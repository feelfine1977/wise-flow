/**
 * Metric-to-style scales, colour-blind-safe palettes with pattern twins,
 * contrast helpers and level-of-detail rules.
 */
import { scaleLinear, scaleLog, scaleSqrt } from "d3-scale";
import { type FlowEdge, type FlowGraph, type FlowNode, metric } from "./model";

export type PatternId =
  | "solid"
  | "diagonal"
  | "dots"
  | "crosshatch"
  | "horizontal"
  | "vertical"
  | "diagonal-reverse"
  | "grid";

export const PATTERNS: PatternId[] = [
  "solid",
  "diagonal",
  "dots",
  "crosshatch",
  "horizontal",
  "vertical",
  "diagonal-reverse",
  "grid",
];

/**
 * Palettes. Sequential scales are single-hue and lightness-driven (safe for every
 * common colour-vision deficiency); the diverging scale is purple–orange; the
 * categorical palette is Okabe–Ito.
 */
export const palettes = {
  /** Light to dark orange; used for expectation shortfall shares. */
  sequential: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"],
  /** Light to dark blue; used for performance metrics. */
  sequentialBlue: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  /** Purple (negative) over neutral to orange (positive); used for deltas. */
  diverging: ["#542788", "#998ec3", "#d8daeb", "#f7f7f7", "#fee0b6", "#f1a340", "#b35806"],
  /** Okabe–Ito, stable by hashed key, with pattern twins. */
  categorical: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#999999"],
} as const;

export type PaletteName = keyof typeof palettes;

/** Fixed colours for hotspot types and gate states (workbench tokens). */
export const fixedColors = {
  severity: "#D55E00",
  mechanism: "#0072B2",
  reservoir: "#009E73",
  pass: "#009E73",
  warn: "#E69F00",
  fail: "#D55E00",
  neutral: "#8c8c8c",
  outOfScope: "#b0b0b0",
  ink: "#1f1f1f",
  /** Ink for text on coloured fills; pure black reaches 4.5 : 1 on every mid-tone of the palettes. */
  inkStrong: "#000000",
  paper: "#ffffff",
} as const;

// ---------------------------------------------------------------------------
// Colour helpers

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
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

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours. */
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
  domain?: [number, number];
  range?: [number, number];
}

export interface ColorSpec {
  /** Metric for sequential and diverging palettes. */
  metric?: string;
  palette?: PaletteName;
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

export const defaultStyle: StyleSpec = {
  edgeWidth: { metric: "count", scale: "sqrt", range: [1, 8] },
  edgeColor: { metric: "violationShare", palette: "sequential", domain: [0, 1] },
  nodeColor: { by: "group", palette: "categorical" },
};

/** Style for diff maps: width from the slice, colour from the delta of the shortfall share. */
export const diffStyle: StyleSpec = {
  edgeWidth: { metric: "count", scale: "sqrt", range: [1, 8] },
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
}

export type LegendItem =
  | { kind: "width"; title: string; metric: string; domain: [number, number]; range: [number, number] }
  | { kind: "sequential" | "diverging"; title: string; metric: string; domain: number[]; stops: readonly string[] }
  | { kind: "categorical"; title: string; entries: CategoricalEntry[] };

export interface Scales {
  spec: StyleSpec;
  edgeWidth(edge: FlowEdge): number;
  edgeColor(edge: FlowEdge): string;
  nodeColor(node: FlowNode): string;
  nodePattern(node: FlowNode): PatternId;
  /** Colour and pattern twin for a categorical key; stable by hashed key. */
  categorical(key: string): CategoricalEntry;
  /** Colour for a metric value on a named palette and domain. */
  color(value: number, palette: PaletteName, domain: number[]): string;
  legend: LegendItem[];
  domains: { edgeWidth?: [number, number]; edgeColor?: number[]; nodeColor?: number[] };
}

function extentOf(values: number[]): [number, number] | undefined {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo === Infinity ? undefined : [lo, hi];
}

function isShareMetric(name: string): boolean {
  return /share/i.test(name);
}

export function colorOn(value: number, palette: PaletteName, domain: number[]): string {
  const stops = palettes[palette];
  if (!Number.isFinite(value)) return fixedColors.neutral;
  if (domain.length >= 3) {
    const [lo, mid, hi] = domain;
    const tt = value < mid ? (mid - lo === 0 ? 0 : 0.5 * (value - lo) / (mid - lo)) : hi - mid === 0 ? 1 : 0.5 + 0.5 * ((value - mid) / (hi - mid));
    return interpolatePalette(stops, tt);
  }
  const [lo, hi] = domain.length === 2 ? domain : [0, 1];
  const tt = hi - lo === 0 ? 0 : (value - lo) / (hi - lo);
  return interpolatePalette(stops, tt);
}

function categoricalEntry(key: string): CategoricalEntry {
  const index = hashKey(key) % palettes.categorical.length;
  return { key, color: palettes.categorical[index], pattern: PATTERNS[index], index };
}

/** Build the scales of a graph for a style specification; deterministic for the same input. */
export function buildScales(graph: FlowGraph, spec: StyleSpec = defaultStyle): Scales {
  const domains: Scales["domains"] = {};
  const follows = graph.edges.filter((e) => e.kind === "follows");

  // Edge width
  const widthSpec = spec.edgeWidth;
  let widthFn: (e: FlowEdge) => number = () => 1.5;
  if (widthSpec) {
    const domain =
      widthSpec.domain ?? extentOf(follows.map((e) => metric(e, widthSpec.metric, NaN))) ?? [0, 1];
    const safeDomain: [number, number] = domain[0] === domain[1] ? [0, domain[1] || 1] : domain;
    const range = widthSpec.range ?? [1, 8];
    const kind = widthSpec.scale ?? "sqrt";
    const s =
      kind === "log"
        ? scaleLog().domain([Math.max(1e-9, safeDomain[0]), Math.max(1e-9, safeDomain[1])]).range(range).clamp(true)
        : kind === "linear"
          ? scaleLinear().domain(safeDomain).range(range).clamp(true)
          : scaleSqrt().domain(safeDomain).range(range).clamp(true);
    domains.edgeWidth = safeDomain;
    widthFn = (e) => {
      const v = e.metrics?.[widthSpec.metric];
      if (typeof v !== "number" || !Number.isFinite(v)) return range[0];
      return Number(s(kind === "log" ? Math.max(1e-9, v) : v).toFixed(2));
    };
  }

  // Edge colour
  const edgeSpec = spec.edgeColor;
  let edgeColorFn: (e: FlowEdge) => string = () => fixedColors.neutral;
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
    edgeColorFn = (e) => {
      const v = e.metrics?.[edgeSpec.metric!];
      return typeof v === "number" && Number.isFinite(v) ? colorOn(v, palette, domain) : fixedColors.neutral;
    };
  }

  // Node colour and pattern
  const nodeSpec = spec.nodeColor;
  const keyOf = (n: FlowNode): string | undefined => {
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
  let nodeColorFn: (n: FlowNode) => string = () => fixedColors.neutral;
  let nodePatternFn: (n: FlowNode) => PatternId = () => "solid";
  const categoricalKeys = new Set<string>();
  if (nodeSpec?.by) {
    for (const n of graph.nodes) {
      const k = keyOf(n);
      if (k !== undefined) categoricalKeys.add(k);
    }
    nodeColorFn = (n) => {
      const k = keyOf(n);
      return k === undefined ? fixedColors.neutral : categoricalEntry(k).color;
    };
    nodePatternFn = (n) => {
      const k = keyOf(n);
      return k === undefined ? "solid" : categoricalEntry(k).pattern;
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
      return typeof v === "number" && Number.isFinite(v) ? colorOn(v, palette, domain) : fixedColors.neutral;
    };
  }

  const legend: LegendItem[] = [];
  if (widthSpec && domains.edgeWidth) {
    legend.push({ kind: "width", title: "legend.edgeWidth", metric: widthSpec.metric, domain: domains.edgeWidth, range: widthSpec.range ?? [1, 8] });
  }
  if (edgeSpec?.metric && domains.edgeColor) {
    const palette = edgeSpec.palette ?? "sequential";
    legend.push({ kind: palette === "diverging" ? "diverging" : "sequential", title: "legend.edgeColor", metric: edgeSpec.metric, domain: domains.edgeColor, stops: palettes[palette] });
  }
  if (nodeSpec?.by && categoricalKeys.size) {
    legend.push({ kind: "categorical", title: "legend.nodeColor", entries: [...categoricalKeys].sort().map(categoricalEntry) });
  } else if (nodeSpec?.metric && domains.nodeColor) {
    const palette = nodeSpec.palette ?? "sequential";
    legend.push({ kind: palette === "diverging" ? "diverging" : "sequential", title: "legend.nodeColor", metric: nodeSpec.metric, domain: domains.nodeColor, stops: palettes[palette] });
  }

  return {
    spec,
    edgeWidth: widthFn,
    edgeColor: edgeColorFn,
    nodeColor: nodeColorFn,
    nodePattern: nodePatternFn,
    categorical: categoricalEntry,
    color: colorOn,
    legend,
    domains,
  };
}

function symmetricDomain(values: number[]): number[] {
  const ext = extentOf(values);
  if (!ext) return [-1, 0, 1];
  const m = Math.max(Math.abs(ext[0]), Math.abs(ext[1])) || 1;
  return [-m, 0, m];
}

/** SVG pattern definitions for the pattern twins, usable in exports and in the DOM. */
export function patternDefs(prefix = "wf-pattern", ink = fixedColors.ink): string {
  const size = 8;
  const defs: string[] = [];
  const stroke = `stroke="${ink}" stroke-width="1.2" stroke-opacity="0.55"`;
  for (const p of PATTERNS) {
    let body = "";
    switch (p) {
      case "solid":
        body = "";
        break;
      case "diagonal":
        body = `<path d="M0 ${size}L${size} 0" ${stroke}/>`;
        break;
      case "diagonal-reverse":
        body = `<path d="M0 0L${size} ${size}" ${stroke}/>`;
        break;
      case "dots":
        body = `<circle cx="${size / 2}" cy="${size / 2}" r="1.3" fill="${ink}" fill-opacity="0.6"/>`;
        break;
      case "crosshatch":
        body = `<path d="M0 ${size}L${size} 0M0 0L${size} ${size}" ${stroke}/>`;
        break;
      case "horizontal":
        body = `<path d="M0 ${size / 2}H${size}" ${stroke}/>`;
        break;
      case "vertical":
        body = `<path d="M${size / 2} 0V${size}" ${stroke}/>`;
        break;
      case "grid":
        body = `<path d="M0 ${size / 2}H${size}M${size / 2} 0V${size}" ${stroke}/>`;
        break;
    }
    defs.push(`<pattern id="${prefix}-${p}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${body}</pattern>`);
  }
  defs.push(
    `<pattern id="${prefix}-outofscope" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="${fixedColors.outOfScope}" stroke-width="2"/></pattern>`,
  );
  return defs.join("");
}
