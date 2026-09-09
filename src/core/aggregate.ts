/**
 * Aggregation: abstraction by frequency or performance with a keep-connected
 * guarantee, stage collapse (semantic zoom) and diff maps.
 */
import {
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type Metrics,
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

function sumMetrics(items: { metrics?: Metrics }[], weightKey: string[]): Metrics {
  const SUM = new Set(["events", "count", "starts", "ends", "violations", "internalCount"]);
  const MAX = new Set(["cases", "share"]);
  const names = new Set<string>();
  for (const it of items) for (const k of Object.keys(it.metrics ?? {})) names.add(k);
  const out: Metrics = {};
  for (const name of names) {
    let sum = 0;
    let max = -Infinity;
    let weighted = 0;
    let weightSum = 0;
    let any = false;
    for (const it of items) {
      const v = it.metrics?.[name];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      any = true;
      sum += v;
      max = Math.max(max, v);
      const w = firstMetric(it, weightKey) ?? 1;
      weighted += v * w;
      weightSum += w;
    }
    if (!any) continue;
    if (SUM.has(name)) out[name] = sum;
    else if (MAX.has(name)) out[name] = max;
    else out[name] = weightSum > 0 ? weighted / weightSum : sum / items.length;
  }
  return out;
}

function descendants(groups: Map<string, FlowGroup>, roots: Set<string>): Set<string> {
  const out = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const g of groups.values()) {
      if (g.parent && out.has(g.parent) && !out.has(g.id)) {
        out.add(g.id);
        changed = true;
      }
    }
  }
  return out;
}

/**
 * Collapse the members of the given stage groups into one `stage` node per group.
 * The stage node takes the group's id and label. Internal edges are dropped and
 * counted in the stage node's `internalCount`; parallel edges are merged (counts
 * summed, cases and shares taken as the maximum, other metrics averaged by weight).
 * Overlays on members move to the stage node; arcs that fold onto one node are dropped.
 */
export function collapseGroups(graph: FlowGraph, groups: string[] | "all"): FlowGraph {
  const idx = indexGraph(graph);
  const requested =
    groups === "all"
      ? [...idx.groups.values()].filter((g) => g.kind === "stage" && !g.parent).map((g) => g.id)
      : groups.filter((id) => idx.groups.has(id));
  if (requested.length === 0) return graph;
  const collapsedRoots = new Set(requested);
  const collapsedAll = descendants(idx.groups, collapsedRoots);

  // Map every group to the collapsed root that swallows it.
  const rootOf = (groupId: string): string | undefined => {
    let cur: FlowGroup | undefined = idx.groups.get(groupId);
    let found: string | undefined;
    while (cur) {
      if (collapsedRoots.has(cur.id)) found = cur.id;
      cur = cur.parent ? idx.groups.get(cur.parent) : undefined;
    }
    return found;
  };
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
    nodes.push({
      id: root,
      kind: "stage",
      label: group.label,
      group: group.parent,
      metrics: { ...sumMetrics(members, ["cases", "events"]), members: members.length },
      tags: [COLLAPSED_TAG],
    });
  }
  for (const root of requested) {
    if (!emitted.has(root)) {
      const group = idx.groups.get(root)!;
      nodes.push({ id: root, kind: "stage", label: group.label, group: group.parent, metrics: { members: 0 }, tags: [COLLAPSED_TAG] });
    }
  }

  const merged = new Map<string, FlowEdge[]>();
  const internal = new Map<string, number>();
  const order: string[] = [];
  for (const e of graph.edges) {
    const s = nodeTarget.get(e.source) ?? e.source;
    const t = nodeTarget.get(e.target) ?? e.target;
    if (s === t && nodeTarget.has(e.source) && nodeTarget.has(e.target)) {
      internal.set(s, (internal.get(s) ?? 0) + metric(e, "count", 1));
      continue;
    }
    const key = `${e.kind}|${s}|${t}`;
    if (!merged.has(key)) {
      merged.set(key, []);
      order.push(key);
    }
    merged.get(key)!.push({ ...e, source: s, target: t });
  }
  const edges: FlowEdge[] = order.map((key) => {
    const list = merged.get(key)!;
    if (list.length === 1) return list[0];
    const first = list[0];
    return {
      id: `${first.source}->${first.target}`,
      kind: first.kind,
      source: first.source,
      target: first.target,
      metrics: sumMetrics(list, ["count", "cases"]),
      tags: [...new Set(list.flatMap((e) => e.tags ?? []))],
    };
  });
  for (const n of nodes) {
    const c = internal.get(n.id);
    if (c !== undefined) n.metrics = { ...(n.metrics ?? {}), internalCount: c };
  }

  const overlays: Overlay[] | undefined = graph.overlays
    ?.map((o) => {
      const target = nodeTarget.get(o.target) ?? o.target;
      if (o.kind === "arc" && o.payload?.source && o.payload?.target) {
        const s = nodeTarget.get(String(o.payload.source)) ?? String(o.payload.source);
        const t = nodeTarget.get(String(o.payload.target)) ?? String(o.payload.target);
        if (s === t) return null;
        return { ...o, target, payload: { ...o.payload, source: s, target: t } };
      }
      return target === o.target ? o : { ...o, target };
    })
    .filter((o): o is Overlay => o !== null);

  return {
    nodes,
    edges,
    groups: (graph.groups ?? []).filter((g) => !collapsedAll.has(g.id)),
    overlays,
    meta: { ...(graph.meta ?? {}), collapsed: requested },
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

class MinHeap<T> {
  private items: { key: number; order: number; value: T }[] = [];
  private counter = 0;
  push(key: number, value: T) {
    const it = { key, order: this.counter++, value };
    const a = this.items;
    a.push(it);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i], a[p])) {
        [a[i], a[p]] = [a[p], a[i]];
        i = p;
      } else break;
    }
  }
  pop(): T | undefined {
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
    return top.value;
  }
  get size() {
    return this.items.length;
  }
  private less(a: { key: number; order: number }, b: { key: number; order: number }) {
    return a.key < b.key || (a.key === b.key && a.order < b.order);
  }
}

/**
 * Re-add the cheapest paths of the original graph until the kept nodes form one
 * component, then give every kept activity an incoming and an outgoing edge where
 * the original graph had one. Re-added elements are tagged `reconnected`.
 */
function reconnect(
  original: FlowGraph,
  keptNodes: FlowNode[],
  keptEdges: FlowEdge[],
  edgeStrength: Map<string, number>,
  nodeStrength: Map<string, number>,
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const originalIdx = indexGraph(original);
  const nodes = [...keptNodes];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [...keptEdges];
  const edgeIds = new Set(edges.map((e) => e.id));
  const tag = (e: FlowEdge): FlowEdge => ({ ...e, tags: [...new Set([...(e.tags ?? []), RECONNECTED_TAG])] });
  const addEdge = (e: FlowEdge) => {
    if (edgeIds.has(e.id)) return;
    edgeIds.add(e.id);
    edges.push(tag(e));
  };
  const addNode = (id: string) => {
    if (nodeIds.has(id)) return;
    const n = originalIdx.nodes.get(id);
    if (!n) return;
    nodeIds.add(id);
    nodes.push({ ...n, tags: [...new Set([...(n.tags ?? []), RECONNECTED_TAG])] });
  };
  const allIds = new Set(original.nodes.map((n) => n.id));
  const adj = undirectedAdjacency(original.edges, allIds);
  const cost = (e: FlowEdge) => 1 + (1 - (edgeStrength.get(e.id) ?? 1));

  // 1a. Maximum spanning forest over the original edges between present nodes:
  //     the strongest direct edges that join two components are re-added first.
  const joinDirect = (): number => {
    let comp = components(nodeIds, edges);
    let count = new Set(comp.values()).size;
    if (count <= 1) return count;
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let r = x;
      while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    for (const [id, c] of comp) parent.set(id, `#${c}`);
    const direct = original.edges
      .filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target) && !edgeIds.has(e.id))
      .sort((a, b) => cost(a) - cost(b) || byId(a, b));
    for (const e of direct) {
      const ra = find(e.source);
      const rb = find(e.target);
      if (ra === rb) continue;
      parent.set(ra, rb);
      addEdge(e);
      count--;
      if (count <= 1) break;
    }
    comp = components(nodeIds, edges);
    return new Set(comp.values()).size;
  };

  // 1b. Remaining components are reached through the cheapest path of the original
  //     graph (re-adding the removed nodes on it), starting from the heaviest component.
  for (let guard = 0; guard < original.nodes.length; guard++) {
    if (joinDirect() <= 1) break;
    const comp = components(nodeIds, edges);
    const weight = new Map<number, number>();
    for (const n of nodes) {
      const c = comp.get(n.id) ?? 0;
      weight.set(c, (weight.get(c) ?? 0) + (isStructuralNode(n) ? 0 : (nodeStrength.get(n.id) ?? 1)));
    }
    let mainComp = 0;
    let best = -1;
    for (const [c, w] of [...weight.entries()].sort((a, b) => a[0] - b[0])) {
      if (w > best) {
        best = w;
        mainComp = c;
      }
    }
    const dist = new Map<string, number>();
    const prev = new Map<string, { edge: FlowEdge; from: string }>();
    const heap = new MinHeap<string>();
    for (const [id, c] of comp) {
      if (c === mainComp) {
        dist.set(id, 0);
        heap.push(0, id);
      }
    }
    let hit: string | undefined;
    while (heap.size) {
      const cur = heap.pop()!;
      const d = dist.get(cur)!;
      const c = comp.get(cur);
      if (c !== undefined && c !== mainComp) {
        hit = cur;
        break;
      }
      const ns = [...(adj.neighbours.get(cur) ?? [])].sort((a, b) => cost(a.edge) - cost(b.edge) || byId(a.edge, b.edge));
      for (const { edge, other } of ns) {
        const nd = d + cost(edge);
        const od = dist.get(other);
        if (od === undefined || nd < od) {
          dist.set(other, nd);
          prev.set(other, { edge, from: cur });
          heap.push(nd, other);
        }
      }
    }
    if (!hit) break; // the original graph is disconnected itself
    let cur = hit;
    while (prev.has(cur)) {
      const { edge, from } = prev.get(cur)!;
      addNode(cur);
      addNode(from);
      addEdge(edge);
      cur = from;
    }
  }

  // 2. Every kept activity keeps flow context: an incoming and an outgoing edge.
  //    Open needs (a node without incoming or without outgoing edges) are served by
  //    the original edge that closes the most needs at once, then by strength, so
  //    that one edge serving two nodes is never replaced by two edges. Nodes re-added
  //    by step 1 are reconnection artefacts and are left as they are. Both rules keep
  //    the result monotone in the thresholds.
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const hasIn = new Set<string>();
  const hasOut = new Set<string>();
  const note = (e: FlowEdge) => {
    if (e.source === e.target) return;
    hasOut.add(e.source);
    hasIn.add(e.target);
  };
  for (const e of edges) note(e);
  const needsIn = (id: string) => keptIds.has(id) && !hasIn.has(id) && !isStructuralNode(originalIdx.nodes.get(id)!) && (originalIdx.incoming.get(id) ?? []).some((e) => e.source !== e.target);
  const needsOut = (id: string) => keptIds.has(id) && !hasOut.has(id) && !isStructuralNode(originalIdx.nodes.get(id)!) && (originalIdx.outgoing.get(id) ?? []).some((e) => e.source !== e.target);
  const candidates = original.edges.filter((e) => e.source !== e.target && nodeIds.has(e.source) && nodeIds.has(e.target) && !edgeIds.has(e.id));
  for (let guard = 0; guard < candidates.length + 1; guard++) {
    let best: FlowEdge | undefined;
    let bestScore = 0;
    for (const e of candidates) {
      if (edgeIds.has(e.id)) continue;
      const score = (needsOut(e.source) ? 1 : 0) + (needsIn(e.target) ? 1 : 0);
      if (score === 0) continue;
      if (
        !best ||
        score > bestScore ||
        (score === bestScore && ((edgeStrength.get(e.id) ?? 1) > (edgeStrength.get(best.id) ?? 1) || ((edgeStrength.get(e.id) ?? 1) === (edgeStrength.get(best.id) ?? 1) && byId(e, best) < 0)))
      ) {
        best = e;
        bestScore = score;
      }
    }
    if (!best) break;
    addEdge(best);
    note(best);
  }
  return { nodes, edges };
}

/**
 * Abstract a graph: optionally collapse stage groups, then remove weak activities and
 * weak follows edges, then (by default) restore connectivity with the strongest removed
 * elements. Structural nodes (events, gateways), constraint and flow edges are kept.
 * The result keeps the input order of elements; re-added elements are tagged.
 */
export function abstract(graph: FlowGraph, options: AbstractOptions = {}): FlowGraph {
  const {
    minEdgeShare = 0,
    minNodeShare = 0,
    keepConnected = true,
    collapse = false,
    relativeTo = "max",
  } = options;
  const base = collapse ? collapseGroups(graph, collapse) : graph;
  const edgeCandidates = options.edgeMetric ? [options.edgeMetric, ...EDGE_METRICS] : EDGE_METRICS;
  const nodeCandidates = options.nodeMetric ? [options.nodeMetric, ...NODE_METRICS] : NODE_METRICS;
  const follows = base.edges.filter((e) => e.kind === "follows" && e.source !== e.target);
  const edgeStrength = strengths(follows, edgeCandidates, relativeTo);
  for (const e of base.edges) if (!edgeStrength.has(e.id)) edgeStrength.set(e.id, e.source === e.target ? strengthOfLoop(e, follows, edgeCandidates, relativeTo) : 1);
  const scalable = base.nodes.filter((n) => !isStructuralNode(n));
  const nodeStrength = strengths(scalable, nodeCandidates, relativeTo);
  for (const n of base.nodes) if (!nodeStrength.has(n.id)) nodeStrength.set(n.id, 1);
  const keep = new Set(options.keep ?? []);

  const keptNodes = base.nodes.filter(
    (n) => isStructuralNode(n) || keep.has(n.id) || (nodeStrength.get(n.id) ?? 1) >= minNodeShare,
  );
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges = base.edges.filter(
    (e) =>
      keptIds.has(e.source) &&
      keptIds.has(e.target) &&
      (e.kind !== "follows" || (edgeStrength.get(e.id) ?? 1) >= minEdgeShare),
  );

  let nodes = keptNodes;
  let edges = keptEdges;
  if (keepConnected) {
    const r = reconnect(base, keptNodes, keptEdges, edgeStrength, nodeStrength);
    // Keep the original element order for stable rendering.
    const nodeOrder = new Map(base.nodes.map((n, i) => [n.id, i]));
    const edgeOrder = new Map(base.edges.map((e, i) => [e.id, i]));
    nodes = r.nodes.sort((a, b) => (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0));
    edges = r.edges.sort((a, b) => (edgeOrder.get(a.id) ?? 0) - (edgeOrder.get(b.id) ?? 0));
  }
  const nodeSet = new Set(nodes.map((n) => n.id));
  const edgeSet = new Set(edges.map((e) => e.id));
  const usedGroups = new Set<string>();
  const groupIdx = new Map((base.groups ?? []).map((g) => [g.id, g]));
  for (const n of nodes) {
    let g = n.group ? groupIdx.get(n.group) : undefined;
    while (g) {
      usedGroups.add(g.id);
      g = g.parent ? groupIdx.get(g.parent) : undefined;
    }
  }
  const groups = (base.groups ?? []).filter((g) => usedGroups.has(g.id));
  const survives = (id: unknown) => typeof id === "string" && (nodeSet.has(id) || usedGroups.has(id));
  const overlays = base.overlays?.filter((o) =>
    o.kind === "arc" && o.payload?.source !== undefined && o.payload?.target !== undefined
      ? survives(o.payload.source) && survives(o.payload.target)
      : o.target === MAP_TARGET || nodeSet.has(o.target) || edgeSet.has(o.target) || usedGroups.has(o.target),
  );
  return {
    nodes,
    edges,
    groups,
    overlays,
    meta: {
      ...(base.meta ?? {}),
      abstraction: { minEdgeShare, minNodeShare, keepConnected, collapse: collapse || undefined },
    },
  };
}

function strengthOfLoop(
  e: FlowEdge,
  follows: FlowEdge[],
  candidates: string[],
  relativeTo: "max" | "total",
): number {
  const v = firstMetric(e, candidates);
  if (v === undefined) return 1;
  let denominator = 0;
  for (const f of follows) {
    const fv = firstMetric(f, candidates);
    if (fv === undefined) continue;
    denominator = relativeTo === "max" ? Math.max(denominator, fv) : denominator + fv;
  }
  return denominator > 0 ? Math.min(1, v / denominator) : 1;
}

export interface DiffOptions {
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
