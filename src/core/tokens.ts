/** Design tokens: the one table of colours, sizes, fonts, arrowheads and pattern twins. It imports nothing, so tooling reads it alone. */

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
  /** Outlines that stand out: an activity's card. */
  lineStrong: "#8c94a1",
  /** The frequency cue's stripe behind an activity's texts: ink keeps 7 : 1 on it, the muted ink 4.5 : 1. */
  cueStripe: "#e6e8ec",
  /** The frequency cue's foot along an activity's bottom edge: 4.5 : 1 on the paper. */
  cueFoot: "#5f6672",
  /** Accent: focus, selection and hover outlines. */
  focus: "#0072b2",
  /** Text on the accent colour. */
  onFocus: "#ffffff",
  /** Background of a pressed toggle of the panels (outlined in `focus`). */
  pressed: "#0072b2",
  /** Text on a pressed toggle. */
  onPressed: "#ffffff",
  /** Ink of the pattern twins on the stage colours: 3 : 1 or more on each colour of the categorical palette. */
  patternInk: "#1f1f1f",
  selection: "rgba(0, 114, 178, 0.14)",
  hover: "rgba(0, 0, 0, 0.05)",
  neutral: "#8c8c8c",
  outOfScope: "#b0b0b0",
  /** Deviations: badges, chips, constraint arcs and their labels, the one hue of the map. Text in it reaches 4.5 : 1 on the paper. */
  accent: "#b84a00",
  /**
   * Paths from a start event and to an end event (`Scales.terminal`): pale,
   * a hairline-class role like `line`, never a measure's colour; their count
   * label and the events' glyphs carry their meaning.
   */
  terminal: "#c9ced6",
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
  cueStripe: "#2c3038",
  cueFoot: "#8f96a3",
  selection: "rgba(86, 180, 233, 0.22)",
  hover: "rgba(255, 255, 255, 0.07)",
  accent: "#ff8c42",
  /** Apart from the dark hairlines (1.32 : 1) and from the paper (2.22 : 1). */
  terminal: "#4b515b",
  /** Darker than the surface, so that no control of the dark scheme is lighter than the panels it sits on. */
  pressed: "#0b1f2e",
  onPressed: "#ececec",
  /** Dark on the stage colours, as in the light scheme: 3.64 : 1 or more on each. */
  patternInk: "#101114",
};

/**
 * Palettes. Sequential scales are single-hue and lightness-driven (safe for every
 * common colour-vision deficiency); the diverging scale is purple–orange; the
 * categorical palette is Okabe–Ito without its orange and vermilion, which
 * would read as the accent.
 */
export const paletteTokens = {
  /** Paths by cases in the light scheme: grey, darker with more cases; the lightest has 3.36 : 1 on the paper. */
  neutral: ["#8c8c8c", "#6b6b6b", "#4d4d4d", "#2e2e2e", "#141414"],
  /** Light to dark orange; used for expectation shortfall shares. */
  sequential: ["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"],
  /** Light to dark blue; used for performance metrics. */
  sequentialBlue: ["#f7fbff", "#c6dbef", "#6baed6", "#2171b5", "#08306b"],
  /** Purple (negative) over neutral to orange (positive); used for deltas. */
  diverging: ["#542788", "#998ec3", "#d8daeb", "#f7f7f7", "#fee0b6", "#f1a340", "#b35806"],
  /** Okabe–Ito without orange and vermilion, stable by hashed key, with pattern twins (`categoricalPatterns`). */
  categorical: ["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#F0E442", "#999999"],
} as const;

/** Palettes that the dark scheme changes. */
export const darkPaletteTokens = {
  /** Paths by cases in the dark scheme: grey, brighter with more cases; the dimmest has 3.73 : 1 on the dark paper. */
  neutral: ["#6e737d", "#8d929b", "#adb1b8", "#cfd2d6", "#f2f3f5"],
} as const;

export const fontTokens = {
  family: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Menlo, monospace",
} as const;

/** Default box of each node kind, in layout units. */
export const nodeSizeTokens = {
  activity: { width: 180, height: 64 },
  stage: { width: 200, height: 64 },
  gateway: { width: 44, height: 44 },
  event: { width: 36, height: 36 },
  note: { width: 160, height: 60 },
} as const;

/**
 * Text by role: size in layout units, weight, line height. Sizes are on the
 * scale 11, 13 and 15, weights 400, 500 and 600. Then the smallest text the
 * map draws on screen and in an exported figure (`readableAt`).
 */
export const textTokens = {
  /** @deprecated No longer read: an activity's card writes its name in `activityName`. */
  nodeLabel: { size: 13 },
  /** A stage node's name on its card. */
  stageLabel: { size: 13, weight: 600 },
  /** @deprecated No longer read: an activity's card writes its cases in `activityNumber`. */
  nodeCount: { size: 11 },
  eventLabel: { size: 11 },
  /** The ▶ of a start event and the ■ of an end event, in the middle of its circle. */
  eventGlyph: { size: 15, weight: 600 },
  gatewayGlyph: { size: 15, weight: 600 },
  noteLabel: { size: 11 },
  /** An activity's name on its card, on up to two lines. */
  activityName: { size: 13, weight: 500, lineHeight: 16 },
  /** The cases on a card's number line. */
  activityNumber: { size: 11, weight: 600, lineHeight: 14 },
  /** The share of all cases after them. */
  activityShare: { size: 11 },
  pathLabel: { size: 11 },
  groupLabel: { size: 13, weight: 600 },
  badge: { size: 11, weight: 600 },
  badgeValue: { size: 11 },
  chip: { size: 11 },
  chipLead: { size: 11, weight: 600 },
  arcLabel: { size: 11 },
  selfLoopLabel: { size: 11 },
  attribution: { size: 11 },
  legendTitle: { size: 13, weight: 600 },
  legendItem: { size: 11, weight: 600 },
  legendValue: { size: 11 },
  legendKey: { size: 11 },
  legendChip: { size: 11, weight: 600 },
  figureTitle: { size: 15, weight: 600 },
  figureText: { size: 11 },
  panel: { size: 13 },
  panelHeading: { size: 13, weight: 600 },
  panelTitle: { size: 13 },
  panelNote: { size: 11 },
  panelLabel: { size: 11, weight: 600 },
  panelKey: { size: 11 },
  panelSymbol: { size: 15 },
  panelPlain: { weight: 400 },
  tooltip: { size: 11 },
  activityTooltip: { size: 13 },
  timelineAxis: { size: 11 },
  timelineLabel: { size: 11 },
  timelineNote: { size: 11 },
  timelineMark: { size: 11 },
  comparisonValue: { size: 15 },
  comparisonNote: { size: 13 },
  comparisonDenominator: { size: 13, weight: 400 },
  comparisonTab: { weight: 600 },
  comparisonCaption: { weight: 600 },
  comparisonRowHeader: { weight: 500 },
  /**
   * The smallest text on the screen, in CSS pixels: at a zoom below one the
   * maps scale their texts up to it, and shed what no longer fits its card.
   */
  minScreenPx: 9,
  /**
   * The smallest text of an exported figure, in points at the width it is
   * declared to be printed at; 0 draws the figure as one picture scaled to
   * its width with every text at its size.
   */
  minFigurePt: 0,
} as const satisfies Record<string, number | { size?: number; weight?: number; lineHeight?: number }>;

/**
 * Corner radii by element, on the scale 4, 8 and full (`pill`, which a mark
 * resolves to half its height, and `circle`); `node` and `large` (groups,
 * panels) are `--wf-radius` and `--wf-radius-lg`.
 */
export const radiusTokens = {
  node: 4,
  large: 8,
  band: 4,
  swatch: 4,
  control: 4,
  tooltip: 4,
  key: 4,
  pill: 999,
  circle: "50%",
  filterChip: 999,
  legendGradient: 4,
  activityTooltip: 4,
  comparisonBar: 4,
  tint: 8,
  hatch: 4,
  chip: 999,
  canvasSelection: 8,
  timelineEvent: 4,
  timelineViolation: 8,
  /** The radius a path's bends are rounded to (0.5); 0: sharp bends. */
  bend: 0,
} as const;

/**
 * Stroke widths by element and state, in layout units, on the scale 1 and 2.
 * Not strokes of the scale: `pathMin` to `pathMax`, the range a path's width
 * encodes its cases in, `arcCoverage`, the width an arc adds for its coverage,
 * and `pathHit`, the width of a path the pointer hits, which is not drawn.
 */
export const strokeTokens = {
  node: 1,
  stage: 1,
  eventStart: 1,
  eventEnd: 2,
  gateway: 1,
  note: 1,
  focus: 2,
  selection: 2,
  canvasSelection: 2,
  group: 1,
  canvasGroupSelected: 2,
  band: 2,
  halo: 2,
  path: 1,
  pathMin: 1,
  pathMax: 8,
  canvasPathHighlight: 2,
  pathFocus: 2,
  pathHit: 14,
  /** The hairline from a path to a label the scene moved off its line (`EdgeMark.leader`, 0.5). */
  leader: 1,
  /**
   * How much thinner a path against the reading direction is drawn than its
   * cases give, while no activity it touches is selected (never under
   * `pathMin`); 0 draws it at its width.
   */
  backwardStep: 0,
  /** Every constraint arc, whatever its coverage. */
  arc: 1,
  /** Read by nothing: an arc's width no longer shows its coverage. */
  arcCoverage: 8,
  /** Outline of the pill an arc's label is written in. */
  pill: 1,
  selfLoop: 2,
  badge: 1,
  chip: 1,
  filterChip: 1,
  legendGradient: 1,
  tab: 2,
  /** The lines of the icons on the panels' buttons. */
  icon: 2,
  timelineSpan: 1,
  timelineViolation: 2,
  minimapNode: 2,
} as const;

/** The strokes of the table that are not drawn at a width of the scale (see `strokeTokens`). */
export const unscaledStrokes = ["pathMin", "pathMax", "arcCoverage", "pathHit", "backwardStep"] as const;

/**
 * Dash patterns by meaning, in layout units. A dash means "not directly
 * observed": the scene dashes only re-added paths and activities. `note`,
 * `constraint`, `group` and `reverseArc` are read by nothing.
 */
export const dashTokens = {
  reconnectedNode: [4, 3],
  reconnectedPath: [6, 5],
  /** Round dots, in stroke-width units, for opted-in flows added by the host. */
  addedFlow: [0, 3],
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
  /** Stage groups are outlined without a tint. */
  groupFill: 0,
  bandFill: 0.06,
  bandOddFill: 0.02,
  groupStroke: 0.5,
  /** A path against the reading direction while no activity it touches is selected (`strokeTokens.backwardStep`); 1 draws it as any path. */
  backward: 1,
  legendRule: 0.4,
  timelineGrid: 0.4,
} as const;

/** Spacing: multiples of `unit`; the stylesheet reads `--wf-space-<step>`. */
export const spaceTokens = { unit: 2, steps: [1, 1.5, 2, 3, 4, 5, 6, 8] } as const;

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
  /** An icon on a button of the panels. */
  icon: 16,
  /** A slider's track and its thumb. */
  sliderTrack: 4,
  sliderThumb: 16,
  backgroundGap: 24,
  /** Height of the frequency cue's foot along an activity's bottom edge. */
  cueFoot: 3,
  /** Width an event's label below its circle is shortened to. */
  eventLabel: 96,
  /** Width the statement under a start or an end event's label is shortened to (`StyleSpec.terminals`). */
  eventStatement: 160,
  /** The paper ring of an event on a vertical timeline (0.5), across, around its stage dot. */
  timelineRing: 20,
  /** A stage with no activity in the graph drawn as a divider, and as a narrow lane, across (`LaneOptions.emptyLanes`, 0.5). */
  laneDivider: 12,
  emptyLane: 36,
  /** The stage dot inside an event's ring on a vertical timeline (0.5), across. */
  timelineDot: 7,
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
  /** The deprecated count of a node (`nodeCount`); an event's label is `eventLabel`, of the same size. */
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
 * `box` units drawn at `size` user units. With `perWidth` the size grows with
 * the path it ends, to `perWidth` times its width (see `pathArrowhead`);
 * without it the size does not depend on the path.
 */
export interface Arrowhead {
  size: number;
  box: number;
  length: number;
  width: number;
  overhang: number;
  outline: number;
  perWidth?: number;
  /** The narrowest path that ends in a head: a thinner one ends on its route's end without one. Default 0, every path. */
  minWidth?: number;
}

/**
 * Arrowheads of the maps. Edges: a closed arrow, the triangle (−5, ±4) with
 * an outline of 1 in a view box of 20, drawn at 12 (3 long, 4.8 wide and
 * outlined by 0.6) and at 4 times the path's width where that is more, so
 * that the head stays 1.8 times as wide as its line; the line ends three
 * quarters of the head's length before its tip, inside the head, so that no
 * line wider than the tip shows past it. Overlays: arcs and self-loops, a
 * triangle 12 long and wide with its tip 1.2 beyond the path.
 */
export const arrowheadTokens = {
  edge: { size: 12, box: 20, length: 5, width: 8, overhang: 3.75, outline: 1, perWidth: 4 },
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

/** Every pattern twin; the SVG export and the maps define a tile for each. */
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
 * The pattern twin of each categorical colour, in the palette's order: each
 * colour keeps the twin it had before orange (diagonal) and vermilion
 * (vertical) left the palette, so no two colours share one.
 */
export const categoricalPatterns: PatternId[] = ["solid", "dots", "crosshatch", "horizontal", "diagonal-reverse", "grid"];

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

/** How pattern twins are drawn: `patternTokens`, or a theme's `pattern`. */
export type PatternLook = { readonly [K in keyof typeof patternTokens]: number };

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
export const hatchTokens = { size: 8, width: 1, domPeriod: 7 } as const;

/**
 * The smallest text and stroke a look may draw, in points at the figure's
 * output size (one layout unit is one CSS pixel, 0.75 pt). The default look's
 * are the smallest of its scales: text at 11 px and strokes of 1 px.
 */
export const minimumTokens = { text: 8.25, stroke: 0.75 } as const;

/**
 * How the maps keep their texts readable (`readableAt`). The smallest text
 * on the screen, in layout units, is rounded up to a ladder of rungs
 * `2^(1/steps)` apart, from `2^(first/steps)` to `2^(last/steps)` (4 to 128):
 * the interactive map writes one class as the floor moves a rung, and below
 * the last rung no text is drawn. A level, a kind of label or a rung that was
 * shed comes back only once the floor is `hysteresis` below where it went.
 * An activity's name is shown while a line holds its first `nameChars`
 * characters and the ellipsis after them.
 */
export const readableTokens = { steps: 8, first: 16, last: 56, hysteresis: 0.1, nameChars: 8, number: { padding: 0.5, height: 1.5, link: 1 / 12 } } as const;

/**
 * How a map opens and what it draws at a small zoom. A map opens fitted where
 * the whole map fits at `openingZoom` or more; otherwise it opens at
 * `openingZoom` on the start of the process, with an overview of the whole
 * map, `overview.width` wide and at most `overview.height` high (screen
 * pixels), in a corner no panel occupies. A path is drawn while its line is
 * at least `pathPx` of a screen pixel wide (its width on the width scale
 * times the zoom), so that at zoom `openingZoom` every path is drawn.
 */
export const viewTokens = { openingZoom: 0.75, pathPx: 0.5, overview: { width: 200, height: 120 } } as const;

/**
 * What a theme's rules may set, on the scales: a stroke weight of 1 or 2, a
 * radius of 4, 8 or full (half the shorter side of the box), an opacity from
 * 0.2 to 1 (a value outside is clamped), a text size up to 15 (from the
 * theme's minimum) and a weight of 400, 500 or 600.
 */
export const ruleTokens = {
  strokeWeight: { thin: 1, strong: 2 },
  radius: { s: 4, m: 8 },
  opacity: { min: 0.2, max: 1 },
  textMax: 15,
  weights: [400, 500, 600],
} as const;

/**
 * What the print theme changes in the table: white paper and surfaces, no
 * tints, a pattern twin on every categorical colour (five colours, five
 * patterns, none solid, each colour with the twin it had among seven) drawn opaque, ramps whose palest stop has 3 : 1 on the
 * paper (three greys, three oranges, three blues), and no text under 7 pt and
 * no stroke under 0.75 pt, in its tables and in an exported figure at its
 * declared width. It has no dark scheme.
 */
export const printTokens = {
  color: { paper: "#ffffff", surface: "#ffffff" },
  palette: {
    neutral: ["#8c8c8c", "#5c5c5c", "#2b2b2b"],
    shortfall: ["#e6550d", "#a63603", "#5a1c03"],
    performance: ["#3a7bbf", "#08519c", "#08306b"],
    categorical: ["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#F0E442"],
  },
  patterns: ["diagonal", "crosshatch", "horizontal", "vertical", "grid"],
  pattern: { strokeOpacity: 1, dotOpacity: 1 },
  opacity: { tint: 0, groupFill: 0, bandFill: 0, bandOddFill: 0 },
  minimum: { text: 7, stroke: 0.75 },
  text: { minFigurePt: 7 },
} as const satisfies Record<string, unknown> & { patterns: readonly PatternId[] };

/**
 * What the `instrument` theme changes in the table: an exact, quiet look of
 * ink on paper. Cards with corners of 8 and no frequency cue, a band of 6
 * only on an activity with a stage, one grey path ramp of four stops whose
 * palest has 3 : 1 on the paper (the paler grey draws the paths from a start
 * and to an end event, `terminal`), blues for the performance measure, the
 * categorical colours without yellow (each keeping its pattern twin), Inter
 * where the page has it, end events outlined as thin as start events, a lane's
 * rule 3 wide and tints of 3.5 and 1.9 %, heads whose base is twice their path's
 * width (a head of size s is 0.4 s wide: `perWidth` 5) and none on a path under 2, paths against the reading direction a step
 * thinner at 0.6, and in the dark scheme borders instead of shadows. Values
 * of the prompt that fail `checkTheme` are moved to the nearest that passes:
 * the ramps start at `#8c94a1` and `#6b747f`, the dark `lineStrong` is
 * `#5e6672` (3.07 : 1), and text on the dark accent is dark.
 */
export const instrumentTokens = {
  color: { paper: "#ffffff", surface: "#f7f8fa", ink: "#1a1d21", inkMuted: "#5c6470", line: "#d9dde3", lineStrong: "#8c94a1", focus: "#2456c4", selection: "rgba(36, 86, 196, 0.14)", neutral: "#8c94a1", terminal: "#c9ced6" },
  dark: { paper: "#15181c", surface: "#0f1114", ink: "#e6e9ee", inkMuted: "#9aa3ae", line: "#2a2f36", lineStrong: "#5e6672", focus: "#6ea0ff", onFocus: "#15181c", selection: "rgba(110, 160, 255, 0.22)", neutral: "#6b747f", terminal: "#3a4049" },
  palette: {
    neutral: ["#8c94a1", "#5f6873", "#3a4049", "#1a1d21"],
    performance: ["#cfe0f5", "#7fb0e0", "#2f6fb5", "#0b3d7a"],
    categorical: ["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#999999"],
  },
  darkPalette: {
    neutral: ["#6b747f", "#a3acb7", "#cfd2d6", "#e6e9ee"],
    performance: ["#1e3a5f", "#2f6fb5", "#7fb0e0", "#bcd7f5"],
  },
  patterns: ["solid", "dots", "crosshatch", "horizontal", "grid"],
  font: { family: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  radius: { node: 8, bend: 8 },
  size: { band: 6, darkShadow: "none" },
  stroke: { eventEnd: 1, band: 3, backwardStep: 1 },
  opacity: { bandFill: 0.035, bandOddFill: 0.019, backward: 0.6 },
  frequencyCue: "none",
  arrowhead: { edge: { ...arrowheadTokens.edge, perWidth: 5, minWidth: 2 } },
} as const satisfies Record<string, unknown> & { patterns: readonly PatternId[] };

/** The table as one object. */
export const designTokens = {
  color: colorTokens,
  darkColor: darkColorTokens,
  palette: paletteTokens,
  darkPalette: darkPaletteTokens,
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
  minimum: minimumTokens,
  readable: readableTokens,
  view: viewTokens,
  rule: ruleTokens,
  print: printTokens,
  instrument: instrumentTokens,
} as const;

/** Colours with a CSS variable: the ones a stylesheet or the Canvas renderer reads. */
export const themedColors: readonly ColorToken[] = ["paper", "surface", "ink", "inkMuted", "line", "lineStrong", "cueStripe", "cueFoot", "focus", "pressed", "onPressed", "patternInk", "selection", "hover", "neutral", "outOfScope", "warn", "fail"];

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
  text: "activityName activityNumber activityShare stageLabel groupLabel eventLabel pathLabel legendItem legendValue attribution panel panelHeading panelTitle panelNote panelLabel panelKey panelSymbol tooltip activityTooltip timelineAxis timelineLabel timelineNote comparisonValue comparisonNote comparisonDenominator",
  weight: "activityName activityNumber stageLabel groupLabel legendItem panelHeading panelLabel panelPlain comparisonTab comparisonCaption comparisonRowHeader comparisonDenominator",
  leading: "activityName activityNumber",
  radius: "band swatch control tooltip key pill filterChip legendGradient activityTooltip comparisonBar",
  stroke: "focus selection halo filterChip tab icon timelineViolation leader",
  dash: "timelineAnchor bpmnOutOfScope",
  opacity: "dimmed dimmedPath disabled",
  z: "comparisonRowHeader comparisonHeader comparisonCorner overlayPanel bpmnTable bpmnPanel sideList tooltip canvasTooltip bpmnNavigation menu activityTooltip",
  size: "band mapMinHeight viewMapMinHeight handle panelMaxWidth controlLabel controlOutput legendSwatchWidth legendSwatchHeight legendSample legendGlyph legendGradient searchMinWidth tableSwatch tooltipMaxWidth canvasTooltipMaxWidth activityTooltipMaxWidth bpmnTableTop watermarkClearance sideList menuMinWidth menuMaxWidth filterChipMinHeight zoomButtonWidth zoomButtonHeight cueFoot icon sliderTrack sliderThumb",
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
  const text = textTokens as unknown as Record<string, { size?: number | string; weight?: number; lineHeight?: number }>;
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
  // The scheme the browser draws the panels' native controls (sliders, check boxes, search fields, scroll bars) in.
  light["--wf-color-scheme"] = "light";
  const dark: Record<string, string> = { "--wf-color-scheme": "dark" };
  for (const name of themedColors) {
    const v = darkColorTokens[name];
    if (v !== undefined) dark[cssVariable(name)] = lower(v);
  }
  return { light, dark };
}
