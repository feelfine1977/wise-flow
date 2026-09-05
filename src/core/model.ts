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
  [key: string]: unknown;
}

export interface Overlay {
  kind: OverlayKind;
  /** Node, edge or group id; `MAP_TARGET` for map-level chips. */
  target: string;
  payload?: OverlayPayload;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  groups?: FlowGroup[];
  overlays?: Overlay[];
  meta?: Record<string, unknown>;
}

/** Target id of overlays that belong to the whole map rather than an element. */
export const MAP_TARGET = "__map";

export type FlowElement = FlowNode | FlowEdge;

export function isEdge(el: FlowElement): el is FlowEdge {
  return (el as FlowEdge).source !== undefined && (el as FlowEdge).target !== undefined;
}

/** Read a metric with a fallback; `NaN` and missing values yield the fallback. */
export function metric(el: { metrics?: Metrics } | undefined, name: string, fallback = 0): number {
  const v = el?.metrics?.[name];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function hasTag(el: { tags?: string[] } | undefined, tag: string): boolean {
  return !!el?.tags?.includes(tag);
}

/** Index over a graph: maps by id and adjacency lists, built once per graph. */
export interface GraphIndex {
  nodes: Map<string, FlowNode>;
  edges: Map<string, FlowEdge>;
  groups: Map<string, FlowGroup>;
  outgoing: Map<string, FlowEdge[]>;
  incoming: Map<string, FlowEdge[]>;
  /** Members per group id. */
  members: Map<string, FlowNode[]>;
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
  return { nodes, edges, groups, outgoing, incoming, members };
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
