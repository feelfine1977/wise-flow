/**
 * Retained geometry of a scene for the canvas renderer: every element with
 * its box or route, colours and texts resolved once, plus the R-tree that
 * serves hover, click and viewport culling. `prepareScene` is pure and runs
 * in Node; drawing happens in `draw.ts`.
 */
import {
  type Box,
  type EdgeRoute,
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type LaneBand,
  type LaneMode,
  type Locale,
  type LodRules,
  type Overlay,
  type OverlayGeometryOptions,
  type OverlayShape,
  type PatternId,
  type Positions,
  type Scales,
  type StyleSpec,
  HitIndex,
  MAP_TARGET,
  RECONNECTED_TAG,
  buildScales,
  canonicalOverlays,
  defaultStyle,
  fixedColors,
  formatCompact,
  hasTag,
  laneBands,
  lodForSize,
  metric,
  overlayGeometry,
  straightRoute,
} from "../core/index.js";

export interface SceneNode {
  node: FlowNode;
  box: Box;
  color: string;
  pattern: PatternId;
  label: string;
  meta?: string;
  hatched: boolean;
  reconnected: boolean;
  badges: OverlayShape[];
  end: boolean;
  glyph?: string;
}

export interface SceneEdge {
  edge: FlowEdge;
  points: { x: number; y: number }[];
  width: number;
  color: string;
  dash?: number[];
  label?: string;
  reconnected: boolean;
}

export interface SceneGroup {
  group: FlowGroup;
  box: Box;
  color: string;
  tint?: string;
  band?: LaneBand;
  chips: OverlayShape[];
}

export interface PreparedScene {
  graph: FlowGraph;
  positions: Positions;
  scales: Scales;
  overlays: Overlay[];
  shapes: OverlayShape[];
  nodes: SceneNode[];
  edges: SceneEdge[];
  groups: SceneGroup[];
  bands: LaneBand[];
  /** Union of positions and overlay geometry. */
  bounds: Box;
  hit: HitIndex;
  lod: LodRules;
  locale: Locale;
  /** Nodes plus edges; decides whether the renderer culls by viewport. */
  size: number;
  nodeById: Map<string, SceneNode>;
  edgeById: Map<string, SceneEdge>;
  groupById: Map<string, SceneGroup>;
  shapeById: Map<string, OverlayShape>;
  /** Cache of truncated labels per width, filled by the drawing routines. */
  labelCache: Map<string, string>;
}

export interface PrepareOptions {
  style?: StyleSpec;
  overlays?: Overlay[];
  lod?: Partial<LodRules>;
  locale?: Locale;
  lanes?: LaneMode;
  /** Bands already computed by the caller (the positions are then used as given). */
  bands?: LaneBand[];
  overlayGeometry?: OverlayGeometryOptions;
  /** Self-loop follows edges become self-loop overlays. Default true. */
  selfLoops?: boolean;
}

function union(a: Box, b: Box): Box {
  if (b.width <= 0 && b.height <= 0) return a;
  if (a.width <= 0 && a.height <= 0) return b;
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Self-loop overlays for follows edges from a node to itself (as `<ProcessMap/>` does). */
export function selfLoopOverlays(graph: FlowGraph, locale: Locale = "en"): Overlay[] {
  const out: Overlay[] = [];
  const maxCount = Math.max(1, ...graph.edges.filter((e) => e.kind === "follows").map((e) => metric(e, "count", 0)));
  const nodeCases = new Map(graph.nodes.map((n) => [n.id, metric(n, "cases", NaN)]));
  for (const e of graph.edges) {
    if (e.kind !== "follows" || e.source !== e.target) continue;
    const count = metric(e, "count", NaN);
    const cases = metric(e, "cases", NaN);
    const nc = nodeCases.get(e.source) ?? NaN;
    const share = Number.isFinite(cases) && Number.isFinite(nc) && nc > 0 ? cases / nc : Number.isFinite(count) ? count / maxCount : undefined;
    out.push({ kind: "selfLoop", target: e.source, payload: { label: e.id, value: share, text: Number.isFinite(count) ? `${formatCompact(count, locale)} ×` : undefined, edgeId: e.id } });
  }
  return out;
}

function tintFor(value: number | undefined, scales: Scales): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const hex = scales.color(value, "sequential", [0, 1]);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.18)`;
}

/**
 * Resolve a graph with positions into retained geometry. Overlays are
 * `graph.overlays` plus `options.overlays` plus self-loops, restricted to
 * targets present in the graph; positions may be replaced by lane bands.
 */
export function prepareScene(graph: FlowGraph, givenPositions: Positions, options: PrepareOptions = {}): PreparedScene {
  const locale = options.locale ?? "en";
  const style = options.style ?? defaultStyle;
  const lanes = options.bands ? "none" : (options.lanes ?? "none");
  const laid = laneBands(graph, givenPositions, { lanes });
  const positions = laid.positions;
  const scales = buildScales(graph, style);
  const known = new Set([...graph.nodes.map((n) => n.id), ...(graph.groups ?? []).map((g) => g.id), MAP_TARGET]);
  const raw = [...(graph.overlays ?? []), ...(options.overlays ?? [])].filter(
    (o) => known.has(o.target) || (o.kind === "arc" && known.has(String(o.payload?.source)) && known.has(String(o.payload?.target))),
  );
  const overlays = canonicalOverlays(options.selfLoops === false ? raw : [...raw, ...selfLoopOverlays(graph, locale)]);
  const lod = lodForSize(graph.nodes.length, { ...(style.lod ?? {}), ...(options.lod ?? {}) });
  const geometry = overlayGeometry(overlays, positions, { ...(options.overlayGeometry ?? {}), lod });
  const shapesByTarget = new Map<string, OverlayShape[]>();
  for (const s of geometry.shapes) {
    if (!shapesByTarget.has(s.overlay.target)) shapesByTarget.set(s.overlay.target, []);
    shapesByTarget.get(s.overlay.target)!.push(s);
  }
  const bandIndex = new Map((options.bands ?? laid.bands).map((b) => [b.id, b]));

  const groups: SceneGroup[] = [];
  for (const g of graph.groups ?? []) {
    const box = positions.groups[g.id];
    if (!box) continue;
    const shapes = shapesByTarget.get(g.id) ?? [];
    const tint = shapes.find((s) => s.kind === "tint");
    groups.push({ group: g, box, color: scales.categorical(g.id).color, tint: tintFor(tint?.overlay.payload?.value, scales), band: bandIndex.get(g.id), chips: shapes.filter((s) => s.kind === "chip") });
  }

  const nodes: SceneNode[] = [];
  for (const n of graph.nodes) {
    const box = positions.nodes[n.id];
    if (!box) continue;
    const shapes = shapesByTarget.get(n.id) ?? [];
    const cases = metric(n, "cases", NaN);
    const members = metric(n, "members", NaN);
    const meta = n.kind === "stage" ? `${Number.isFinite(members) ? `${members} · ` : ""}${Number.isFinite(cases) ? formatCompact(cases, locale) : ""}`.trim() || undefined : Number.isFinite(cases) ? formatCompact(cases, locale) : undefined;
    nodes.push({
      node: n,
      box,
      color: scales.nodeColor(n),
      pattern: scales.nodePattern(n),
      label: n.label,
      meta,
      hatched: shapes.some((s) => s.kind === "hatch"),
      reconnected: hasTag(n, RECONNECTED_TAG),
      badges: shapes.filter((s) => s.kind === "badge"),
      end: n.kind === "event" && hasTag(n, "end"),
      glyph: n.kind === "gateway" ? (hasTag(n, "and") ? "+" : hasTag(n, "or") ? "○" : "×") : undefined,
    });
  }

  const edges: SceneEdge[] = [];
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    const a = positions.nodes[e.source];
    const b = positions.nodes[e.target];
    if (!a || !b) continue;
    const route: EdgeRoute = positions.edges[e.id]?.points?.length >= 2 ? positions.edges[e.id] : straightRoute(a, b);
    const reconnected = hasTag(e, RECONNECTED_TAG);
    const count = metric(e, "count", NaN);
    edges.push({
      edge: e,
      points: route.points,
      width: scales.edgeWidth(e),
      color: e.kind === "constraint" ? fixedColors.mechanism : scales.edgeColor(e),
      dash: reconnected ? [6, 5] : e.kind === "constraint" ? [2, 4] : undefined,
      label: e.kind === "follows" && Number.isFinite(count) ? formatCompact(count, locale) : undefined,
      reconnected,
    });
  }

  const routed: Positions = { ...positions, edges: Object.fromEntries(edges.map((e) => [e.edge.id, { points: e.points }])) };
  const hit = HitIndex.fromScene(routed, geometry);
  return {
    graph,
    positions,
    scales,
    overlays,
    shapes: geometry.shapes,
    nodes,
    edges,
    groups,
    bands: options.bands ?? laid.bands,
    bounds: union(positions.bounds, geometry.shapes.length ? geometry.bounds : { x: 0, y: 0, width: 0, height: 0 }),
    hit,
    lod,
    locale,
    size: nodes.length + edges.length,
    nodeById: new Map(nodes.map((n) => [n.node.id, n])),
    edgeById: new Map(edges.map((e) => [e.edge.id, e])),
    groupById: new Map(groups.map((g) => [g.group.id, g])),
    shapeById: new Map(geometry.shapes.map((s) => [s.id, s])),
    labelCache: new Map(),
  };
}

/** Group labels for descriptions; kept here so the React wrapper and the PNG export agree. */
export function groupLabelOf(scene: PreparedScene, id: string | undefined): string | undefined {
  return id ? scene.groupById.get(id)?.group.label : undefined;
}
