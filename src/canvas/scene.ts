/** Retained geometry of a scene for the canvas renderer, with the R-tree for hits and culling. Pure; runs in Node. */
import {
  type ActivityLabelOptions,
  type ColorScheme,
  type GroupMark,
  type TextMeasure,
  type ThemeSetting,
  activityLabel,
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
  followsSelfLoops,
  gatewayGlyph,
  groupMarks,
  hasTag,
  resolveTheme,
  markArrowhead,
  nodeCount,
  tintColor,
  unionBoxes,
} from "../core/index.js";
import { sceneOf } from "../core/scene.js";
import { ruleTokens } from "../core/tokens.js";

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
  /** @deprecated Texts arrive fitted by the scene's text measure and nothing fills this cache; read the marks' texts. Removed in the next major version. */
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
  /** What the texts are measured by (`FlowSceneOptions.textMeasure`): the Canvas draws the lines the scene fitted. Default `estimateTextWidth`. */
  textMeasure?: TextMeasure;
}

/** The overlay shapes of the elements without any. */
const NO_SHAPES: OverlayShape[] = Object.freeze([]) as unknown as OverlayShape[];

/** A glyph is allowed 0.7 em in the extents. */
const EM = 0.7;

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

type ExtentText = Pick<MarkText, "text" | "lead" | "x" | "y" | "size" | "weight" | "anchor" | "baseline" | "halo" | "maxWidth">;

/**
 * The box a text can cover: its glyphs by the scene's measure, at least 0.7 em each, or its limit (a shortened text keeps
 * a character and the ellipsis), its height from the baseline, the halo.
 */
function textBox(t: ExtentText, measure: TextMeasure, halo: number): Box {
  const text = (t.lead ?? "") + t.text;
  const w = Math.min(Math.max([...text].length * EM * t.size, measure(text, t)), Math.max(t.maxWidth ?? Infinity, 3 * EM * t.size));
  const x = t.anchor === "start" ? t.x : t.anchor === "middle" ? t.x - w / 2 : t.x - w;
  const [up, down] = t.baseline === "middle" ? [0.6 * t.size, 0.6 * t.size] : [t.size, 0.35 * t.size];
  return grow({ x, y: t.y - up, width: w, height: up + down }, t.halo ? halo : 0);
}

/** How far an arrowhead reaches from its path's end: tip, base or half width, and the outline. */
const reach = (a: ReturnType<typeof arrowheadExtent>): number => Math.max(a.tip, a.length - a.tip, a.half) + a.outline / 2;

/** The segment of the route nearest to a point (the first of equals): the one a path's count is written beside. */
function nearestSegment(points: readonly XY[], at: XY): number {
  let best = 0;
  let least = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    const d = Math.hypot(a.x + t * dx - at.x, a.y + t * dy - at.y);
    if (d < least) [best, least] = [i, d];
  }
  return best;
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
    theme: resolveTheme(options.theme),
    scheme: options.scheme,
    textMeasure: options.textMeasure,
  }, true);
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
      // The lines the card writes, not wrapped again.
      activityLines: labels ? { name: mark.texts.filter((t) => t.role === "nameLine").map((t) => t.text), counts: labels.showCounts === false ? [] : [mark.texts.filter((t) => t.role === "countLine" || t.role === "share").map((t) => t.text).join(" ")] } : undefined,
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
  const { stroke } = theme;
  const highlight = stroke.canvasPathHighlight / 2;
  // The selection ring (on the box), the focus rectangle (4 outside it) and a rule's strongest outline; a group's selected outline; the halo.
  const nodeReach = Math.max(6, stroke.canvasSelection, 4 + stroke.focus / 2, ruleTokens.strokeWeight.strong / 2);
  const groupReach = Math.max(1.5, stroke.canvasGroupSelected / 2, ruleTokens.strokeWeight.strong / 2);
  const halo = Math.max(1.5, stroke.halo / 2);
  const withTexts = (box: Box, texts: readonly ExtentText[]): Box => unionBoxes([box, ...texts.map((t) => textBox(t, scene.textMeasure, halo))]);
  const labelAt = new Map<number, number>();
  const extentOf = (it: HitItem): Box | undefined => {
    const i = it.index;
    if (i === undefined) return undefined;
    switch (it.kind) {
      case "node": {
        const { box: b, mark: m } = nodes[i];
        return withTexts(grow(m.shape === "diamond" && b.width > b.height ? { x: b.x, y: b.y + (b.height - b.width) / 2, width: b.width, height: b.width } : b, Math.max(nodeReach, m.stroke.width / 2)), m.texts);
      }
      case "group": {
        const m = groups[i].mark;
        return withTexts(grow(groups[i].box, Math.max(groupReach, m.stroke.width / 2, (m.rule?.width ?? 0) / 2)), m.texts);
      }
      case "overlay": {
        const m = marks[i];
        return withTexts(grow(m.box, Math.max(m.stroke ? m.stroke.width / 2 : 0, m.arrow ? reach(arrowheadExtent(markArrowhead(m.arrow))) : 0)), m.texts);
      }
      default: {
        const e = edges[i];
        const [p, q] = it.segment!;
        // The line (wider where highlighted) and its head, which grows with the line.
        const box = grow({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(q.x - p.x), height: Math.abs(q.y - p.y) }, Math.max(e.width / 2, highlight, reach(arrowheadExtent(e.mark.arrow))));
        const text = e.mark.texts[0];
        if (!text) return box;
        if (!labelAt.has(i)) labelAt.set(i, nearestSegment(e.points, text));
        return e.points.indexOf(p) === labelAt.get(i) ? withTexts(box, [text]) : box;
      }
    }
  };
  const hit = HitIndex.fromScene(routed, { ...geometry, shapes: shown }, undefined, (kind, id) => at[kind].get(id), extentOf, (id) => nodes[at.node.get(id)!]?.mark.shape === "diamond", (id) => marks[at.overlay.get(id)!], (id) => edges[at.edge.get(id)!]?.mark);
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
