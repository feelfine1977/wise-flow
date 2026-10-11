/**
 * The legend and the figure frame, described once: which rows the legend
 * lists and how tall they are, and where the title, the map, the legend and
 * the activity key sit in an exported figure.
 */
import { type ActivityLabelOptions, activityKeyLines } from "./activity-labels.js";
import { shownActivityIds } from "./collapsed-members.js";
import { asFilter, describeClause } from "./filters.js";
import { type Locale, formatCount } from "./format.js";
import type { Box } from "./layout.js";
import { channelTitle, formatMetricValue, metricEntry, metricName } from "./metrics.js";
import { type FlowGraph, type FlowNode, type Overlay, MAP_TARGET } from "./model.js";
import type { OverlayMark } from "./overlay-marks.js";
import type { LegendItem, PatternId } from "./style.js";
import { type StringKey, t } from "./strings.js";
import { type TextMeasure, estimateTextWidth, truncateText, wrapText } from "./text.js";
import type { Theme } from "./theme.js";
import { textTokens } from "./tokens.js";

export type FigurePreset = "single-column" | "double-column" | "slide" | "none";

export const FIGURE_WIDTHS: Record<Exclude<FigurePreset, "none">, number> = {
  "single-column": 1000,
  "double-column": 2000,
  slide: 1600,
};

/**
 * What a legend key row explains: an overlay kind (a badge row per glyph),
 * reverse-order arcs, paths and activities not directly observed (re-added),
 * paths not evaluated, and the start and end of the process.
 */
export type LegendKeyKind = "badge" | "arc" | "reverse" | "selfLoop" | "outOfScope" | "reconnected" | "notEvaluated" | "start" | "end";

export interface LegendKey {
  kind: LegendKeyKind;
  glyph: string;
  title: StringKey;
}

/**
 * One row of the legend, in the words and numbers it shows: the measure the
 * map shows with its unit, a scale (path width with three samples, a colour
 * ramp with its values, or category swatches with their pattern twins, each
 * titled "channel: metric (unit)"), the key of a mark kind drawn, or a
 * map-level chip.
 */
export type LegendRow =
  | { kind: "measure"; text: string }
  | { kind: "width"; title: string; samples: { width: number; text: string }[] }
  | { kind: "ramp"; title: string; /** Names the ramp's gradient in an SVG document. */ id: string; stops: readonly string[]; /** The domain's values: low, (middle,) high. */ values: string[] }
  | { kind: "swatches"; title: string; entries: { text: string; color: string; pattern: PatternId }[] }
  | { kind: "key"; key: LegendKeyKind; glyph: string; text: string }
  | { kind: "chip"; chip: Overlay; label: string; text: string };

/** What the legend lists, in order: the measure, the scales in use, the keys, the map-level chips. */
export interface SceneLegend {
  /** The legend's heading. */
  title: string;
  /** The rows every legend renders, in order: the measure, the scale items, the keys, the chips. */
  rows: LegendRow[];
  items: LegendItem[];
  /** The kinds of the marks drawn that the legend explains, one per key row. */
  keys: LegendKey[];
  /** Map-level chips, listed under the keys. */
  chips: Overlay[];
}

/** The keys other than badges, in their order after the badges. */
const KEYS: readonly LegendKey[] = [
  { kind: "arc", glyph: "⌒", title: "legend.arc" },
  { kind: "reverse", glyph: "⇐", title: "legend.reverse" },
  { kind: "selfLoop", glyph: "↻", title: "legend.selfLoop" },
  { kind: "outOfScope", glyph: "▨", title: "legend.outOfScope" },
  { kind: "reconnected", glyph: "┄", title: "legend.reconnected" },
  { kind: "notEvaluated", glyph: "─", title: "legend.notEvaluated" },
  { kind: "start", glyph: "○", title: "legend.start" },
  { kind: "end", glyph: "◉", title: "legend.end" },
];

const BADGES: Partial<Record<string, StringKey>> = { presence: "legend.badge.presence", singularity: "legend.badge.singularity", exclusion: "legend.badge.exclusion" };

/** One key per glyph of the badges, in their order, worded by the constraint the first of each glyph shows. */
function badgeKeys(badges: readonly Overlay[]): LegendKey[] {
  const out = new Map<string, LegendKey>();
  for (const b of badges) {
    const glyph = String(b.payload?.glyph ?? "●");
    if (!out.has(glyph)) out.set(glyph, { kind: "badge", glyph, title: BADGES[String(b.payload?.constraintType)] ?? "legend.badge" });
  }
  return [...out.values()];
}

/** What a legend is built from besides its scale items and keys. */
interface LegendContext {
  /** The metric paths are labelled with (`Scales.pathMetric`). */
  pathMetric?: string;
  /** All cases of the scene (`meta.cases`), which the shares are of. */
  cases?: number;
}

/** "Shortfall · cases · share of 251,734 cases": the measure the paths' colour shows, the unit and what the shares are of. */
function measureText(items: LegendItem[], context: LegendContext, locale: Locale): string {
  const colour = items.find((i) => i.title === "legend.edgeColor" && i.kind !== "categorical");
  const metric = colour && "metric" in colour ? colour.metric : undefined;
  // A metric outside the registry names the measure itself.
  const measure = !metric ? t(locale, "measure.frequency") : metric.startsWith("delta_") ? t(locale, "measure.difference") : (() => { const key = metricEntry(metric)?.measure; return key ? t(locale, key) : metricName(metric, locale); })();
  const width = items.find((i) => i.kind === "width");
  const unit = metricName(context.pathMetric ?? (width && "metric" in width ? width.metric : "cases"), locale);
  const text = t(locale, "legend.measure", { measure, unit });
  return context.cases !== undefined && Number.isFinite(context.cases) ? `${text} · ${t(locale, "legend.shareOf", { total: formatCount(context.cases, locale) })}` : text;
}

/** The rows of the measure, the scale items, the keys and the chips, in that order, in a locale. */
function legendOf(items: LegendItem[], keys: LegendKey[], chips: Overlay[], locale: Locale, context: LegendContext = {}): SceneLegend {
  const rows: LegendRow[] = items.length ? [{ kind: "measure", text: measureText(items, context, locale) }] : [];
  for (const item of items) {
    if (item.kind === "width") {
      const samples = item.samples ?? [0, 1].map((i) => ({ value: item.domain[i], width: item.range[i] }));
      const title = channelTitle(item.title, item.metric, locale);
      rows.push({ kind: "width", title: item.transitionsOnly ? `${title} · ${t(locale, "legend.transitionsOnly")}` : title, samples: samples.map((s) => ({ width: s.width, text: formatMetricValue(item.metric, s.value, locale, { path: true }) })) });
    } else if (item.kind === "categorical") {
      const channel = t(locale, item.title);
      rows.push({ kind: "swatches", title: item.entries.some((e) => e.label !== undefined) ? t(locale, "legend.channelBare", { channel, metric: t(locale, "legend.stage") }) : channel, entries: item.entries.map((e) => ({ text: e.label ?? e.key, color: e.color, pattern: e.pattern })) });
    } else {
      const { domain } = item;
      rows.push({ kind: "ramp", title: channelTitle(item.title, item.metric, locale), id: `${item.title.replace(/\W/g, "")}-${item.metric.replace(/\W/g, "")}`, stops: item.stops, values: (domain.length === 3 ? domain : [domain[0], domain[domain.length - 1]]).map((v) => formatMetricValue(item.metric, v, locale)) });
    }
  }
  for (const k of keys) rows.push({ kind: "key", key: k.kind, glyph: k.glyph, text: t(locale, k.title) });
  for (const chip of chips) {
    const p = chip.payload ?? {};
    rows.push({ kind: "chip", chip, label: `${p.glyph ?? ""} ${p.label ?? ""}`.trim(), text: String(p.text ?? "") });
  }
  return { title: t(locale, "legend.title"), rows, items, keys, chips };
}

/** The overlay kind a key explains (reverse-order arcs are arcs). */
const overlayKind = (k: LegendKeyKind) => (k === "outOfScope" ? "hatch" : k === "reverse" ? "arc" : k);

/**
 * The legend of the given scale items and overlays: the keys of the overlay
 * kinds given, then re-added paths, which every map can show. A scene's
 * legend (`legendOfScene`) lists the marks it draws instead.
 */
export function sceneLegend(items: LegendItem[], overlays: readonly Overlay[], locale: Locale = "en"): SceneLegend {
  const present = (k: LegendKeyKind) => k === "reconnected" || overlays.some((o) => o.kind === overlayKind(k) && (k !== "reverse" || !!o.payload?.reverse));
  const keys = [...badgeKeys(overlays.filter((o) => o.kind === "badge")), ...KEYS.filter((k) => present(k.kind))];
  return legendOf(items, keys, overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET), locale);
}

/** The parts of a scene its legend is built from. */
export interface LegendSource {
  scales: { legend: LegendItem[]; /** The metric paths are labelled with; default the width's. */ pathMetric?: string };
  marks: readonly OverlayMark[];
  nodeMarks: readonly { reconnected: boolean; node?: FlowNode }[];
  edgeMarks: readonly { reconnected: boolean; notEvaluated?: boolean }[];
  locale: Locale;
  /** Its graph, whose `meta.cases` the measure's shares are of. */
  graph?: Pick<FlowGraph, "meta">;
}

/**
 * The legend of what a scene draws: the measure with its unit, the path
 * scales where it draws paths, the activity colour where it draws nodes, a
 * key for each kind of mark it draws that the legend explains (one per badge
 * glyph, and none for a kind it does not draw: re-added and not evaluated
 * paths, start and end events too), and its map-level chips.
 */
export function legendOfScene(scene: LegendSource): SceneLegend {
  const { marks, nodeMarks, edgeMarks } = scene;
  const event = (tag: string) => nodeMarks.some((m) => m.node?.kind === "event" && !!m.node.tags?.includes(tag));
  const present = (k: LegendKeyKind) =>
    k === "reconnected" ? nodeMarks.some((m) => m.reconnected) || edgeMarks.some((m) => m.reconnected)
    : k === "notEvaluated" ? edgeMarks.some((m) => m.notEvaluated)
    : k === "start" || k === "end" ? event(k)
    : marks.some((m) => m.inMap && m.kind === overlayKind(k) && (k !== "reverse" || !!m.overlay.payload?.reverse));
  const items = scene.scales.legend.filter((item) => (item.title === "legend.nodeColor" ? nodeMarks : edgeMarks).length > 0);
  const keys = [...badgeKeys(marks.filter((m) => m.inMap && m.kind === "badge").map((m) => m.overlay)), ...KEYS.filter((k) => present(k.kind))];
  const cases = scene.graph?.meta?.cases;
  return legendOf(items, keys, marks.filter((m) => m.kind === "chip" && !m.inMap).map((m) => m.overlay), scene.locale, { pathMetric: scene.scales.pathMetric, cases: typeof cases === "number" ? cases : undefined });
}

/** Row heights of the legend in a figure; text offsets within a row stay with the renderers. */
export const legendMetrics = {
  /** Width of the legend's rows. */
  width: 188,
  heading: 26,
  /** One line of a row's title or of the measure. */
  itemTitle: 16,
  /** Below the measure. */
  measureEnd: 6,
  widthScale: 20,
  gradient: 30,
  /** One swatch or width sample. */
  entry: 16,
  entriesEnd: 4,
  /** One line of a key. */
  key: 14,
  chipsGap: 6,
  chipLabel: 13,
  chipText: 15,
} as const;

/** Height of one scale item with a title of one line. */
export function legendItemHeight(item: LegendItem): number {
  const m = legendMetrics;
  if (item.kind === "width") return m.itemTitle + (item.samples?.length ?? 2) * m.entry + m.entriesEnd;
  if (item.kind === "categorical") return m.itemTitle + item.entries.length * m.entry + m.entriesEnd;
  return m.itemTitle + m.gradient;
}

/** Where each row of the legend starts, relative to its top, with its texts shortened to the legend's width. */
export interface LegendLayout {
  /**
   * Each row's top, the lines its title (or the measure) wraps into, and the
   * texts an export writes for it, fitted by the measure: a swatch's entries
   * shortened, a key's text wrapped into lines, a chip's label and text
   * shortened.
   */
  rows: { row: LegendRow; y: number; lines: string[]; texts: string[] }[];
  items: { item: LegendItem; y: number }[];
  keys: { key: LegendKey; y: number }[];
  chips: { chip: Overlay; y: number }[];
  height: number;
}

/** Lay out the legend's rows from the top down under its heading, their texts fitted by the measure to `width` (default `legendMetrics.width`) in the theme's legend text styles. */
export function legendLayout(legend: SceneLegend, options: { measure?: TextMeasure; width?: number; text?: Theme["text"] } = {}): LegendLayout {
  const { measure = estimateTextWidth, width = legendMetrics.width, text = textTokens } = options;
  const fit = (s: string, inset: number, font: { size: number; weight?: number }) => truncateText(s, width - inset, font, measure);
  const wrap = (s: string, inset: number, font: { size: number; weight?: number }) => wrapText(s, width - inset, font, measure);
  const m = legendMetrics;
  let y = m.heading;
  const out: LegendLayout = { rows: [], items: [], keys: [], chips: [], height: 0 };
  for (const row of legend.rows) {
    if (row.kind === "chip" && !out.chips.length) y += m.chipsGap;
    const at = y;
    const lines = row.kind === "measure" ? wrap(row.text, 0, text.legendItem) : row.kind === "key" || row.kind === "chip" ? [] : wrap(row.title, 0, text.legendItem);
    const texts = row.kind === "swatches" ? row.entries.map((e) => fit(e.text, 24, text.legendValue)) : row.kind === "key" ? wrap(row.text, 24, text.legendKey) : row.kind === "chip" ? [fit(row.label, 4, text.legendChip), fit(row.text, 4, text.legendKey)] : [];
    out.rows.push({ row, y: at, lines, texts });
    const title = lines.length * m.itemTitle;
    if (row.kind === "measure") {
      y += title + m.measureEnd;
    } else if (row.kind === "key") {
      out.keys.push({ key: legend.keys[out.keys.length], y: at });
      y += Math.max(1, texts.length) * m.key;
    } else if (row.kind === "chip") {
      out.chips.push({ chip: row.chip, y: at });
      y += m.chipLabel + m.chipText;
    } else {
      out.items.push({ item: legend.items[out.items.length], y: at });
      y += title + (row.kind === "width" ? row.samples.length * m.entry + m.entriesEnd : row.kind === "ramp" ? m.gradient : row.entries.length * m.entry + m.entriesEnd);
    }
  }
  out.height = y;
  return out;
}

const counted = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/**
 * The caption line of an exported figure, from the graph's `meta`: its label
 * (`label` or `scene`), its cases, its period (`period`, two dates), the
 * filters in effect (`filters`, a filter or a list of clauses; an empty one
 * reads "filter: none") and how much of the model is shown ("7 of 12
 * activities, 13 of 31 paths shown", from `meta.model`; a collapsed stage
 * shows its activities, and with one the paths are left out: merged paths are
 * not the model's). A part whose data is missing is left out; without any,
 * there is no caption.
 */
export function figureCaption(graph: FlowGraph, locale: Locale = "en", labelOf?: (id: string) => string): string | undefined {
  const meta = graph.meta ?? {};
  const parts: string[] = [];
  const label = meta.label ?? meta.scene;
  if (typeof label === "string" && label) parts.push(label);
  if (counted(meta.cases)) parts.push(t(locale, "caption.cases", { cases: formatCount(meta.cases as number, locale) }));
  const period = meta.period as unknown;
  const [from, to] = Array.isArray(period) ? period : period && typeof period === "object" ? [(period as { from?: unknown }).from, (period as { to?: unknown }).to] : [];
  if (typeof from === "string" && typeof to === "string") parts.push(t(locale, "caption.period", { from, to }));
  if (meta.filters !== undefined && meta.filters !== null && typeof meta.filters === "object") {
    const clauses = asFilter(meta.filters as Parameters<typeof asFilter>[0]).and;
    parts.push(clauses.length ? t(locale, "caption.filters", { filters: clauses.map((c) => describeClause(c, locale, labelOf)).join("; ") }) : t(locale, "caption.noFilters"));
  }
  const model = meta.model ?? {};
  // A collapsed stage shows its activities; its merged paths are not the model's, so their share is not known.
  const { ids: activities, collapsed } = shownActivityIds(graph);
  const shown = [
    counted(model.activities) && t(locale, "caption.activities", { shown: formatCount(activities.size, locale), total: formatCount(model.activities!, locale) }),
    counted(model.paths) && !collapsed && t(locale, "caption.paths", { shown: formatCount(graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target).length, locale), total: formatCount(model.paths!, locale) }),
  ].filter((p): p is string => !!p);
  if (shown.length) parts.push(t(locale, "caption.shown", { parts: shown.join(", ") }));
  return parts.length ? parts.join(" · ") : undefined;
}

/** Space between the legend's rule and its rows, and after the rows. */
const legendInset = 16;

/** Fixed measurements of an exported figure. */
export const figureMetrics = {
  padding: 24,
  /** The legend's column: a rule, the inset, the rows and the inset again. */
  legendColumn: legendMetrics.width + 2 * legendInset,
  legendInset,
  titleHeight: 40,
  titleBaseline: 26,
  contextHeight: 18,
  contextBaseline: 44,
  keyLine: 16,
  /** The row of the note on withheld edges, and its baseline in it. */
  noteRow: 16,
  noteBaseline: 12,
  noteSize: textTokens.figureText.size,
} as const;

export interface FigureFrameOptions {
  /** The figure has a title (and, unless `context` is false, a context line). */
  title?: boolean;
  context?: boolean;
  /** Default true. */
  legend?: boolean;
  /** Default `figureMetrics.padding`. */
  padding?: number;
  preset?: FigurePreset;
  /** Output width; overrides the preset. */
  width?: number;
  /** Edges the figure withholds: a note under the map states how many it shows. */
  withheld?: { shown: number; total: number };
  /** The caption line under the map and the legend (`figureCaption`). Default true. */
  caption?: boolean;
}

/** Where everything sits in an exported figure, in figure units (the view box). */
export interface FigureFrame {
  padding: number;
  /** Height of the title and context line. */
  header: number;
  /** The map's drawing area including its padding; the scene's content is shifted by `offset`. */
  map: { width: number; height: number; offset: { x: number; y: number } };
  legend?: {
    layout: LegendLayout;
    /** Top-left of the rows and their width. */
    x: number;
    y: number;
    width: number;
    /** The vertical rule left of the legend. */
    rule: { x: number; top: number; bottom: number };
  };
  /** The caption's lines (wrapped to the figure's width) and the baseline of the first, under the map and the legend; lines are `figureMetrics.keyLine` apart. */
  caption?: { lines: string[]; x: number; y: number };
  /** The note on withheld edges and its baseline's start, under the caption. */
  note?: { text: string; x: number; y: number };
  /** The activity key's lines and the baseline of the first; lines are `figureMetrics.keyLine` apart. */
  key: { lines: string[]; y: number };
  width: number;
  height: number;
  /** Size of the output; the figure scales to fit the preset or given width. */
  outWidth: number;
  outHeight: number;
}

/** The parts of a scene the frame depends on. */
export interface FramedScene {
  graph: FlowGraph;
  activityLabels?: ActivityLabelOptions;
  locale: Locale;
  bounds: Box;
  legend: SceneLegend;
  /** What the legend's texts, the note and the activity key are measured by. Default `estimateTextWidth`. */
  textMeasure?: TextMeasure;
  /** Its legend text styles. Default the token table's. */
  theme?: Theme;
}

/** Measure the figure of a scene: header, map, legend column, activity key and output size. */
export function figureFrame(scene: FramedScene, options: FigureFrameOptions = {}): FigureFrame {
  const f = figureMetrics;
  const pad = options.padding ?? f.padding;
  const measure = scene.textMeasure ?? estimateTextWidth;
  const layout = options.legend === false ? undefined : legendLayout(scene.legend, { measure, text: scene.theme?.text });
  const column = layout ? f.legendColumn : 0;
  const header = options.title ? f.titleHeight + (options.context !== false ? f.contextHeight : 0) : 0;
  const content = scene.bounds;
  const mapW = content.width + 2 * pad;
  const mapH = content.height + 2 * pad;
  const { withheld } = options;
  const { locale } = scene;
  const text = withheld && t(locale, "map.edges.withheld", { shown: formatCount(withheld.shown, locale), total: formatCount(withheld.total, locale) });
  // Widened to fit the note.
  const width = Math.max(mapW + column, text ? measure(text, { size: f.noteSize }) + 2 * pad : 0);
  const below = Math.max(mapH, (layout?.height ?? 0) + 2 * pad) + header;
  const captionText = options.caption === false ? undefined : figureCaption(scene.graph, locale);
  const captionLines = captionText ? wrapText(captionText, width - 2 * pad, { size: f.noteSize }, measure) : [];
  const noteTop = below + captionLines.length * f.keyLine;
  const keyY = noteTop + (text ? f.noteRow : 0);
  const lines = activityKeyLines(scene.graph, scene.activityLabels, width - 2 * pad, scene.locale, measure);
  const height = keyY + (lines.length ? lines.length * f.keyLine + 2 * pad : text || captionLines.length ? pad : 0);
  const outWidth = options.width ?? (options.preset && options.preset !== "none" ? FIGURE_WIDTHS[options.preset] : width);
  return {
    padding: pad,
    header,
    map: { width: mapW, height: mapH, offset: { x: pad - content.x, y: header + pad - content.y } },
    legend: layout && {
      layout,
      x: mapW + f.legendInset,
      y: header + pad,
      width: legendMetrics.width,
      rule: { x: mapW, top: header + pad, bottom: (text || captionLines.length ? below : height) - pad },
    },
    caption: captionLines.length ? { lines: captionLines, x: pad, y: below + f.noteBaseline } : undefined,
    note: text ? { text, x: pad, y: noteTop + f.noteBaseline } : undefined,
    key: { lines, y: keyY + pad },
    width,
    height,
    outWidth,
    // Exactly `height` when the figure is not scaled; an empty figure stays empty.
    outHeight: width > 0 ? height * (outWidth / width) : height,
  };
}
