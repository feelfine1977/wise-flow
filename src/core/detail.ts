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
  /** The second key of the activities' rank: their events, relative. */
  nodeEvents: Map<string, number>;
  edgeStrength: Map<string, number>;
  activityDetail: number;
  pathDetail: number;
  /** Node and path ids shown at every share (protected marks, `keep`), a path's ends among them. */
  required: Set<string>;
}

export interface DetailSelection {
  /** The shown nodes and edges in the base graph's order, then the indirect paths by id. */
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** The nodes the activity share shows, events and gateways included. */
  byShare: Set<string>;
  /** The paths shown by frequency, and the anchor paths. */
  frequent: Set<string>;
  anchors: Set<string>;
  /** For every anchor-only path, by id, the activities, stages and gateways it keeps on a way. */
  keeps: Record<string, string[]>;
  /** The paths in their rank, strongest first. */
  ranked: FlowEdge[];
}

interface Way {
  nodes: string[];
  edges: FlowEdge[];
}

const EPSILON = 1e-9;
const within = (share: number, n: number) => Math.min(n, Math.max(0, Math.ceil(Math.min(1, Math.max(0, share)) * n - EPSILON)));

/**
 * The anchoring way of `v` (`back`: into it, otherwise out of it): its
 * strongest path from (to) a more frequent node or a start (an end), then id;
 * without one, the way through less frequent nodes whose rarest node is the
 * most frequent possible, then the fewest steps, then the smallest ids. The
 * way's nodes and edges run in the direction of the paths.
 */
function anchorWay(v: string, back: boolean, rank: Map<string, number>, near: Map<string, FlowEdge[]>, terminal: (id: string) => boolean, strength: (e: FlowEdge) => number): Way | undefined {
  const other = (e: FlowEdge) => (back ? e.source : e.target);
  const anchoring = (id: string) => terminal(id) || rank.get(id)! < rank.get(v)!;
  let best: FlowEdge | undefined;
  for (const e of near.get(v)!) if (anchoring(other(e)) && (!best || strength(e) > strength(best))) best = e;
  if (best) return back ? { nodes: [best.source, v], edges: [best] } : { nodes: [v, best.target], edges: [best] };
  // Ordered by the rarest node passed, then by steps: a key of rarity · (n + 1) + steps.
  const scale = rank.size + 1;
  const key = new Map<string, number>([[v, 0]]);
  const via = new Map<string, FlowEdge>();
  const heap = new MinHeap<string>();
  heap.push(0, v, v);
  for (let top = heap.pop(); top; top = heap.pop()) {
    const { key: k, value: at } = top;
    if (k > key.get(at)!) continue;
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
    const rarest = Math.floor(k / scale);
    for (const e of near.get(at)!) {
      const next = other(e);
      if (next === v) continue;
      const nk = (anchoring(next) ? rarest : Math.max(rarest, rank.get(next)!)) * scale + (k % scale) + 1;
      const old = key.get(next);
      if (old === undefined || nk < old) {
        key.set(next, nk);
        via.set(next, e);
        heap.push(nk, next, next);
      } else if (nk === old && e.id < via.get(next)!.id) via.set(next, e);
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
 * one indirect path.
 */
export function selectByDetail(input: DetailInput): DetailSelection {
  const { base, nodeStrength, nodeEvents, edgeStrength, required } = input;
  const nodeById = new Map(base.nodes.map((n) => [n.id, n]));
  const strengthOf = (e: FlowEdge) => edgeStrength.get(e.id) ?? 1;
  const ordered = base.nodes.filter((n) => !isStructuralNode(n)).sort((a, b) => nodeStrength.get(b.id)! - nodeStrength.get(a.id)! || nodeEvents.get(b.id)! - nodeEvents.get(a.id)! || byId(a, b));
  const rank = new Map([...base.nodes.filter(isStructuralNode).sort(byId), ...ordered].map((n, i) => [n.id, i]));
  let count = ordered.length ? Math.max(1, within(input.activityDetail, ordered.length)) : 0;
  const tied = (a: FlowNode, b: FlowNode) => nodeStrength.get(a.id) === nodeStrength.get(b.id) && nodeEvents.get(a.id) === nodeEvents.get(b.id);
  while (count < ordered.length && tied(ordered[count], ordered[count - 1])) count++;
  const byShare = new Set([...base.nodes.filter(isStructuralNode), ...ordered.slice(0, count)].map((n) => n.id));
  const shown = new Set(byShare);
  for (const id of required) if (nodeById.has(id)) shown.add(id);

  const paths = base.edges.filter((e) => e.kind !== "constraint" && nodeById.has(e.source) && nodeById.has(e.target));
  const ranked = [...paths].sort((a, b) => strengthOf(b) - strengthOf(a) || byId(a, b));
  const frequent = new Set(ranked.slice(0, within(input.pathDetail, ranked.length)).map((e) => e.id));

  const into = new Map<string, FlowEdge[]>(base.nodes.map((n) => [n.id, []]));
  const out = new Map<string, FlowEdge[]>(base.nodes.map((n) => [n.id, []]));
  for (const e of [...paths].sort(byId)) {
    if (e.source === e.target) continue;
    out.get(e.source)!.push(e);
    into.get(e.target)!.push(e);
  }
  const ways = new Map<string, Way | undefined>();
  const wayOf = (id: string, back: boolean): Way | undefined => {
    const terminal = (n: string) => nodeById.get(n)!.kind === "event" && hasTag(nodeById.get(n), back ? "start" : "end");
    const key = `${+back}${id}`;
    if (!ways.has(key)) ways.set(key, terminal(id) ? undefined : anchorWay(id, back, rank, back ? into : out, terminal, strengthOf));
    return ways.get(key);
  };

  const anchors = new Set<string>();
  const keeps = new Map<string, Set<string>>();
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
            const pair = `${nodes[from]}\u0000${id}`;
            const was = indirect.get(pair);
            if (!was || hidden.length < was.length || (hidden.length === was.length && hidden.join("\u0000") < was.join("\u0000"))) indirect.set(pair, hidden);
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
  const added = [...indirect].map(([pair, via]) => {
    const [source, target] = pair.split("\u0000");
    let id = `${source}->${target}:indirect`;
    for (let n = 2; used.has(id); n++) id = `${source}->${target}:indirect:${n}`;
    used.add(id);
    return { id, kind: "follows" as const, source, target, tags: [INDIRECT_TAG], payload: { hiddenActivities: via.length, via } };
  });
  return { nodes, edges: [...edges, ...added.sort(byId)], byShare, frequent, anchors, keeps: keepsOut, ranked };
}
