/**
 * Selection by detail: which activities and paths two detail shares show, so
 * that every shown activity lies on a directed way from a start to an end
 * over shown paths (docs/ARCHITECTURE.md §2.2).
 */
import { type FlowEdge, type FlowGraph, type FlowNode, byId, hasTag, isStructuralNode } from "./model.js";

/** Tag of a path shown only to keep an activity on a way from start to end, outside the paths share. */
export const ANCHOR_TAG = "anchor";
/** Tag of a path that stands for a way through activities not shown; it has no count. */
export const INDIRECT_TAG = "indirect";

/** The payload of an indirect path: the activities not shown it passes, in their order on the way. */
export const indirectWay = (e: FlowEdge): { hiddenActivities: number; via: string[] } | undefined => (hasTag(e, INDIRECT_TAG) ? (e.payload as { hiddenActivities: number; via: string[] }) : undefined);

/** A binary heap: entries leave by key, then by `tie`; no two entries in one heap share both. */
export class MinHeap<T> {
  private items: { key: number; tie: string; value: T }[] = [];
  push(key: number, value: T, tie = "") {
    const a = this.items;
    a.push({ key, tie, value });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): { key: number; value: T } | undefined {
    const a = this.items;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
  private less(a: { key: number; tie: string }, b: { key: number; tie: string }) {
    return a.key < b.key || (a.key === b.key && a.tie < b.tie);
  }
}

export interface DetailInput {
  base: FlowGraph;
  /** Relative strength of every node and edge, 1 where nothing was measured; a self-loop's may pass 1. */
  nodeStrength: Map<string, number>;
  /** The second key of the activities' rank: their events, relative, where measured. */
  nodeEvents: Map<string, number>;
  edgeStrength: Map<string, number>;
  /** The activities and paths nothing measured: shown at every share, a path when both its ends are. */
  unmeasured: Set<string>;
  activityDetail: number;
  pathDetail: number;
  /** Node and path ids shown at every share (protected marks, `keep`), a path's ends among them. */
  required: Set<string>;
}

export interface DetailSelection {
  /** The shown nodes and edges in the base graph's order, then the indirect paths by id. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** The nodes the activity share shows, events, gateways and activities nothing measured included. */
  byShare: Set<string>;
  /** The paths shown by frequency (with every one nothing measured), and the anchor paths. */
  frequent: Set<string>;
  anchors: Set<string>;
  /** For every anchor-only path, by id, the activities, stages and gateways it keeps on a way. */
  keeps: Record<string, string[]>;
  /** The measured paths in their rank, strongest first. */
  ranked: FlowEdge[];
  /** The numbers of activities the share can show (`rankActivities`) and how many it shows. */
  stops: number[];
  count: number;
}

interface Way {
  nodes: string[];
  edges: FlowEdge[];
}

const EPSILON = 1e-9;
/** How many of `n` ranked elements a share shows: the share of them rounded up. */
export const within = (share: number, n: number) => Math.min(n, Math.max(0, Math.ceil(Math.min(1, Math.max(0, share)) * n - EPSILON)));

/** The measured activities in their rank (cases, then events, then id) and the numbers that end a tie of cases and events. */
export function rankActivities(nodes: FlowNode[], nodeStrength: Map<string, number>, nodeEvents: Map<string, number>, unmeasured: Set<string>): { measured: FlowNode[]; stops: number[] } {
  const events = (n: FlowNode) => nodeEvents.get(n.id) ?? 0;
  const strength = (n: FlowNode) => nodeStrength.get(n.id)!;
  const measured = nodes.filter((n) => !isStructuralNode(n) && !unmeasured.has(n.id)).sort((a, b) => strength(b) - strength(a) || events(b) - events(a) || byId(a, b));
  const stops = measured.flatMap((n, i) => (i + 1 < measured.length && strength(measured[i + 1]) === strength(n) && events(measured[i + 1]) === events(n) ? [] : [i + 1]));
  return { measured, stops };
}

/**
 * The anchoring way of `v` (`back`: into it, otherwise out of it): its
 * strongest path from (to) a more frequent node or a start (an end), then id;
 * without one, the way through less frequent nodes whose rarest node is the
 * most frequent possible, then the fewest steps, then the smallest path ids
 * from `v` on. Only nodes a start reaches (that reach an end) count, `live`.
 * The way's nodes and edges run in the direction of the paths.
 */
function anchorWay(v: string, back: boolean, rank: Map<string, number>, near: Map<string, FlowEdge[]>, terminal: (id: string) => boolean, live: Set<string>, strength: (e: FlowEdge) => number): Way | undefined {
  if (!live.has(v)) return undefined;
  const other = (e: FlowEdge) => (back ? e.source : e.target);
  const anchoring = (id: string) => terminal(id) || (live.has(id) && rank.get(id)! < rank.get(v)!);
  let best: FlowEdge | undefined;
  for (const e of near.get(v)!) if (anchoring(other(e)) && (!best || strength(e) > strength(best))) best = e;
  if (best) return back ? { nodes: [best.source, v], edges: [best] } : { nodes: [v, best.target], edges: [best] };
  // The rarest node a way must pass at the least: a search keyed by the rarest node passed so far.
  const rarest = new Map<string, number>([[v, 0]]);
  const heap = new MinHeap<string>();
  heap.push(0, v, v);
  let limit: number | undefined;
  for (let top = heap.pop(); top && limit === undefined; top = heap.pop()) {
    const { key: k, value: at } = top;
    if (k > rarest.get(at)!) continue;
    if (at !== v && anchoring(at)) limit = k;
    else {
      for (const e of near.get(at)!) {
        const next = other(e);
        if (!live.has(next)) continue;
        const nk = anchoring(next) ? k : Math.max(k, rank.get(next)!);
        if (next !== v && !(rarest.get(next)! <= nk)) {
          rarest.set(next, nk);
          heap.push(nk, next, next);
        }
      }
    }
  }
  if (limit === undefined) return undefined;
  // Of the ways through nodes no rarer than that, the fewest steps, then the smallest path ids from v on.
  const via = new Map<string, FlowEdge>();
  const queue = [v];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at !== v && anchoring(at)) {
      const nodes = [at];
      const edges: FlowEdge[] = [];
      for (let id = at; id !== v; ) {
        const e = via.get(id)!;
        edges.push(e);
        id = back ? e.target : e.source;
        nodes.push(id);
      }
      return back ? { nodes, edges } : { nodes: nodes.reverse(), edges: edges.reverse() };
    }
    for (const e of near.get(at)!) {
      const next = other(e);
      if (next === v || via.has(next) || !live.has(next) || (!anchoring(next) && rank.get(next)! > limit)) continue;
      via.set(next, e);
      queue.push(next);
    }
  }
  return undefined;
}

/**
 * Select by detail on a graph whose stages are already collapsed. Activities
 * enter by rank (cases, then events, then id; a tie enters whole), paths by
 * their rank in the whole graph (count, then id). Every shown node keeps its
 * anchoring ways into it and out of it, followed through anchoring nodes not
 * shown to the first shown one; a stretch of nodes not shown on them becomes
 * one indirect path, named by its way.
 */
export function selectByDetail(input: DetailInput): DetailSelection {
  const { base, nodeStrength, edgeStrength, unmeasured, required } = input;
  const nodeEvents = (n: FlowNode) => input.nodeEvents.get(n.id) ?? 0;
  const nodeById = new Map(base.nodes.map((n) => [n.id, n]));
  const strengthOf = (e: FlowEdge) => edgeStrength.get(e.id) ?? 1;
  const ordered = base.nodes.filter((n) => !isStructuralNode(n)).sort((a, b) => nodeStrength.get(b.id)! - nodeStrength.get(a.id)! || nodeEvents(b) - nodeEvents(a) || byId(a, b));
  const rank = new Map([...base.nodes.filter(isStructuralNode).sort(byId), ...ordered].map((n, i) => [n.id, i]));
  // The share counts the measured activities, up to the end of a tie; an activity nothing measured is always shown.
  const { measured, stops } = rankActivities(base.nodes, nodeStrength, input.nodeEvents, unmeasured);
  const count = stops.find((n) => n >= within(input.activityDetail, measured.length)) ?? 0;
  const byShare = new Set([...base.nodes.filter((n) => isStructuralNode(n) || unmeasured.has(n.id)), ...measured.slice(0, count)].map((n) => n.id));
  const shown = new Set(byShare);
  for (const id of required) if (nodeById.has(id)) shown.add(id);

  const paths = base.edges.filter((e) => e.kind !== "constraint" && nodeById.has(e.source) && nodeById.has(e.target));
  const ranked = paths.filter((e) => !unmeasured.has(e.id)).sort((a, b) => strengthOf(b) - strengthOf(a) || byId(a, b));
  const frequent = new Set([...unmeasured, ...ranked.slice(0, within(input.pathDetail, ranked.length)).map((e) => e.id)]);

  const into = new Map<string, FlowEdge[]>(base.nodes.map((n) => [n.id, []]));
  const out = new Map<string, FlowEdge[]>(base.nodes.map((n) => [n.id, []]));
  for (const e of [...paths].sort(byId)) {
    if (e.source === e.target) continue;
    out.get(e.source)!.push(e);
    into.get(e.target)!.push(e);
  }
  const terminal = (back: boolean) => (n: string) => nodeById.get(n)!.kind === "event" && hasTag(nodeById.get(n), back ? "start" : "end");
  // The nodes a start reaches, and those that reach an end: only these can anchor.
  const reached = (back: boolean) => {
    const live = new Set(base.nodes.map((n) => n.id).filter(terminal(back)));
    for (const id of live) for (const e of (back ? out : into).get(id)!) live.add(back ? e.target : e.source);
    return live;
  };
  const live = [reached(false), reached(true)];
  const ways = new Map<string, Way | undefined>();
  const wayOf = (id: string, back: boolean): Way | undefined => {
    const key = `${+back}${id}`;
    if (!ways.has(key)) ways.set(key, terminal(back)(id) ? undefined : anchorWay(id, back, rank, back ? into : out, terminal(back), live[+back], strengthOf));
    return ways.get(key);
  };

  const anchors = new Set<string>();
  const keeps = new Map<string, Set<string>>();
  // Every stretch through hidden nodes, by its way: the same stretch from two walks is one indirect path.
  const indirect = new Map<string, string[]>();
  // The shown activities, and each shown node where one's ways stop (a gateway): it needs its own.
  for (const back of [true, false]) {
    const queue = [...shown].filter((id) => !isStructuralNode(nodeById.get(id)!)).sort();
    const queued = new Set(queue);
    for (let v = queue.shift(); v !== undefined; v = queue.shift()) {
      // The ways from the first shown anchoring node to v (or from v to it), joined.
      const parts: Way[] = [];
      for (let at = v, w = wayOf(at, back); w; w = wayOf(at, back)) {
        parts.push(w);
        at = back ? w.nodes[0] : w.nodes[w.nodes.length - 1];
        if (!shown.has(at)) continue;
        if (!queued.has(at)) {
          queue.push(at);
          queued.add(at);
        }
        break;
      }
      if (back) parts.reverse();
      const nodes = parts.flatMap((w, i) => (i ? w.nodes.slice(1) : w.nodes));
      const edges = parts.flatMap((w) => w.edges);
      let from = -1;
      nodes.forEach((id, i) => {
        if (!shown.has(id)) return;
        if (from >= 0 && nodes[from] !== id) {
          if (i === from + 1) {
            anchors.add(edges[from].id);
            if (!keeps.has(edges[from].id)) keeps.set(edges[from].id, new Set());
            keeps.get(edges[from].id)!.add(v);
          } else {
            const hidden = [...new Set(nodes.slice(from + 1, i))];
            indirect.set([nodes[from], ...hidden, id].join("->"), [nodes[from], ...hidden, id]);
          }
        }
        from = i;
      });
    }
  }

  const nodes = base.nodes.filter((n) => shown.has(n.id));
  const edges: FlowEdge[] = [];
  for (const e of base.edges) {
    if (!shown.has(e.source) || !shown.has(e.target)) continue;
    if (!frequent.has(e.id) && anchors.has(e.id)) edges.push({ ...e, tags: [...new Set([...(e.tags ?? []), ANCHOR_TAG])] });
    else if (e.kind === "constraint" || frequent.has(e.id) || required.has(e.id)) edges.push(e);
  }
  const keepsOut = Object.fromEntries([...anchors].filter((id) => !frequent.has(id)).sort().map((id) => [id, [...keeps.get(id)!].sort()]));
  const used = new Set([...base.nodes, ...base.edges, ...(base.groups ?? [])].map((el) => el.id));
  const added = [...indirect].map(([way, stretch]) => {
    const [source, via, target] = [stretch[0], stretch.slice(1, -1), stretch[stretch.length - 1]];
    let id = `${way}:indirect`;
    for (let n = 2; used.has(id); n++) id = `${way}:indirect:${n}`;
    used.add(id);
    return { id, kind: "follows" as const, source, target, tags: [INDIRECT_TAG], payload: { hiddenActivities: via.length, via } };
  });
  return { nodes, edges: [...edges, ...added.sort(byId)], byShare, frequent, anchors, keeps: keepsOut, ranked, stops, count };
}
