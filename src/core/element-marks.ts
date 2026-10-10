/**
 * Node and edge marks: what each node and edge looks like, resolved once for
 * every renderer. Texts carry their full value and the width they are limited
 * to; `fitText` shortens them by one rule with the renderer's text measure.
 */
import { type ActivityLabelOptions, activityDescription, activityLabelLines } from "./activity-labels.js";
import { type Locale, formatCompact } from "./format.js";
import { type Box, type Positions, type XY, straightRoute } from "./layout.js";
import { type EdgeKind, type FlowEdge, type FlowGraph, type FlowNode, type NodeKind, hasTag, metric } from "./model.js";
import { RECONNECTED_TAG } from "./aggregate.js";
import type { MarkPaint, MarkText } from "./overlay-marks.js";
import { type PatternId, type Scales, fixedColors } from "./style.js";
import { sizeTokens, textSizeTokens } from "./tokens.js";

/** Width of a text in a font, in the units it is drawn in. */
export type TextMeasure = (text: string, font: { size: number; weight?: number }) => number;

/**
 * Width of a text without font metrics: 0.55 em per character, about the
 * average advance of the default sans-serif stack.
 */
export const estimateTextWidth: TextMeasure = (text, font) => Array.from(text).length * 0.55 * font.size;

/**
 * The longest start of `text` that fits `maxWidth` with an ellipsis, at least
 * one character; the text itself when it fits.
 */
export function truncateText(text: string, maxWidth: number, font: { size: number; weight?: number }, measure: TextMeasure = estimateTextWidth): string {
  if (measure(text, font) <= maxWidth) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join("")}…`, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, Math.max(1, lo)).join("")}…`;
}

/** The text a renderer draws for a mark text: shortened to its `maxWidth` when it has one. */
export function fitText(text: MarkText, measure: TextMeasure = estimateTextWidth): string {
  return text.maxWidth === undefined ? text.text : truncateText(text.text, text.maxWidth, { size: text.size, weight: text.weight }, measure);
}

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

export interface NodeMarkOptions {
  color: string;
  pattern: PatternId;
  locale?: Locale;
  /** Activity label options with references (see `activityReferences`). */
  activityLabels?: ActivityLabelOptions;
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

const strokes = new Map<string, NodeMark["stroke"]>();

/** One frozen outline per paint, width and dash, shared by the marks that have it. */
function outline(paint: MarkPaint, width: number, dash?: readonly number[]): NodeMark["stroke"] {
  const key = `${paint} ${width} ${dash}`;
  let stroke = strokes.get(key);
  if (!stroke) strokes.set(key, (stroke = Object.freeze(dash ? { paint, width, dash: dash as number[] } : { paint, width })));
  return stroke;
}

const RECONNECTED_DASH = Object.freeze([4, 3]);
const NOTE_DASH = Object.freeze([2, 3]);

/** What one node looks like in its box. */
export function nodeMark(node: FlowNode, box: Box, options: NodeMarkOptions): NodeMark {
  const locale = options.locale ?? "en";
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
      return mark("circle", Math.min(box.width, box.height) / 2, outline("ink", hasTag(node, "end") ? 3 : 1.5, dash), [ink(node.label, cx, cy, textSizeTokens.small, { role: "label", anchor: "middle", maxWidth: box.width - 4, lod: "labels" })]);
    case "gateway":
      return mark("diamond", 0, outline("ink", 1.5, dash), [ink(gatewayGlyph(node), cx, cy + 1, textSizeTokens.glyph, { role: "glyph", weight: 700, anchor: "middle" })]);
    case "note":
      return mark("box", sizeTokens.radius, outline("value", 2, NOTE_DASH), [ink(node.label, box.x + 16, cy, textSizeTokens.note, { role: "label", maxWidth: box.width - 24 })], "surface");
    default: {
      const stroke = outline("value", node.kind === "stage" ? 3 : 2, dash);
      const labels = node.kind === "activity" ? options.activityLabels : undefined;
      if (labels) {
        const lines = activityLabelLines(node, labels, box.width, locale);
        const counts = labels.showCounts === false ? [] : lines.counts;
        const left = (text: string, size: number, y: number, role: ElementText["role"]) => ink(text, box.x + 16, y, size, { role, baseline: "alphabetic" });
        const names = lines.name.map((line, i) => left(line, textSizeTokens.nameLine, box.y + 24 + i * 18, "nameLine"));
        return mark("box", sizeTokens.radius, stroke, names.concat(counts.map((line, i) => left(line, textSizeTokens.countLine, box.y + 24 + lines.name.length * 18 + i * 16, "countLine"))), "paper", sizeTokens.band, activityDescription(node, labels, locale));
      }
      const count = nodeCount(node, locale);
      const label = ink(node.label, box.x + 16, cy, textSizeTokens.label, { role: "label", maxWidth: box.width - 24, lod: "labels", weight: node.kind === "stage" ? 600 : undefined });
      return mark("box", sizeTokens.radius, stroke, count ? [label, ink(count, box.x + box.width - 6, box.y + box.height - 5, textSizeTokens.small, { role: "count", anchor: "end", baseline: "alphabetic", paint: "inkMuted", lod: "labels" })] : [label], "paper", sizeTokens.band);
    }
  }
}

const RECONNECTED_EDGE_DASH = Object.freeze([6, 5]);
const CONSTRAINT_DASH = Object.freeze([2, 4]);
const NO_TEXTS: ElementText[] = Object.freeze([]) as unknown as ElementText[];

/** What one edge looks like along its route. */
export function edgeMark(edge: FlowEdge, points: XY[], options: { color: string; width: number; locale?: Locale }): EdgeMark {
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
    dash: (reconnected ? RECONNECTED_EDGE_DASH : edge.kind === "constraint" ? CONSTRAINT_DASH : undefined) as number[] | undefined,
    texts: Number.isFinite(count)
      ? [{ text: formatCompact(count, options.locale ?? "en"), x: at.x, y: at.y, size: textSizeTokens.edgeCount, anchor: "middle", baseline: "alphabetic", paint: "ink", halo: true, role: "count", lod: "edgeLabels" }]
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
export function nodeMarks(graph: FlowGraph, positions: Positions, scales: Scales, options: { locale?: Locale; activityLabels?: ActivityLabelOptions } = {}): NodeMark[] {
  return shareCounts(
    graph.nodes.flatMap((n) => {
      const box = positions.nodes[n.id];
      return box ? [nodeMark(n, box, { color: scales.nodeColor(n), pattern: scales.nodePattern(n), locale: options.locale, activityLabels: options.activityLabels })] : [];
    }),
  );
}

/** One mark per edge between two placed nodes, in the graph's order; edges from a node to itself are self-loop overlays. */
export function edgeMarks(graph: FlowGraph, positions: Positions, scales: Scales, locale: Locale = "en"): EdgeMark[] {
  return shareCounts(
    graph.edges.flatMap((e) => {
      if (e.source === e.target) return [];
      const points = edgePoints(positions, e);
      return points ? [edgeMark(e, points, { color: edgeColor(e, scales), width: scales.edgeWidth(e), locale })] : [];
    }),
  );
}

/** Constraint edges in the mechanism colour, the others by the edge colour scale. */
export function edgeColor(edge: FlowEdge, scales: Scales): string {
  return edge.kind === "constraint" ? fixedColors.mechanism : scales.edgeColor(edge);
}
