import { collapsedActivityIds, shownActivityIds } from "./collapsed-members.js";
/**
 * Aggregation: abstraction by frequency or performance with a keep-connected
 * guarantee, stage collapse (semantic zoom) and diff maps.
 */
import type { MetricBasis } from "./metrics.js";
import {
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type Metrics,
  type ModelOutline,
  type Overlay,
  MAP_TARGET,
  byId,
  indexGraph,
  isStructuralNode,
  metric,
} from "./model.js";

export interface AbstractOptions {
  /** Follows edges whose relative strength is below this share are removed. 0 keeps every edge. */
  minEdgeShare?: number;
  /** Activities and stages whose relative strength is below this share are removed. 0 keeps every node. */
  minNodeShare?: number;
  /** Re-add the strongest removed elements until the map is connected again. Default `true`. */
  keepConnected?: boolean;
  /** Group ids to collapse into one stage node each; `"all"` collapses every stage group. */
  collapse?: string[] | "all" | false;
  /** Metric that measures edge strength. Default: `count`, then `cases`, then `share`. */
  edgeMetric?: string;
  /** Metric that measures node strength. Default: `cases`, then `events`, then `share`. */
  nodeMetric?: string;
  /** Strength is measured relative to the maximum (default) or to the total of the metric. */
  relativeTo?: "max" | "total";
  /** Node ids that are never removed. Events and gateways are never removed anyway. */
  keep?: string[];
}

export const RECONNECTED_TAG = "reconnected";
export const COLLAPSED_TAG = "collapsed";

const EDGE_METRICS = ["count", "cases", "share"];
const NODE_METRICS = ["cases", "events", "share"];

function firstMetric(el: { metrics?: Metrics }, candidates: string[]): number | undefined {
  for (const c of candidates) {
    const v = el.metrics?.[c];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Relative strength in [0, 1] of every element, computed from the first available
 * metric. Elements without a metric get strength 1 so that thresholds never remove
 * elements the caller did not measure.
 */
export function strengths<T extends { id: string; metrics?: Metrics }>(
  items: T[],
  candidates: string[],
  relativeTo: "max" | "total" = "max",
): Map<string, number> {
  const values = new Map<string, number>();
  let denominator = 0;
  for (const it of items) {
    const v = firstMetric(it, candidates);
    if (v === undefined) continue;
    values.set(it.id, Math.max(0, v));
    denominator = relativeTo === "max" ? Math.max(denominator, v) : denominator + Math.max(0, v);
  }
  const out = new Map<string, number>();
  for (const it of items) {
    const v = values.get(it.id);
    out.set(it.id, v === undefined || denominator <= 0 ? 1 : v / denominator);
  }
  return out;
}

/**
 * The metrics of merged elements: counts summed (exact), cases and shares the
 * maximum (a lower bound once more than one element is merged: the cases they
 * share are not known), every other metric a mean weighted by the first of
 * `weightKey` (a mean, not the metric of the whole). What is not exact is
 * listed in `basis`; a value an element already carried as a bound or a mean
 * stays one.
 */
function sumMetrics(items: { metrics?: Metrics; metricBasis?: Partial<Record<string, MetricBasis>> }[], weightKey: string[]): { metrics: Metrics; basis?: Partial<Record<string, MetricBasis>> } {
  const SUM = new Set(["events", "count", "starts", "ends", "violations", "internalCount"]);
  const MAX = new Set(["cases", "share"]);
  const names = new Set<string>();
  for (const it of items) for (const k of Object.keys(it.metrics ?? {})) names.add(k);
  const out: Metrics = {};
  const basis: Partial<Record<string, MetricBasis>> = {};
  for (const name of names) {
    let sum = 0;
    let max = -Infinity;
    let weighted = 0;
    let weightSum = 0;
    let n = 0;
    let given: MetricBasis | undefined;
    for (const it of items) {
      const v = it.metrics?.[name];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      n++;
      sum += v;
      max = Math.max(max, v);
      const w = firstMetric(it, weightKey) ?? 1;
      weighted += v * w;
      weightSum += w;
      given = it.metricBasis?.[name] === "mean" ? "mean" : (given ?? it.metricBasis?.[name]);
    }
    if (!n) continue;
    if (SUM.has(name)) out[name] = sum;
    else if (MAX.has(name)) out[name] = max;
    else out[name] = weightSum > 0 ? weighted / weightSum : sum / items.length;
    const merged = n > 1 && !SUM.has(name) ? (MAX.has(name) ? "atLeast" : "mean") : undefined;
    const b = merged === "mean" || given === "mean" ? "mean" : (merged ?? given);
    if (b) basis[name] = b;
  }
  return Object.keys(basis).length ? { metrics: out, basis } : { metrics: out };
}

/**
 * Collapse the members of the given stage groups into one `stage` node per group.
 * The stage node takes the group's id and label. Internal edges are dropped and
 * counted in the stage node's `internalCount`; parallel edges are merged (counts
 * summed, cases and shares taken as the maximum, other metrics averaged by weight).
 * Of more than one merged element, the maximum of cases and share is marked a lower
 * bound and an average a mean (`metricBasis`); the values themselves are not changed.
 * Overlays remain separate: member/internal-edge targets move to the stage and
 * parallel-edge targets move to the merged edge, without averaging overlay values.
 * Folded arcs become labeled chips. `meta.collapsedMembers` retains original
 * activities; `meta.collapsedEdgeTargets` maps original edges to displayed targets
 * (a stage id for internal edges). Response focus and paths retain their identity.
 */
export function collapseGroups(graph: FlowGraph, groups: string[] | "all"): FlowGraph {
  const idx = indexGraph(graph);
  const requested = [...new Set(
    groups === "all"
      ? [...idx.groups.values()].filter((g) => g.kind === "stage" && !g.parent).map((g) => g.id)
      : groups.filter((id) => idx.groups.has(id)))];
  if (requested.length === 0) return graph;
  const collapsedRoots = new Set(requested);
  const chainOf = (groupId: string): FlowGroup[] => {
    const own = idx.groups.get(groupId);
    return own ? [own, ...idx.ancestors(groupId, "group")] : [];
  };
  const collapsedAll = new Set([...idx.groups.keys()].filter((id) => chainOf(id).some((g) => collapsedRoots.has(g.id))));

  // Map every group to the outermost collapsed root that swallows it.
  const rootOf = (groupId: string): string | undefined => chainOf(groupId).filter((g) => collapsedRoots.has(g.id)).pop()?.id;
  const roots = requested.filter((id) => rootOf(id) === id);
  const collapsedMembers = new Map(Object.entries((graph.meta?.collapsedMembers ?? {}) as Record<string, string[]>));
  const nodeTarget = new Map<string, string>();
  const membersOf = new Map<string, FlowNode[]>();
  for (const n of graph.nodes) {
    const root = n.group ? rootOf(n.group) : undefined;
    if (root) {
      nodeTarget.set(n.id, root);
      if (!membersOf.has(root)) membersOf.set(root, []);
      membersOf.get(root)!.push(n);
    }
  }

  const nodes: FlowNode[] = [];
  const emitted = new Set<string>();
  for (const n of graph.nodes) {
    const root = nodeTarget.get(n.id);
    if (!root) {
      nodes.push(n);
      continue;
    }
    if (emitted.has(root)) continue;
    emitted.add(root);
    const group = idx.groups.get(root)!;
    const members = membersOf.get(root)!;
    collapsedMembers.set(root, [...new Set(members.flatMap((member) => collapsedActivityIds(graph, member.id) ?? (member.kind === "activity" ? [member.id] : [])))]);
    const { metrics, basis } = sumMetrics(members, ["cases", "events"]);
    nodes.push({
      id: root,
      kind: "stage",
      label: group.label,
      group: group.parent,
      metrics: { ...metrics, members: members.length },
      ...(basis && { metricBasis: basis }),
      tags: [COLLAPSED_TAG],
    });
  }
  for (const root of roots) {
    if (!emitted.has(root)) {
      const group = idx.groups.get(root)!;
      collapsedMembers.set(root, []);
      nodes.push({ id: root, kind: "stage", label: group.label, group: group.parent, metrics: { members: 0 }, tags: [COLLAPSED_TAG] });
    }
  }

  const merged = new Map<string, FlowEdge[]>();
  const edgeTarget = new Map<string, string>();
  const internal = new Map<string, number>();
  const order: string[] = [];
  for (const e of graph.edges) {
    const s = nodeTarget.get(e.source) ?? e.source;
    const t = nodeTarget.get(e.target) ?? e.target;
    if (s === t && nodeTarget.has(e.source) && nodeTarget.has(e.target)) {
      internal.set(s, (internal.get(s) ?? 0) + metric(e, "count", 1));
      edgeTarget.set(e.id, s);
      continue;
    }
    const key = JSON.stringify([e.kind, s, t]);
    if (!merged.has(key)) {
      merged.set(key, []);
      order.push(key);
    }
    merged.get(key)!.push({ ...e, source: s, target: t });
  }
  // Keep singleton ids unchanged and reserve node/group ids to avoid ambiguous targets.
  const usedIds = new Set([...nodes.map((n) => n.id), ...(graph.groups ?? []).map((g) => g.id), ...[...merged.values()].filter((list) => list.length === 1).map((list) => list[0].id)]);
  const edges: FlowEdge[] = order.map((key) => {
    const list = merged.get(key)!;
    if (list.length === 1) {
      edgeTarget.set(list[0].id, list[0].id);
      return list[0];
    }
    const first = list[0];
    const baseId = `${first.source}->${first.target}`;
    let id = baseId;
    for (let suffix = 1; usedIds.has(id); suffix++) id = `${baseId}:${first.kind}:${suffix}`;
    usedIds.add(id);
    for (const edge of list) edgeTarget.set(edge.id, id);
    const { metrics, basis } = sumMetrics(list, ["count", "cases"]);
    return {
      id,
      kind: first.kind,
      source: first.source,
      target: first.target,
      metrics,
      ...(basis && { metricBasis: basis }),
      tags: [...new Set(list.flatMap((e) => e.tags ?? []))],
    };
  });
  for (const n of nodes) {
    const c = internal.get(n.id);
    if (c !== undefined) n.metrics = { ...(n.metrics ?? {}), internalCount: c };
  }

  const targetOf = (id: string) => nodeTarget.get(id) ?? rootOf(id) ?? edgeTarget.get(id) ?? id;
  const collapsedEdgeTargets = new Map(edgeTarget);
  const previousTargets = graph.meta?.collapsedEdgeTargets;
  if (previousTargets && typeof previousTargets === "object") {
    for (const [id, target] of Object.entries(previousTargets)) {
      if (typeof target === "string") collapsedEdgeTargets.set(id, targetOf(target));
    }
  }
  const overlays: Overlay[] | undefined = graph.overlays
    ?.map((o) => {
      const target = targetOf(o.target);
      if (o.kind === "arc" && o.payload?.source && o.payload?.target) {
        const s = targetOf(String(o.payload.source));
        const t = targetOf(String(o.payload.target));
        if (s === t) return { ...o, kind: "chip" as const, target: s, payload: { ...o.payload, source: s, target: t, text: `${o.payload.text ?? o.payload.label ?? "Arc"} (inside collapsed stage)` } };
        return { ...o, target, payload: { ...o.payload, source: s, target: t } };
      }
      return target === o.target ? o : { ...o, target };
    });

  return {
    ...graph,
    nodes,
    edges,
    groups: (graph.groups ?? []).filter((g) => !collapsedAll.has(g.id)),
    overlays,
    meta: { ...(graph.meta ?? {}), collapsed: roots, collapsedMembers: Object.fromEntries(collapsedMembers), collapsedEdgeTargets: Object.fromEntries(collapsedEdgeTargets) },
  };
}

interface Adjacency {
  neighbours: Map<string, { edge: FlowEdge; other: string }[]>;
}

function undirectedAdjacency(edges: FlowEdge[], nodeIds: Set<string>): Adjacency {
  const neighbours = new Map<string, { edge: FlowEdge; other: string }[]>();
  for (const id of nodeIds) neighbours.set(id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    neighbours.get(e.source)!.push({ edge: e, other: e.target });
    neighbours.get(e.target)!.push({ edge: e, other: e.source });
  }
  return { neighbours };
}

/** Connected components (undirected) over the given nodes and edges, keyed by node id. */
export function components(nodeIds: Iterable<string>, edges: FlowEdge[]): Map<string, number> {
  const ids = new Set(nodeIds);
  const adj = undirectedAdjacency(edges, ids);
  const comp = new Map<string, number>();
  let next = 0;
  for (const id of [...ids].sort()) {
    if (comp.has(id)) continue;
    const stack = [id];
    comp.set(id, next);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const { other } of adj.neighbours.get(cur) ?? []) {
        if (!comp.has(other)) {
          comp.set(other, next);
          stack.push(other);
        }
      }
    }
    next++;
  }
  return comp;
}

/** True when the undirected graph over the nodes (ignoring self-loops) has one component. */
export function isConnected(graph: FlowGraph): boolean {
  if (graph.nodes.length === 0) return true;
  const comp = components(
    graph.nodes.map((n) => n.id),
    graph.edges,
  );
  return new Set(comp.values()).size === 1;
}

/** Entries leave by key, then by `tie`; no two entries in one heap share both. */
class MinHeap<T> {
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

/**
 * What `abstract` keeps before it reconnects: the graph it abstracts (with stages
 * collapsed when asked), the kept nodes and edges in input order and the strength
 * of every element. Exported for the reconnection's tests, not from the package.
 */
export interface Thresholded {
  base: FlowGraph;
  nodes: FlowNode[];
  edges: FlowEdge[];
  edgeStrength: Map<string, number>;
  nodeStrength: Map<string, number>;
}

/** Collapse stages and remove weak activities and follows edges, as `abstract` does first. */
export function thresholded(graph: FlowGraph, options: AbstractOptions = {}): Thresholded {
  const { minEdgeShare = 0, minNodeShare = 0, collapse = false, relativeTo = "max" } = options;
  const base = collapse ? collapseGroups(graph, collapse) : graph;
  const edgeCandidates = options.edgeMetric ? [options.edgeMetric, ...EDGE_METRICS] : EDGE_METRICS;
  const nodeCandidates = options.nodeMetric ? [options.nodeMetric, ...NODE_METRICS] : NODE_METRICS;
  const follows = base.edges.filter((e) => e.kind === "follows" && e.source !== e.target);
  const edgeStrength = strengths(follows, edgeCandidates, relativeTo);
  let loopDenominator: number | undefined;
  for (const e of base.edges) {
    if (edgeStrength.has(e.id)) continue;
    if (e.source !== e.target) {
      edgeStrength.set(e.id, 1);
      continue;
    }
    loopDenominator ??= loopStrengthDenominator(follows, edgeCandidates, relativeTo);
    edgeStrength.set(e.id, strengthOfLoop(e, loopDenominator, edgeCandidates));
  }
  const scalable = base.nodes.filter((n) => !isStructuralNode(n));
  const nodeStrength = strengths(scalable, nodeCandidates, relativeTo);
  for (const n of base.nodes) if (!nodeStrength.has(n.id)) nodeStrength.set(n.id, 1);
  const keep = new Set(options.keep ?? []);

  const nodes = base.nodes.filter(
    (n) => isStructuralNode(n) || keep.has(n.id) || (nodeStrength.get(n.id) ?? 1) >= minNodeShare,
  );
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges = base.edges.filter(
    (e) =>
      keptIds.has(e.source) &&
      keptIds.has(e.target) &&
      (e.kind !== "follows" || (edgeStrength.get(e.id) ?? 1) >= minEdgeShare),
  );
  return { base, nodes, edges, edgeStrength, nodeStrength };
}

const tagged = <T extends FlowNode | FlowEdge>(el: T): T => ({ ...el, tags: [...new Set([...(el.tags ?? []), RECONNECTED_TAG])] });

/**
 * Step 1 of the reconnection (docs/ARCHITECTURE.md §2.2): the cheapest direct edges
 * join components, then one search grows the heaviest component and takes in the
 * nearest other one at a time, from all that is joined at distance 0.
 */
export function joinComponents({ base, nodes: keptNodes, edges: keptEdges, edgeStrength, nodeStrength }: Thresholded): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const byNodeId = new Map(base.nodes.map((n) => [n.id, n]));
  const nodes = [...keptNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [...keptEdges];
  const edgeIds = new Set(edges.map((e) => e.id));
  const addEdge = (e: FlowEdge) => {
    if (edgeIds.has(e.id)) return;
    edgeIds.add(e.id);
    edges.push(tagged(e));
  };
  // A path costs 1 per edge plus the edge's weakness, so each removed node on it adds at least 1.
  const cost = (e: FlowEdge) => 1 + (1 - (edgeStrength.get(e.id) ?? 1));
  const parent = new Map<string, string>();
  for (const id of nodeIds) parent.set(id, id);
  const find = (id: string): string => {
    for (let up = parent.get(id)!; up !== id; up = parent.get(id)!) {
      const top = parent.get(up)!;
      parent.set(id, top);
      id = top;
    }
    return id;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent.set(ra, rb);
    return true;
  };
  for (const e of edges) union(e.source, e.target);
  const direct = base.edges
    .filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target) && !edgeIds.has(e.id))
    .sort((a, b) => cost(a) - cost(b) || byId(a, b));
  for (const e of direct) if (union(e.source, e.target)) addEdge(e);

  // Components by their smallest node id, weighed by the strength of their activities.
  const members = new Map<string, string[]>();
  const weight = new Map<string, number>();
  for (const id of [...nodeIds].sort()) {
    const root = find(id);
    if (!members.has(root)) members.set(root, []);
    members.get(root)!.push(id);
    weight.set(root, (weight.get(root) ?? 0) + (isStructuralNode(byNodeId.get(id)!) ? 0 : (nodeStrength.get(id) ?? 1)));
  }
  if (members.size < 2) return { nodes, edges };
  let main = "";
  let heaviest = -1;
  for (const [root, w] of weight) if (w > heaviest) [main, heaviest] = [root, w];

  const adjacency = undirectedAdjacency(base.edges, new Set(byNodeId.keys())).neighbours;
  const dist = new Map<string, number>();
  const via = new Map<string, FlowEdge>();
  const joined = new Set<string>();
  const heap = new MinHeap<string>();
  const join = (id: string) => {
    joined.add(id);
    dist.set(id, 0);
    heap.push(0, id, id);
  };
  const absorb = (root: string) => members.get(root)!.forEach(join);
  absorb(main);
  for (let top = heap.pop(); top; top = heap.pop()) {
    const { key: d, value: at } = top;
    if (d > dist.get(at)!) continue;
    if (nodeIds.has(at) && !joined.has(at)) {
      // The nearest component: re-add the path back to what is joined, then the
      // cheapest direct edge from a re-added node to each component it touches.
      const added: string[] = [];
      for (let from = at; ; ) {
        const e = via.get(from)!;
        addEdge(e);
        from = e.source === from ? e.target : e.source;
        if (joined.has(from)) break;
        nodeIds.add(from);
        nodes.push(tagged(byNodeId.get(from)!));
        added.push(from);
        join(from);
      }
      absorb(find(at));
      const touched = new Map<string, FlowEdge>();
      for (const id of added) {
        for (const { edge, other } of adjacency.get(id)!) {
          if (!nodeIds.has(other) || joined.has(other)) continue;
          const root = find(other);
          const best = touched.get(root);
          if (!best || (cost(edge) - cost(best) || byId(edge, best)) < 0) touched.set(root, edge);
        }
      }
      for (const [root, e] of touched) {
        addEdge(e);
        absorb(root);
      }
      continue;
    }
    for (const { edge, other } of adjacency.get(at)!) {
      const nd = d + cost(edge);
      const od = dist.get(other);
      if (od === undefined || nd < od) {
        dist.set(other, nd);
        via.set(other, edge);
        heap.push(nd, other, other);
      } else if (nd === od && edge.id < via.get(other)!.id) via.set(other, edge);
    }
  }
  return { nodes, edges };
}

/**
 * Step 2 of the reconnection: every kept activity keeps flow context, an incoming
 * and an outgoing edge where the original graph had one. Open needs (a node without
 * incoming or without outgoing edges) are served by the original edge that closes
 * the most needs at once, then by strength, so that one edge serving two nodes is
 * never replaced by two edges. Nodes re-added by step 1 are reconnection artefacts
 * and are left as they are. Both rules keep the result monotone in the thresholds.
 */
function restoreFlowContext(
  { base, nodes: keptNodes, edgeStrength }: Thresholded,
  joined: { nodes: FlowNode[]; edges: FlowEdge[] },
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodeIds = new Set(joined.nodes.map((n) => n.id));
  const { edges } = joined;
  const edgeIds = new Set(edges.map((e) => e.id));
  const open = new Set(keptNodes.filter((n) => !isStructuralNode(n)).map((n) => n.id));
  const hasIn = new Set<string>();
  const hasOut = new Set<string>();
  const note = (e: FlowEdge) => {
    if (e.source === e.target) return;
    hasOut.add(e.source);
    hasIn.add(e.target);
  };
  for (const e of edges) note(e);
  // Asked only about the ends of candidates, which are original edges between two
  // different nodes, so the original had an incoming or outgoing edge there.
  const needsIn = (id: string) => open.has(id) && !hasIn.has(id);
  const needsOut = (id: string) => open.has(id) && !hasOut.has(id);
  const candidates = base.edges.filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target) && !edgeIds.has(e.id));
  // Each step takes the candidate that closes the most needs, then the strongest, then
  // the smallest id, then the first. Scores only fall as needs close, so candidates wait
  // in a heap under the score they had when queued and are requeued when it has fallen.
  const strength = candidates.map((e) => edgeStrength.get(e.id) ?? 1);
  const rank = new Array<number>(candidates.length);
  candidates
    .map((_, i) => i)
    .sort((a, b) => strength[b] - strength[a] || byId(candidates[a], candidates[b]) || a - b)
    .forEach((i, r) => (rank[i] = r));
  const scoreOf = (e: FlowEdge) => (needsOut(e.source) ? 1 : 0) + (needsIn(e.target) ? 1 : 0);
  const queued = new MinHeap<{ index: number; score: number }>();
  const queue = (index: number, score: number) => queued.push((2 - score) * candidates.length + rank[index], { index, score });
  candidates.forEach((e, i) => {
    const score = scoreOf(e);
    if (score > 0) queue(i, score);
  });
  while (queued.size) {
    const { index, score: was } = queued.pop()!.value;
    const e = candidates[index];
    if (edgeIds.has(e.id)) continue;
    const score = scoreOf(e);
    if (score === 0) continue;
    if (score < was) {
      queue(index, score);
      continue;
    }
    edgeIds.add(e.id);
    edges.push(tagged(e));
    note(e);
  }
  return joined;
}

/**
 * Abstract a graph: optionally collapse stage groups, then remove weak activities and
 * weak follows edges, then (by default) restore connectivity with the strongest removed
 * elements. Structural nodes (events, gateways), constraint and flow edges are kept.
 * The result keeps the input order of elements; re-added elements are tagged.
 * `meta.model` records the activities, paths and group order of the graph
 * before any abstraction (kept from an earlier one): a figure's caption
 * reports how much of it is shown, and stage colours follow its order.
 */
export function abstract(graph: FlowGraph, options: AbstractOptions = {}): FlowGraph {
  const { minEdgeShare = 0, minNodeShare = 0, keepConnected = true, collapse = false } = options;
  const kept = thresholded(graph, options);
  const { base } = kept;
  let { nodes, edges } = kept;
  if (keepConnected) {
    const r = restoreFlowContext(kept, joinComponents(kept));
    // Keep the original element order for stable rendering.
    const nodeOrder = new Map(base.nodes.map((n, i) => [n.id, i]));
    const edgeOrder = new Map(base.edges.map((e, i) => [e.id, i]));
    nodes = r.nodes.sort((a, b) => (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0));
    edges = r.edges.sort((a, b) => (edgeOrder.get(a.id) ?? 0) - (edgeOrder.get(b.id) ?? 0));
  }
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edgeSet = new Set(edges.map((e) => e.id));
  const usedGroups = new Set<string>();
  const baseIdx = indexGraph({ nodes: [], edges: [], groups: base.groups });
  for (const n of nodes) {
    const own = n.group ? baseIdx.groups.get(n.group) : undefined;
    if (!own) continue;
    usedGroups.add(own.id);
    for (const g of baseIdx.ancestors(own.id, "group")) usedGroups.add(g.id);
  }
  const groups = (base.groups ?? []).filter((g) => usedGroups.has(g.id));
  const survives = (id: unknown) => typeof id === "string" && (nodeSet.has(id) || usedGroups.has(id));
  const overlays = base.overlays?.filter((o) =>
    o.kind === "arc" && o.payload?.source !== undefined && o.payload?.target !== undefined
      ? survives(o.payload.source) && survives(o.payload.target)
      : o.target === MAP_TARGET || nodeSet.has(o.target) || edgeSet.has(o.target) || usedGroups.has(o.target),
  );
  return {
    ...base,
    nodes,
    edges,
    groups,
    overlays,
    meta: {
      ...(base.meta ?? {}),
      abstraction: { minEdgeShare, minNodeShare, keepConnected, collapse: collapse || undefined },
      // The model before any abstraction: a figure's caption reports its size, stage colours follow its groups' order.
      model: base.meta?.model ?? modelOutline(graph),
    },
  };
}

/**
 * A graph's outline as the model: its activities (a collapsed stage's
 * members included), its paths (not known once a stage is collapsed: merged
 * paths are not the model's) and its groups' order.
 */
function modelOutline(graph: FlowGraph): ModelOutline {
  const { ids, collapsed } = shownActivityIds(graph);
  const paths = collapsed ? undefined : graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target).length;
  return { activities: ids.size, ...(paths !== undefined && { paths }), groups: (graph.groups ?? []).map((g) => g.id) };
}

/** The maximum or the total of the follows edges' metric, which self-loops are measured against. */
function loopStrengthDenominator(follows: FlowEdge[], candidates: string[], relativeTo: "max" | "total"): number {
  let denominator = 0;
  for (const f of follows) {
    const fv = firstMetric(f, candidates);
    if (fv === undefined) continue;
    denominator = relativeTo === "max" ? Math.max(denominator, fv) : denominator + fv;
  }
  return denominator;
}

function strengthOfLoop(e: FlowEdge, denominator: number, candidates: string[]): number {
  const v = firstMetric(e, candidates);
  if (v === undefined) return 1;
  return denominator > 0 ? Math.min(1, v / denominator) : 1;
}

interface DiffOptions {
  /** Metrics to compare; default: every metric present on either side. */
  metrics?: string[];
}

export const DIFF_TAGS = { onlyA: "only-a", onlyB: "only-b", both: "both" } as const;

/**
 * Diff of two scenes on the same ids, e.g. the rest of the log (`a`) against a
 * slice (`b`). The result carries `b`'s metrics under their own names (so the
 * standard style renders it like `b`), the counterpart under `a_<metric>` and the
 * difference under `delta_<metric>` (b minus a). Elements on one side only are
 * tagged `only-a` or `only-b`, shared elements `both`.
 */
export function diff(a: FlowGraph, b: FlowGraph, options: DiffOptions = {}): FlowGraph {
  const diffMetrics = (x?: Metrics, y?: Metrics): Metrics => {
    const names = options.metrics ?? [...new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})])].sort();
    const out: Metrics = {};
    for (const m of names) {
      const va = x?.[m];
      const vb = y?.[m];
      if (typeof vb === "number") out[m] = vb;
      if (typeof va === "number") out[`a_${m}`] = va;
      if (typeof va === "number" || typeof vb === "number") out[`delta_${m}`] = (vb ?? 0) - (va ?? 0);
    }
    return out;
  };
  const tagsFor = (inA: boolean, inB: boolean) => [inA && inB ? DIFF_TAGS.both : inA ? DIFF_TAGS.onlyA : DIFF_TAGS.onlyB];

  const aNodes = new Map(a.nodes.map((n) => [n.id, n]));
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]));
  const nodeIds = [...new Set([...a.nodes.map((n) => n.id), ...b.nodes.map((n) => n.id)])];
  const nodes: FlowNode[] = nodeIds.map((id) => {
    const na = aNodes.get(id);
    const nb = bNodes.get(id);
    const ref = (nb ?? na)!;
    return {
      id,
      kind: ref.kind,
      label: ref.label,
      group: ref.group,
      metrics: diffMetrics(na?.metrics, nb?.metrics),
      tags: [...new Set([...(ref.tags ?? []), ...tagsFor(!!na, !!nb)])],
    };
  });
  const aEdges = new Map(a.edges.map((e) => [e.id, e]));
  const bEdges = new Map(b.edges.map((e) => [e.id, e]));
  const edgeIds = [...new Set([...a.edges.map((e) => e.id), ...b.edges.map((e) => e.id)])];
  const edges: FlowEdge[] = edgeIds.map((id) => {
    const ea = aEdges.get(id);
    const eb = bEdges.get(id);
    const ref = (eb ?? ea)!;
    return {
      id,
      kind: ref.kind,
      source: ref.source,
      target: ref.target,
      metrics: diffMetrics(ea?.metrics, eb?.metrics),
      tags: [...new Set([...(ref.tags ?? []), ...tagsFor(!!ea, !!eb)])],
      payload: ref.payload,
    };
  });
  const groups = new Map<string, FlowGroup>();
  for (const g of [...(a.groups ?? []), ...(b.groups ?? [])]) if (!groups.has(g.id)) groups.set(g.id, g);
  return {
    nodes,
    edges,
    groups: [...groups.values()],
    meta: { diff: true, a: a.meta, b: b.meta },
  };
}
