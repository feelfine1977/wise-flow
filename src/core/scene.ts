/**
 * The scene every renderer reads: a graph with its positions resolved once
 * into activity references, lane bands, scales, the overlays to show in their
 * canonical order, level-of-detail rules and overlay geometry.
 */
import { type ActivityLabelOptions, activityReferences } from "./activity-labels.js";
import type { Locale } from "./format.js";
import { type Box, type Positions, type XY, unionBoxes } from "./layout.js";
import { type LaneBand, type LaneMode, laneBands } from "./lanes.js";
import { type FlowGraph, type Overlay, MAP_TARGET } from "./model.js";
import { withFollowsSelfLoops } from "./observed-loops.js";
import { type OverlayGeometry, type OverlayGeometryOptions, placeOverlays } from "./overlay-geometry.js";
import { type OverlayMark, overlayMarks } from "./overlay-marks.js";
import { canonicalOverlays } from "./overlays.js";
import { repositionNodes } from "./routing.js";
import { type LodRules, type Scales, type StyleSpec, buildScales, defaultLod, defaultStyle, lodForSize } from "./style.js";

export interface FlowSceneOptions {
  /** Overlays to show. Default `graph.overlays`. */
  overlays?: Overlay[];
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
}

export interface FlowScene {
  graph: FlowGraph;
  /** Positions after the lane bands and the manual moves placed the nodes. */
  positions: Positions;
  bands: LaneBand[];
  /** The given activity-label options with references for every activity. */
  activityLabels?: ActivityLabelOptions;
  locale: Locale;
  style: StyleSpec;
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
  const locale = options.locale ?? "en";
  const style = options.style ?? defaultStyle;
  const laid = laneBands(graph, givenPositions, { lanes: options.lanes ?? "none" });
  const positions = options.moved ? repositionNodes(graph, laid.positions, options.moved) : laid.positions;
  const activityLabels = options.activityLabels ? { ...options.activityLabels, references: activityReferences(graph, options.activityLabels.references) } : undefined;
  const overlays = canonicalOverlays(shownOverlays(graph, options.overlays ?? graph.overlays ?? [], options, locale));
  const rules = { ...(style.lod ?? {}), ...(options.lod ?? {}) };
  const lod = options.lodBySize ? lodForSize(graph.nodes.length, rules) : { ...defaultLod, ...rules };
  const geometry = placeOverlays(overlays, positions, { ...(options.overlayGeometry ?? {}), lod });
  const marks = overlayMarks(geometry.shapes, locale);
  return {
    graph,
    positions,
    bands: laid.bands,
    activityLabels,
    locale,
    style,
    scales: buildScales(graph, style),
    overlays,
    lod,
    geometry,
    marks,
    bounds: unionBoxes([positions.bounds, ...marks.filter((m) => m.inMap).map((m) => m.box)]),
  };
}
