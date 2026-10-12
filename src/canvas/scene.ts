/** Retained geometry of a scene for the canvas renderer, with the R-tree for hits and culling. Pure; runs in Node. */
import {
  type ActivityLabelOptions,
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
  type MarkText,
  type NodeMark,
  type Overlay,
  type OverlayGeometryOptions,
  type OverlayShape,
  type PatternId,
  type Positions,
  type StyleSpec,
  type XY,
  HitIndex,
  arrowheadExtent,
  arrowheadTokens,
  followsSelfLoops,
  gatewayGlyph,
  hasTag,
  markArrowhead,
  nodeCount,
  tintColor,
  unionBoxes,
} from "../core/index.js";
import { sceneOf } from "../core/scene.js";

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
  /** Cache of truncated labels per font and width, filled by the drawing routines. */
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

/** The overlay shapes of the elements without any. */
const NO_SHAPES: OverlayShape[] = Object.freeze([]) as unknown as OverlayShape[];

/** A glyph is allowed 0.7 em in the extents. */
const EM = 0.7;

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

/** The box a text can cover: its glyphs or its limit (a shortened text keeps a character and the ellipsis), its height from the baseline, the halo. */
function textBox(t: Pick<MarkText, "text" | "lead" | "x" | "y" | "size" | "anchor" | "baseline" | "halo" | "maxWidth">): Box {
  const w = Math.min([...(t.lead ?? "") + t.text].length * EM * t.size, Math.max(t.maxWidth ?? Infinity, 3 * EM * t.size));
  const x = t.anchor === "start" ? t.x : t.anchor === "middle" ? t.x - w / 2 : t.x - w;
  const [up, down] = t.baseline === "middle" ? [0.6 * t.size, 0.6 * t.size] : [t.size, 0.35 * t.size];
  return grow({ x, y: t.y - up, width: w, height: up + down }, t.halo ? 1.5 : 0);
}

const withTexts = (box: Box, texts: readonly Parameters<typeof textBox>[0][]): Box => unionBoxes([box, ...texts.map(textBox)]);

/** How far an arrowhead reaches from its path's end: tip, base or half width, and the outline. */
const reach = (a: ReturnType<typeof arrowheadExtent>): number => Math.max(a.tip, a.length - a.tip, a.half) + a.outline / 2;

/** The segment at the route's half length, where the count label sits. */
function midSegment(points: readonly XY[]): number {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let rest = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i] || i === lengths.length - 1) return i;
    rest -= lengths[i];
  }
  return 0;
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

/**
 * Resolve a graph with positions into retained geometry on top of the core
 * scene (`buildScene`): overlays are `options.overlays` (default
 * `graph.overlays`) plus self-loops; positions may be replaced by lane bands.
 */
export function prepareScene(graph: FlowGraph, givenPositions: Positions, options: PrepareOptions = {}): PreparedScene {
  const scene = sceneOf(graph, givenPositions, {
    overlays: options.overlays,
    style: options.style,
    locale: options.locale,
    lanes: options.bands ? "none" : options.lanes,
    activityLabels: options.activityLabels,
    selfLoops: options.selfLoops,
    lod: options.lod,
    lodBySize: options.lodBySize !== false,
    overlayGeometry: options.overlayGeometry,
  }, true);
  return retainScene(options.bands ? { ...scene, bands: options.bands } : scene);
}

/** Retained geometry for a scene the core has built (`buildScene`). */
export function retainScene(scene: FlowScene): PreparedScene {
  const { graph, positions, bands, scales, locale, geometry, marks, activityLabels } = scene;
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
    groups.push({ group: g, box, color: scales.categorical(g.id).color, tint: tint && tintColor(tint.overlay), band: bandIndex.get(g.id), chips: shapes.filter((s) => s.kind === "chip") });
  }

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

  // The hit index holds the elements the scene draws, also where the positions hold more.
  const routed: Positions = {
    ...positions,
    nodes: Object.fromEntries(nodes.map((n) => [n.node.id, n.box])),
    groups: Object.fromEntries(groups.map((g) => [g.group.id, g.box])),
    edges: Object.fromEntries(edges.map((e) => [e.edge.id, { points: e.points }])),
  };
  // Marks that are not drawn on the map (map-level chips) take no room and answer no hit.
  const drawn = new Set(marks.filter((m) => m.inMap).map((m) => m.id));
  const shown = geometry.shapes.filter((s) => drawn.has(s.id));
  // Each item keeps its element's place in the list it is drawn from.
  const order = { group: groups.map((g) => g.group.id), node: nodes.map((n) => n.node.id), edge: edges.map((e) => e.edge.id), overlay: marks.map((m) => m.id) };
  const at = Object.fromEntries(Object.entries(order).map(([k, ids]) => [k, new Map(ids.map((id, i) => [id, i]))])) as Record<HitItem["kind"], Map<string, number>>;
  // What a culled draw reads an element for: everything the drawing can put beyond its box (see docs/API.md).
  const edgeArrow = arrowheadExtent(arrowheadTokens.edge);
  const extentOf = (it: HitItem): Box | undefined => {
    const i = it.index;
    if (i === undefined) return undefined;
    switch (it.kind) {
      case "node": {
        const { box: b, mark: m } = nodes[i];
        return withTexts(grow(m.shape === "diamond" && b.width > b.height ? { x: b.x, y: b.y + (b.height - b.width) / 2, width: b.width, height: b.width } : b, 6), m.texts);
      }
      case "group": {
        const b = groups[i].box;
        return withTexts(grow(b, 1.5), [{ text: groups[i].group.label, x: b.x + 12, y: b.y + 22, size: 14, anchor: "start", baseline: "alphabetic", halo: false }]);
      }
      case "overlay": {
        const m = marks[i];
        return withTexts(grow(m.box, Math.max(m.stroke ? m.stroke.width / 2 : 0, m.arrow ? reach(arrowheadExtent(markArrowhead(m.arrow))) : 0)), m.texts);
      }
      default: {
        const e = edges[i];
        const [p, q] = it.segment!;
        const box = grow({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }, Math.max(e.width / 2, reach(edgeArrow)));
        return e.mark.texts.length && e.points.indexOf(p) === midSegment(e.points) ? withTexts(box, [e.mark.texts[0]]) : box;
      }
    }
  };
  const hit = HitIndex.fromScene(routed, { ...geometry, shapes: shown }, undefined, (kind, id) => at[kind].get(id), extentOf, (id) => nodes[at.node.get(id)!]?.mark.shape === "diamond");
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
