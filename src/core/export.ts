/**
 * Deterministic SVG export of a scene with an embedded legend and figure presets.
 */
import type { ActivityLabelOptions } from "./activity-labels.js";
import { type EdgeBudget, type EdgeSelection, type ShownEdges, budgetEdges } from "./edge-budget.js";
import { type BoxSide, type ElementText, fitText, truncateText } from "./element-marks.js";
import { type FigurePreset, type LegendLayout, figureFrame, figureMetrics, legendMetrics } from "./figure.js";
import { type Locale, formatCompact, formatCount, formatNumber, formatShare } from "./format.js";
import { type Box, type Positions } from "./layout.js";
import { type LaneMode } from "./lanes.js";
import type { FlowGraph, Overlay } from "./model.js";
import type { OverlayGeometryOptions } from "./overlays.js";
import { type MarkSvgOptions, arrowMarker, markSvg, svgMarkup } from "./mark-svg.js";
import { type MarkPaint, type MarkText, type OverlayMark, markArrowhead, overlayArrow } from "./overlay-marks.js";
import { type FlowScene, buildScene } from "./scene.js";
import { type StyleSpec, lodAt, patternDefs } from "./style.js";
import { t } from "./strings.js";
import { type ColorScheme, type ThemeSetting, resolveTheme } from "./theme.js";
import { type ColorToken, arrowheadTokens, dimensionTokens } from "./tokens.js";

export interface Scene {
  activityLabels?: ActivityLabelOptions;
  graph: FlowGraph;
  positions: Positions;
  overlays?: Overlay[];
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
  /** Figure preset setting the output width in pixels (the drawing scales to fit). */
  preset?: FigurePreset;
  /** Explicit output width in pixels; overrides the preset. */
  width?: number;
  legend?: boolean;
  background?: string;
  fontFamily?: string;
  padding?: number;
  /** Zoom level used for level-of-detail decisions. Default 1 (everything visible). */
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
  /** The theme the figure is drawn in: a preset's name or changes over a preset (`resolveTheme`). Default the `default` preset. */
  theme?: ThemeSetting;
  /** The colour scheme of the theme. Default `light`. */
  scheme?: ColorScheme;
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
  withheld?: EdgeSelection;
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
    out.push(`<g class="wf-group${m.band ? " wf-group-band" : ""}" data-id="${esc(m.id)}">`);
    if (stroke.sides) {
      out.push(rect(b, fill));
      out.push(`<path d="${sidesPath(b, stroke.sides)}" stroke="${paint(stroke.paint)}" stroke-width="${num(stroke.width)}" fill="none"/>`);
    } else {
      out.push(rect(b, `rx="${num(m.radius)}" ${fill} stroke="${paint(stroke.paint)}" stroke-width="${num(stroke.width)}"${stroke.dash ? ` stroke-dasharray="${stroke.dash.join(" ")}"` : ""}`));
    }
    if (rule) out.push(`<path d="${sidesPath(b, [rule.side])}" stroke="${paint(rule.paint)}" stroke-width="${num(rule.width)}" fill="none"/>`);
    for (const tx of m.texts) out.push(markText(ctx, m.color, m.color, tx));
    out.push(`</g>`);
  }
  return out.join("");
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : 1);

/** Texts of a node or edge mark that its level of detail shows at the export's zoom. */
function shownTexts(ctx: Ctx, texts: ElementText[]): ElementText[] {
  return texts.filter((t) => !t.lod || ctx.lod[t.lod]);
}

function drawEdges(ctx: Ctx): string {
  const out: string[] = [];
  const { withheld } = ctx;
  for (const m of ctx.scene.edgeMarks.filter((_, i) => !withheld || withheld.drawn.has(i)).sort(byId)) {
    const dash = m.dash ? ` stroke-dasharray="${m.dash.join(" ")}"` : "";
    const d = m.points.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join("");
    out.push(`<g class="wf-edge" data-id="${esc(m.id)}"><path d="${d}" fill="none" stroke="${m.color}" stroke-width="${num(m.width)}" stroke-linejoin="round"${dash} marker-end="url(#wf-arrow)"/>`);
    for (const tx of shownTexts(ctx, m.texts)) out.push(markText(ctx, m.color, m.color, tx));
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
    out.push(`<g class="wf-node wf-node-${m.kind}" data-id="${esc(m.id)}">`);
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
    if (m.band) {
      const band: Box = { x: b.x, y: b.y, width: m.band, height: b.height };
      const rx = ctx.scene.theme.radius.band;
      out.push(rect(band, `rx="${rx}" fill="${m.color}"`));
      if (m.pattern !== "solid") out.push(rect(band, `rx="${rx}" fill="url(#wf-pattern-${m.pattern})"`));
    }
    if (m.title) out.push(`<title>${esc(m.title)}</title>`);
    for (const tx of shownTexts(ctx, m.texts)) out.push(markText(ctx, m.color, m.color, tx));
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
  return paint === "value" ? color : paint === "onValue" ? onColor : ctx.colors[paint];
}

function markText(ctx: Ctx, color: string, onColor: string, m: MarkText): string {
  const y = m.baseline === "middle" ? m.y + 0.3 * m.size : m.y;
  const halo = m.halo ? ` paint-order="stroke" stroke="${ctx.colors.paper}" stroke-width="${ctx.scene.theme.stroke.halo}"` : "";
  return text(m.x, y, fitText(m), `font-size="${m.size}"${m.weight ? ` font-weight="${m.weight}"` : ""}${m.anchor === "start" ? "" : ` text-anchor="${m.anchor}"`} fill="${paintOf(ctx, color, onColor, m.paint)}"${halo}`);
}

function drawMarks(ctx: Ctx, layer: OverlayMark["layer"]): string {
  const options = markOptions(ctx);
  return ctx.scene.marks
    .filter((m) => m.layer === layer && m.inMap && ctx.lodZoom >= m.minZoom)
    .map((m) => svgMarkup(markSvg(m, options)))
    .join("");
}

function drawLegend(ctx: Ctx, width: number, layout: LegendLayout): string {
  const out: string[] = [];
  const L = ctx.locale;
  const { colors } = ctx;
  const { text: textTokens, radius: radiusTokens, stroke: strokeTokens } = ctx.scene.theme;
  const { legendTitle, legendItem, legendValue, legendKey, legendChip } = textTokens;
  const { legendSampleExport: sample, legendGradient: ramp, legendSwatchWidth, legendSwatchHeight } = dimensionTokens;
  const value = `${fontAttrs(legendValue)} fill="${colors.ink}"`;
  out.push(text(0, 14, t(L, "legend.title"), `${fontAttrs(legendTitle)} fill="${colors.ink}"`));
  for (const { item, y } of layout.items) {
    out.push(text(0, y + 11, t(L, item.title), `${fontAttrs(legendItem)} fill="${colors.ink}"`));
    const cy = y + legendMetrics.itemTitle;
    if (item.kind === "width") {
      const [lo, hi] = item.range;
      out.push(`<path d="M0 ${num(cy + 6)}H${sample}" stroke="${colors.neutral}" stroke-width="${num(lo)}"/>`);
      out.push(text(46, cy + 10, formatCompact(item.domain[0], L), value));
      out.push(`<path d="M${num(width / 2)} ${num(cy + 6)}H${num(width / 2 + sample)}" stroke="${colors.neutral}" stroke-width="${num(hi)}"/>`);
      out.push(text(width / 2 + 46, cy + 10, formatCompact(item.domain[1], L), value));
    } else if (item.kind === "sequential" || item.kind === "diverging") {
      const gid = `wf-grad-${item.title.replace(/\W/g, "")}-${item.metric.replace(/\W/g, "")}`;
      const stops = item.stops.map((c, i) => `<stop offset="${num((i / (item.stops.length - 1)) * 100)}%" stop-color="${c}"/>`).join("");
      out.push(`<defs><linearGradient id="${gid}">${stops}</linearGradient></defs>`);
      out.push(rect({ x: 0, y: cy, width: width - 10, height: ramp }, `fill="url(#${gid})" stroke="${colors.neutral}" stroke-width="${strokeTokens.legendGradient}"`));
      const share = /share/i.test(item.metric);
      const f = (v: number) => (share ? formatShare(v, L) : formatNumber(v, 1, L));
      out.push(text(0, cy + 22, f(item.domain[0]), value));
      if (item.domain.length === 3) out.push(text((width - 10) / 2, cy + 22, f(item.domain[1]), `${fontAttrs(legendValue)} text-anchor="middle" fill="${colors.ink}"`));
      out.push(text(width - 10, cy + 22, f(item.domain[item.domain.length - 1]), `${fontAttrs(legendValue)} text-anchor="end" fill="${colors.ink}"`));
    } else if (item.kind === "categorical") {
      item.entries.forEach((e, i) => {
        const sw: Box = { x: 0, y: cy + i * legendMetrics.entry, width: legendSwatchWidth, height: legendSwatchHeight };
        out.push(rect(sw, `rx="${radiusTokens.swatch}" fill="${e.color}"`));
        if (e.pattern !== "solid") out.push(rect(sw, `rx="${radiusTokens.swatch}" fill="url(#wf-pattern-${e.pattern})"`));
        out.push(text(20, sw.y + 10, truncateText(e.key, width - 24, legendValue), value));
      });
    }
  }
  for (const { key, y } of layout.keys) {
    out.push(text(0, y + 10, key.glyph, value));
    out.push(text(22, y + 10, truncateText(t(L, key.title), width - 24, legendKey), `${fontAttrs(legendKey)} fill="${colors.ink}"`));
  }
  for (const { chip, y } of layout.chips) {
    const p = chip.payload ?? {};
    const label = truncateText(`${p.glyph ?? ""} ${p.label ?? ""}`.trim(), width - 4, legendChip);
    out.push(text(0, y + 10, label, `${fontAttrs(legendChip)} fill="${colors.ink}"`));
    out.push(text(0, y + legendMetrics.chipLabel + 10, truncateText(String(p.text ?? ""), width - 4, legendKey), `${fontAttrs(legendKey)} fill="${colors.ink}"`));
  }
  return out.join("");
}

/**
 * Render a scene to an SVG string. Output is deterministic for the same input:
 * elements are drawn in id order, numbers are formatted with fixed precision and
 * no time-dependent data is embedded.
 */
export function toSVG(given: Scene, options: ExportOptions = {}): string {
  const scene = buildScene(given.graph, given.positions, {
    overlays: given.overlays,
    style: given.style,
    locale: given.locale,
    lanes: given.lanes,
    activityLabels: given.activityLabels,
    selfLoops: given.selfLoops,
    overlayGeometry: options.overlayGeometry,
    theme: resolveTheme(options.theme),
    scheme: options.scheme,
  });
  const { locale, colors, theme } = scene;
  const font = options.fontFamily ?? theme.font.family;
  const lodZoom = options.lodZoom ?? 1;
  const withheld = budgetEdges(scene, options.edgeBudget);
  const ctx: Ctx = { scene, colors, locale, lod: lodAt(lodZoom, scene.lod), lodZoom, withheld };
  const frame = figureFrame(scene, { title: !!given.title, context: options.context, legend: options.legend, padding: options.padding, preset: options.preset, width: options.width, withheld });
  const { padding: pad, width: totalW, height: totalH, outWidth: outW, outHeight: outH } = frame;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(outW)}" height="${num(outH)}" viewBox="0 0 ${num(totalW)} ${num(totalH)}" font-family="${esc(font)}" role="img" aria-label="${esc(given.title ?? t(locale, "map.description", { nodes: scene.graph.nodes.length, edges: scene.graph.edges.length, groups: scene.graph.groups?.length ?? 0 }))}">`,
  );
  parts.push(`<defs>${patternDefs("wf-pattern", colors.ink, colors.outOfScope, theme.pattern)}`);
  parts.push(svgMarkup(arrowMarker("wf-arrow", arrowheadTokens.edge)));
  parts.push(svgMarkup(arrowMarker("wf-overlay-arrow", markArrowhead(overlayArrow))));
  parts.push(`</defs>`);
  parts.push(rect({ x: 0, y: 0, width: totalW, height: totalH }, `fill="${options.background ?? colors.paper}"`));
  if (given.title) {
    parts.push(text(pad, figureMetrics.titleBaseline, given.title, `${fontAttrs(theme.text.figureTitle)} fill="${colors.ink}"`));
    if (options.context !== false) {
      const meta = scene.graph.meta ?? {};
      const label = given.subtitle ?? String(meta.label ?? meta.scene ?? "");
      const cases = typeof meta.cases === "number" ? formatCount(meta.cases, locale) : "–";
      const events = typeof meta.events === "number" ? formatCount(meta.events, locale) : "–";
      parts.push(text(pad, figureMetrics.contextBaseline, t(locale, "export.context", { label, cases, events }), `${fontAttrs(theme.text.figureText)} fill="${colors.neutral}"`));
    }
  }
  parts.push(`<g class="wf-map" transform="translate(${num(frame.map.offset.x)} ${num(frame.map.offset.y)})">`);
  parts.push(drawGroups(ctx));
  parts.push(drawMarks(ctx, "below"));
  parts.push(drawEdges(ctx));
  parts.push(drawMarks(ctx, "between"));
  parts.push(drawNodes(ctx));
  parts.push(drawMarks(ctx, "above"));
  parts.push(`</g>`);
  if (frame.legend) {
    const { rule, x, y, width, layout } = frame.legend;
    parts.push(`<g class="wf-legend" transform="translate(${num(rule.x)} ${num(rule.top)})">`);
    parts.push(`<path d="M0 0V${num(rule.bottom - rule.top)}" stroke="${colors.neutral}" stroke-opacity="${theme.opacity.legendRule}"/>`);
    parts.push(`<g transform="translate(${num(x - rule.x)} ${num(y - rule.top)})">${drawLegend(ctx, width, layout)}</g>`);
    parts.push(`</g>`);
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
