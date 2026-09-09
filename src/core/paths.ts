/**
 * Incoming and outgoing paths of an activity, the path between two
 * activities, and the sets a renderer highlights for a focus. The numbers
 * come from the response's `paths` block when the API was asked with
 * `focus`, and from the graph's own follows edges otherwise.
 */
import { type FlowEdge, type FlowGraph, type FlowPath, type FlowPaths, type GraphIndex, hasTag, indexGraph, metric } from "./model.js";
import { RECONNECTED_TAG } from "./aggregate.js";

/** One row of the path list; every number is optional because payloads differ. */
export interface PathRow {
  /** Edge id when the path is an edge of the graph. */
  edgeId?: string;
  from: string;
  to: string;
  count?: number;
  cases?: number;
  /** Cases on the path relative to the focused activity's cases. */
  share?: number;
  medianLagHours?: number;
  p90LagHours?: number;
  violationShare?: number;
  /** The path was re-added by the abstraction to keep the map connected. */
  reconnected?: boolean;
}

export interface ActivityPaths {
  focus: string;
  incoming: PathRow[];
  outgoing: PathRow[];
  /** `payload` when the rows come from the response, `graph` when computed here. */
  source: "payload" | "graph";
  /** Sums of `count` over the rows (the activity's in- and out-counts). */
  totals: { incoming: number; outgoing: number };
}

export type PathSortKey = "count" | "cases" | "share" | "medianLagHours" | "p90LagHours" | "violationShare" | "label";

export interface PathsOptions {
  /** Paths to use instead of `graph.paths`. */
  paths?: FlowPaths;
  /** Sort column; default `count`, descending. */
  sort?: PathSortKey;
  ascending?: boolean;
  /** Follows edges only (default) or sequence flows as well. */
  kinds?: FlowEdge["kind"][];
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A contract path (`median_lag`, `violation_share`) or a metric-named path as a row. */
export function normalizePath(p: FlowPath, focus: string, direction: "incoming" | "outgoing"): PathRow {
  const other = direction === "incoming" ? (p.from ?? p.to ?? "") : (p.to ?? p.from ?? "");
  const from = direction === "incoming" ? other : focus;
  const to = direction === "incoming" ? focus : other;
  const median = num(p.medianLagHours) ?? num(p.median_lag_hours) ?? num(p.median_lag);
  const p90 = num(p.p90LagHours) ?? num(p.p90_lag_hours) ?? num(p.p90_lag);
  const violation = num(p.violationShare) ?? num(p.violation_share);
  return {
    edgeId: typeof p.id === "string" ? p.id : undefined,
    from,
    to,
    count: num(p.count),
    cases: num(p.cases),
    share: num(p.share),
    medianLagHours: median,
    p90LagHours: p90,
    violationShare: violation,
  };
}

function rowOf(e: FlowEdge): PathRow {
  return {
    edgeId: e.id,
    from: e.source,
    to: e.target,
    count: num(e.metrics?.count),
    cases: num(e.metrics?.cases),
    share: num(e.metrics?.share),
    medianLagHours: num(e.metrics?.medianLagHours),
    p90LagHours: num(e.metrics?.p90LagHours),
    violationShare: num(e.metrics?.violationShare),
    reconnected: hasTag(e, RECONNECTED_TAG) || undefined,
  };
}

function compare(key: PathSortKey, ascending: boolean, labelOf: (id: string) => string, focus: string) {
  const dir = ascending ? 1 : -1;
  return (a: PathRow, b: PathRow): number => {
    if (key === "label") {
      const la = labelOf(a.from === focus ? a.to : a.from);
      const lb = labelOf(b.from === focus ? b.to : b.from);
      return dir * la.localeCompare(lb);
    }
    const va = a[key];
    const vb = b[key];
    if (va === undefined && vb === undefined) return (a.count ?? 0) < (b.count ?? 0) ? 1 : -1;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return va === vb ? (a.from + a.to < b.from + b.to ? -1 : 1) : dir * (va - vb);
  };
}

function sortRows(rows: PathRow[], options: PathsOptions, idx: GraphIndex, focus: string): PathRow[] {
  const labelOf = (id: string) => idx.nodes.get(id)?.label ?? id;
  return [...rows].sort(compare(options.sort ?? "count", options.ascending ?? (options.sort === "label"), labelOf, focus));
}

function fillShare(rows: PathRow[], focusCases: number | undefined, total: number): PathRow[] {
  return rows.map((r) => {
    if (r.share !== undefined) return r;
    if (r.cases !== undefined && focusCases) return { ...r, share: r.cases / focusCases };
    if (r.count !== undefined && total > 0) return { ...r, share: r.count / total };
    return r;
  });
}

/**
 * Incoming and outgoing paths of an activity. When the graph (or `options.paths`)
 * carries a `paths` block for this activity, its rows are used and `source` is
 * `payload`; otherwise the rows are the graph's follows edges at the activity.
 * Self-loops are not paths in or out and are left to the self-loop overlay.
 */
export function pathsFor(graph: FlowGraph, focus: string, options: PathsOptions = {}): ActivityPaths {
  const idx = indexGraph(graph);
  const focusCases = num(idx.nodes.get(focus)?.metrics?.cases);
  const payload = options.paths ?? graph.paths;
  const payloadFocus = options.paths?.focus ?? graph.paths?.focus ?? graph.focus ?? (typeof graph.meta?.focus === "string" ? graph.meta.focus : undefined);
  const usePayload = !!payload && (payloadFocus === undefined || payloadFocus === focus);
  let incoming: PathRow[];
  let outgoing: PathRow[];
  let source: ActivityPaths["source"];
  if (usePayload && payload) {
    const edgeId = (from: string, to: string) => (idx.outgoing.get(from) ?? []).find((e) => e.target === to)?.id;
    incoming = (payload.incoming ?? []).map((p) => normalizePath(p, focus, "incoming")).map((r) => ({ ...r, edgeId: r.edgeId ?? edgeId(r.from, r.to) }));
    outgoing = (payload.outgoing ?? []).map((p) => normalizePath(p, focus, "outgoing")).map((r) => ({ ...r, edgeId: r.edgeId ?? edgeId(r.from, r.to) }));
    source = "payload";
  } else {
    const kinds = new Set(options.kinds ?? ["follows"]);
    const n = neighbourhood(graph, focus);
    incoming = n.incoming.filter((e) => kinds.has(e.kind)).map(rowOf);
    outgoing = n.outgoing.filter((e) => kinds.has(e.kind)).map(rowOf);
    source = "graph";
  }
  const totalIn = incoming.reduce((s, r) => s + (r.count ?? 0), 0);
  const totalOut = outgoing.reduce((s, r) => s + (r.count ?? 0), 0);
  return {
    focus,
    incoming: sortRows(fillShare(incoming, focusCases, totalIn), options, idx, focus),
    outgoing: sortRows(fillShare(outgoing, focusCases, totalOut), options, idx, focus),
    source,
    totals: { incoming: totalIn, outgoing: totalOut },
  };
}

/**
 * The node ids a focus stands for: the node itself, or the members of a
 * group (paths in and out of a stage are the paths crossing its boundary).
 */
export function focusMembers(graph: FlowGraph, focus: string): Set<string> {
  const idx = indexGraph(graph);
  if (idx.nodes.has(focus) || !idx.groups.has(focus)) return new Set([focus]);
  const groups = idx.groups;
  const under = (id: string | undefined): boolean => {
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      if (cur === focus) return true;
      seen.add(cur);
      cur = groups.get(cur)?.parent;
    }
    return false;
  };
  return new Set(graph.nodes.filter((n) => under(n.group)).map((n) => n.id));
}

/** Predecessors and successors of a node (or of a group's members) over follows and flow edges; no self-loops, no edges inside the group. */
export function neighbourhood(graph: FlowGraph, id: string): { predecessors: string[]; successors: string[]; incoming: FlowEdge[]; outgoing: FlowEdge[] } {
  const idx = indexGraph(graph);
  const members = focusMembers(graph, id);
  const incoming: FlowEdge[] = [];
  const outgoing: FlowEdge[] = [];
  for (const m of members) {
    for (const e of idx.incoming.get(m) ?? []) if (e.kind !== "constraint" && e.source !== e.target && !members.has(e.source)) incoming.push(e);
    for (const e of idx.outgoing.get(m) ?? []) if (e.kind !== "constraint" && e.source !== e.target && !members.has(e.target)) outgoing.push(e);
  }
  return {
    predecessors: [...new Set(incoming.map((e) => e.source))],
    successors: [...new Set(outgoing.map((e) => e.target))],
    incoming,
    outgoing,
  };
}

export interface PathBetween {
  a: string;
  b: string;
  /** The direct path a → b when the graph has one. */
  direct?: FlowEdge;
  /** Nodes of the shortest path a → b (a first, b last); empty when none exists. */
  nodes: string[];
  edges: string[];
  found: boolean;
  /** The same for b → a, when such a path exists. */
  reverse?: { direct?: FlowEdge; nodes: string[]; edges: string[] };
}

function shortest(idx: GraphIndex, a: string, b: string, maxCount: number): { nodes: string[]; edges: string[] } | undefined {
  // Dijkstra on hops with a small penalty for weak paths, so that among equally
  // short paths the strongest one wins and the result is deterministic.
  const dist = new Map<string, number>([[a, 0]]);
  const prev = new Map<string, { node: string; edge: string }>();
  const done = new Set<string>();
  const queue: string[] = [a];
  while (queue.length) {
    queue.sort((x, y) => (dist.get(x)! - dist.get(y)!) || (x < y ? -1 : 1));
    const u = queue.shift()!;
    if (done.has(u)) continue;
    done.add(u);
    if (u === b) break;
    for (const e of idx.outgoing.get(u) ?? []) {
      if (e.kind === "constraint" || e.source === e.target) continue;
      const strength = maxCount > 0 ? metric(e, "count", maxCount) / maxCount : 1;
      const cost = dist.get(u)! + 1 + (1 - Math.max(0, Math.min(1, strength))) * 0.5;
      if (cost < (dist.get(e.target) ?? Infinity)) {
        dist.set(e.target, cost);
        prev.set(e.target, { node: u, edge: e.id });
        queue.push(e.target);
      }
    }
  }
  if (!dist.has(b) || a === b) return undefined;
  const nodes = [b];
  const edges: string[] = [];
  let cur = b;
  while (cur !== a) {
    const p = prev.get(cur);
    if (!p) return undefined;
    edges.unshift(p.edge);
    nodes.unshift(p.node);
    cur = p.node;
  }
  return { nodes, edges };
}

/** The shortest (then strongest) path from `a` to `b`, plus the reverse one when it exists. */
export function pathBetween(graph: FlowGraph, a: string, b: string): PathBetween {
  const idx = indexGraph(graph);
  const maxCount = Math.max(0, ...graph.edges.map((e) => metric(e, "count", 0)));
  const direct = (idx.outgoing.get(a) ?? []).find((e) => e.target === b && e.kind !== "constraint");
  const forward = shortest(idx, a, b, maxCount);
  const reverseDirect = (idx.outgoing.get(b) ?? []).find((e) => e.target === a && e.kind !== "constraint");
  const backward = shortest(idx, b, a, maxCount);
  return {
    a,
    b,
    direct,
    nodes: forward?.nodes ?? [],
    edges: forward?.edges ?? [],
    found: !!forward,
    reverse: backward ? { direct: reverseDirect, nodes: backward.nodes, edges: backward.edges } : undefined,
  };
}

/** Rows for the edges of a path between two activities, in path order. */
export function pathRows(graph: FlowGraph, between: PathBetween, direction: "forward" | "reverse" = "forward"): PathRow[] {
  const idx = indexGraph(graph);
  const edges = direction === "forward" ? between.edges : (between.reverse?.edges ?? []);
  return edges.map((id) => idx.edges.get(id)).filter((e): e is FlowEdge => !!e).map(rowOf);
}

export type Focus = string | [string, string];

/**
 * Nodes and edges that stay bright for a focus: an activity with its
 * predecessors, successors and the paths between them, or the path between
 * two activities (both directions).
 */
export function focusHighlight(graph: FlowGraph, focus: Focus): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (typeof focus === "string") {
    const n = neighbourhood(graph, focus);
    for (const m of focusMembers(graph, focus)) nodes.add(m);
    for (const p of n.predecessors) nodes.add(p);
    for (const s of n.successors) nodes.add(s);
    for (const e of n.incoming) edges.add(e.id);
    for (const e of n.outgoing) edges.add(e.id);
    return { nodes, edges };
  }
  const [a, b] = focus;
  const between = pathBetween(graph, a, b);
  nodes.add(a);
  nodes.add(b);
  for (const id of between.nodes) nodes.add(id);
  for (const id of between.edges) edges.add(id);
  for (const id of between.reverse?.nodes ?? []) nodes.add(id);
  for (const id of between.reverse?.edges ?? []) edges.add(id);
  return { nodes, edges };
}
