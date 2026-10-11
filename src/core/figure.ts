/**
 * The legend and the figure frame, described once: which rows the legend
 * lists and how tall they are, and where the title, the map, the legend and
 * the activity key sit in an exported figure.
 */
import { type ActivityLabelOptions, activityKeyLines } from "./activity-labels.js";
import { type Locale, formatCompact, formatCount, formatNumber, formatShare } from "./format.js";
import type { Box } from "./layout.js";
import { type FlowGraph, type Overlay, MAP_TARGET } from "./model.js";
import type { OverlayMark } from "./overlay-marks.js";
import type { LegendItem, PatternId } from "./style.js";
import { type StringKey, t } from "./strings.js";
import { type TextMeasure, estimateTextWidth, truncateText } from "./text.js";
import type { Theme } from "./theme.js";
import { textTokens } from "./tokens.js";

export type FigurePreset = "single-column" | "double-column" | "slide" | "none";

export const FIGURE_WIDTHS: Record<Exclude<FigurePreset, "none">, number> = {
  "single-column": 1000,
  "double-column": 2000,
  slide: 1600,
};

/** What a legend key row explains: an overlay kind, reverse-order arcs, or re-added paths. */
export type LegendKeyKind = "badge" | "arc" | "reverse" | "selfLoop" | "outOfScope" | "reconnected";

export interface LegendKey {
  kind: LegendKeyKind;
  glyph: string;
  title: StringKey;
}

/**
 * One row of the legend, in the words and numbers it shows: a scale (path
 * width with its two samples, a colour ramp with its values, or category
 * swatches with their pattern twins), the key of a mark kind drawn, or a
 * map-level chip.
 */
export type LegendRow =
  | { kind: "width"; title: string; samples: { width: number; text: string }[] }
  | { kind: "ramp"; title: string; /** Names the ramp's gradient in an SVG document. */ id: string; stops: readonly string[]; /** The domain's values: low, (middle,) high. */ values: string[] }
  | { kind: "swatches"; title: string; entries: { text: string; color: string; pattern: PatternId }[] }
  | { kind: "key"; key: LegendKeyKind; glyph: string; text: string }
  | { kind: "chip"; chip: Overlay; label: string; text: string };

/** What the legend lists, in order: the scales in use, the keys, the map-level chips. */
export interface SceneLegend {
  /** The legend's heading. */
  title: string;
  /** The rows every legend renders, in order: the scale items, the keys, the chips. */
  rows: LegendRow[];
  items: LegendItem[];
  /** The kinds of the marks drawn that the legend explains. */
  keys: LegendKey[];
  /** Map-level chips, listed under the keys. */
  chips: Overlay[];
}

const KEYS: readonly LegendKey[] = [
  { kind: "badge", glyph: "●", title: "legend.badge" },
  { kind: "arc", glyph: "⌒", title: "legend.arc" },
  { kind: "reverse", glyph: "⌒┄", title: "legend.reverse" },
  { kind: "selfLoop", glyph: "↻", title: "legend.selfLoop" },
  { kind: "outOfScope", glyph: "▨", title: "legend.outOfScope" },
  { kind: "reconnected", glyph: "┄", title: "legend.reconnected" },
];

/** The rows of the scale items, the keys of the kinds `present` says are there and the chips, in that order, in a locale. */
function legendOf(items: LegendItem[], present: (kind: LegendKeyKind) => boolean, chips: Overlay[], locale: Locale): SceneLegend {
  const keys = KEYS.filter((k) => present(k.kind));
  const rows: LegendRow[] = items.map((item): LegendRow => {
    const title = t(locale, item.title);
    if (item.kind === "width") return { kind: "width", title, samples: [0, 1].map((i) => ({ width: item.range[i], text: formatCompact(item.domain[i], locale) })) };
    if (item.kind === "categorical") return { kind: "swatches", title, entries: item.entries.map((e) => ({ text: e.key, color: e.color, pattern: e.pattern })) };
    const value = (v: number) => (/share/i.test(item.metric) ? formatShare(v, locale) : formatNumber(v, 1, locale));
    const { domain } = item;
    return { kind: "ramp", title, id: `${item.title.replace(/\W/g, "")}-${item.metric.replace(/\W/g, "")}`, stops: item.stops, values: (domain.length === 3 ? domain : [domain[0], domain[domain.length - 1]]).map(value) };
  });
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
  return legendOf(items, present, overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET), locale);
}

/** The parts of a scene its legend is built from. */
export interface LegendSource {
  scales: { legend: LegendItem[] };
  marks: readonly OverlayMark[];
  nodeMarks: readonly { reconnected: boolean }[];
  edgeMarks: readonly { reconnected: boolean }[];
  locale: Locale;
}

/**
 * The legend of what a scene draws: the path scales where it draws paths, the
 * activity colour where it draws nodes, a key for each kind of mark it draws
 * that the legend explains (and none for a kind it does not draw), and its
 * map-level chips.
 */
export function legendOfScene(scene: LegendSource): SceneLegend {
  const { marks, nodeMarks, edgeMarks } = scene;
  const present = (k: LegendKeyKind) =>
    k === "reconnected" ? nodeMarks.some((m) => m.reconnected) || edgeMarks.some((m) => m.reconnected) : marks.some((m) => m.inMap && m.kind === overlayKind(k) && (k !== "reverse" || !!m.overlay.payload?.reverse));
  const items = scene.scales.legend.filter((item) => (item.title === "legend.nodeColor" ? nodeMarks : edgeMarks).length > 0);
  return legendOf(items, present, marks.filter((m) => m.kind === "chip" && !m.inMap).map((m) => m.overlay), scene.locale);
}

/** Row heights of the legend in a figure; text offsets within a row stay with the renderers. */
export const legendMetrics = {
  /** Width of the legend's rows. */
  width: 188,
  heading: 26,
  itemTitle: 16,
  widthScale: 20,
  gradient: 30,
  entry: 16,
  entriesEnd: 4,
  key: 14,
  chipsGap: 6,
  chipLabel: 13,
  chipText: 15,
} as const;

/** Height of one scale item, its title included. */
export function legendItemHeight(item: LegendItem): number {
  const m = legendMetrics;
  if (item.kind === "width") return m.itemTitle + m.widthScale;
  if (item.kind === "categorical") return m.itemTitle + item.entries.length * m.entry + m.entriesEnd;
  return m.itemTitle + m.gradient;
}

/** Where each row of the legend starts, relative to its top, with its texts shortened to the legend's width. */
export interface LegendLayout {
  /**
   * Each row's top and the texts an export writes for it, shortened by the
   * measure: a swatch's entries, a key's text, a chip's label and text.
   */
  rows: { row: LegendRow; y: number; texts: string[] }[];
  items: { item: LegendItem; y: number }[];
  keys: { key: LegendKey; y: number }[];
  chips: { chip: Overlay; y: number }[];
  height: number;
}

/** Lay out the legend's rows from the top down under its heading, their texts shortened by the measure to `width` (default `legendMetrics.width`) in the theme's legend text styles. */
export function legendLayout(legend: SceneLegend, options: { measure?: TextMeasure; width?: number; text?: Theme["text"] } = {}): LegendLayout {
  const { measure = estimateTextWidth, width = legendMetrics.width, text = textTokens } = options;
  const fit = (s: string, inset: number, font: { size: number; weight?: number }) => truncateText(s, width - inset, font, measure);
  let y = legendMetrics.heading;
  const out: LegendLayout = { rows: [], items: [], keys: [], chips: [], height: 0 };
  for (const row of legend.rows) {
    if (row.kind === "chip" && !out.chips.length) y += legendMetrics.chipsGap;
    const at = y;
    const texts = row.kind === "swatches" ? row.entries.map((e) => fit(e.text, 24, text.legendValue)) : row.kind === "key" ? [fit(row.text, 24, text.legendKey)] : row.kind === "chip" ? [fit(row.label, 4, text.legendChip), fit(row.text, 4, text.legendKey)] : [];
    out.rows.push({ row, y: at, texts });
    if (row.kind === "key") {
      out.keys.push({ key: legend.keys[out.keys.length], y: at });
      y += legendMetrics.key;
    } else if (row.kind === "chip") {
      out.chips.push({ chip: row.chip, y: at });
      y += legendMetrics.chipLabel + legendMetrics.chipText;
    } else {
      const m = legendMetrics;
      out.items.push({ item: legend.items[out.items.length], y: at });
      y += m.itemTitle + (row.kind === "width" ? m.widthScale : row.kind === "ramp" ? m.gradient : row.entries.length * m.entry + m.entriesEnd);
    }
  }
  out.height = y;
  return out;
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
  /** The note on withheld edges and its baseline's start, under the map and the legend. */
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
  const keyY = below + (text ? f.noteRow : 0);
  const lines = activityKeyLines(scene.graph, scene.activityLabels, width - 2 * pad, scene.locale, measure);
  const height = keyY + (lines.length ? lines.length * f.keyLine + 2 * pad : text ? pad : 0);
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
      rule: { x: mapW, top: header + pad, bottom: (text ? below : height) - pad },
    },
    note: text ? { text, x: pad, y: below + f.noteBaseline } : undefined,
    key: { lines, y: keyY + pad },
    width,
    height,
    outWidth,
    // Exactly `height` when the figure is not scaled; an empty figure stays empty.
    outHeight: width > 0 ? height * (outWidth / width) : height,
  };
}
