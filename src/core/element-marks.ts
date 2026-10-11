/**
 * Node and edge marks: what each node and edge looks like, resolved once for
 * every renderer. Texts carry what is drawn: shortened to the width they are
 * limited to, or wrapped into lines, by the scene's text measure.
 */
import { type ActivityLabelOptions, activityDescription, activityLabel } from "./activity-labels.js";
import { type Locale, formatPathCount } from "./format.js";
import { elementMetric, formatMetricValue, metricBasis } from "./metrics.js";
import { type Box, type Positions, type XY, straightRoute } from "./layout.js";
import type { LaneBand } from "./lanes.js";
import { type EdgeKind, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type GroupKind, type NodeKind, hasTag, metric } from "./model.js";
import { RECONNECTED_TAG } from "./aggregate.js";
import type { CourseLabel, PathCourses } from "./courses.js";
import { chipAnchor } from "./overlay-geometry.js";
import type { MarkFill, MarkPaint, MarkText } from "./overlay-marks.js";
import type { PatternId, Scales } from "./style.js";
import { type TextMeasure, estimateTextWidth, truncateText, wrapLines } from "./text.js";
import { type Theme, defaultTheme } from "./theme.js";
import { type Arrowhead, arrowheadExtent, arrowheadTokens, dashTokens, dimensionTokens } from "./tokens.js";

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
   * What the text is: the node's label, a gateway's glyph, an edge's count,
   * one line of a card's name, or its number line: the cases (`countLine`)
   * and their share of all cases (`share`).
   */
  role: "label" | "glyph" | "count" | "nameLine" | "countLine" | "share";
  /** Level-of-detail rule from which the text is drawn; drawn at every zoom without one. */
  lod?: "labels" | "edgeLabels";
}

/**
 * The frequency cue of a card: its share of all cases as a flat stripe behind
 * its texts and a foot along its bottom edge, each from the inner left edge
 * (after the band) and `share` of the inner width long.
 */
export interface NodeCue {
  /** The node's cases over the cases of the log (`graph.meta.cases`), from 0 to 1. */
  share: number;
  stripe?: { box: Box; paint: MarkPaint };
  foot?: { box: Box; paint: MarkPaint };
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
  /** An activity's or a stage's frequency cue, drawn under its texts; none without a share or at a share of 0. */
  cue?: NodeCue;
  texts: ElementText[];
  /** Added back to keep the map connected; drawn dashed. */
  reconnected: boolean;
  /** Outside the scope the host evaluates (a hatch overlay on it): its name is in the muted ink. */
  outOfScope: boolean;
  /** Exact description for a tooltip, where the node shows a short form (activity labels). */
  title?: string;
}

export interface EdgeMark {
  id: string;
  kind: EdgeKind;
  edge: FlowEdge;
  /** The routed points, or a straight line between the two boxes: the head's tip lies on the last; the line ends before it (`lineEnd`). */
  points: XY[];
  color: string;
  width: number;
  /** The arrowhead at the end, as wide as the line needs (`pathArrowhead`). */
  arrow: Arrowhead;
  dash?: number[];
  /** The count label at `edgeLabelPoint`, where the edge has a count; "–" on a path not evaluated. */
  texts: ElementText[];
  reconnected: boolean;
  /** A path without a value: drawn in the line colour at the thinnest width (`Scales.notEvaluated`). */
  notEvaluated?: boolean;
  /** A path against the reading direction, drawn below the flow it returns over (`pathCourses`). */
  backward?: boolean;
}

interface NodeMarkOptions {
  color: string;
  pattern: PatternId;
  locale?: Locale;
  /** The cases of the log, which a card's share is of. */
  total?: number;
  /** Outside the scope the host evaluates. */
  outOfScope?: boolean;
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

/**
 * The count a node shows: its cases grouped in full, and for a stage its
 * members before them. Cases that are a lower bound (a collapsed stage) read
 * "at least 211,379".
 */
export function nodeCount(node: FlowNode, locale: Locale = "en"): string | undefined {
  const cases = metric(node, "cases", NaN);
  const shown = Number.isFinite(cases) ? elementMetric(node, "cases", locale) : "";
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

/** A card's share of all cases: its cases over the log's (a lower bound where the cases are one); none without both or with a log of no cases. */
export function caseShare(node: FlowNode, total: number | undefined): number | undefined {
  const cases = metric(node, "cases", NaN);
  return total! > 0 && cases >= 0 && cases < Infinity ? cases / total! : undefined;
}

/** Where a text's baseline lies in a line of `lineHeight`: its capitals centred in the line. */
const baseline = (top: number, lineHeight: number, size: number) => top + (lineHeight + 0.7 * size) / 2;

/** What one node looks like in its box. */
export function nodeMark(node: FlowNode, box: Box, options: NodeMarkOptions): NodeMark {
  const theme = options.theme ?? defaultTheme;
  const { stroke: strokeTokens, radius: radiusTokens, text: textTokens, space } = theme;
  // Where a node's texts start and how much of its width they leave out: the stylesheet's padding of a node.
  const INSET = 8 * space.unit;
  const INSETS = INSET + 4 * space.unit;
  const locale = options.locale ?? "en";
  const measure = options.measure ?? estimateTextWidth;
  const reconnected = hasTag(node, RECONNECTED_TAG);
  const outOfScope = options.outOfScope ?? false;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const mark = (shape: NodeMark["shape"], radius: number, stroke: NodeMark["stroke"], texts: ElementText[], fill: MarkPaint = "paper", band?: number, title?: string, cue?: NodeCue): NodeMark => ({
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
    outOfScope,
    band,
    cue,
    title,
  });
  const dash = reconnected ? RECONNECTED_DASH : undefined;
  switch (node.kind) {
    case "event": {
      // The label sits below the circle, shortened to its width.
      const label = textTokens.eventLabel;
      const text = fitted(ink(node.label, cx, box.y + box.height + space.unit * 2 + label.size, label.size, { role: "label", anchor: "middle", baseline: "alphabetic", maxWidth: dimensionTokens.eventLabel, lod: "labels" }), measure);
      return mark("circle", Math.min(box.width, box.height) / 2, outline("ink", hasTag(node, "end") ? strokeTokens.eventEnd : strokeTokens.eventStart, dash), [text], "paper", undefined, text.text === node.label ? undefined : node.label);
    }
    case "gateway":
      return mark("diamond", 0, outline("ink", strokeTokens.gateway, dash), [ink(gatewayGlyph(node), cx, cy + 1, textTokens.gatewayGlyph.size, { role: "glyph", weight: textTokens.gatewayGlyph.weight, anchor: "middle" })]);
    case "note":
      return mark("box", radiusTokens.node, outline("value", strokeTokens.note), [fitted(ink(node.label, box.x + INSET, cy, textTokens.noteLabel.size, { role: "label", maxWidth: box.width - INSETS }), measure)], "surface");
    default: {
      // The card: the name on up to two lines, the number line, the stage once as the band, the frequency cue.
      const width = node.kind === "stage" ? strokeTokens.stage : strokeTokens.node;
      const stroke = outline("lineStrong", width, dash);
      const labels = node.kind === "activity" ? options.activityLabels : undefined;
      const name = labels ? activityLabel(node, labels) : node.label;
      const nameText = node.kind === "stage" ? { ...textTokens.activityName, ...textTokens.stageLabel } : textTokens.activityName;
      const { activityNumber: numberText, activityShare: shareText } = textTokens;
      // The room the interactive map gives the texts: inside the padding and a solid outline (a dashed one is drawn over the box).
      const room = box.width - INSETS - (dash ? 0 : 2 * width);
      const lines = wrapLines(name, room, nameText, 2, measure);
      const share = caseShare(node, options.total);
      const counted = labels?.showCounts !== false;
      // The texts as one block in the middle of the card above its foot.
      const block = lines.length * nameText.lineHeight + (counted ? numberText.lineHeight : 0);
      const top = box.y + width + (box.height - 2 * width - dimensionTokens.cueFoot - block) / 2;
      const lod = labels ? undefined : ("labels" as const);
      const x = box.x + INSET;
      const texts = lines.map((line, i) => ink(line, x, baseline(top + i * nameText.lineHeight, nameText.lineHeight, nameText.size), nameText.size, { role: "nameLine", baseline: "alphabetic", weight: nameText.weight, paint: outOfScope ? "inkMuted" : "ink", lod }));
      if (counted) {
        const count = elementMetric(node, "cases", locale);
        const y = baseline(top + lines.length * nameText.lineHeight, numberText.lineHeight, numberText.size);
        texts.push(ink(count, x, y, numberText.size, { role: "countLine", baseline: "alphabetic", weight: numberText.weight, lod }));
        const shown = share === undefined ? "–" : formatMetricValue("share", share, locale, { basis: metricBasis(node, "cases") });
        texts.push(ink(`· ${shown}`, x + measure(count, numberText) + 2 * space.unit, y, shareText.size, { role: "share", baseline: "alphabetic", paint: "inkMuted", lod }));
      }
      // A name shortened to two lines is given whole to hover and assistive technology.
      const cut = lines.join("").replace(/\s/gu, "") !== name.replace(/\s/gu, "");
      const title = labels ? activityDescription(node, labels, locale) : cut ? name : undefined;
      return mark("box", radiusTokens.node, stroke, texts, "paper", dimensionTokens.band, title, cue(box, width, share, theme));
    }
  }
}

/** The stripe and foot of a card's share inside its outline and after its band, as the theme places them. */
function cue(box: Box, stroke: number, share: number | undefined, theme: Theme): NodeCue | undefined {
  const place = theme.frequencyCue;
  if (!(share! > 0) || place === "none") return undefined;
  const { band, cueFoot } = dimensionTokens;
  const part = (y: number, height: number, paint: MarkPaint) => ({ box: { x: box.x + band, y, width: Math.min(1, share!) * (box.width - band - stroke), height }, paint });
  return {
    share: share!,
    stripe: place === "bottom" ? undefined : part(box.y + stroke, box.height - 2 * stroke, "cueStripe"),
    foot: place === "behind" ? undefined : part(box.y + box.height - stroke - cueFoot, cueFoot, "cueFoot"),
  };
}

const RECONNECTED_EDGE_DASH = Object.freeze(dashTokens.reconnectedPath);
const heads = new Map<number, Arrowhead>();

/**
 * The arrowhead of a path `width` wide: the rule's size, or `perWidth` times
 * the width rounded up where that is more (`arrowheadTokens.edge`: 12, so a
 * path 8 wide ends in a head of 32, 14.4 wide with its outline). One frozen
 * head per size.
 */
export function pathArrowhead(width: number, rule: Arrowhead = arrowheadTokens.edge): Arrowhead {
  const size = Math.max(rule.size, Math.ceil((rule.perWidth ?? 0) * width));
  if (rule !== arrowheadTokens.edge) return { ...rule, size };
  let head = heads.get(size);
  if (!head) heads.set(size, (head = Object.freeze({ ...rule, size })));
  return head;
}

/**
 * Where the line of a route ends under its arrowhead: the route's last point
 * moved back along its last segment by the head's overhang (no further than
 * that segment's start), so that the head's tip lies on the route's end.
 */
export function lineEnd(points: readonly XY[], arrow: Arrowhead): XY {
  const end = points[points.length - 1];
  const from = points[points.length - 2];
  const length = from ? Math.hypot(end.x - from.x, end.y - from.y) : 0;
  if (!length) return end;
  const back = Math.min(length, arrowheadExtent(arrow).tip) / length;
  return { x: end.x - (end.x - from.x) * back, y: end.y - (end.y - from.y) * back };
}
const NO_TEXTS: ElementText[] = Object.freeze([]) as unknown as ElementText[];

/**
 * What one edge looks like along its route. A path's label is the count of
 * `metric` (`Scales.pathMetric`; another edge and a path without one: its
 * cases, else its transitions):
 * in full up to 99,999, then shortened; "≥" before a lower bound; "–" on a
 * path `notEvaluated`.
 */
export function edgeMark(edge: FlowEdge, points: XY[], options: { color: string; width: number; locale?: Locale; theme?: Theme; metric?: string; notEvaluated?: boolean; label?: CourseLabel; backward?: boolean }): EdgeMark {
  const reconnected = hasTag(edge, RECONNECTED_TAG);
  // A path reads the scene's path metric; another edge (a sequence flow, a constraint) its own cases, else its count.
  const name = (edge.kind === "follows" && options.metric) || (Number.isFinite(metric(edge, "cases", NaN)) ? "cases" : "count");
  const count = metric(edge, name, NaN);
  const label = Number.isFinite(count) ? `${metricBasis(edge, name) === "atLeast" ? "≥" : ""}${formatPathCount(count, options.locale ?? "en")}` : options.notEvaluated ? "–" : undefined;
  const size = (options.theme ?? defaultTheme).text.pathLabel.size;
  let at = edgeLabelPoint(points);
  let anchor: ElementText["anchor"] = "middle";
  if (options.label) {
    // Beside the course, 4 clear of the line on the side given: after or before it, or above or below it.
    const { at: p, side } = options.label;
    const gap = options.width / 2 + 4;
    if (Math.abs(side.x) > Math.abs(side.y)) [at, anchor] = [{ x: p.x + side.x * gap, y: p.y + 0.35 * size }, side.x > 0 ? "start" : "end"];
    else at = { x: p.x, y: side.y > 0 ? p.y + gap + 0.8 * size : p.y - gap };
  }
  return {
    id: edge.id,
    kind: edge.kind,
    edge,
    points,
    color: options.color,
    width: options.width,
    arrow: pathArrowhead(options.width),
    dash: (reconnected ? RECONNECTED_EDGE_DASH : undefined) as number[] | undefined,
    texts: label
      ? [{ text: label, x: at.x, y: at.y, size, anchor, baseline: "alphabetic", paint: "ink", halo: true, role: "count", lod: "edgeLabels" }]
      : NO_TEXTS,
    reconnected,
    ...(options.notEvaluated && { notEvaluated: true }),
    ...(options.backward && { backward: true }),
  };
}

/** Equal count texts of the marks share one string. */
function shareCounts<M extends { texts: ElementText[] }>(marks: M[]): M[] {
  const pool = new Map<string, string>();
  for (const m of marks) for (const t of m.texts) if (t.role === "count") pool.set(t.text, (t.text = pool.get(t.text) ?? t.text));
  return marks;
}

/** One mark per node with a box, in the graph's order; `outOfScope` holds the nodes outside the scope the host evaluates. */
export function nodeMarks(graph: FlowGraph, positions: Positions, scales: Scales, options: { locale?: Locale; activityLabels?: ActivityLabelOptions; theme?: Theme; measure?: TextMeasure; outOfScope?: ReadonlySet<string> } = {}): NodeMark[] {
  const cases = graph.meta?.cases;
  const total = typeof cases === "number" ? cases : undefined;
  return shareCounts(
    graph.nodes.flatMap((n) => {
      const box = positions.nodes[n.id];
      return box ? [nodeMark(n, box, { color: scales.nodeColor(n), pattern: scales.nodePattern(n), locale: options.locale, activityLabels: options.activityLabels, theme: options.theme, measure: options.measure, total, outOfScope: options.outOfScope?.has(n.id) })] : [];
    }),
  );
}

/**
 * One mark per edge between two placed nodes, in the graph's order; edges
 * from a node to itself are self-loop overlays. `courses` gives the labels of
 * paths with a course of their own and the paths drawn backward (`pathCourses`).
 */
export function edgeMarks(graph: FlowGraph, positions: Positions, scales: Scales, locale: Locale = "en", theme: Theme = defaultTheme, courses?: Pick<PathCourses, "labels" | "backward">): EdgeMark[] {
  return shareCounts(
    graph.edges.flatMap((e) => {
      if (e.source === e.target) return [];
      const points = edgePoints(positions, e);
      return points ? [edgeMark(e, points, { color: edgeColor(e, scales, theme), width: scales.edgeWidth(e), locale, theme, metric: scales.pathMetric, notEvaluated: scales.notEvaluated(e), label: courses?.labels.get(e.id), backward: courses?.backward.has(e.id) })] : [];
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
  /** The group's tint: its colour at an opacity (none for a box group in the default theme). */
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

/** What one group looks like in its box: a box outlined by a hairline, tinted as the theme's `groupFill` says (not by default), or a band outlined between the bands with a rule along its start. */
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
    stroke: band ? { paint: "line", width: 1, sides: main ? ["left", "right"] : ["top", "bottom"] } : { paint: "line", width: stroke.group },
    rule: band && { paint: "value", width: stroke.band, side: main ? "top" : "left" },
    texts: [ink(group.label, box.x + 12, box.y + 22, text.groupLabel.size, { role: "label", baseline: "alphabetic", weight: text.groupLabel.weight, paint: "inkMuted" })],
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
