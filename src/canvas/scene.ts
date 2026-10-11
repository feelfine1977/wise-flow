/**
 * Retained geometry of a scene for the canvas renderer: every element with
 * its box or route, colours and texts resolved once, plus the R-tree that
 * serves hover, click and viewport culling. `prepareScene` is pure and runs
 * in Node; drawing happens in `draw.ts`.
 */
import {
  type ActivityLabelOptions,
  type ColorScheme,
  type GroupMark,
  type ThemeSetting,
  activityLabel,
  activityLabelLines,
  activityNodeCounts,
  type Box,
  type EdgeMark,
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type FlowScene,
  type HitItem,
  type LaneBand,
  type LaneMode,
  type Locale,
  type LodRules,
  type NodeMark,
  type Overlay,
  type OverlayGeometryOptions,
  type OverlayShape,
  type PatternId,
  type Positions,
  type StyleSpec,
  HitIndex,
  buildScene,
  followsSelfLoops,
  gatewayGlyph,
  groupMarks,
  hasTag,
  resolveTheme,
  nodeCount,
  tintColor,
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
  /** What the node looks like; the drawing reads it. */
  mark: NodeMark;
}

export interface SceneEdge {
  edge: FlowEdge;
  points: { x: number; y: number }[];
  width: number;
  color: string;
  dash?: number[];
  label?: string;
  reconnected: boolean;
  /** What the edge looks like; the drawing reads it. */
  mark: EdgeMark;
}

export interface SceneGroup {
  group: FlowGroup;
  box: Box;
  color: string;
  tint?: string;
  band?: LaneBand;
  chips: OverlayShape[];
  /** What the group looks like; the drawing reads it. */
  mark: GroupMark;
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
  /** The theme the marks are resolved in: a preset's name or changes over a preset (`resolveTheme`). Default the `default` preset. */
  theme?: ThemeSetting;
  /** The colour scheme of the theme. Default `light`. */
  scheme?: ColorScheme;
}

/** The overlay shapes of the elements without any. */
const NO_SHAPES: OverlayShape[] = Object.freeze([]) as unknown as OverlayShape[];

/** Positions and overlay extents together; an empty box adds nothing. */
function sceneBounds(positions: Box, overlays: Box | undefined): Box {
  const extents = [positions, ...(overlays ? [overlays] : [])].filter((b) => b.width > 0 || b.height > 0);
  return extents.length ? unionBoxes(extents) : positions;
}

/** Self-loop overlays for follows edges from a node to itself (as `<ProcessMap/>` does). */
export function selfLoopOverlays(graph: FlowGraph, locale: Locale = "en"): Overlay[] {
  return followsSelfLoops(graph, { locale });
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
    theme: resolveTheme(options.theme),
    scheme: options.scheme,
  });
  return retainScene(options.bands ? { ...scene, bands: options.bands, groupMarks: groupMarks(graph, scene.positions, options.bands, scene.scales, scene.theme) } : scene);
}

/** Retained geometry for a scene the core has built (`buildScene`). */
export function retainScene(scene: FlowScene): PreparedScene {
  const { positions, locale, geometry, marks, activityLabels, theme } = scene;
  const shapesByTarget = new Map<string, OverlayShape[]>();
  for (const s of geometry.shapes) {
    if (!shapesByTarget.has(s.overlay.target)) shapesByTarget.set(s.overlay.target, []);
    shapesByTarget.get(s.overlay.target)!.push(s);
  }
  const groups: SceneGroup[] = scene.groupMarks.map((mark) => {
    const shapes = shapesByTarget.get(mark.id) ?? [];
    const tint = shapes.find((s) => s.kind === "tint");
    return { group: mark.group, box: mark.box, color: mark.color, tint: tint && tintColor(tint.overlay, theme), band: mark.band, chips: shapes.filter((s) => s.kind === "chip"), mark };
  });

  const shapesOf = (id: string) => shapesByTarget.get(id) ?? NO_SHAPES;
  const nodes: SceneNode[] = scene.nodeMarks.map((mark) => {
    const n = mark.node;
    const labels = n.kind === "activity" ? activityLabels : undefined;
    const shapes = shapesOf(n.id);
    const badges = shapes.filter((s) => s.kind === "badge");
    return {
      node: n,
      box: mark.box,
      color: mark.color,
      pattern: mark.pattern,
      label: labels ? activityLabel(n, labels) : n.label,
      activityLines: labels ? activityLabelLines(n, labels, mark.box.width, locale) : undefined,
      // The count the mark writes, not formatted again.
      meta: labels ? (labels.showCounts === false ? undefined : activityNodeCounts(n, labels, locale)) : (mark.texts.find((t) => t.role === "count")?.text ?? nodeCount(n, locale)),
      hatched: shapes.some((s) => s.kind === "hatch"),
      reconnected: mark.reconnected,
      badges: badges.length ? badges : NO_SHAPES,
      end: n.kind === "event" && hasTag(n, "end"),
      glyph: n.kind === "gateway" ? gatewayGlyph(n) : undefined,
      mark,
    };
  });

  const edges: SceneEdge[] = scene.edgeMarks.map((mark) => ({
    edge: mark.edge,
    points: mark.points,
    width: mark.width,
    color: mark.color,
    dash: mark.dash,
    label: mark.texts[0]?.text,
    reconnected: mark.reconnected,
    mark,
  }));

  const routed: Positions = { ...positions, edges: Object.fromEntries(edges.map((e) => [e.edge.id, { points: e.points }])) };
  // Marks that are not drawn on the map (map-level chips) take no room and answer no hit.
  const drawn = new Set(marks.filter((m) => m.inMap).map((m) => m.id));
  const shown = geometry.shapes.filter((s) => drawn.has(s.id));
  // Each item keeps its element's place in the list it is drawn from.
  const order = { group: groups.map((g) => g.group.id), node: nodes.map((n) => n.node.id), edge: edges.map((e) => e.edge.id), overlay: marks.map((m) => m.id) };
  const at = Object.fromEntries(Object.entries(order).map(([k, ids]) => [k, new Map(ids.map((id, i) => [id, i]))])) as Record<HitItem["kind"], Map<string, number>>;
  const hit = HitIndex.fromScene(routed, { ...geometry, shapes: shown }, undefined, (kind, id) => at[kind].get(id));
  return {
    ...scene,
    shapes: geometry.shapes,
    nodes,
    edges,
    groups,
    bounds: sceneBounds(positions.bounds, shown.length ? unionBoxes(shown) : undefined),
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
