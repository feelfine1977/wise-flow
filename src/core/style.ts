/**
 * Metric-to-style scales, colour-blind-safe palettes with pattern twins,
 * contrast helpers, the check of a theme's contrasts and sizes, and
 * level-of-detail rules.
 */
import { scaleLinear, scaleLog, scaleSqrt } from "d3-scale";
import { hatchSvg, patternTwinSvg, svgMarkup } from "./mark-svg.js";
import { metricKind } from "./metrics.js";
import { INDIRECT_TAG } from "./detail.js";
import { type FlowEdge, type FlowGraph, type FlowNode, hasTag, metric } from "./model.js";
import type { StringKey } from "./strings.js";
import { ruleDeviations } from "./rules.js";
import { type ColorScheme, type Theme, type ThemePalettes, colorChannels, defaultTheme, themeColors, themePalettes } from "./theme.js";
import { type ColorToken, type PatternId, type PatternLook, PATTERNS, colorTokens, paletteTokens, strokeTokens } from "./tokens.js";

export { type PatternId, type PatternLook, PATTERNS } from "./tokens.js";

/** The palettes of the token table (`paletteTokens`). */
export const palettes = paletteTokens;

/** A palette of the theme by name; `sequential` and `sequentialBlue` are the theme's `shortfall` and `performance`. */
type PaletteName = keyof typeof palettes | keyof ThemePalettes;

const ALIASES: Partial<Record<PaletteName, keyof ThemePalettes>> = { sequential: "shortfall", sequentialBlue: "performance" };

/** The stops of a named palette in a theme. */
export function themePalette(theme: Theme, name: PaletteName): readonly string[] {
  return theme.palette[ALIASES[name] ?? (name as keyof ThemePalettes)];
}

/** Fixed colours for hotspot types, gate states and the light scheme, from the token table (`colorTokens`). */
export const fixedColors = {
  severity: colorTokens.severity,
  mechanism: colorTokens.mechanism,
  reservoir: colorTokens.reservoir,
  pass: colorTokens.pass,
  warn: colorTokens.warn,
  fail: colorTokens.fail,
  neutral: colorTokens.neutral,
  outOfScope: colorTokens.outOfScope,
  ink: colorTokens.ink,
  /** Secondary text such as counts. */
  inkMuted: colorTokens.inkMuted,
  /** Ink for text on coloured fills; pure black reaches 4.5 : 1 on every mid-tone of the palettes. */
  inkStrong: colorTokens.inkStrong,
  paper: colorTokens.paper,
  /** Hairlines and tracks (`--wf-line`). */
  line: colorTokens.line,
  /** Background of notes and hovered elements. */
  surface: colorTokens.surface,
} as const;

// ---------------------------------------------------------------------------
// Colour helpers

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Piecewise-linear interpolation through the palette stops; `t` is clamped to [0, 1]. */
export function interpolatePalette(stops: readonly string[], t: number): string {
  if (stops.length === 0) return fixedColors.neutral;
  if (stops.length === 1) return stops[0];
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const pos = clamped * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** WCAG relative luminance of a literal colour (`colorChannels`) or of hex digits without `#`; NaN for anything else. */
function relativeLuminance(color: string): number {
  const [r, g, b] = (colorChannels(color) ?? colorChannels(`#${color}`) ?? [NaN, NaN, NaN]).slice(0, 3).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two literal colours; NaN when one is not a colour. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Ink colour with contrast ≥ 4.5 : 1 on the given background. */
export function contrastText(background: string): string {
  return contrastRatio(background, fixedColors.inkStrong) >= contrastRatio(background, fixedColors.paper)
    ? fixedColors.inkStrong
    : fixedColors.paper;
}

/** Something of a theme that falls short of what `checkTheme` asks. */
export interface ThemeDeviation {
  /**
   * `text`: text against its ground under 4.5 : 1 (ink on the frequency cue's
   * stripe under 7 : 1). `line`: a line against the paper under 3 : 1 (the
   * cue's foot under 4.5 : 1). `rampOrder`: the path ramp of a scheme not rising in
   * contrast against the paper from stop to stop.
   * `rampStart`: its low end against the paper under 3 : 1. `textSize`,
   * `strokeWidth`: a table entry under the theme's minimum. `color`: a colour
   * that is not a literal. `rule`: an entry of a rule that is unknown or out
   * of range (`ruleDeviations`); the rule changes nothing, but an opacity
   * outside 0.2 to 1 is clamped to it.
   */
  kind: "text" | "line" | "rampOrder" | "rampStart" | "textSize" | "strokeWidth" | "color" | "rule";
  /** The scheme of a contrast or of the ramp. */
  scheme?: ColorScheme;
  /** What was measured: `ink on paper`, `lineStrong on paper`, `palette.neutral`, `text.nodeCount`, `stroke.legendGradient`, `dark.paper`, `rules[0].set.strokeWeight`. */
  subject: string;
  /** The contrast ratio (two decimals), the size or width in pt, or the colour. */
  value: number | string;
  /** What it must reach. */
  minimum?: number;
}

/** Text and the grounds it is drawn on; deviations write their labels in the accent on the paper. */
const TEXT: [ColorToken, ColorToken][] = [["ink", "paper"], ["inkMuted", "paper"], ["ink", "surface"], ["inkMuted", "surface"], ["onFocus", "focus"], ["onPressed", "pressed"], ["accent", "paper"]];
/**
 * Lines that carry meaning: outlines that stand out, paths without a measure,
 * focus and selection, and deviations. `line` is left out: it draws hairlines
 * and tracks whose meaning a label or a neighbour carries too.
 */
const LINES: ColorToken[] = ["lineStrong", "neutral", "focus", "accent"];
/**
 * The frequency cue: text on its stripe keeps 7 : 1 (the muted ink 4.5 : 1),
 * and its foot stands out from the card's paper at 4.5 : 1.
 */
const CUE: ["text" | "line", ColorToken, ColorToken, number][] = [["text", "ink", "cueStripe", 7], ["text", "inkMuted", "cueStripe", 4.5], ["line", "cueFoot", "paper", 4.5]];
const TEXT_CONTRAST = 4.5;
const LINE_CONTRAST = 3;
/** Points per layout unit (a CSS pixel). */
const PT = 0.75;

const twoDecimals = (n: number) => Math.round(n * 100) / 100;

/** A colour as it is drawn over a ground (itself over white): a translucent colour mixed with the ground by its alpha. */
function over(color: string, ground?: string): string {
  const c = colorChannels(color);
  if (!c || c[3] >= 1) return color;
  const g = colorChannels(ground ? over(ground) : "#ffffff") ?? [255, 255, 255];
  return `rgb(${c.slice(0, 3).map((v, i) => Math.round(v * c[3] + g[i] * (1 - c[3]))).join(" ")})`;
}

/**
 * What of a theme falls short, in both schemes: text against its ground at
 * least 4.5 : 1 (ink on the frequency cue's stripe 7 : 1), lines against the
 * paper at least 3 : 1 (the cue's foot 4.5 : 1), the path ramp of the
 * scheme (`palette.neutral`, in the dark scheme with `darkPalette` over it)
 * monotonic in luminance, each stop with more contrast against the paper than
 * the one before, and its low end at least 3 : 1 against it, no text size or stroke width of the tables under the
 * theme's `minimum`, every colour a literal, and every rule known and in
 * range (`ruleDeviations`). A translucent colour is measured as drawn over
 * its ground. Empty when nothing does.
 */
export function checkTheme(theme: Theme): ThemeDeviation[] {
  const out: ThemeDeviation[] = [];
  for (const table of ["color", "dark"] as const) {
    for (const [role, value] of Object.entries(theme[table])) if (value !== undefined && !colorChannels(value)) out.push({ kind: "color", subject: `${table}.${role}`, value });
  }
  for (const scheme of ["light", "dark"] as const) {
    const c = themeColors(theme, scheme);
    // Each stop of the path ramp stands out more from the paper than the one before (against a paper that is a colour).
    const ramp = themePalettes(theme, scheme).neutral;
    if (colorChannels(c.paper) && ramp.slice(1).some((v, i) => !(contrastRatio(v, c.paper) > contrastRatio(ramp[i], c.paper)))) out.push({ kind: "rampOrder", scheme, subject: "palette.neutral", value: ramp.join(" ") });
    const check = (kind: "text" | "line" | "rampStart", subject: string, a: string, b: string, minimum: number) => {
      const r = contrastRatio(over(a, b), over(b));
      if (r < minimum) out.push({ kind, scheme, subject, value: twoDecimals(r), minimum });
    };
    for (const [text, ground] of TEXT) check("text", `${text} on ${ground}`, c[text], c[ground], TEXT_CONTRAST);
    for (const line of LINES) check("line", `${line} on paper`, c[line], c.paper, LINE_CONTRAST);
    for (const [kind, a, b, minimum] of CUE) check(kind, `${a} on ${b}`, c[a], c[b], minimum);
    if (ramp.length) check("rampStart", "palette.neutral", ramp[0], c.paper, LINE_CONTRAST);
    // The pattern twins are drawn in the pattern ink over every stage colour.
    for (const stage of themePalettes(theme, scheme).categorical) if (colorChannels(stage)) check("line", `patternInk on ${stage}`, c.patternInk, stage, LINE_CONTRAST);
  }
  for (const [role, style] of Object.entries(theme.text)) {
    const size = (style as { size?: number | string }).size;
    if (typeof size === "number" && size * PT < theme.minimum.text) out.push({ kind: "textSize", subject: `text.${role}`, value: size * PT, minimum: theme.minimum.text });
  }
  for (const [role, width] of Object.entries(theme.stroke)) {
    if (width * PT < theme.minimum.stroke) out.push({ kind: "strokeWidth", subject: `stroke.${role}`, value: width * PT, minimum: theme.minimum.stroke });
  }
  return [...out, ...ruleDeviations(theme)];
}

/** Stable 32-bit FNV-1a hash of a string. */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Style specification

export interface ChannelSpec {
  metric: string;
  scale?: "linear" | "sqrt" | "log";
  /** Values the range is stretched over instead of the scale from 0 to `max`: the lower end at the range's start, the upper at its end. */
  domain?: [number, number];
  /**
   * The upper end of a path width's scale, which runs from 0 to it, so that
   * the width depends on a path's value alone. Give several maps the same one
   * to compare them (`resolveViews` gives its views theirs). Default the
   * strongest path of the graph before any abstraction (`meta.model.pathMax`,
   * which `abstract` records), else of the graph.
   */
  max?: number;
  /** The thinnest line, which every path whose width rounds under it is drawn at, and the width of the upper end. */
  range?: [number, number];
}

export interface ColorSpec {
  /** Metric for sequential and diverging palettes. */
  metric?: string;
  palette?: PaletteName;
  /** How a sequential palette runs over its domain: evenly (`linear`, the default) or by the square root, as path width does (`sqrt`). */
  scale?: "linear" | "sqrt";
  /** Domain: two numbers for sequential, three for diverging (negative, centre, positive). */
  domain?: number[];
  /** Categorical colour by group, kind or a tag prefix (`tag:layer:`). */
  by?: "group" | "kind" | "tag" | "layer";
  /** Prefix of the tag to read when `by` is `tag`. */
  tagPrefix?: string;
}

export interface LodRules {
  /** Zoom level from which node labels are drawn. */
  labels: number;
  edgeLabels: number;
  badges: number;
  arcs: number;
  chips: number;
  hatch: number;
  selfLoops: number;
}

export interface StyleSpec {
  edgeWidth?: ChannelSpec;
  edgeColor?: ColorSpec;
  nodeColor?: ColorSpec;
  lod?: Partial<LodRules>;
  /**
   * The host's full list of stage (group) ids in stage order. Categorical
   * colours and their pattern twins are assigned in this order, then to the
   * graph's other groups and keys in the order they first appear, so that a
   * filtered graph keeps every stage's colour. Without it the order of the
   * unfiltered graph that `abstract` records (`meta.model.groups`) is used,
   * then the graph's own.
   */
  stages?: readonly string[];
}

export const defaultLod: LodRules = {
  labels: 0.2,
  edgeLabels: 0.6,
  badges: 0.22,
  arcs: 0.22,
  chips: 0.22,
  hatch: 0.15,
  selfLoops: 0.25,
};

/** Paths by cases: width and colour on the same square-root scale of the count, on the neutral ramp; activities by stage. */
export const defaultStyle: StyleSpec = {
  edgeWidth: { metric: "cases", scale: "sqrt", range: [strokeTokens.pathMin, strokeTokens.pathMax] },
  edgeColor: { metric: "cases", palette: "neutral", scale: "sqrt" },
  nodeColor: { by: "group", palette: "categorical" },
};

/** Paths coloured by their expectation shortfall share on the shortfall palette (the default style up to 0.3), width by cases. */
export const shortfallStyle: StyleSpec = {
  edgeWidth: defaultStyle.edgeWidth,
  edgeColor: { metric: "violationShare", palette: "sequential", domain: [0, 1] },
  nodeColor: defaultStyle.nodeColor,
};

/** Style for diff maps: width from the slice's cases, colour from the delta of the shortfall share. */
export const diffStyle: StyleSpec = {
  edgeWidth: { metric: "cases", scale: "sqrt", range: [strokeTokens.pathMin, strokeTokens.pathMax] },
  edgeColor: { metric: "delta_violationShare", palette: "diverging", domain: [-0.5, 0, 0.5] },
  nodeColor: { metric: "delta_violationShare", palette: "diverging", domain: [-0.5, 0, 0.5] },
};

/** Which elements are visible at a zoom level. */
export function lodAt(zoom: number, rules: Partial<LodRules> = {}): Record<keyof LodRules, boolean> {
  const r = { ...defaultLod, ...rules };
  return {
    labels: zoom >= r.labels,
    edgeLabels: zoom >= r.edgeLabels,
    badges: zoom >= r.badges,
    arcs: zoom >= r.arcs,
    chips: zoom >= r.chips,
    hatch: zoom >= r.hatch,
    selfLoops: zoom >= r.selfLoops,
  };
}

/** Rules tightened for larger maps so that a fitted view stays readable. */
export function lodForSize(nodeCount: number, base: Partial<LodRules> = {}): LodRules {
  const r = { ...defaultLod, ...base };
  const factor = nodeCount > 400 ? 1.8 : nodeCount > 150 ? 1.4 : nodeCount > 60 ? 1.15 : 1;
  const out = { ...r };
  for (const k of Object.keys(out) as (keyof LodRules)[]) out[k] = Math.min(2, r[k] * factor);
  return out;
}

// ---------------------------------------------------------------------------
// Scales

export interface CategoricalEntry {
  key: string;
  color: string;
  pattern: PatternId;
  index: number;
  /** The group's label where the key is a group's id. */
  label?: string;
}

export type LegendItem =
  | {
      kind: "width";
      title: StringKey;
      metric: string;
      domain: [number, number];
      range: [number, number];
      /**
       * Three values with the widths the scale draws them at: the thinnest
       * line with the largest value drawn at it (`floor`), a value near the
       * middle width and the upper end; with a `domain`, its ends and the middle.
       */
      samples?: { value: number; width: number; floor?: boolean }[];
      /** The scale runs from 0 to the strongest path of the graph (`graph`) or to the upper end the style gives (`shared`); none with a `domain`. */
      scale?: "graph" | "shared";
      /** The paths count transitions: the graph gives no cases for them. */
      transitionsOnly?: boolean;
    }
  | { kind: "sequential" | "diverging"; title: StringKey; metric: string; domain: number[]; stops: readonly string[] }
  | { kind: "categorical"; title: StringKey; entries: CategoricalEntry[] };

export interface Scales {
  spec: StyleSpec;
  edgeWidth(edge: FlowEdge): number;
  edgeColor(edge: FlowEdge): string;
  nodeColor(node: FlowNode): string;
  nodePattern(node: FlowNode): PatternId;
  /**
   * Colour and pattern twin for a categorical key: assigned in stage order
   * (`StyleSpec.stages`, `meta.model.groups`, then the graph's groups and
   * keys), each key from its hashed colour to the next one free, so that no
   * two keys share a colour until the palette is used up; then the colours
   * are used again with the next pattern. A key outside that order takes its
   * hashed colour.
   */
  categorical(key: string): CategoricalEntry;
  /**
   * The count metric paths are labelled with and their width reads: the width
   * metric, `cases` by default, or `count` where the graph gives paths only
   * transition counts.
   */
  pathMetric: string;
  /** A follows edge without a value of `pathMetric`: drawn in the line colour at the thinnest width, labelled "–". */
  notEvaluated(edge: FlowEdge): boolean;
  /** Colour for a metric value on a named palette and domain. */
  color(value: number, palette: PaletteName, domain: number[]): string;
  legend: LegendItem[];
  domains: { edgeWidth?: [number, number]; edgeColor?: number[]; nodeColor?: number[] };
}

/** The smallest and largest finite value, or `undefined` when there is none. */
export function extentOf(values: number[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

export function isShareMetric(name: string): boolean {
  return /share/i.test(name);
}

export function colorOn(value: number, palette: PaletteName, domain: number[], theme: Theme = defaultTheme): string {
  const stops = themePalette(theme, palette);
  if (!Number.isFinite(value)) return theme.color.neutral;
  if (domain.length >= 3) {
    const [lo, mid, hi] = domain;
    const tt = value < mid ? (mid - lo === 0 ? 0 : 0.5 * (value - lo) / (mid - lo)) : hi - mid === 0 ? 1 : 0.5 + 0.5 * ((value - mid) / (hi - mid));
    return interpolatePalette(stops, tt);
  }
  const [lo, hi] = domain.length === 2 ? domain : [0, 1];
  const tt = hi - lo === 0 ? 0 : (value - lo) / (hi - lo);
  return interpolatePalette(stops, tt);
}

/** The colour and pattern twin of a categorical key in a theme's categorical palette, by its hash; `round` shifts the pattern. */
function categoricalEntry(key: string, theme: Theme, index = hashKey(key) % theme.palette.categorical.length, round = 0): CategoricalEntry {
  return { key, color: theme.palette.categorical[index], pattern: theme.patterns[(index + round) % theme.patterns.length], index };
}

/**
 * The entries of keys in their order: each takes its hashed colour or the
 * next one not yet taken; once every colour is taken they are free again
 * and the next round shifts the pattern twins by one. A key that is not a
 * string has no entry.
 */
export function orderedCategorical(keys: Iterable<string>, theme: Theme = defaultTheme): Map<string, CategoricalEntry> {
  const size = theme.palette.categorical.length;
  const out = new Map<string, CategoricalEntry>();
  const taken = new Set<number>();
  let round = 0;
  for (const key of keys) {
    if (typeof key !== "string" || out.has(key) || !size) continue;
    if (taken.size === size) {
      taken.clear();
      round++;
    }
    let index = hashKey(key) % size;
    while (taken.has(index)) index = (index + 1) % size;
    taken.add(index);
    out.set(key, categoricalEntry(key, theme, index, round));
  }
  return out;
}

/** The value of a count with two significant digits: 357 → 360. */
function roundish(v: number): number {
  if (!(Math.abs(v) >= 100)) return Math.round(v);
  const step = 10 ** (Math.floor(Math.log10(Math.abs(v))) - 1);
  return Math.round(v / step) * step;
}

/**
 * The upper end of a graph's path width scale for a metric: the largest value
 * over the paths of the graph before any abstraction (`meta.model.pathMax`),
 * else over its own paths (follows and sequence flow edges); none without one.
 */
export function pathScaleMax(graph: FlowGraph, name: string): number | undefined {
  const recorded = graph.meta?.model?.pathMax?.[name];
  if (Number.isFinite(recorded)) return recorded;
  return extentOf(graph.edges.filter((e) => e.kind !== "constraint").map((e) => metric(e, name, NaN)))?.[1];
}

/** Build the scales of a graph for a style specification in a theme's palettes; deterministic for the same input. */
export function buildScales(graph: FlowGraph, spec: StyleSpec = defaultStyle, theme: Theme = defaultTheme): Scales {
  const domains: Scales["domains"] = {};
  const neutral = theme.color.neutral;
  const color = (value: number, palette: PaletteName, domain: number[]) => colorOn(value, palette, domain, theme);
  // Paths carry the metrics; sequence flows of a BPMN-lite graph carry the same metrics.
  const follows = graph.edges.filter((e) => e.kind === "follows" || e.kind === "flow");
  const has = (name: string) => follows.some((e) => Number.isFinite(metric(e, name, NaN)));
  // Paths count cases like activities; where the graph gives them only transitions, they count those.
  const transitionsOnly = !has("cases") && has("count");
  const resolved = (name: string) => (name === "cases" && transitionsOnly ? "count" : name);

  // Categorical colours in stage order, then in the order groups and keys first appear.
  const keyOf = categoricalKey(spec.nodeColor);
  const order = orderedCategorical([...(spec.stages ?? []), ...(graph.meta?.model?.groups ?? []), ...(graph.groups ?? []).map((g) => g.id), ...graph.nodes.flatMap((n) => keyOf(n) ?? [])], theme);
  const categorical = (key: string) => order.get(key) ?? categoricalEntry(key, theme);

  // Edge width: one scale per graph, from 0 to its strongest path before abstraction, or over a given domain.
  const widthSpec = spec.edgeWidth && { ...spec.edgeWidth, metric: resolved(spec.edgeWidth.metric) };
  const pathMetric = widthSpec && metricKind(widthSpec.metric) === "count" ? widthSpec.metric : resolved("cases");
  // An indirect path has no count, as it is no path of the graph: it is not a path not evaluated.
  const indirect = (e: FlowEdge) => hasTag(e, INDIRECT_TAG);
  const notEvaluated = (e: FlowEdge) => e.kind === "follows" && !indirect(e) && !Number.isFinite(metric(e, pathMetric, NaN));
  let widthFn: (e: FlowEdge) => number = () => theme.stroke.path;
  let samples: { value: number; width: number; floor?: boolean }[] | undefined;
  const upper = widthSpec && (widthSpec.max ?? pathScaleMax(graph, widthSpec.metric));
  const kind = widthSpec?.scale ?? "sqrt";
  const measured = widthSpec && (widthSpec.domain ?? (upper === undefined ? undefined : ([kind === "log" ? 1 : 0, upper] as [number, number])));
  if (widthSpec) {
    const domain = measured ?? [0, 1];
    const safeDomain: [number, number] = domain[0] === domain[1] ? [0, domain[1] || 1] : domain;
    const range = widthSpec.range ?? [theme.stroke.pathMin, theme.stroke.pathMax];
    // From 0 the scale runs onto 0 and every width that rounds under the thinnest line is drawn at it; a domain is stretched onto the range.
    const floor = widthSpec.domain || kind === "log" ? -Infinity : range[0];
    const onto: [number, number] = floor === -Infinity ? range : [0, range[1]];
    const s =
      kind === "log"
        ? scaleLog().domain([Math.max(1e-9, safeDomain[0]), Math.max(1e-9, safeDomain[1])]).range(onto).clamp(true)
        : kind === "linear"
          ? scaleLinear().domain(safeDomain).range(onto).clamp(true)
          : scaleSqrt().domain(safeDomain).range(onto).clamp(true);
    domains.edgeWidth = safeDomain;
    const at = (v: number) => {
      const w = s(kind === "log" ? Math.max(1e-9, v) : v);
      // A domain or value that is not a number gives no width: the thinnest line.
      return Math.max(floor, typeof w === "number" && Number.isFinite(w) ? Number(w.toFixed(2)) : range[0]);
    };
    widthFn = (e) => {
      const v = e.metrics?.[widthSpec.metric];
      if (typeof v !== "number" || !Number.isFinite(v)) return range[0];
      return at(v);
    };
    const count = metricKind(widthSpec.metric) === "count";
    const middle = Number(s.invert((range[0] + range[1]) / 2));
    // A count near the middle width, with two significant digits; another metric as it is.
    const near = count ? roundish(middle) : middle;
    if (floor === -Infinity) {
      samples = [safeDomain[0], near, safeDomain[1]].map((value) => ({ value, width: at(value) }));
    } else {
      // The largest value the thinnest line stands for, where a value is drawn at it.
      const lowest = count ? Math.floor(Number(s.invert(floor))) : Number(s.invert(floor));
      samples = [...(lowest > 0 ? [{ value: lowest, width: at(lowest), floor: true }] : []), { value: near, width: at(near) }, { value: safeDomain[1], width: at(safeDomain[1]) }];
    }
  }

  // Edge colour
  const edgeSpec = spec.edgeColor && { ...spec.edgeColor, metric: spec.edgeColor.metric && resolved(spec.edgeColor.metric) };
  let edgeColorFn: (e: FlowEdge) => string = () => neutral;
  if (edgeSpec?.metric) {
    const palette = edgeSpec.palette ?? "sequential";
    const domain =
      edgeSpec.domain ??
      (palette === "diverging"
        ? symmetricDomain(follows.map((e) => metric(e, edgeSpec.metric!, NaN)))
        : isShareMetric(edgeSpec.metric)
          ? [0, 1]
          : (extentOf(follows.map((e) => metric(e, edgeSpec.metric!, NaN))) ?? [0, 1]));
    domains.edgeColor = domain;
    // By the square root, a value is placed on the ramp where its square root lies between those of the domain's ends.
    const root = edgeSpec.scale === "sqrt" && domain.length === 2 ? scaleSqrt().domain(domain[0] === domain[1] ? [0, domain[1] || 1] : domain) : undefined;
    edgeColorFn = (e) => {
      const v = e.metrics?.[edgeSpec.metric!];
      if (typeof v !== "number" || !Number.isFinite(v)) return neutral;
      return root ? interpolatePalette(themePalette(theme, palette), root(v)) : color(v, palette, domain);
    };
  }
  const pathColorFn = (e: FlowEdge) => (notEvaluated(e) || indirect(e) ? theme.color.line : edgeColorFn(e));

  // Node colour and pattern
  const nodeSpec = spec.nodeColor;
  let nodeColorFn: (n: FlowNode) => string = () => neutral;
  let nodePatternFn: (n: FlowNode) => PatternId = () => "solid";
  const categoricalKeys = new Set<string>();
  if (nodeSpec?.by) {
    for (const n of graph.nodes) {
      const k = keyOf(n);
      if (k !== undefined) categoricalKeys.add(k);
    }
    nodeColorFn = (n) => {
      const k = keyOf(n);
      return k === undefined ? neutral : categorical(k).color;
    };
    nodePatternFn = (n) => {
      const k = keyOf(n);
      return k === undefined ? "solid" : categorical(k).pattern;
    };
  } else if (nodeSpec?.metric) {
    const palette = nodeSpec.palette ?? "sequential";
    const values = graph.nodes.map((n) => metric(n, nodeSpec.metric!, NaN));
    const domain =
      nodeSpec.domain ??
      (palette === "diverging" ? symmetricDomain(values) : isShareMetric(nodeSpec.metric) ? [0, 1] : (extentOf(values) ?? [0, 1]));
    domains.nodeColor = domain;
    nodeColorFn = (n) => {
      const v = n.metrics?.[nodeSpec.metric!];
      return typeof v === "number" && Number.isFinite(v) ? color(v, palette, domain) : neutral;
    };
  }

  const legend: LegendItem[] = [];
  // A width with nothing measured has no samples to show.
  if (widthSpec && domains.edgeWidth && measured) {
    const scale = widthSpec.domain || kind === "log" ? undefined : widthSpec.max === undefined ? "graph" : "shared";
    legend.push({ kind: "width", title: "legend.edgeWidth", metric: widthSpec.metric, domain: domains.edgeWidth, range: widthSpec.range ?? [theme.stroke.pathMin, theme.stroke.pathMax], samples, ...(scale && { scale }), ...(widthSpec.metric === "count" && transitionsOnly && { transitionsOnly }) });
  }
  if (edgeSpec?.metric && domains.edgeColor) {
    const palette = edgeSpec.palette ?? "sequential";
    legend.push({ kind: palette === "diverging" ? "diverging" : "sequential", title: "legend.edgeColor", metric: edgeSpec.metric, domain: domains.edgeColor, stops: themePalette(theme, palette) });
  }
  if (nodeSpec?.by && categoricalKeys.size) {
    const labels = new Map(nodeSpec.by === "group" ? (graph.groups ?? []).map((g) => [g.id, g.label]) : []);
    const entry = (k: string) => (labels.has(k) ? { ...categorical(k), label: labels.get(k) } : categorical(k));
    // The order holds every node's key: the entries in stage order.
    legend.push({ kind: "categorical", title: "legend.nodeColor", entries: [...order.keys()].filter((k) => categoricalKeys.has(k)).map(entry) });
  } else if (nodeSpec?.metric && domains.nodeColor) {
    const palette = nodeSpec.palette ?? "sequential";
    legend.push({ kind: palette === "diverging" ? "diverging" : "sequential", title: "legend.nodeColor", metric: nodeSpec.metric, domain: domains.nodeColor, stops: themePalette(theme, palette) });
  }

  return {
    spec,
    edgeWidth: widthFn,
    edgeColor: pathColorFn,
    nodeColor: nodeColorFn,
    nodePattern: nodePatternFn,
    categorical,
    pathMetric,
    notEvaluated,
    color,
    legend,
    domains,
  };
}

/** The categorical key of a node for a colour specification: its group, kind, layer or tag. */
function categoricalKey(nodeSpec: ColorSpec | undefined): (n: FlowNode) => string | undefined {
  return (n) => {
    switch (nodeSpec?.by) {
      case "group":
        return n.group;
      case "kind":
        return n.kind;
      case "layer":
        return n.tags?.find((tg) => tg.startsWith("layer:"))?.slice(6);
      case "tag": {
        const prefix = nodeSpec.tagPrefix ?? "";
        return n.tags?.find((tg) => tg.startsWith(prefix))?.slice(prefix.length);
      }
      default:
        return undefined;
    }
  };
}

export function symmetricDomain(values: number[]): number[] {
  const ext = extentOf(values);
  if (!ext) return [-1, 0, 1];
  const m = Math.max(Math.abs(ext[0]), Math.abs(ext[1])) || 1;
  return [-m, 0, m];
}

/** SVG pattern definitions for the pattern twins (drawn as `look` says) and the out-of-scope hatching, usable in exports and in the DOM. */
export function patternDefs(prefix = "wf-pattern", ink: string = fixedColors.ink, outOfScope: string = fixedColors.outOfScope, look?: PatternLook): string {
  return [...PATTERNS.map((p) => patternTwinSvg(`${prefix}-${p}`, p, ink, look)), hatchSvg(`${prefix}-outofscope`, outOfScope)].map(svgMarkup).join("");
}
