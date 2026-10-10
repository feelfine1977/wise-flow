/**
 * Graph model shared by every renderer. Mirrors `#/components/schemas/FlowGraph`
 * of the workbench API: ids are opaque and stable, numbers arrive pre-aggregated.
 */

export type NodeKind = "activity" | "stage" | "gateway" | "event" | "note";
export type EdgeKind = "follows" | "constraint" | "flow";
export type GroupKind = "lane" | "stage" | "pool";
export type OverlayKind = "badge" | "arc" | "hatch" | "tint" | "chip" | "selfLoop";

export type Metrics = Record<string, number>;

export interface FlowNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Group (lane, stage or pool) the node belongs to. */
  group?: string;
  metrics?: Metrics;
  tags?: string[];
}

export interface FlowEdge {
  id: string;
  kind: EdgeKind;
  source: string;
  target: string;
  metrics?: Metrics;
  tags?: string[];
  payload?: unknown;
}

export interface FlowGroup {
  id: string;
  kind: GroupKind;
  label: string;
  parent?: string;
}

/**
 * Payload of an overlay. Every field is optional; presets fill what the
 * constraint type needs, renderers read what they can draw and put the rest
 * in the table alternative.
 */
export interface OverlayPayload {
  constraintId?: string;
  constraintType?: string;
  layer?: string;
  /** Short human label, e.g. the constraint label. */
  label?: string;
  /** Number the overlay encodes, usually a share in [0, 1]. */
  value?: number;
  /** Share of cases where the constraint could be evaluated. */
  coverage?: number;
  /** Glyph shown in badges: "≥1", "≤1", "∅", "⇒". */
  glyph?: string;
  /** Text shown next to the glyph or on hover, already formatted. */
  text?: string;
  description?: string;
  unit?: string;
  threshold?: number;
  width?: number;
  /** Arc endpoints (node ids). */
  source?: string;
  target?: string;
  /** Arc drawn against the expected order (precedence violations). */
  reverse?: boolean;
  /** Gauge for balance and metric constraints. */
  gauge?: { value: number; threshold: number; width?: number; direction?: "high" | "low" };
  /**
   * Text drawn beside a self-loop or arc instead of the glyph and value; it also
   * widens the overlay's reserved extent.
   */
  displayLabel?: string;
  /** The overlay shows recorded data (an observed self-loop) and is drawn at every zoom. */
  observed?: boolean;
  /** Edge an overlay stands for, e.g. the follows self-edge behind a self-loop. */
  edgeId?: string;
  [key: string]: unknown;
}

export interface Overlay {
  kind: OverlayKind;
  /** Node, edge or group id; `MAP_TARGET` for map-level chips. */
  target: string;
  payload?: OverlayPayload;
}

/**
 * One path in the `paths` block of a focused flow response
 * (`GET …/flow?focus=<activity>`): the contract's field names (`median_lag`,
 * `violation_share`) and the metric names of the graph are both accepted.
 */
export interface FlowPath {
  from?: string;
  to?: string;
  count?: number;
  cases?: number;
  share?: number;
  medianLagHours?: number;
  p90LagHours?: number;
  violationShare?: number;
  median_lag?: number;
  violation_share?: number;
  [key: string]: unknown;
}

/** Incoming and outgoing paths of the focused activity, as the API returns them. */
export interface FlowPaths {
  /** Activity the paths belong to; defaults to `FlowGraph.focus`. */
  focus?: string;
  incoming: FlowPath[];
  outgoing: FlowPath[];
}

/** Thresholds `abstract` applied to a graph, recorded in `meta.abstraction`. */
export interface AbstractionMeta {
  minEdgeShare?: number;
  minNodeShare?: number;
  keepConnected?: boolean;
  collapse?: string[] | "all";
}

/**
 * Metadata of a graph. Keys other than the declared ones pass through untouched.
 * `abstraction` is the server's threshold share (a number, `0` when nothing was
 * removed) or, after `abstract`, the thresholds the library applied.
 */
export interface FlowMeta {
  abstraction?: number | AbstractionMeta;
  [key: string]: unknown;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups?: FlowGroup[];
  overlays?: Overlay[];
  meta?: FlowMeta;
  /** Activity the response was focused on (`focus` query parameter). */
  focus?: string;
  /** Paths of the focused activity from the full directly-follows graph. */
  paths?: FlowPaths;
}

/** Target id of overlays that belong to the whole map rather than an element. */
export const MAP_TARGET = "__map";

/** Read a metric with a fallback; `NaN` and missing values yield the fallback. */
export function metric(el: { metrics?: Metrics } | undefined, name: string, fallback = 0): number {
  const v = el?.metrics?.[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function hasTag(el: { tags?: string[] } | undefined, tag: string): boolean {
  return !!el?.tags?.includes(tag);
}

/**
 * Index over a graph: maps by id, adjacency lists and the group hierarchy.
 * Build it once per graph and ask it instead of walking `parent` chains.
 */
export interface GraphIndex {
  nodes: Map<string, FlowNode>;
  edges: Map<string, FlowEdge>;
  groups: Map<string, FlowGroup>;
  outgoing: Map<string, FlowEdge[]>;
  incoming: Map<string, FlowEdge[]>;
  /** Direct members per group id (nodes whose `group` is the id). */
  members: Map<string, FlowNode[]>;
  /**
   * Groups enclosing an element, innermost first: for a node its group and that
   * group's ancestors, for a group its parent and upwards. A node id is read as
   * a node unless `kind` says otherwise (a collapsed stage node shares its id
   * with its group). Unknown ids and parents end the chain; a cycle ends it
   * before a group repeats.
   */
  ancestors(id: string, kind?: "node" | "group"): FlowGroup[];
  /** Nodes of a group and of every group nested in it, in graph order. */
  allMembers(groupId: string): FlowNode[];
  /** Label of a node, else of a group, else the id itself. */
  label(id: string): string;
}

export function indexGraph(graph: FlowGraph): GraphIndex {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const groups = new Map<string, FlowGroup>();
  const outgoing = new Map<string, FlowEdge[]>();
  const incoming = new Map<string, FlowEdge[]>();
  const members = new Map<string, FlowNode[]>();
  for (const n of graph.nodes) {
    nodes.set(n.id, n);
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const g of graph.groups ?? []) {
    groups.set(g.id, g);
    members.set(g.id, []);
  }
  for (const n of graph.nodes) {
    if (n.group && members.has(n.group)) members.get(n.group)!.push(n);
  }
  for (const e of graph.edges) {
    edges.set(e.id, e);
    outgoing.get(e.source)?.push(e);
    incoming.get(e.target)?.push(e);
  }
  const chain = (start: string | undefined, exclude?: string): FlowGroup[] => {
    const out: FlowGroup[] = [];
    const seen = new Set<string>(exclude === undefined ? [] : [exclude]);
    let cur = start === undefined ? undefined : groups.get(start);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.push(cur);
      cur = cur.parent === undefined ? undefined : groups.get(cur.parent);
    }
    return out;
  };
  const ancestors = (id: string, kind?: "node" | "group"): FlowGroup[] => {
    const asNode = kind === "node" || (kind === undefined && nodes.has(id));
    if (asNode) return chain(nodes.get(id)?.group);
    return chain(groups.get(id)?.parent, id);
  };
  const nested = new Map<string, FlowNode[]>();
  const allMembers = (groupId: string): FlowNode[] => {
    let found = nested.get(groupId);
    if (!found) {
      found = groups.has(groupId) ? graph.nodes.filter((n) => chain(n.group).some((g) => g.id === groupId)) : [];
      nested.set(groupId, found);
    }
    return found;
  };
  const label = (id: string): string => nodes.get(id)?.label ?? groups.get(id)?.label ?? id;
  return { nodes, edges, groups, outgoing, incoming, members, ancestors, allMembers, label };
}

export interface GraphIssue {
  level: "error" | "warning";
  message: string;
  id?: string;
}

/**
 * Structural validation of a FlowGraph as received from an API: duplicate ids,
 * dangling edge endpoints, unknown groups, overlays on unknown targets.
 */
export function validateGraph(graph: FlowGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const nodeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (nodeIds.has(n.id)) issues.push({ level: "error", message: `duplicate node id`, id: n.id });
    nodeIds.add(n.id);
  }
  const groupIds = new Set<string>();
  for (const g of graph.groups ?? []) {
    if (groupIds.has(g.id)) issues.push({ level: "error", message: `duplicate group id`, id: g.id });
    groupIds.add(g.id);
  }
  for (const g of graph.groups ?? []) {
    if (g.parent && !groupIds.has(g.parent)) {
      issues.push({ level: "error", message: `group parent not found: ${g.parent}`, id: g.id });
    }
  }
  for (const n of graph.nodes) {
    if (n.group && !groupIds.has(n.group)) {
      issues.push({ level: "warning", message: `node group not found: ${n.group}`, id: n.id });
    }
  }
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) issues.push({ level: "error", message: `duplicate edge id`, id: e.id });
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source)) issues.push({ level: "error", message: `edge source not found: ${e.source}`, id: e.id });
    if (!nodeIds.has(e.target)) issues.push({ level: "error", message: `edge target not found: ${e.target}`, id: e.id });
  }
  for (const o of graph.overlays ?? []) {
    if (o.target !== MAP_TARGET && !nodeIds.has(o.target) && !edgeIds.has(o.target) && !groupIds.has(o.target)) {
      issues.push({ level: "warning", message: `overlay target not found: ${o.target}` });
    }
  }
  return issues;
}

/** Warnings for parallel gateways without a partner (docs/API.md); rejects nothing. */
export function validateGateways(graph: FlowGraph): GraphIssue[] {
  const idx = indexGraph({ nodes: graph.nodes, edges: graph.edges.filter((e) => e.kind !== "constraint" && !hasTag(e, "message") && !hasTag(e, "association")) });
  const outs = (id: string) => idx.outgoing.get(id) ?? [];
  const ins = (id: string) => idx.incoming.get(id) ?? [];
  const pairs = (split: string, branches: FlowEdge[], join: string): boolean => {
    const taken = new Set<string>();
    const inputs = new Set<FlowEdge>();
    for (const branch of branches) {
      const region = new Set<string>();
      const reached: FlowEdge[] = [];
      const stack = [branch];
      while (stack.length) {
        const f = stack.pop()!;
        if (f.target === join) reached.push(f);
        else if (f.target === split || taken.has(f.target) || !outs(f.target).length) return false;
        else if (!region.has(f.target)) {
          region.add(f.target);
          for (const e of outs(f.target)) stack.push(e);
        }
      }
      if (reached.length !== 1 || inputs.has(reached[0])) return false;
      inputs.add(reached[0]);
      for (const v of region) {
        taken.add(v);
        if (ins(v).some((e) => e !== branch && !region.has(e.source))) return false;
      }
    }
    return true;
  };
  const parallel = graph.nodes.filter((n) => n.kind === "gateway" && hasTag(n, "and"));
  const joins = parallel.filter((n) => ins(n.id).length > 1);
  const partners = new Set<FlowNode>();
  const issues: GraphIssue[] = [];
  for (const split of parallel) {
    const branches = outs(split.id);
    if (branches.length < 2) continue;
    const join = joins.find((j) => j !== split && ins(j.id).length === branches.length && pairs(split.id, branches, j.id));
    if (join) partners.add(join);
    else issues.push({ level: "warning", message: "parallel split whose branches do not all reach one parallel join", id: split.id });
  }
  for (const join of joins) if (!partners.has(join)) issues.push({ level: "warning", message: "parallel join that is the partner of no parallel split", id: join.id });
  return issues;
}

/** Shallow copy of a graph with sorted, de-duplicated element arrays. */
export function normalizeGraph(graph: FlowGraph): FlowGraph {
  const byId = <T extends { id: string }>(items: T[]): T[] => {
    const seen = new Map<string, T>();
    for (const it of items) if (!seen.has(it.id)) seen.set(it.id, it);
    return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  };
  return {
    nodes: byId(graph.nodes),
    edges: byId(graph.edges),
    groups: graph.groups ? byId(graph.groups) : undefined,
    overlays: graph.overlays,
    meta: graph.meta,
    focus: graph.focus,
    paths: graph.paths,
  };
}

/** Nodes that a map never removes: events and gateways carry structure, not frequency. */
export function isStructuralNode(node: FlowNode): boolean {
  return node.kind === "event" || node.kind === "gateway";
}

/** Sort helper that is stable across engines and locales. */
export function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
