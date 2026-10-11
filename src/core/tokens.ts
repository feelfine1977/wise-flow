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

/** Text by role: size in layout units (or a CSS length), weight, line height. */
export const textTokens = {
  nodeLabel: { size: 12 },
  stageLabel: { size: 12, weight: 600 },
  nodeCount: { size: 9 },
  eventLabel: { size: 9 },
  gatewayGlyph: { size: 14, weight: 700 },
  noteLabel: { size: 11 },
  activityName: { size: 14, weight: 500, lineHeight: 18 },
  activityNumber: { size: 12, lineHeight: 16 },
  pathLabel: { size: 10 },
  groupLabel: { size: 14, weight: 600 },
  badge: { size: 10, weight: 700 },
  badgeValue: { size: 10 },
  chip: { size: 10 },
  chipLead: { size: 10, weight: 700 },
  arcLabel: { size: 11 },
  selfLoopLabel: { size: 10 },
  attribution: { size: 9 },
  legendTitle: { size: 13, weight: 700 },
  legendItem: { size: 11, weight: 600 },
  legendValue: { size: 10 },
  legendKey: { size: 9.5 },
  legendChip: { size: 10, weight: 600 },
  figureTitle: { size: 18, weight: 700 },
  figureText: { size: 11 },
  panel: { size: 12 },
  panelHeading: { size: 12, weight: 700 },
  panelTitle: { size: 13 },
  panelNote: { size: 11 },
  panelLabel: { size: 10, weight: 700 },
  panelKey: { size: 10 },
  panelSymbol: { size: 14 },
  panelPlain: { weight: 400 },
  tooltip: { size: 11 },
  activityTooltip: { size: 13 },
  timelineAxis: { size: 10 },
  timelineLabel: { size: 11 },
  timelineNote: { size: 10 },
  timelineMark: { size: 8 },
  comparisonValue: { size: 14 },
  comparisonNote: { size: "0.875rem" },
  comparisonDenominator: { size: "0.8rem", weight: 400 },
  comparisonTab: { weight: 600 },
  comparisonCaption: { weight: 600 },
  comparisonRowHeader: { weight: 500 },
} as const satisfies Record<string, { size?: number | string; weight?: number; lineHeight?: number }>;

/** Corner radii by element; `node` and `large` (groups, panels) are `--wf-radius` and `--wf-radius-lg`. */
export const radiusTokens = {
  node: 6,
  large: 10,
  band: 3,
  swatch: 2,
  control: 4,
  tooltip: 4,
  key: 3,
  pill: 999,
  circle: "50%",
  filterChip: 12,
  legendGradient: 3,
  activityTooltip: 6,
  comparisonBar: 2,
  tint: 10,
  hatch: 6,
  chip: 12,
  canvasSelection: 8,
  timelineEvent: 5,
  timelineViolation: 6.5,
} as const;

/** Stroke widths by element and state, in layout units. */
export const strokeTokens = {
  node: 2,
  stage: 3,
  eventStart: 2,
  eventEnd: 3,
  gateway: 1.5,
  note: 2,
  focus: 2,
  selection: 3,
  canvasSelection: 6,
  group: 1.5,
  canvasGroupSelected: 2.5,
  band: 3,
  halo: 3,
  path: 1.5,
  pathMin: 1,
  pathMax: 8,
  canvasPathHighlight: 2.5,
  pathFocus: 3,
  pathHit: 14,
  arc: 2,
  arcCoverage: 8,
  selfLoop: 2.5,
  badge: 1.5,
  chip: 2,
  filterChip: 2,
  legendGradient: 0.5,
  tab: 3,
  timelineSpan: 1.5,
  timelineViolation: 2,
  minimapNode: 2,
} as const;

/** Dash patterns by meaning, in layout units. */
export const dashTokens = {
  reconnectedNode: [4, 3],
  reconnectedPath: [6, 5],
  note: [2, 3],
  constraint: [2, 4],
  group: [6, 4],
  reverseArc: [6, 4],
  timelineAnchor: [4, 3],
  bpmnOutOfScope: [4, 3],
} as const;

/** Opacities by element and state. */
export const opacityTokens = {
  dimmed: 0.35,
  dimmedPath: 0.25,
  disabled: 0.45,
  tint: 0.18,
  hatch: 0.55,
  arc: 0.9,
  groupFill: 0.06,
  bandFill: 0.06,
  bandOddFill: 0.02,
  groupStroke: 0.5,
  legendRule: 0.4,
  timelineGrid: 0.4,
} as const;

/** Spacing: multiples of `unit`; the stylesheet reads `--wf-space-<step>`. */
export const spaceTokens = { unit: 2, steps: [1, 1.5, 2, 3, 4, 5, 6, 7, 8] } as const;

/** Stacking order of the map's elements and of the layers above the map. */
export const zTokens = {
  pathHovered: 5,
  activityLabels: 10,
  comparisonRowHeader: 1,
  comparisonHeader: 2,
  comparisonCorner: 3,
  overlayPanel: 5,
  bpmnTable: 5,
  bpmnPanel: 6,
  sideList: 6,
  tooltip: 10,
  canvasTooltip: 10,
  bpmnNavigation: 15,
  menu: 30,
  activityTooltip: 1000,
  marksAbove: 1001,
} as const;

/** Fixed sizes of controls, panels and legend samples, in layout units. */
export const dimensionTokens = {
  band: 8,
  mapMinHeight: 320,
  viewMapMinHeight: 240,
  handle: 6,
  panelMaxWidth: 260,
  controlLabel: 70,
  controlOutput: 42,
  legendSwatchWidth: 14,
  legendSwatchHeight: 12,
  legendSample: 28,
  legendSampleExport: 40,
  legendGlyph: 18,
  legendGradient: 10,
  searchMinWidth: 240,
  tableSwatch: 10,
  tooltipMaxWidth: 280,
  canvasTooltipMaxWidth: 320,
  activityTooltipMaxWidth: 320,
  bpmnTableTop: 56,
  watermarkClearance: 48,
  sideList: 380,
  menuMinWidth: 260,
  menuMaxWidth: 340,
  filterChipMinHeight: 24,
  zoomButtonWidth: 28,
  zoomButtonHeight: 26,
  backgroundGap: 24,
} as const;

/** Sizes of the node and edge marks, in layout units. */
export const sizeTokens = {
  /** Corner radius of nodes. */
  radius: radiusTokens.node,
  /** Corner radius of groups and panels. */
  radiusLarge: radiusTokens.large,
  /** Width of the colour band along a node's left edge. */
  band: dimensionTokens.band,
  shadow: "0 1px 2px rgba(0, 0, 0, 0.12)",
  shadowMenu: "0 6px 24px rgba(0, 0, 0, 0.18)",
} as const;

/** Font sizes of the node and edge texts, in layout units (the sizes of their roles in `textTokens`). */
export const textSizeTokens = {
  label: textTokens.nodeLabel.size,
  glyph: textTokens.gatewayGlyph.size,
  /** Label inside an event circle and the count of a node. */
  small: textTokens.nodeCount.size,
  note: textTokens.noteLabel.size,
  edgeCount: textTokens.pathLabel.size,
  nameLine: textTokens.activityName.size,
  countLine: textTokens.activityNumber.size,
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
interface PatternShape {
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

/**
 * Hatching of out-of-scope elements: a diagonal of `width` in a tile of
 * `size`, in the out-of-scope colour; the live map's elements stripe their
 * background with the same width every `domPeriod`.
 */
export const hatchTokens = { size: 8, width: 2, domPeriod: 7 } as const;

/** The table as one object. */
export const designTokens = {
  color: colorTokens,
  darkColor: darkColorTokens,
  palette: paletteTokens,
  font: fontTokens,
  nodeSize: nodeSizeTokens,
  size: sizeTokens,
  textSize: textSizeTokens,
  text: textTokens,
  radius: radiusTokens,
  stroke: strokeTokens,
  dash: dashTokens,
  opacity: opacityTokens,
  space: spaceTokens,
  z: zTokens,
  dimension: dimensionTokens,
  arrowhead: arrowheadTokens,
  pattern: patternTokens,
  hatch: hatchTokens,
} as const;

/** Colours with a CSS variable: the ones a stylesheet or the Canvas renderer reads. */
export const themedColors: readonly ColorToken[] = ["paper", "surface", "ink", "inkMuted", "line", "lineStrong", "focus", "onFocus", "selection", "hover", "neutral", "outOfScope", "warn", "fail"];

/** Name of the CSS variable of a colour token: `--wf-` and the name in kebab case. */
export function cssVariable(name: string): string {
  return `--wf-${kebab(name)}`;
}

const px = (n: number | string) => (typeof n === "number" ? `${n}px` : n);
const lower = (v: string) => (v.startsWith("#") ? v.toLowerCase() : v);
const cssFont = (v: string) => v.replace(/'/g, '"');
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The words of a space-separated list. */
type Words<S extends string, A = never> = S extends `${infer H} ${infer T}` ? Words<T, A | H> : A | S;
/** The text roles that set `K`. */
type TextWith<K extends string> = { [R in keyof typeof textTokens]: (typeof textTokens)[R] extends Record<K, unknown> ? R : never }[keyof typeof textTokens];
/** The roles each prefix may list. */
type StyledRoles = {
  text: TextWith<"size">;
  weight: TextWith<"weight">;
  leading: TextWith<"lineHeight">;
  radius: keyof typeof radiusTokens;
  stroke: keyof typeof strokeTokens;
  dash: keyof typeof dashTokens;
  opacity: keyof typeof opacityTokens;
  z: keyof typeof zTokens;
  size: keyof typeof dimensionTokens;
};
/** `T` where every list names roles of its table; a list with another word is `never` and fails to compile. */
type Listed<T extends Record<keyof StyledRoles, string>> = { [P in keyof StyledRoles]: [Words<T[P]>] extends [StyledRoles[P]] ? T[P] : never };

/** The roles the stylesheet reads, by variable prefix. */
const styledRoles = {
  text: "pathLabel legendItem legendValue attribution panel panelHeading panelTitle panelNote panelLabel panelKey panelSymbol tooltip activityTooltip timelineAxis timelineLabel timelineNote comparisonValue comparisonNote comparisonDenominator",
  weight: "legendItem panelHeading panelLabel panelPlain comparisonTab comparisonCaption comparisonRowHeader comparisonDenominator",
  leading: "activityName activityNumber",
  radius: "band swatch control tooltip key pill filterChip legendGradient activityTooltip comparisonBar",
  stroke: "focus selection halo filterChip tab timelineViolation",
  dash: "timelineAnchor bpmnOutOfScope",
  opacity: "dimmed dimmedPath disabled",
  z: "comparisonRowHeader comparisonHeader comparisonCorner overlayPanel bpmnTable bpmnPanel sideList tooltip canvasTooltip bpmnNavigation menu activityTooltip",
  size: "mapMinHeight viewMapMinHeight handle panelMaxWidth controlLabel controlOutput legendSwatchWidth legendSwatchHeight legendSample legendGlyph legendGradient searchMinWidth tableSwatch tooltipMaxWidth canvasTooltipMaxWidth activityTooltipMaxWidth bpmnTableTop watermarkClearance sideList menuMinWidth menuMaxWidth filterChipMinHeight zoomButtonWidth zoomButtonHeight",
} as const;

/** The CSS variables of `tokens.css`: all of them in the light scheme, the ones that change in the dark scheme. */
export function tokenVariables(): { light: Record<string, string>; dark: Record<string, string> } {
  const light: Record<string, string> = {
    "--wf-font": cssFont(fontTokens.family),
    "--wf-font-mono": cssFont(fontTokens.mono),
  };
  for (const name of themedColors) light[cssVariable(name)] = lower(colorTokens[name]);
  light["--wf-radius"] = px(radiusTokens.node);
  light["--wf-radius-lg"] = px(radiusTokens.large);
  light["--wf-shadow"] = sizeTokens.shadow;
  light["--wf-shadow-menu"] = sizeTokens.shadowMenu;
  light["--wf-node-width"] = px(nodeSizeTokens.activity.width);
  light["--wf-node-height"] = px(nodeSizeTokens.activity.height);
  for (const kind of ["stage", "gateway", "event", "note"] as const) {
    light[`--wf-${kind}-width`] = px(nodeSizeTokens[kind].width);
    light[`--wf-${kind}-height`] = px(nodeSizeTokens[kind].height);
  }
  const text = textTokens as Record<string, { size?: number | string; weight?: number; lineHeight?: number }>;
  const tables: Record<keyof typeof styledRoles, (role: string) => string> = {
    text: (r) => px(text[r].size!),
    weight: (r) => String(text[r].weight),
    leading: (r) => px(text[r].lineHeight!),
    radius: (r) => px(radiusTokens[r as keyof typeof radiusTokens]),
    stroke: (r) => px(strokeTokens[r as keyof typeof strokeTokens]),
    dash: (r) => dashTokens[r as keyof typeof dashTokens].join(" "),
    opacity: (r) => String(opacityTokens[r as keyof typeof opacityTokens]),
    z: (r) => String(zTokens[r as keyof typeof zTokens]),
    size: (r) => px(dimensionTokens[r as keyof typeof dimensionTokens]),
  };
  for (const [prefix, value] of Object.entries(tables)) {
    for (const role of (styledRoles satisfies Listed<typeof styledRoles>)[prefix as keyof typeof styledRoles].split(" ")) light[`--wf-${prefix}-${kebab(role)}`] = value(role);
  }
  for (const step of spaceTokens.steps) light[`--wf-space-${String(step).replace(".", "-")}`] = px(step * spaceTokens.unit);
  const dark: Record<string, string> = {};
  for (const name of themedColors) {
    const v = darkColorTokens[name];
    if (v !== undefined) dark[cssVariable(name)] = lower(v);
  }
  return { light, dark };
}
