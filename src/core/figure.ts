/**
 * The legend and the figure frame, described once: which rows the legend
 * lists and how tall they are, and where the title, the map, the legend and
 * the activity key sit in an exported figure.
 */
import { type ActivityLabelOptions, activityKeyLines } from "./activity-labels.js";
import type { Locale } from "./format.js";
import type { Box } from "./layout.js";
import { type FlowGraph, type Overlay, MAP_TARGET } from "./model.js";
import type { LegendItem } from "./style.js";
import type { StringKey } from "./strings.js";

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

/** What the legend lists, in order: the scales in use, the keys, the map-level chips. */
export interface SceneLegend {
  items: LegendItem[];
  /** The overlay kinds present, then re-added paths, which every map can show. */
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

/** The legend of the given scale items and the overlays a scene shows. */
export function sceneLegend(items: LegendItem[], overlays: readonly Overlay[]): SceneLegend {
  const kinds = new Set(overlays.map((o) => o.kind));
  const present: Record<LegendKeyKind, boolean> = {
    badge: kinds.has("badge"),
    arc: kinds.has("arc"),
    reverse: overlays.some((o) => o.kind === "arc" && !!o.payload?.reverse),
    selfLoop: kinds.has("selfLoop"),
    outOfScope: kinds.has("hatch"),
    reconnected: true,
  };
  return { items, keys: KEYS.filter((k) => present[k.kind]), chips: overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET) };
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

/** Where each part of the legend starts, relative to its top. */
export interface LegendLayout {
  items: { item: LegendItem; y: number }[];
  keys: { key: LegendKey; y: number }[];
  chips: { chip: Overlay; y: number }[];
  height: number;
}

/** Lay out the legend's rows from the top down: heading, scale items, keys, chips. */
export function legendLayout(legend: SceneLegend): LegendLayout {
  const m = legendMetrics;
  let y = m.heading;
  const items = legend.items.map((item) => {
    const at = { item, y };
    y += legendItemHeight(item);
    return at;
  });
  const keys = legend.keys.map((key) => {
    const at = { key, y };
    y += m.key;
    return at;
  });
  if (legend.chips.length) y += m.chipsGap;
  const chips = legend.chips.map((chip) => {
    const at = { chip, y };
    y += m.chipLabel + m.chipText;
    return at;
  });
  return { items, keys, chips, height: y };
}

/** Fixed measurements of an exported figure. */
export const figureMetrics = {
  padding: 24,
  /** The legend's column: a rule, the inset, the rows and the inset again. */
  legendColumn: legendMetrics.width + 2 * 16,
  legendInset: 16,
  titleHeight: 40,
  titleBaseline: 26,
  contextHeight: 18,
  contextBaseline: 44,
  keyLine: 16,
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
}

/** Measure the figure of a scene: header, map, legend column, activity key and output size. */
export function figureFrame(scene: FramedScene, options: FigureFrameOptions = {}): FigureFrame {
  const f = figureMetrics;
  const pad = options.padding ?? f.padding;
  const layout = options.legend === false ? undefined : legendLayout(scene.legend);
  const column = layout ? f.legendColumn : 0;
  const header = options.title ? f.titleHeight + (options.context !== false ? f.contextHeight : 0) : 0;
  const content = scene.bounds;
  const mapW = content.width + 2 * pad;
  const mapH = content.height + 2 * pad;
  const width = mapW + column;
  const keyY = Math.max(mapH, (layout?.height ?? 0) + 2 * pad) + header;
  const lines = activityKeyLines(scene.graph, scene.activityLabels, width - 2 * pad, scene.locale);
  const height = keyY + (lines.length ? lines.length * f.keyLine + 2 * pad : 0);
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
      rule: { x: mapW, top: header + pad, bottom: height - pad },
    },
    key: { lines, y: keyY + pad },
    width,
    height,
    outWidth,
    outHeight: (height / width) * outWidth,
  };
}
