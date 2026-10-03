/**
 * Design tokens of @wise/flow: the one table of colours, sizes, the font
 * stack, the arrowhead rule and the pattern twins. The SVG export and the
 * marks read it directly; the Canvas renderer starts from it and picks up the
 * live CSS variables; `tokens.css` writes its themeable part as CSS variables
 * (`tokenVariables`) and is checked against it.
 *
 * This module imports nothing, so tooling can read the table on its own.
 */

/** Colours of the light scheme. */
export const colorTokens = {
  paper: "#ffffff",
  /** Background of notes and hovered elements. */
  surface: "#f6f7f9",
  ink: "#1f1f1f",
  /** Secondary text such as counts. */
  inkMuted: "#5b6270",
  /** Ink for text on coloured fills; pure black reaches 4.5 : 1 on every mid-tone of the palettes. */
  inkStrong: "#000000",
  /** Hairlines and tracks. */
  line: "#cfd4dc",
  lineStrong: "#8c94a1",
  /** Accent: focus, selection and hover outlines. */
  focus: "#0072b2",
  /** Text on the accent colour. */
  onFocus: "#ffffff",
  selection: "rgba(0, 114, 178, 0.14)",
  hover: "rgba(0, 0, 0, 0.05)",
  neutral: "#8c8c8c",
  outOfScope: "#b0b0b0",
  // Hotspot types and gate states (Okabe–Ito).
  severity: "#D55E00",
  mechanism: "#0072B2",
  reservoir: "#009E73",
  pass: "#009E73",
  warn: "#E69F00",
  fail: "#D55E00",
} as const;

export type ColorToken = keyof typeof colorTokens;

/** Colours that the dark scheme changes. */
export const darkColorTokens: Partial<Record<ColorToken, string>> = {
  paper: "#16181d",
  surface: "#1f2229",
  ink: "#ececec",
  inkMuted: "#a7adb8",
  line: "#3a3f49",
  lineStrong: "#6b7280",
  selection: "rgba(86, 180, 233, 0.22)",
  hover: "rgba(255, 255, 255, 0.07)",
};

/**
 * Palettes. Sequential scales are single-hue and lightness-driven (safe for every
 * common colour-vision deficiency); the diverging scale is purple–orange; the
 * categorical palette is Okabe–Ito.
 */
export const paletteTokens = {
  /** Light to dark orange; used for expectation shortfall shares. */
  sequential: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"],
  /** Light to dark blue; used for performance metrics. */
  sequentialBlue: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  /** Purple (negative) over neutral to orange (positive); used for deltas. */
  diverging: ["#542788", "#998ec3", "#d8daeb", "#f7f7f7", "#fee0b6", "#f1a340", "#b35806"],
  /** Okabe–Ito, stable by hashed key, with pattern twins. */
  categorical: ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#F0E442", "#999999"],
} as const;

export const fontTokens = {
  family: "Inter, 'Segoe UI', Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace",
} as const;

/** Default box of each node kind, in layout units. */
export const nodeSizeTokens = {
  activity: { width: 180, height: 48 },
  stage: { width: 200, height: 56 },
  gateway: { width: 44, height: 44 },
  event: { width: 36, height: 36 },
  note: { width: 160, height: 60 },
} as const;

/** Sizes of the node and edge marks, in layout units. */
export const sizeTokens = {
  /** Corner radius of nodes. */
  radius: 6,
  /** Corner radius of groups and panels. */
  radiusLarge: 10,
  /** Width of the colour band along a node's left edge. */
  band: 8,
  shadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
} as const;

/** Font sizes of the node and edge texts, in layout units. */
export const textSizeTokens = {
  label: 12,
  /** Gateway glyph. */
  glyph: 14,
  /** Label inside an event circle and the count of a node. */
  small: 9,
  note: 11,
  edgeCount: 10,
  /** Name and count lines of activity labels. */
  nameLine: 14,
  countLine: 12,
} as const;

/**
 * The arrowhead rule: a closed triangle `length` long and `width` wide whose
 * tip lies `overhang` beyond the end of its path, outlined with a stroke of
 * `outline` in its own colour (0: none). These four are in a view box of
 * `box` units drawn at `size` user units, independent of the stroke width of
 * the path.
 */
export interface Arrowhead {
  size: number;
  box: number;
  length: number;
  width: number;
  overhang: number;
  outline: number;
}

/**
 * Arrowheads of the live map. Edges: the closed arrow of its edges, the
 * triangle (−5, ±4) with an outline of 1 in a view box of 20 drawn at 12, so
 * 3 long, 4.8 wide and outlined by 0.6. Overlays: arcs and self-loops, a
 * triangle 12 long and wide with its tip 1.2 beyond the path.
 */
export const arrowheadTokens = {
  edge: { size: 12, box: 20, length: 5, width: 8, overhang: 0, outline: 1 },
  overlay: { size: 12, box: 10, length: 10, width: 10, overhang: 1, outline: 0 },
} as const satisfies Record<string, Arrowhead>;

/** An arrowhead's triangle and outline in user units. */
export function arrowheadExtent(a: Arrowhead): { length: number; half: number; tip: number; outline: number } {
  const k = a.size / a.box;
  return { length: a.length * k, half: (a.width * k) / 2, tip: a.overhang * k, outline: a.outline * k };
}

export type PatternId =
  | "solid"
  | "diagonal"
  | "dots"
  | "crosshatch"
  | "horizontal"
  | "vertical"
  | "diagonal-reverse"
  | "grid";

/** Pattern twins in the order of the categorical palette. */
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
 * Pattern twins of the categorical colours: tiles of `size` with lines of
 * `strokeWidth` at `strokeOpacity`, or dots of `dotRadius` at `dotOpacity`,
 * in the ink colour. `patternTwin` gives the shape of each.
 */
export const patternTokens = {
  size: 6,
  strokeWidth: 1,
  strokeOpacity: 0.6,
  dotRadius: 1,
  dotOpacity: 0.7,
} as const;

/** Shape of a pattern twin in its tile: lines from (x1, y1) to (x2, y2) and dot centres. */
export interface PatternShape {
  size: number;
  lines: [number, number, number, number][];
  dots: [number, number][];
}

/** The one definition of every pattern twin; SVG, Canvas and React draw it. */
export function patternTwin(pattern: PatternId): PatternShape {
  const s = patternTokens.size;
  const h = s / 2;
  const rising: [number, number, number, number] = [0, s, s, 0];
  const falling: [number, number, number, number] = [0, 0, s, s];
  const across: [number, number, number, number] = [0, h, s, h];
  const down: [number, number, number, number] = [h, 0, h, s];
  const lines: Record<PatternId, [number, number, number, number][]> = {
    solid: [],
    diagonal: [rising],
    "diagonal-reverse": [falling],
    crosshatch: [rising, falling],
    horizontal: [across],
    vertical: [down],
    grid: [across, down],
    dots: [],
  };
  return { size: s, lines: lines[pattern] ?? [], dots: pattern === "dots" ? [[h, h]] : [] };
}

/** Hatching of out-of-scope elements: a diagonal of `width` in a tile of `size`, in the out-of-scope colour. */
export const hatchTokens = { size: 8, width: 2 } as const;

/** The table as one object. */
export const designTokens = {
  color: colorTokens,
  darkColor: darkColorTokens,
  palette: paletteTokens,
  font: fontTokens,
  nodeSize: nodeSizeTokens,
  size: sizeTokens,
  textSize: textSizeTokens,
  arrowhead: arrowheadTokens,
  pattern: patternTokens,
  hatch: hatchTokens,
} as const;

/** Colours with a CSS variable: the ones a stylesheet or the Canvas renderer reads. */
export const themedColors: readonly ColorToken[] = ["paper", "surface", "ink", "inkMuted", "line", "lineStrong", "focus", "onFocus", "selection", "hover", "neutral", "outOfScope", "warn", "fail"];

/** Name of the CSS variable of a colour token: `--wf-` and the name in kebab case. */
export function cssVariable(name: string): string {
  return `--wf-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

const px = (n: number) => `${n}px`;
const lower = (v: string) => (v.startsWith("#") ? v.toLowerCase() : v);
const cssFont = (v: string) => v.replace(/'/g, '"');

/** The CSS variables of `tokens.css`: all of them in the light scheme, the ones that change in the dark scheme. */
export function tokenVariables(): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {
    "--wf-font": cssFont(fontTokens.family),
    "--wf-font-mono": cssFont(fontTokens.mono),
  };
  for (const name of themedColors) light[cssVariable(name)] = lower(colorTokens[name]);
  light["--wf-radius"] = px(sizeTokens.radius);
  light["--wf-radius-lg"] = px(sizeTokens.radiusLarge);
  light["--wf-shadow"] = sizeTokens.shadow;
  light["--wf-node-width"] = px(nodeSizeTokens.activity.width);
  light["--wf-node-height"] = px(nodeSizeTokens.activity.height);
  for (const kind of ["stage", "gateway", "event", "note"] as const) {
    light[`--wf-${kind}-width`] = px(nodeSizeTokens[kind].width);
    light[`--wf-${kind}-height`] = px(nodeSizeTokens[kind].height);
  }
  const dark: Record<string, string> = {};
  for (const name of themedColors) {
    const v = darkColorTokens[name];
    if (v !== undefined) dark[cssVariable(name)] = lower(v);
  }
  return { light, dark };
}
