/** The scene every renderer reads: a graph with its positions resolved once into the theme's marks, overlays, scales and the legend. */
import { type ActivityLabelOptions, activityReferences } from "./activity-labels.js";
import { pathCourses } from "./courses.js";
import { type EdgeMark, type GroupMark, type NodeMark, edgeColor, edgeMarks, edgePoints, groupMarks, nodeMarks } from "./element-marks.js";
import { type SceneLegend, legendOfScene } from "./figure.js";
import type { Locale } from "./format.js";
import { type Box, type Positions, type XY, filterPositions, finitePositions, unionBoxes } from "./layout.js";
import { type LaneBand, type LaneMode, laneBands } from "./lanes.js";
import { type FlowGraph, type Overlay, MAP_TARGET } from "./model.js";
import { withFollowsSelfLoops } from "./observed-loops.js";
import { type OverlayGeometry, type OverlayGeometryOptions, groupTitles, placeOverlays } from "./overlay-geometry.js";
import { type OverlayMark, overlayMarks } from "./overlay-marks.js";
import { canonicalOverlays } from "./overlays.js";
import { repositionNodes } from "./routing.js";
import { type LodRules, type Measure, type Scales, type StyleSpec, buildScales, defaultLod, lodForSize, measureStyle } from "./style.js";
import { type TextMeasure, estimateTextWidth } from "./text.js";
import { type ColorScheme, type Theme, defaultTheme, themeColors, themePalettes } from "./theme.js";
import type { ColorToken } from "./tokens.js";

export interface FlowSceneOptions {
  /** Overlays to show. Default `graph.overlays`. */
  overlays?: Overlay[];
  /**
   * The measure the map shows (`measureStyles`): `frequency`, `shortfall` or
   * `performance`. A `style` given too changes it entry by entry
   * (`measureStyle`). Default: `style`, else `defaultStyle`, which draws
   * frequency and names no measure.
   */
  measure?: Measure;
  style?: StyleSpec;
  locale?: Locale;
  /** Draw stage or lane groups as bands (see `laneBands`). Default `none`. */
  lanes?: LaneMode;
  /**
   * Nodes moved by hand to these absolute points after the lane bands are laid
   * out; the edges are routed around them again (see `repositionNodes`).
   */
  moved?: Readonly<Record<string, XY>>;
  activityLabels?: ActivityLabelOptions;
  /** Follows edges from a node to itself become self-loop overlays. Default true. */
  selfLoops?: boolean;
  /** Level-of-detail rules over `style.lod`. */
  lod?: Partial<LodRules>;
  /**
   * Tighten the level-of-detail rules with the number of nodes (`lodForSize`),
   * so that a fitted live map stays readable. Default false: exports read zoom 1.
   */
  lodBySize?: boolean;
  overlayGeometry?: OverlayGeometryOptions;
  /** What the marks are drawn in: paints, palettes, fonts, text styles, radii and strokes. Default `defaultTheme`. */
  theme?: Theme;
  /** The colour scheme the theme's colour roles are resolved in. Default `light`. */
  scheme?: ColorScheme;
  /**
   * What every text is measured by: node labels and chip texts are shortened,
   * activity names wrapped, chips and the figure sized by it, so that every
   * renderer draws the same lines. Default `estimateTextWidth`, which needs no
   * DOM; in a browser `canvasTextMeasure` (`wise-flow/canvas`) measures with
   * the font.
   */
  textMeasure?: TextMeasure;
}

export interface FlowScene {
  graph: FlowGraph;
  /** Positions after the lane bands and the manual moves placed the nodes, with the courses of backward and opposite paths (`pathCourses`). */
  positions: Positions;
  bands: LaneBand[];
  /** The given activity-label options with references for every activity. */
  activityLabels?: ActivityLabelOptions;
  locale: Locale;
  /** The style drawn: the measure's with the given style over it. */
  style: StyleSpec;
  /** The theme the marks were resolved in. */
  theme: Theme;
  scheme: ColorScheme;
  /** The colour of every paint role (`MarkPaint` names one) in the scene's scheme. */
  colors: Readonly<Record<ColorToken, string>>;
  /** What the scene's texts were measured by; the exports measure the legend and the figure with it. */
  textMeasure: TextMeasure;
  scales: Scales;
  /**
   * Overlays whose target (or, for arcs, both endpoints) is a node, a group or
   * the map, plus the follows self-loops, in canonical order.
   */
  overlays: Overlay[];
  /** Zoom from which each kind of element is drawn. */
  lod: LodRules;
  geometry: OverlayGeometry;
  /** What each shape of the geometry looks like, one mark per shape in the same order. */
  marks: OverlayMark[];
  /** What each placed node looks like, in the graph's order. */
  nodeMarks: NodeMark[];
  /** What each edge between two placed nodes looks like, in the graph's order; not the edges from a node to itself. */
  edgeMarks: EdgeMark[];
  /** What each placed group looks like, in the graph's order. */
  groupMarks: GroupMark[];
  /** What the legend lists: the scales of what is drawn, a key per kind of mark drawn and the map-level chips (`legendOfScene`). */
  legend: SceneLegend;
  /** Union of the positions' bounds and the marks drawn on the map. */
  bounds: Box;
}

function shownOverlays(graph: FlowGraph, given: Overlay[], options: FlowSceneOptions, locale: Locale): Overlay[] {
  const known = new Set([...graph.nodes.map((n) => n.id), ...(graph.groups ?? []).map((g) => g.id), MAP_TARGET]);
  const overlays = given.filter((o) => (o.kind === "arc" ? known.has(String(o.payload?.source)) && known.has(String(o.payload?.target)) : known.has(o.target)));
  if (options.selfLoops === false) return overlays;
  return withFollowsSelfLoops(graph, overlays, { locale, observed: options.activityLabels ? { caseLabel: options.activityLabels.caseLabel } : undefined });
}

/** Resolve a graph with positions into the scene the renderers draw. */
export function buildScene(graph: FlowGraph, givenPositions: Positions, options: FlowSceneOptions = {}): FlowScene {
  return sceneOf(graph, givenPositions, options);
}

/** `buildScene`; `own` places the overlays on the graph's own positions, as on the map (an export's may hold more). */
export function sceneOf(graph: FlowGraph, givenPositions: Positions, options: FlowSceneOptions, own?: boolean): FlowScene {
  const locale = options.locale ?? "en";
  const style = measureStyle(options.measure, options.style);
  const theme = options.theme ?? defaultTheme;
  const scheme = options.scheme ?? "light";
  const colors = themeColors(theme, scheme);
  // The marks draw the neutral colour, the accent and the palettes of the scheme; every other paint they name by role.
  const marked = scheme === "light" ? theme : { ...theme, color: colors, palette: themePalettes(theme, scheme) };
  const measure = options.textMeasure ?? estimateTextWidth;
  const laid = laneBands(graph, finitePositions(givenPositions), { lanes: options.lanes ?? "none" });
  const positions = options.moved ? finitePositions(repositionNodes(graph, laid.positions, options.moved)) : laid.positions;
  const activityLabels = options.activityLabels ? { ...options.activityLabels, references: activityReferences(graph, options.activityLabels.references) } : undefined;
  const overlays = canonicalOverlays(shownOverlays(graph, options.overlays ?? graph.overlays ?? [], options, locale));
  const rules = { ...(style.lod ?? {}), ...(options.lod ?? {}) };
  const lod = options.lodBySize ? lodForSize(graph.nodes.length, rules) : { ...defaultLod, ...rules };
  const scales = buildScales(graph, style, marked);
  // Backward paths below the flow and opposite paths side by side; the scene's positions carry their courses, which chips keep clear of.
  const courses = pathCourses(graph, positions, { width: scales.edgeWidth, bands: new Set(laid.bands.map((b) => b.id)) });
  const routes = graph.edges.flatMap((e) => (e.kind === "constraint" || e.source === e.target ? [] : [edgePoints(courses.positions, e) ?? []]));
  const edges = edgeMarks(graph, courses.positions, scales, locale, marked, courses);
  // Arc labels keep clear of the paths' counts (from their baseline up a full size).
  const counts = edges.flatMap((e) => e.texts.map((t) => {
    const width = measure(t.text, t);
    return { x: t.x - (t.anchor === "middle" ? width / 2 : t.anchor === "end" ? width : 0), y: t.y - t.size, width, height: t.size };
  }));
  const geometry = placeOverlays(overlays, own ? filterPositions(positions, graph) : positions, { locale, ...(options.overlayGeometry ?? {}), lod }, groupTitles(graph.groups ?? [], positions), measure, theme.text, routes, counts);
  // Elements a hatch covers are outside the scope the host evaluates; the state resolves here and reaches every renderer.
  const outOfScope = new Set(overlays.filter((o) => o.kind === "hatch").map((o) => o.target));
  const nodes = nodeMarks(graph, positions, scales, { locale, activityLabels, theme: marked, measure, outOfScope });
  const groups = groupMarks(graph, positions, laid.bands, scales, marked);
  // A self-loop that stands for a path takes the path's colour; a tint follows the corners of what it covers.
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  const radii = new Map<string, number>([...nodes, ...groups].map((m) => [m.id, m.radius]));
  const marks = overlayMarks(geometry.shapes, locale, marked, measure, {
    pathColor: (id) => {
      const edge = byId.get(id);
      return edge && edgeColor(edge, scales, marked);
    },
    radius: (id) => radii.get(id),
  });
  return {
    graph,
    positions: courses.positions,
    bands: laid.bands,
    activityLabels,
    locale,
    style,
    theme,
    scheme,
    colors,
    textMeasure: measure,
    scales,
    overlays,
    lod,
    geometry,
    marks,
    nodeMarks: nodes,
    edgeMarks: edges,
    groupMarks: groups,
    legend: legendOfScene({ scales, marks, nodeMarks: nodes, edgeMarks: edges, locale, graph }),
    bounds: unionBoxes([courses.positions.bounds, ...marks.filter((m) => m.inMap).map((m) => m.box)]),
  };
}
