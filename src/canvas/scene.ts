/**
 * Retained geometry of a scene for the canvas renderer: every element with
 * its box or route, colours and texts resolved once, plus the R-tree that
 * serves hover, click and viewport culling. `prepareScene` is pure and runs
 * in Node; drawing happens in `draw.ts`.
 */
import {
  type ActivityLabelOptions,
  activityLabel,
  activityLabelLines,
  activityNodeCounts,
  type Box,
  type EdgeRoute,
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type FlowScene,
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
  RECONNECTED_TAG,
  buildScene,
  followsSelfLoops,
  fixedColors,
  formatCompact,
  hasTag,
  metric,
  straightRoute,
  unionBoxes,
} from "../core/index.js";

export interface SceneNode {
  node: FlowNode;
  box: Box;
  color: string;
  pattern: PatternId;
  label: string;
  activityLines?: { name: string[]; counts: string[] };
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

/**
 * The core scene with what the Canvas renderer adds: elements with their
 * resolved geometry and texts, the hit index and lookups by id.
 */
export interface PreparedScene extends FlowScene {
  shapes: OverlayShape[];
  nodes: SceneNode[];
  edges: SceneEdge[];
  groups: SceneGroup[];
  /** Union of positions and overlay geometry; boxes without area add nothing. */
  bounds: Box;
  hit: HitIndex;
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
  activityLabels?: ActivityLabelOptions;
  style?: StyleSpec;
  /** Overlays to show. Default `graph.overlays`. */
  overlays?: Overlay[];
  lod?: Partial<LodRules>;
  /**
   * Tighten the level-of-detail rules with the number of nodes, so that a
   * fitted live map stays readable. Default true; exports pass false.
   */
  lodBySize?: boolean;
  locale?: Locale;
  lanes?: LaneMode;
  /** Bands already computed by the caller (the positions are then used as given). */
  bands?: LaneBand[];
  overlayGeometry?: OverlayGeometryOptions;
  /** Self-loop follows edges become self-loop overlays. Default true. */
  selfLoops?: boolean;
}

/** Positions and overlay extents together; an empty box adds nothing. */
function sceneBounds(positions: Box, overlays: Box | undefined): Box {
  const extents = [positions, ...(overlays ? [overlays] : [])].filter((b) => b.width > 0 || b.height > 0);
  return extents.length ? unionBoxes(extents) : positions;
}

/** Self-loop overlays for follows edges from a node to itself (as `<ProcessMap/>` does). */
export function selfLoopOverlays(graph: FlowGraph, locale: Locale = "en"): Overlay[] {
  return followsSelfLoops(graph, { locale });
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
 * Resolve a graph with positions into retained geometry on top of the core
 * scene (`buildScene`): overlays are `options.overlays` (default
 * `graph.overlays`) plus self-loops; positions may be replaced by lane bands.
 */
export function prepareScene(graph: FlowGraph, givenPositions: Positions, options: PrepareOptions = {}): PreparedScene {
  const scene = buildScene(graph, givenPositions, {
    overlays: options.overlays,
    style: options.style,
    locale: options.locale,
    lanes: options.bands ? "none" : options.lanes,
    activityLabels: options.activityLabels,
    selfLoops: options.selfLoops,
    lod: options.lod,
    lodBySize: options.lodBySize !== false,
    overlayGeometry: options.overlayGeometry,
  });
  const { positions, scales, locale, geometry, activityLabels } = scene;
  const bands = options.bands ?? scene.bands;
  const shapesByTarget = new Map<string, OverlayShape[]>();
  for (const s of geometry.shapes) {
    if (!shapesByTarget.has(s.overlay.target)) shapesByTarget.set(s.overlay.target, []);
    shapesByTarget.get(s.overlay.target)!.push(s);
  }
  const bandIndex = new Map(bands.map((b) => [b.id, b]));

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
      label: n.kind === "activity" && activityLabels ? activityLabel(n, activityLabels) : n.label,
      activityLines: n.kind === "activity" && activityLabels ? activityLabelLines(n, activityLabels, box.width, locale) : undefined,
      meta: n.kind === "activity" && activityLabels ? activityLabels.showCounts === false ? undefined : activityNodeCounts(n, activityLabels, locale) : meta,
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
    ...scene,
    bands,
    shapes: geometry.shapes,
    nodes,
    edges,
    groups,
    bounds: sceneBounds(positions.bounds, geometry.shapes.length ? geometry.bounds : undefined),
    hit,
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
