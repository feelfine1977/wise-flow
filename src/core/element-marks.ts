/**
 * Node and edge marks: what each node and edge looks like, resolved once for
 * every renderer. Texts carry what is drawn: shortened to the width they are
 * limited to, or wrapped into lines, by the scene's text measure.
 */
import { type ActivityLabelOptions, activityDescription, activityLabelLines } from "./activity-labels.js";
import { type Locale, formatCompact } from "./format.js";
import { type Box, type Positions, type XY, straightRoute } from "./layout.js";
import type { LaneBand } from "./lanes.js";
import { type EdgeKind, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type GroupKind, type NodeKind, hasTag, metric } from "./model.js";
import { RECONNECTED_TAG } from "./aggregate.js";
import { chipAnchor } from "./overlay-geometry.js";
import type { MarkFill, MarkPaint, MarkText } from "./overlay-marks.js";
import type { PatternId, Scales } from "./style.js";
import { type TextMeasure, estimateTextWidth, truncateText } from "./text.js";
import { type Theme, defaultTheme } from "./theme.js";
import { dashTokens, dimensionTokens } from "./tokens.js";

/** Point at half of a polyline's length. */
export function routeMidpoint(points: readonly XY[]): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const l = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(l);
    total += l;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return { x: points[i].x + (points[i + 1].x - points[i].x) * f, y: points[i].y + (points[i + 1].y - points[i].y) * f };
    }
    remaining -= lengths[i];
  }
  return points[points.length - 1];
}

/** Where an edge's label sits: 4 above the middle of its route. */
export function edgeLabelPoint(points: readonly XY[]): XY {
  const mid = routeMidpoint(points);
  return { x: mid.x, y: mid.y - 4 };
}

/** The route an edge is drawn along: its routed points, or a straight line between the two boxes. */
export function edgePoints(positions: Positions, edge: FlowEdge): XY[] | undefined {
  const route = positions.edges[edge.id];
  if (route && route.points.length >= 2) return route.points;
  const a = positions.nodes[edge.source];
  const b = positions.nodes[edge.target];
  return a && b ? straightRoute(a, b).points : undefined;
}

/** A text of a node or an edge mark. */
export interface ElementText extends MarkText {
  /**
   * What the text is: the node's label, a gateway's glyph, a node's or an
   * edge's count, or one line of an activity's name or counts.
   */
  role: "label" | "glyph" | "count" | "nameLine" | "countLine";
  /** Level-of-detail rule from which the text is drawn; drawn at every zoom without one. */
  lod?: "labels" | "edgeLabels";
}

export interface NodeMark {
  id: string;
  kind: NodeKind;
  node: FlowNode;
  box: Box;
  /** Outline: a rounded box (`radius`), the circle inside the box, or the diamond inside it. */
  shape: "box" | "circle" | "diamond";
  radius: number;
  /** Colour of the node's category (`scales.nodeColor`); the `value` paint. */
  color: string;
  /** Pattern twin of `color`. */
  pattern: PatternId;
  fill: MarkPaint;
  stroke: { paint: MarkPaint; width: number; dash?: number[] };
  /** Colour band of `band` width along the left edge, in `color` with its pattern twin. */
  band?: number;
  texts: ElementText[];
  /** Added back to keep the map connected; drawn dashed. */
  reconnected: boolean;
  /** Exact description for a tooltip, where the node shows a short form (activity labels). */
  title?: string;
}

export interface EdgeMark {
  id: string;
  kind: EdgeKind;
  edge: FlowEdge;
  /** The routed points, or a straight line between the two boxes. */
  points: XY[];
  color: string;
  width: number;
  dash?: number[];
  /** The count label at `edgeLabelPoint`, where the edge has a count. */
  texts: ElementText[];
  reconnected: boolean;
}

interface NodeMarkOptions {
  color: string;
  pattern: PatternId;
  locale?: Locale;
  /** Activity label options with references (see `activityReferences`). */
  activityLabels?: ActivityLabelOptions;
  /** The theme the mark's outline, radius and texts are resolved in. Default `defaultTheme`. */
  theme?: Theme;
  /** What the texts are shortened and wrapped by. Default `estimateTextWidth`. */
  measure?: TextMeasure;
}

/** Glyph of a gateway: + for AND, ○ for OR, × otherwise. */
export function gatewayGlyph(node: FlowNode): string {
  return hasTag(node, "and") ? "+" : hasTag(node, "or") ? "○" : "×";
}

/** The count a node shows: its cases, and for a stage its members before them. */
export function nodeCount(node: FlowNode, locale: Locale = "en"): string | undefined {
  const cases = metric(node, "cases", NaN);
  const shown = Number.isFinite(cases) ? formatCompact(cases, locale) : "";
  if (node.kind !== "stage") return shown || undefined;
  const members = metric(node, "members", NaN);
  return `${Number.isFinite(members) ? `${members} · ` : ""}${shown}`.trim() || undefined;
}

// Texts and marks are written as one literal with every key (a key without a
// value reads as absent), which the engine keeps in one allocation.
const ink = (text: string, x: number, y: number, size: number, rest: Partial<ElementText> & Pick<ElementText, "role">): ElementText => ({
  text,
  x,
  y,
  size,
  anchor: rest.anchor ?? "start",
  baseline: rest.baseline ?? "middle",
  paint: rest.paint ?? "ink",
  halo: false,
  role: rest.role,
  maxWidth: rest.maxWidth,
  lod: rest.lod,
  weight: rest.weight,
});

/** A text shortened to its `maxWidth` by the measure, in place. */
function fitted(t: ElementText, measure: TextMeasure): ElementText {
  if (t.maxWidth !== undefined) t.text = truncateText(t.text, t.maxWidth, t, measure);
  return t;
}

const strokes = new Map<string, NodeMark["stroke"]>();

/** One frozen outline per paint, width and dash, shared by the marks that have it. */
function outline(paint: MarkPaint, width: number, dash?: readonly number[]): NodeMark["stroke"] {
  const key = `${paint} ${width} ${dash}`;
  let stroke = strokes.get(key);
  if (!stroke) strokes.set(key, (stroke = Object.freeze(dash ? { paint, width, dash: dash as number[] } : { paint, width })));
  return stroke;
}

// A dash means "not directly observed": only what was re-added to keep the map connected is dashed.
const RECONNECTED_DASH = Object.freeze(dashTokens.reconnectedNode);

/** What one node looks like in its box. */
export function nodeMark(node: FlowNode, box: Box, options: NodeMarkOptions): NodeMark {
  const { stroke: strokeTokens, radius: radiusTokens, text: textTokens, space } = options.theme ?? defaultTheme;
  // Where a node's texts start and how much of its width they leave out: the stylesheet's padding of a node.
  const INSET = 8 * space.unit;
  const INSETS = INSET + 4 * space.unit;
  const locale = options.locale ?? "en";
  const measure = options.measure ?? estimateTextWidth;
  const reconnected = hasTag(node, RECONNECTED_TAG);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const mark = (shape: NodeMark["shape"], radius: number, stroke: NodeMark["stroke"], texts: ElementText[], fill: MarkPaint = "paper", band?: number, title?: string): NodeMark => ({
    id: node.id,
    kind: node.kind,
    node,
    box,
    shape,
    radius,
    color: options.color,
    pattern: options.pattern,
    fill,
    stroke,
    texts,
    reconnected,
    band,
    title,
  });
  const dash = reconnected ? RECONNECTED_DASH : undefined;
  switch (node.kind) {
    case "event":
      return mark("circle", Math.min(box.width, box.height) / 2, outline("ink", hasTag(node, "end") ? strokeTokens.eventEnd : strokeTokens.eventStart, dash), [fitted(ink(node.label, cx, cy, textTokens.eventLabel.size, { role: "label", anchor: "middle", maxWidth: box.width - 4, lod: "labels" }), measure)]);
    case "gateway":
      return mark("diamond", 0, outline("ink", strokeTokens.gateway, dash), [ink(gatewayGlyph(node), cx, cy + 1, textTokens.gatewayGlyph.size, { role: "glyph", weight: textTokens.gatewayGlyph.weight, anchor: "middle" })]);
    case "note":
      return mark("box", radiusTokens.node, outline("value", strokeTokens.note), [fitted(ink(node.label, box.x + INSET, cy, textTokens.noteLabel.size, { role: "label", maxWidth: box.width - INSETS }), measure)], "surface");
    default: {
      const stroke = outline("value", node.kind === "stage" ? strokeTokens.stage : strokeTokens.node, dash);
      const labels = node.kind === "activity" ? options.activityLabels : undefined;
      if (labels) {
        const lines = activityLabelLines(node, labels, box.width, locale, measure);
        const counts = labels.showCounts === false ? [] : lines.counts;
        const left = (text: string, size: number, y: number, role: ElementText["role"]) => ink(text, box.x + INSET, y, size, { role, baseline: "alphabetic" });
        const { activityName: nameText, activityNumber: numberText } = textTokens;
        const names = lines.name.map((line, i) => left(line, nameText.size, box.y + 24 + i * nameText.lineHeight, "nameLine"));
        return mark("box", radiusTokens.node, stroke, names.concat(counts.map((line, i) => left(line, numberText.size, box.y + 24 + lines.name.length * nameText.lineHeight + i * numberText.lineHeight, "countLine"))), "paper", dimensionTokens.band, activityDescription(node, labels, locale));
      }
      const count = nodeCount(node, locale);
      // The room the interactive map gives the label: inside the padding and a solid outline (a dashed one is
      // drawn over the box), and before the count, which it writes after the label on its line.
      const room = box.width - INSETS - (dash ? 0 : 2 * stroke.width) - (count ? measure(count, textTokens.nodeCount) + 3 * space.unit : 0);
      const label = fitted(ink(node.label, box.x + INSET, cy, textTokens.nodeLabel.size, { role: "label", maxWidth: room, lod: "labels", weight: node.kind === "stage" ? textTokens.stageLabel.weight : undefined }), measure);
      return mark("box", radiusTokens.node, stroke, count ? [label, ink(count, box.x + box.width - 6, box.y + box.height - 5, textTokens.nodeCount.size, { role: "count", anchor: "end", baseline: "alphabetic", paint: "inkMuted", lod: "labels" })] : [label], "paper", dimensionTokens.band);
    }
  }
}

const RECONNECTED_EDGE_DASH = Object.freeze(dashTokens.reconnectedPath);
const NO_TEXTS: ElementText[] = Object.freeze([]) as unknown as ElementText[];

/** What one edge looks like along its route. */
export function edgeMark(edge: FlowEdge, points: XY[], options: { color: string; width: number; locale?: Locale; theme?: Theme }): EdgeMark {
  const reconnected = hasTag(edge, RECONNECTED_TAG);
  const count = metric(edge, "count", NaN);
  const at = edgeLabelPoint(points);
  return {
    id: edge.id,
    kind: edge.kind,
    edge,
    points,
    color: options.color,
    width: options.width,
    dash: (reconnected ? RECONNECTED_EDGE_DASH : undefined) as number[] | undefined,
    texts: Number.isFinite(count)
      ? [{ text: formatCompact(count, options.locale ?? "en"), x: at.x, y: at.y, size: (options.theme ?? defaultTheme).text.pathLabel.size, anchor: "middle", baseline: "alphabetic", paint: "ink", halo: true, role: "count", lod: "edgeLabels" }]
      : NO_TEXTS,
    reconnected,
  };
}

/** Equal count texts of the marks share one string. */
function shareCounts<M extends { texts: ElementText[] }>(marks: M[]): M[] {
  const pool = new Map<string, string>();
  for (const m of marks) for (const t of m.texts) if (t.role === "count") pool.set(t.text, (t.text = pool.get(t.text) ?? t.text));
  return marks;
}

/** One mark per node with a box, in the graph's order. */
export function nodeMarks(graph: FlowGraph, positions: Positions, scales: Scales, options: { locale?: Locale; activityLabels?: ActivityLabelOptions; theme?: Theme; measure?: TextMeasure } = {}): NodeMark[] {
  return shareCounts(
    graph.nodes.flatMap((n) => {
      const box = positions.nodes[n.id];
      return box ? [nodeMark(n, box, { color: scales.nodeColor(n), pattern: scales.nodePattern(n), locale: options.locale, activityLabels: options.activityLabels, theme: options.theme, measure: options.measure })] : [];
    }),
  );
}

/** One mark per edge between two placed nodes, in the graph's order; edges from a node to itself are self-loop overlays. */
export function edgeMarks(graph: FlowGraph, positions: Positions, scales: Scales, locale: Locale = "en", theme: Theme = defaultTheme): EdgeMark[] {
  return shareCounts(
    graph.edges.flatMap((e) => {
      if (e.source === e.target) return [];
      const points = edgePoints(positions, e);
      return points ? [edgeMark(e, points, { color: edgeColor(e, scales, theme), width: scales.edgeWidth(e), locale, theme })] : [];
    }),
  );
}

/** Constraint edges in the theme's accent, the others by the edge colour scale. */
export function edgeColor(edge: FlowEdge, scales: Scales, theme: Theme = defaultTheme): string {
  return edge.kind === "constraint" ? theme.color.accent : scales.edgeColor(edge);
}

/** A side of a box. */
export type BoxSide = "top" | "right" | "bottom" | "left";

export interface GroupMark {
  id: string;
  kind: GroupKind;
  group: FlowGroup;
  box: Box;
  /** Colour of the group's category (`scales.categorical`); the `value` paint. */
  color: string;
  /** Pattern twin of `color`. */
  pattern: PatternId;
  /** The lane band the group is drawn as (see `laneBands`). */
  band?: LaneBand;
  /** Corner radius of the box. */
  radius: number;
  /** The group's tint: its colour at an opacity. */
  fill: MarkFill;
  /** Outline: around the whole box, or only along `sides`. */
  stroke: { paint: MarkPaint; width: number; dash?: number[]; sides?: BoxSide[] };
  /** A band's rule along the side it starts at, in its colour. */
  rule?: { paint: MarkPaint; width: number; side: BoxSide };
  /** The group's title. */
  texts: ElementText[];
  /** Where the group's chips are placed from: the right end and the top of the first (`chipAnchor`). */
  chipAnchor: XY;
}

/** What one group looks like in its box: a tinted box with a solid outline, or a band outlined between the bands with a rule along its start. */
export function groupMark(group: FlowGroup, box: Box, options: { color: string; pattern: PatternId; band?: LaneBand; theme?: Theme }): GroupMark {
  const { stroke, text, radius, opacity } = options.theme ?? defaultTheme;
  const band = options.band;
  // Bands along the flow are outlined between each other, left and right, and ruled along the top; bands across it above and below, ruled along the left.
  const main = band?.axis === "main";
  return {
    id: group.id,
    kind: group.kind,
    group,
    box,
    color: options.color,
    pattern: options.pattern,
    band,
    radius: band ? 0 : radius.large,
    fill: { paint: "value", opacity: band ? (band.index % 2 ? opacity.bandOddFill : opacity.bandFill) : opacity.groupFill },
    stroke: band ? { paint: "line", width: 1, sides: main ? ["left", "right"] : ["top", "bottom"] } : { paint: "value", width: stroke.group },
    rule: band && { paint: "value", width: stroke.band, side: main ? "top" : "left" },
    texts: [ink(group.label, box.x + 12, box.y + 22, text.groupLabel.size, { role: "label", baseline: "alphabetic", weight: text.groupLabel.weight })],
    chipAnchor: chipAnchor(box),
  };
}

/** One mark per group with a box, in the graph's order; groups drawn as bands carry their band. */
export function groupMarks(graph: FlowGraph, positions: Positions, bands: readonly LaneBand[], scales: Scales, theme: Theme = defaultTheme): GroupMark[] {
  const bandOf = new Map(bands.map((b) => [b.id, b]));
  return (graph.groups ?? []).flatMap((g) => {
    const box = positions.groups[g.id];
    const c = scales.categorical(g.id);
    return box ? [groupMark(g, box, { color: c.color, pattern: c.pattern, band: bandOf.get(g.id), theme })] : [];
  });
}
