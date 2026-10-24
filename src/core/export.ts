/**
 * Deterministic SVG export of a scene with an embedded legend and figure presets.
 */
import type { ActivityLabelOptions } from "./activity-labels.js";
import { type EdgeBudget, type EdgeSelection, type ShownEdges, budgetEdges, keptLoop } from "./edge-budget.js";
import { type BoxSide, type ElementText, lineEnd, paintOrder } from "./element-marks.js";
import { type FigurePreset, type LegendLayout, figureFloor, figureFrame, figureHeading, figureMetrics, legendMetrics, millimetres } from "./figure.js";
import type { Locale } from "./format.js";
import { type Box, type Positions } from "./layout.js";
import { type LaneMode } from "./lanes.js";
import { type FlowGraph, type Overlay, assertExportable } from "./model.js";
import type { OverlayGeometryOptions } from "./overlays.js";
import { type MarkSvgOptions, arrowMarker, markSvg, svgMarkup } from "./mark-svg.js";
import { type MarkPaint, type MarkText, type OverlayMark, markArrowhead, overlayArrow } from "./overlay-marks.js";
import { type Readable, isPill, nodeTexts, readableMark, shownReadable, titleTexts } from "./readable.js";
import { type FlowScene, sceneOf } from "./scene.js";
import { type Measure, type StyleSpec, lodAt, patternDefs } from "./style.js";
import { t } from "./strings.js";
import type { TextMeasure } from "./text.js";
import { type ColorScheme, type ThemeSetting, resolveTheme } from "./theme.js";
import { type Arrowhead, type ColorToken, arrowheadTokens, dimensionTokens, readableTokens } from "./tokens.js";

export interface Scene {
  activityLabels?: ActivityLabelOptions;
  graph: FlowGraph;
  positions: Positions;
  overlays?: Overlay[];
  /** The measure the figure shows (see `FlowSceneOptions.measure`). */
  measure?: Measure;
  style?: StyleSpec;
  title?: string;
  subtitle?: string;
  locale?: Locale;
  /** Draw stage or lane groups as bands (see `laneBands`). Default `none`. */
  lanes?: LaneMode;
  /** Draw follows edges from a node to itself as self-loops. Default true. */
  selfLoops?: boolean;
}

export interface ExportOptions {
  /** Replay a live map's text state and numbered full-name key. Pair with its theme, `lodZoom` and reported `edgeBudget`. Default the figure's text state. */
  readable?: Readable;
  /** Figure preset setting the output width in pixels (the drawing scales to fit). */
  preset?: FigurePreset;
  /** Explicit output width in pixels; overrides the preset. */
  width?: number;
  /**
   * The width the figure is declared to be printed at, in millimetres; it
   * overrides `width` and the preset, and the SVG states its size in
   * millimetres. One figure unit is a CSS pixel of it (0.75 pt).
   */
  widthMm?: number;
  legend?: boolean;
  background?: string;
  fontFamily?: string;
  padding?: number;
  /**
   * Zoom level used for level-of-detail decisions. Default: in a theme with
   * a figure floor (`text.minFigurePt`, the print theme's), the scale the map
   * is drawn at in the figure; otherwise 1 (everything visible).
   */
  lodZoom?: number;
  overlayGeometry?: OverlayGeometryOptions;
  /** Show the scene context line (label, cases, events) under the title. */
  context?: boolean;
  /**
   * The edges drawn: those a map reported through `onEdgesShown`, or a budget
   * (`budgetEdges`, protecting the edges with an overlay mark on them). While
   * edges are withheld a note under the map says how many are shown. Default
   * every edge.
   */
  edgeBudget?: EdgeBudget | ShownEdges;
  /**
   * The theme the figure is drawn in: a preset's name or changes over a
   * preset (`resolveTheme`). Default the `print` preset, whose texts keep
   * 7 pt at the figure's width: where the cards cannot show their names, they
   * are numbered and the names listed in a key. `default` draws the figure
   * as one picture scaled to its width, as before.
   */
  theme?: ThemeSetting;
  /** The colour scheme of the theme. Default `light`; the print theme has no other. */
  scheme?: ColorScheme;
  /** What the figure's texts are measured by (see `FlowSceneOptions.textMeasure`). Default `estimateTextWidth`. */
  textMeasure?: TextMeasure;
  /**
   * The caption line under the map and the legend: label, cases, period,
   * filters and how much of the model is shown, from the graph's `meta`
   * (`figureCaption`); a part without data is left out. Default true.
   */
  caption?: boolean;
}

const esc = (s: unknown): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number): string => Number(n.toFixed(2)).toString();

interface Ctx {
  scene: FlowScene;
  /** The scene's colour of every paint role. */
  colors: Readonly<Record<ColorToken, string>>;
  locale: Locale;
  lod: ReturnType<typeof lodAt>;
  /** Zoom at which the level of detail is decided. */
  lodZoom: number;
  /** What the texts show at the map's scale in the figure. */
  readable: Readable;
  withheld?: EdgeSelection;
  keptLoops?: ReadonlySet<string>;
}

function rect(b: Box, attrs: string): string {
  return `<rect x="${num(b.x)}" y="${num(b.y)}" width="${num(b.width)}" height="${num(b.height)}" ${attrs}/>`;
}

function text(x: number, y: number, s: string, attrs = ""): string {
  return `<text x="${num(x)}" y="${num(y)}" ${attrs}>${esc(s)}</text>`;
}

/** The font attributes of a text role. */
const fontAttrs = (role: { size: number; weight?: number }): string => `font-size="${role.size}"${role.weight ? ` font-weight="${role.weight}"` : ""}`;

/** Path data along sides of a box. */
function sidesPath(b: Box, sides: readonly BoxSide[]): string {
  const [x0, y0, x1, y1] = [num(b.x), num(b.y), num(b.x + b.width), num(b.y + b.height)];
  const d: Record<BoxSide, string> = { top: `M${x0} ${y0}H${x1}`, right: `M${x1} ${y0}V${y1}`, bottom: `M${x0} ${y1}H${x1}`, left: `M${x0} ${y0}V${y1}` };
  return sides.map((side) => d[side]).join("");
}

function drawGroups(ctx: Ctx): string {
  const out: string[] = [];
  for (const m of [...ctx.scene.groupMarks].sort(byId)) {
    const b = m.box;
    const paint = (p: MarkPaint) => paintOf(ctx, m.color, m.color, p);
    const fill = `fill="${paint(m.fill.paint)}" fill-opacity="${m.fill.opacity ?? 1}"`;
    const { stroke, rule } = m;
    out.push(`<g class="wf-group${m.band ? " wf-group-band" : ""}" data-id="${esc(m.id)}"${opacity(m)}>`);
    if (stroke.sides) {
      out.push(rect(b, fill));
      out.push(`<path d="${sidesPath(b, stroke.sides)}" stroke="${paint(stroke.paint)}" stroke-width="${num(stroke.width)}" fill="none"/>`);
    } else {
      out.push(rect(b, `rx="${num(m.radius)}" ${fill} stroke="${paint(stroke.paint)}" stroke-width="${num(stroke.width)}"${stroke.dash ? ` stroke-dasharray="${stroke.dash.join(" ")}"` : ""}`));
    }
    if (rule) out.push(`<path d="${sidesPath(b, [rule.side])}" stroke="${paint(rule.paint)}" stroke-width="${num(rule.width)}" fill="none"/>`);
    // A group's title is shed with the cards' names and scaled up to the floor from its start.
    for (const tx of titleTexts(m.texts, ctx.readable)) out.push(markText(ctx, m.color, m.color, tx));
    out.push(`</g>`);
  }
  return out.join("");
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : 1);

/** The opacity a theme's rule set on an element, as an attribute of its group. */
const opacity = (m: { opacity?: number }) => (m.opacity === undefined ? "" : ` opacity="${m.opacity}"`);

/** Texts of a node or edge mark that its level of detail shows at the export's zoom. */
function shownTexts(ctx: Ctx, texts: ElementText[]): ElementText[] {
  return texts.filter((t) => !t.lod || ctx.lod[t.lod]);
}

/** The marker of an arrowhead: `wf-arrow` at the rule's size, `wf-arrow-<size>` where it grew with its path. */
const arrowId = (a: Arrowhead) => (a.size === arrowheadTokens.edge.size ? "wf-arrow" : `wf-arrow-${a.size}`);

/** The edges drawn, in painting order (`paintOrder`): the widest first, so that thin paths lie on top. */
const drawnEdges = (ctx: Ctx) => paintOrder(ctx.scene.edgeMarks).filter((i) => !ctx.withheld || ctx.withheld.drawn.has(i)).map((i) => ctx.scene.edgeMarks[i]);

function drawEdges(ctx: Ctx): string {
  const out: string[] = [];
  for (const m of drawnEdges(ctx)) {
    const dash = m.dash ? ` stroke-dasharray="${m.dash.join(" ")}"` : "";
    // The line ends inside its head, whose tip lies on the route's end.
    const end = lineEnd(m.points, m.arrow);
    const d = [...m.points.slice(0, -1), end].map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join("");
    out.push(`<g class="wf-edge" data-id="${esc(m.id)}"${opacity(m)}><path d="${d}" fill="none" stroke="${m.color}" stroke-width="${num(m.width)}" stroke-linejoin="round"${m.addedFlow ? ' stroke-linecap="round"' : ""}${dash}${m.arrow ? ` marker-end="url(#${arrowId(m.arrow)})"` : ""}/>`);
    // Paths' labels are the first texts shed below the floor.
    if (ctx.readable.labels.path) for (const tx of shownTexts(ctx, m.texts)) out.push(markText(ctx, m.color, m.color, tx));
    out.push(`</g>`);
  }
  return out.join("");
}

function drawNodes(ctx: Ctx): string {
  const out: string[] = [];
  for (const m of [...ctx.scene.nodeMarks].sort(byId)) {
    const b = m.box;
    const paint = (p: MarkPaint) => paintOf(ctx, m.color, m.color, p);
    const stroke = `fill="${paint(m.fill)}" stroke="${paint(m.stroke.paint)}" stroke-width="${num(m.stroke.width)}"${m.stroke.dash ? ` stroke-dasharray="${m.stroke.dash.join(" ")}"` : ""}`;
    out.push(`<g class="wf-node wf-node-${esc(m.kind)}" data-id="${esc(m.id)}"${opacity(m)}>`);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    if (m.shape === "circle") {
      out.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(m.radius)}" ${stroke}/>`);
    } else if (m.shape === "diamond") {
      const h = b.width / 2;
      out.push(`<path d="M${num(cx)} ${num(cy - h)}L${num(cx + h)} ${num(cy)}L${num(cx)} ${num(cy + h)}L${num(cx - h)} ${num(cy)}Z" ${stroke}/>`);
    } else {
      out.push(rect(b, `rx="${num(m.radius)}" ${stroke}`));
    }
    // The frequency cue lies inside the outline and under the band and the texts.
    if (m.cue?.stripe) out.push(rect(m.cue.stripe.box, `class="wf-cue" fill="${paint(m.cue.stripe.paint)}"`));
    if (m.cue?.foot) out.push(rect(m.cue.foot.box, `class="wf-cue-foot" fill="${paint(m.cue.foot.paint)}"`));
    // Its part in the accent (the cases short) over them, from their start.
    const accent = m.cue?.accent;
    if (accent?.stripe) out.push(rect(accent.stripe.box, `class="wf-cue-accent" fill="${paint(accent.stripe.paint)}"`));
    if (accent?.foot) out.push(rect(accent.foot.box, `class="wf-cue-foot-accent" fill="${paint(accent.foot.paint)}"`));
    if (m.band) {
      const band: Box = { x: b.x, y: b.y, width: m.band, height: b.height };
      const rx = ctx.scene.theme.radius.band;
      out.push(rect(band, `class="wf-band" rx="${rx}" fill="${m.color}"`));
      if (m.pattern !== "solid") out.push(rect(band, `rx="${rx}" fill="url(#wf-pattern-${m.pattern})"`));
    }
    if (m.title) out.push(`<title>${esc(m.title)}</title>`);
    for (const tx of shownTexts(ctx, nodeTexts(m, ctx.readable))) out.push(markText(ctx, m.color, m.color, tx));
    out.push(`</g>`);
  }
  return out.join("");
}

/** The marks' paints in the scene's colours. */
const markOptions = (ctx: Ctx): MarkSvgOptions => ({
  paint: (mark, paint) => paintOf(ctx, mark.color, mark.onColor, paint),
  arrowId: "wf-overlay-arrow",
  patternId: "wf-pattern-outofscope",
});

function paintOf(ctx: Ctx, color: string, onColor: string, paint: MarkPaint): string {
  return paint === "value" ? color : paint === "onValue" ? onColor : paint[0] === "#" ? paint : ctx.colors[paint as ColorToken];
}

// Keep subpixel font sizes without exposing platform-dependent power rounding.
function markText(ctx: Ctx, color: string, onColor: string, m: MarkText): string {
  const y = m.baseline === "middle" ? m.y + 0.3 * m.size : m.y;
  const halo = m.halo ? ` paint-order="stroke" stroke="${ctx.colors.paper}" stroke-width="${ctx.scene.theme.stroke.halo}"` : "";
  return text(m.x, y, m.text, `font-size="${Number(m.size.toFixed(12))}"${m.weight ? ` font-weight="${m.weight}"` : ""}${m.anchor === "start" ? "" : ` text-anchor="${m.anchor}"`} fill="${paintOf(ctx, color, onColor, m.paint)}"${halo}`);
}

function drawMarks(ctx: Ctx, layer: OverlayMark["layer"]): string {
  const options = markOptions(ctx);
  const { readable, scene } = ctx;
  return scene.marks
    .filter((m) => m.layer === layer && m.inMap && (ctx.lodZoom >= m.minZoom || keptLoop(m, ctx.keptLoops)) && (readable.pills || !isPill(m)))
    .map((m) => svgMarkup(markSvg(readableMark(m, readable, scene.readable), options)))
    .join("");
}

function drawLegend(ctx: Ctx, width: number, layout: LegendLayout): string {
  const out: string[] = [];
  const { colors } = ctx;
  const { text: textTokens, radius: radiusTokens, stroke: strokeTokens } = ctx.scene.theme;
  const { legendTitle, legendItem, legendValue, legendKey, legendChip } = textTokens;
  const { legendSampleExport: sample, legendGradient: ramp, legendSwatchWidth, legendSwatchHeight } = dimensionTokens;
  const m = legendMetrics;
  const ink = (role: { size: number; weight?: number }, more = "") => `${fontAttrs(role)}${more} fill="${colors.ink}"`;
  const value = ink(legendValue);
  out.push(text(0, 14, ctx.scene.legend.title, ink(legendTitle)));
  for (const { row, y, lines, texts } of layout.rows) {
    const cy = y + lines.length * m.itemTitle;
    if (row.kind === "key") {
      out.push(text(0, y + 10, row.glyph, value));
      texts.forEach((line, i) => out.push(text(22, y + 10 + i * m.key, line, ink(legendKey))));
      continue;
    }
    if (row.kind === "chip") {
      out.push(text(0, y + 10, texts[0], ink(legendChip)));
      out.push(text(0, y + m.chipLabel + 10, texts[1], ink(legendKey)));
      continue;
    }
    lines.forEach((line, i) => out.push(text(0, y + 11 + i * m.itemTitle, line, ink(legendItem))));
    if (row.kind === "width") {
      row.samples.forEach((s, i) => {
        const sy = cy + i * m.entry;
        out.push(`<path d="M0 ${num(sy + 6)}H${num(sample)}" stroke="${colors.neutral}" stroke-width="${num(s.width)}"/>`);
        out.push(text(46, sy + 10, s.text, value));
      });
    } else if (row.kind === "ramp") {
      const gid = `wf-grad-${row.id}`;
      const stops = row.stops.map((c, i) => `<stop offset="${num((i / (row.stops.length - 1)) * 100)}%" stop-color="${c}"/>`).join("");
      out.push(`<defs><linearGradient id="${gid}">${stops}</linearGradient></defs>`);
      out.push(rect({ x: 0, y: cy, width: width - 10, height: ramp }, `fill="url(#${gid})" stroke="${colors.neutral}" stroke-width="${strokeTokens.legendGradient}"`));
      const anchors = row.values.length === 3 ? ["start", "middle", "end"] : ["start", "end"];
      row.values.forEach((v, i) => out.push(text(((width - 10) * (anchors[i] === "start" ? 0 : anchors[i] === "middle" ? 1 : 2)) / 2, cy + 22, v, anchors[i] === "start" ? value : ink(legendValue, ` text-anchor="${anchors[i]}"`))));
    } else if (row.kind === "swatches") {
      row.entries.forEach((e, i) => {
        const sw: Box = { x: 0, y: cy + i * m.entry, width: legendSwatchWidth, height: legendSwatchHeight };
        out.push(rect(sw, `rx="${radiusTokens.swatch}" fill="${e.color}"`));
        if (e.pattern !== "solid") out.push(rect(sw, `rx="${radiusTokens.swatch}" fill="url(#wf-pattern-${e.pattern})"`));
        out.push(text(20, sw.y + 10, texts[i], value));
      });
    }
  }
  return out.join("");
}

/**
 * Render a scene to an SVG string. Output is deterministic for the same input:
 * elements are drawn in id order (paths in painting order, the widest first
 * and equal widths in the graph's order), numbers are formatted with fixed precision and no
 * time-dependent data is embedded.
 */
export function toSVG(given: Scene, options: ExportOptions = {}): string {
  assertExportable(given.graph);
  const scene = sceneOf(given.graph, given.positions, {
    overlays: given.overlays,
    measure: given.measure,
    style: given.style,
    locale: given.locale,
    lanes: given.lanes,
    activityLabels: given.activityLabels,
    selfLoops: given.selfLoops,
    overlayGeometry: options.overlayGeometry,
    theme: resolveTheme(options.theme ?? "print"),
    scheme: options.scheme,
    textMeasure: options.textMeasure,
  }, true);
  const { locale, colors, theme } = scene;
  const font = options.fontFamily ?? theme.font.family;
  const withheld = budgetEdges(scene, options.edgeBudget);
  const floor = figureFloor(theme);
  const frame = figureFrame(scene, { title: !!given.title, context: options.context, legend: options.legend, padding: options.padding, preset: options.preset, width: options.widthMm !== undefined ? millimetres(options.widthMm) : options.width, withheld, caption: options.caption, floor, readable: shownReadable(scene, options) });
  const { padding: pad, width: totalW, height: totalH, outWidth: outW, outHeight: outH } = frame;
  const lodZoom = options.lodZoom ?? (floor > 0 ? frame.map.scale : 1);
  const ctx: Ctx = { scene, colors, locale, lod: lodAt(lodZoom, scene.lod), lodZoom, readable: frame.readable, withheld, keptLoops: options.edgeBudget && typeof options.edgeBudget === "object" ? new Set(options.edgeBudget.edges) : undefined };
  // A declared width in millimetres is the figure's size; otherwise its pixels.
  const size = (n: number) => (options.widthMm !== undefined ? `${num((n * options.widthMm) / outW)}mm` : num(n));

  // The note on withheld edges is announced with the figure's name.
  const label = given.title ?? t(locale, "map.description", { nodes: scene.graph.nodes.length, edges: scene.graph.edges.length, groups: scene.graph.groups?.length ?? 0 });
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size(outW)}" height="${size(outH)}" viewBox="0 0 ${num(totalW)} ${num(totalH)}" font-family="${esc(font)}" role="img" aria-label="${esc(frame.note ? `${label.replace(/\.?$/, ".")} ${frame.note.text}.` : label)}">`,
  );
  parts.push(`<defs>${patternDefs("wf-pattern", colors.patternInk, colors.outOfScope, theme.pattern)}`);
  // The rule's head, then each larger head a path drawn ends in, by size.
  const heads = new Map([arrowheadTokens.edge, ...drawnEdges(ctx).flatMap((m) => m.arrow ?? []).sort((a, b) => a.size - b.size)].map((a) => [arrowId(a), a]));
  for (const [id, a] of heads) parts.push(svgMarkup(arrowMarker(id, a)));
  parts.push(svgMarkup(arrowMarker("wf-overlay-arrow", markArrowhead(overlayArrow))));
  parts.push(`</defs>`);
  parts.push(rect({ x: 0, y: 0, width: totalW, height: totalH }, `fill="${options.background ?? colors.paper}"`));
  if (given.title) {
    const heading = figureHeading(scene, frame, given.title, given.subtitle);
    parts.push(text(pad, figureMetrics.titleBaseline, heading.title, `${fontAttrs(theme.text.figureTitle)} fill="${colors.ink}"`));
    if (options.context !== false) parts.push(text(pad, figureMetrics.contextBaseline, heading.context, `${fontAttrs(theme.text.figureText)} fill="${colors.neutral}"`));
  }
  const { offset, scale } = frame.map;
  parts.push(`<g class="wf-map" transform="translate(${num(offset.x)} ${num(offset.y)})${scale === 1 ? "" : ` scale(${Number(scale.toFixed(6))})`}">`);
  parts.push(drawGroups(ctx));
  parts.push(drawMarks(ctx, "below"));
  parts.push(drawEdges(ctx));
  parts.push(drawMarks(ctx, "between"));
  parts.push(drawNodes(ctx));
  parts.push(drawMarks(ctx, "above"));
  // Where the cards cannot show their names, their numbers over everything, keyed beside the map.
  if (frame.numbers) {
    const links = frame.numbers.texts.map(({ text: n }) => n.from ? `<path d="M${num(n.from.x)} ${num(n.from.y)}L${num(n.x)} ${num(n.y)}" stroke="${colors.ink}" stroke-width="${n.size * readableTokens.number.link}"/>` : "").join("");
    parts.push(`<g class="wf-numbers">${links}${frame.numbers.texts.map(({ text: n }) => (n.box ? rect(n.box, `fill="${colors.paper}"`) : "") + markText(ctx, colors.ink, colors.ink, n)).join("")}</g>`);
  }
  parts.push(`</g>`);
  if (frame.legend) {
    const { rule, x, y, width, layout } = frame.legend;
    if (rule) {
      parts.push(`<g class="wf-legend" transform="translate(${num(rule.x)} ${num(rule.top)})">`);
      parts.push(`<path d="M0 0V${num(rule.bottom - rule.top)}" stroke="${colors.neutral}" stroke-opacity="${theme.opacity.legendRule}"/>`);
      parts.push(`<g transform="translate(${num(x - rule.x)} ${num(y - rule.top)})">${drawLegend(ctx, width, layout)}</g>`);
    } else {
      parts.push(`<g class="wf-legend" transform="translate(${num(x)} ${num(y)})">${drawLegend(ctx, width, layout)}`);
    }
    parts.push(`</g>`);
  }
  if (frame.numbers) {
    const { lines, x, y } = frame.numbers;
    parts.push(`<g class="wf-number-key">${lines.map((line, i) => text(x, y + i * figureMetrics.keyLine, line, `${fontAttrs(theme.text.figureText)} fill="${colors.ink}"`)).join("")}</g>`);
  }
  if (frame.caption) {
    const { x, y, lines } = frame.caption;
    parts.push(`<g class="wf-caption">${lines.map((line, i) => text(x, y + i * figureMetrics.keyLine, line, `${fontAttrs(theme.text.figureText)} fill="${colors.ink}"`)).join("")}</g>`);
  }
  if (frame.note) parts.push(text(frame.note.x, frame.note.y, frame.note.text, `class="wf-edge-note" ${fontAttrs(theme.text.figureText)} fill="${colors.ink}"`));
  if (frame.key.lines.length) {
    parts.push(`<g class="wf-activity-key" aria-label="Activity key">`);
    frame.key.lines.forEach((line, i) => parts.push(text(pad, frame.key.y + i * figureMetrics.keyLine, line, `${fontAttrs(theme.text.figureText)} fill="${colors.ink}"`)));
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}
