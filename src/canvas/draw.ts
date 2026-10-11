/**
 * Drawing routines of the canvas renderer, and the text measure of a browser
 * (`canvasTextMeasure`). They take the retained scene, a viewport and the
 * interaction state and issue plain 2D context calls, so
 * that they run on a screen canvas, an offscreen canvas (PNG export) and on
 * a recording stub in tests. When the scene is large, only the elements the
 * scene's R-tree finds in the viewport are read, in the order of a full draw.
 */
import { type Arrowhead, type Box, type BoxSide, type EdgeBudget, type EdgeSelection, type HitItem, type MarkPaint, type MarkText, type OverlayMark, type PatternId, type PatternLook, type Selection, type ShownEdges, type TextMeasure, type Theme, arrowheadExtent, arrowheadTokens, dimensionTokens, fixedColors, hatchTokens, legendLayout, legendMetrics, budgetEdges, defaultTheme, estimateTextWidth, lodAt, markArrowhead, patternTwin } from "../core/index.js";
import type { PreparedScene, SceneEdge, SceneGroup, SceneNode } from "./scene.js";
import { type CanvasTokens, sceneTokens } from "./tokens.js";

/** The subset of the 2D context the renderer uses (stubbed in Node tests). */
export interface DrawContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setLineDash(segments: number[]): void;
  createPattern?(image: CanvasImageSource, repetition: string | null): CanvasPattern | null;
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
}

export interface View {
  /** Screen = flow x zoom + offset, as React Flow's viewport. */
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
}

export interface DrawState {
  selection: Selection;
  hovered?: string | null;
  focused?: string | null;
  /** When present, nodes and edges outside these sets are dimmed. */
  bright?: { nodes: Set<string>; edges: Set<string> };
  /** Edges on a highlighted path; drawn under any edge budget. */
  highlighted?: ReadonlySet<string>;
}

export interface DrawOptions {
  /** Colours and font. Default: the scene's (`sceneTokens`). */
  tokens?: CanvasTokens;
  /** Cull by viewport through the R-tree. Default: when the scene has more than 1,500 elements. */
  cull?: boolean;
  /** Fill the background with the paper colour (or a given colour). Default true. */
  background?: boolean | string;
  /** Zoom at which the level of detail is decided. Default: the view's zoom. */
  lodZoom?: number;
  /** Factory for pattern tiles; `document.createElement("canvas")` when available. */
  createCanvas?: (width: number, height: number) => { getContext(kind: "2d"): unknown } | null;
  /** How many of the edges in view are drawn (`budgetEdges`), or which (those a map reported). Default `"all"`. */
  edgeBudget?: EdgeBudget | ShownEdges;
}

export const emptyState: DrawState = { selection: { nodes: [], edges: [], groups: [] } };

const CULL_ABOVE = 1500;

/** The CSS font of a text role, or of a size and weight. */
export const fontOf = (role: { size: number; weight?: number }, family: string) => `${role.weight ? `${role.weight} ` : ""}${role.size}px ${family}`;

/**
 * A text measure backed by Canvas `measureText` in `family` (default the
 * default theme's font). Widths are kept per font and text. Without a context
 * (no document, or a canvas without 2D) it is `estimateTextWidth`. Create it
 * once the page's fonts have loaded (`document.fonts.ready`), or widths are
 * those of a fallback font.
 */
export function canvasTextMeasure(family: string = defaultTheme.font.family, context?: Pick<DrawContext, "font" | "measureText"> | null): TextMeasure {
  const ctx = context ?? (typeof document === "undefined" ? null : (document.createElement("canvas").getContext("2d") as DrawContext | null));
  if (!ctx) return estimateTextWidth;
  const widths = new Map<string, number>();
  return (text, font) => {
    const css = fontOf(font, family);
    const key = `${css}\n${text}`;
    let width = widths.get(key);
    if (width === undefined) {
      ctx.font = css;
      widths.set(key, (width = ctx.measureText(text).width));
    }
    return width;
  };
}

/** An opacity as the two hex digits of an alpha channel. */
const alpha = (opacity: number) => Math.round(opacity * 255).toString(16).padStart(2, "0");

function roundedRect(ctx: DrawContext, b: Box, r: number) {
  const radius = Math.max(0, Math.min(r, b.width / 2, b.height / 2));
  ctx.beginPath();
  ctx.moveTo(b.x + radius, b.y);
  ctx.lineTo(b.x + b.width - radius, b.y);
  ctx.arc(b.x + b.width - radius, b.y + radius, radius, -Math.PI / 2, 0);
  ctx.lineTo(b.x + b.width, b.y + b.height - radius);
  ctx.arc(b.x + b.width - radius, b.y + b.height - radius, radius, 0, Math.PI / 2);
  ctx.lineTo(b.x + radius, b.y + b.height);
  ctx.arc(b.x + radius, b.y + b.height - radius, radius, Math.PI / 2, Math.PI);
  ctx.lineTo(b.x, b.y + radius);
  ctx.arc(b.x + radius, b.y + radius, radius, Math.PI, 1.5 * Math.PI);
  ctx.closePath();
}

/** Trace an SVG path string with M, L, C and Z commands (the overlay geometry uses these). */
export function tracePath(ctx: DrawContext, d: string): { last?: [number, number]; beforeLast?: [number, number] } {
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let last: [number, number] | undefined;
  let beforeLast: [number, number] | undefined;
  const num = () => Number(tokens[i++]);
  ctx.beginPath();
  while (i < tokens.length) {
    const tk = tokens[i];
    if (/[MLCZmlcz]/.test(tk)) {
      cmd = tk.toUpperCase();
      i++;
      if (cmd === "Z") ctx.closePath();
      continue;
    }
    if (cmd === "M") {
      const x = num();
      const y = num();
      ctx.moveTo(x, y);
      beforeLast = last;
      last = [x, y];
      cmd = "L";
    } else if (cmd === "L") {
      const x = num();
      const y = num();
      ctx.lineTo(x, y);
      beforeLast = last;
      last = [x, y];
    } else if (cmd === "C") {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      ctx.bezierCurveTo(x1, y1, x2, y2, x, y);
      beforeLast = [x2, y2];
      last = [x, y];
    } else {
      i++;
    }
  }
  return { last, beforeLast };
}

/** The arrowhead rule (`Arrowhead`) at the end of the segment `from` → `end`, filled and outlined in `color`. */
function arrowhead(ctx: DrawContext, from: [number, number], end: [number, number], a: Arrowhead, color: string) {
  const dx = end[0] - from[0];
  const dy = end[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  const { length, half, tip, outline } = arrowheadExtent(a);
  const to = tip ? [end[0] + ux * tip, end[1] + uy * tip] : end;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - ux * length - uy * half, to[1] - uy * length + ux * half);
  ctx.lineTo(to[0] - ux * length + uy * half, to[1] - uy * length - ux * half);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = color;
    ctx.lineWidth = outline;
    ctx.lineJoin = "round";
    ctx.stroke();
  }
}

function haloText(ctx: DrawContext, text: string, x: number, y: number, tokens: CanvasTokens, theme: Theme) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = tokens.paper;
  ctx.lineWidth = theme.stroke.halo;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

const patternCache = new WeakMap<object, Map<string, CanvasPattern | null>>();

function tileFactory(options: DrawOptions) {
  return options.createCanvas ?? (typeof document !== "undefined" ? (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h }) : undefined);
}

function cacheOf(ctx: DrawContext): Map<string, CanvasPattern | null> {
  let cache = patternCache.get(ctx as object);
  if (!cache) {
    cache = new Map();
    patternCache.set(ctx as object, cache);
  }
  return cache;
}

/** Tile of a pattern twin (`patternTwin`) in the ink colour, drawn as `look` says (the theme's `pattern`). */
function patternFor(ctx: DrawContext, pattern: PatternId, ink: string, look: PatternLook, options: DrawOptions): CanvasPattern | null {
  if (pattern === "solid" || !ctx.createPattern) return null;
  const cache = cacheOf(ctx);
  const key = `${pattern}:${ink}:${Object.values(look)}`;
  if (cache.has(key)) return cache.get(key)!;
  const shape = patternTwin(pattern);
  const tile = tileFactory(options)?.(shape.size, shape.size);
  const tc = tile?.getContext("2d") as DrawContext | null | undefined;
  if (!tc) {
    cache.set(key, null);
    return null;
  }
  tc.strokeStyle = ink;
  tc.fillStyle = ink;
  tc.lineWidth = look.strokeWidth;
  if (shape.lines.length) {
    tc.globalAlpha = look.strokeOpacity;
    tc.beginPath();
    for (const [x1, y1, x2, y2] of shape.lines) {
      tc.moveTo(x1, y1);
      tc.lineTo(x2, y2);
    }
    tc.stroke();
  }
  if (shape.dots.length) {
    tc.globalAlpha = look.dotOpacity;
    tc.beginPath();
    for (const [cx, cy] of shape.dots) {
      tc.moveTo(cx + look.dotRadius, cy);
      tc.arc(cx, cy, look.dotRadius, 0, 2 * Math.PI);
    }
    tc.fill();
  }
  const out = ctx.createPattern(tile as unknown as CanvasImageSource, "repeat");
  cache.set(key, out);
  return out;
}

/** Tile of the out-of-scope hatching (`hatchTokens`). */
function hatchPattern(ctx: DrawContext, tokens: CanvasTokens, options: DrawOptions): CanvasPattern | null {
  if (!ctx.createPattern) return null;
  const cache = cacheOf(ctx);
  const key = `hatch:${tokens.outOfScope}`;
  if (cache.has(key)) return cache.get(key)!;
  const s = hatchTokens.size;
  const tile = tileFactory(options)?.(s, s);
  const tc = tile?.getContext("2d") as DrawContext | null | undefined;
  if (!tc) {
    cache.set(key, null);
    return null;
  }
  tc.strokeStyle = tokens.outOfScope;
  tc.lineWidth = hatchTokens.width;
  tc.beginPath();
  tc.moveTo(0, s);
  tc.lineTo(s, 0);
  tc.stroke();
  const out = ctx.createPattern(tile as unknown as CanvasImageSource, "repeat");
  cache.set(key, out);
  return out;
}

/** Write a mark text in `color`, as the scene fitted it; a lead is written bold before it. */
function drawText(ctx: DrawContext, scene: PreparedScene, tx: MarkText, color: string, tokens: CanvasTokens) {
  const font = (weight?: number) => fontOf({ size: tx.size, weight }, tokens.font);
  ctx.fillStyle = color;
  ctx.font = font(tx.weight);
  ctx.textAlign = tx.anchor === "start" ? "left" : tx.anchor === "end" ? "right" : "center";
  ctx.textBaseline = tx.baseline;
  const { lead, text } = tx;
  let x = tx.x;
  if (lead) {
    ctx.font = font(scene.theme.text.chipLead.weight);
    if (tx.halo) haloText(ctx, lead, x, tx.y, tokens, scene.theme);
    else ctx.fillText(lead, x, tx.y);
    x += ctx.measureText(lead).width;
    if (!text) return;
    ctx.font = font(tx.weight);
  }
  if (tx.halo) haloText(ctx, text, x, tx.y, tokens, scene.theme);
  else ctx.fillText(text, x, tx.y);
}

function visibleBox(view: View): Box {
  return { x: -view.x / view.zoom, y: -view.y / view.zoom, width: view.width / view.zoom, height: view.height / view.zoom };
}

/** The two ends of a side of a box. */
function side(ctx: DrawContext, b: Box, which: BoxSide) {
  const [x1, y1] = which === "right" ? [b.x + b.width, b.y] : which === "bottom" ? [b.x, b.y + b.height] : [b.x, b.y];
  ctx.moveTo(x1, y1);
  if (which === "top" || which === "bottom") ctx.lineTo(x1 + b.width, y1);
  else ctx.lineTo(x1, y1 + b.height);
}

/** A colour at an opacity: a hex colour with its alpha appended. */
const withAlpha = (color: string, opacity = 1) => (opacity === 1 ? color : `${color}${alpha(opacity)}`);

function drawGroup(ctx: DrawContext, scene: PreparedScene, g: SceneGroup, tokens: CanvasTokens, selected: boolean) {
  const { stroke: strokeTokens } = scene.theme;
  const m = g.mark;
  const b = m.box;
  const { stroke, rule } = m;
  const paint = (p: MarkPaint) => paintOf(m, p, tokens);
  if (stroke.sides) {
    ctx.fillStyle = withAlpha(paint(m.fill.paint), m.fill.opacity);
    ctx.fillRect(b.x, b.y, b.width, b.height);
    ctx.strokeStyle = paint(stroke.paint);
    ctx.lineWidth = stroke.width;
    ctx.setLineDash(stroke.dash ?? []);
    ctx.beginPath();
    for (const s of stroke.sides) side(ctx, b, s);
    ctx.stroke();
  } else {
    roundedRect(ctx, b, m.radius);
    ctx.fillStyle = withAlpha(paint(m.fill.paint), m.fill.opacity);
    ctx.fill();
    ctx.strokeStyle = selected ? tokens.focus : paint(stroke.paint);
    ctx.lineWidth = selected ? strokeTokens.canvasGroupSelected : stroke.width;
    ctx.setLineDash(stroke.dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (rule) {
    ctx.beginPath();
    ctx.strokeStyle = paint(rule.paint);
    ctx.lineWidth = rule.width;
    side(ctx, b, rule.side);
    ctx.stroke();
  }
  if (stroke.sides && selected) {
    ctx.strokeStyle = tokens.focus;
    ctx.lineWidth = strokeTokens.canvasGroupSelected;
    ctx.beginPath();
    ctx.rect(b.x + 1, b.y + 1, b.width - 2, b.height - 2);
    ctx.stroke();
  }
  for (const tx of m.texts) drawText(ctx, scene, tx, paintOf(m, tx.paint, tokens), tokens);
}

function drawEdge(ctx: DrawContext, e: SceneEdge, tokens: CanvasTokens, theme: Theme, highlighted: boolean, dimmed: boolean) {
  const m = e.mark;
  const pts = m.points;
  if (pts.length < 2) return;
  ctx.globalAlpha = dimmed ? theme.opacity.dimmedPath : 1;
  const color = highlighted ? tokens.focus : m.color;
  ctx.strokeStyle = color;
  ctx.lineWidth = highlighted ? Math.max(m.width, theme.stroke.canvasPathHighlight) : m.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  ctx.setLineDash(m.dash ?? []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  arrowhead(ctx, [a.x, a.y], [b.x, b.y], arrowheadTokens.edge, color);
  ctx.globalAlpha = 1;
}

function drawNode(ctx: DrawContext, scene: PreparedScene, n: SceneNode, tokens: CanvasTokens, state: DrawState, lod: ReturnType<typeof lodAt>, options: DrawOptions) {
  const { stroke: strokeTokens, radius: radiusTokens } = scene.theme;
  const m = n.mark;
  const b = m.box;
  const id = m.id;
  const selected = state.selection.nodes.includes(id);
  const focused = state.focused === id;
  const hovered = state.hovered === id;
  const dimmed = !n.activityLines && !!state.bright && !state.bright.nodes.has(id);
  ctx.globalAlpha = dimmed ? scene.theme.opacity.dimmed : 1;
  ctx.setLineDash(m.stroke.dash ?? []);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  if (m.shape === "circle") {
    ctx.beginPath();
    ctx.arc(cx, cy, m.radius, 0, 2 * Math.PI);
  } else if (m.shape === "diamond") {
    const h = b.width / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - h, cy);
    ctx.closePath();
  } else {
    roundedRect(ctx, b, m.radius);
  }
  // Hover, selection and focus change the outline, never the fill.
  ctx.fillStyle = paintOf(m, m.fill, tokens);
  ctx.fill();
  ctx.strokeStyle = selected || focused ? tokens.focus : hovered ? tokens.ink : paintOf(m, m.stroke.paint, tokens);
  ctx.lineWidth = m.stroke.width;
  ctx.stroke();
  ctx.setLineDash([]);
  // The frequency cue lies inside the outline and under the band and the texts.
  for (const part of [m.cue?.stripe, m.cue?.foot]) {
    if (!part) continue;
    ctx.fillStyle = paintOf(m, part.paint, tokens);
    ctx.fillRect(part.box.x, part.box.y, part.box.width, part.box.height);
  }
  if (m.band) {
    ctx.fillStyle = m.color;
    ctx.fillRect(b.x, b.y, m.band, b.height);
    const pattern = patternFor(ctx, m.pattern, tokens.ink, scene.theme.pattern, options);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(b.x, b.y, m.band, b.height);
    }
  }
  for (const tx of m.texts) if (!tx.lod || lod[tx.lod]) drawText(ctx, scene, tx, paintOf(m, tx.paint, tokens), tokens);
  if (selected) {
    // The ring's inner edge lies on the element: its centre line is half its width outside.
    const out = strokeTokens.canvasSelection / 2;
    ctx.strokeStyle = tokens.selection;
    ctx.lineWidth = strokeTokens.canvasSelection;
    ctx.setLineDash([]);
    if (n.node.kind === "event") {
      ctx.beginPath();
      ctx.arc(b.x + b.width / 2, b.y + b.height / 2, Math.min(b.width, b.height) / 2 + out, 0, 2 * Math.PI);
    } else {
      roundedRect(ctx, { x: b.x - out, y: b.y - out, width: b.width + 2 * out, height: b.height + 2 * out }, radiusTokens.canvasSelection);
    }
    ctx.stroke();
  }
  if (focused) {
    ctx.strokeStyle = tokens.focus;
    ctx.lineWidth = strokeTokens.focus;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Colour of a mark's paint; a hovered mark shows its value in the focus colour. */
function paintOf(mark: { color: string; onColor?: string }, paint: MarkPaint, tokens: CanvasTokens, hovered = false): string {
  if (paint === "value") return hovered ? tokens.focus : mark.color;
  if (paint === "onValue") return hovered ? fixedColors.paper : (mark.onColor ?? mark.color);
  return tokens[paint]!;
}

function drawMark(ctx: DrawContext, scene: PreparedScene, m: OverlayMark, tokens: CanvasTokens, hovered: boolean, options: DrawOptions) {
  // The pattern tile is drawn before the path is traced.
  const fill = m.fill && ((m.fill.pattern && hatchPattern(ctx, tokens, options)) || paintOf(m, m.fill.paint, tokens, hovered));
  const end = m.path !== undefined ? tracePath(ctx, m.path) : (roundedRect(ctx, m.box, m.radius), undefined);
  if (m.fill && fill) {
    ctx.fillStyle = fill;
    ctx.globalAlpha = m.fill.opacity ?? 1;
    ctx.fill();
  }
  if (m.stroke) {
    const color = paintOf(m, m.stroke.paint, tokens, hovered);
    ctx.strokeStyle = color;
    ctx.lineWidth = m.stroke.width;
    ctx.globalAlpha = m.stroke.opacity ?? 1;
    ctx.setLineDash(m.stroke.dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
    if (m.arrow && end?.last && end.beforeLast) arrowhead(ctx, end.beforeLast, end.last, markArrowhead(m.arrow), color);
  }
  ctx.globalAlpha = 1;
  if (m.gauge) {
    const g = m.gauge;
    roundedRect(ctx, g, g.height / 2);
    ctx.fillStyle = paintOf(m, "line", tokens, hovered);
    ctx.fill();
    ctx.fillStyle = paintOf(m, "value", tokens, hovered);
    if (g.value > 0) ctx.fillRect(g.x, g.y, g.value * g.width, g.height);
    ctx.fillStyle = paintOf(m, "ink", tokens, hovered);
    ctx.fillRect(g.x + g.threshold * g.width - 1, g.y - 1, 2, g.height + 2);
  }
  for (const tx of m.texts) drawText(ctx, scene, tx, paintOf(m, tx.paint, tokens, hovered), tokens);
}

const RANK: Record<HitItem["kind"], number> = { group: 0, overlay: 1, edge: 2, node: 3 };
const drawingOrder = (a: HitItem, b: HitItem) => RANK[a.kind] - RANK[b.kind] || (a.index ?? -1) - (b.index ?? -1);
const groupId = (g: SceneGroup) => g.group.id;
const markId = (m: OverlayMark) => m.id;
const edgeId = (e: SceneEdge) => e.edge.id;
const nodeId = (n: SceneNode) => n.node.id;

/**
 * Draw the scene into a context for a viewport. Returns what was drawn so
 * that callers (and tests) can check the culling.
 */
export function drawScene(ctx: DrawContext, scene: PreparedScene, view: View, state: DrawState = emptyState, options: DrawOptions = {}): { nodes: number; edges: number; shapes: number; culled: boolean; withheld?: EdgeSelection } {
  // Tokens a host built without the frequency cue's colours take the scene's, in its scheme.
  const given = options.tokens;
  const tokens = given ? { ...given, cueStripe: given.cueStripe ?? scene.colors.cueStripe, cueFoot: given.cueFoot ?? scene.colors.cueFoot } : sceneTokens(scene);
  const lodZoom = options.lodZoom ?? view.zoom;
  const lod = lodAt(lodZoom, scene.lod);
  const cull = options.cull ?? scene.size > CULL_ABOVE;
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, view.width, view.height);
  if (options.background !== false) {
    ctx.fillStyle = typeof options.background === "string" ? options.background : tokens.paper;
    ctx.fillRect(0, 0, view.width, view.height);
  }
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);

  // Culled: what the R-tree finds in the view, in drawing order. An index built without positions walks the lists.
  let found = cull ? scene.hit.within(visibleBox(view)).sort(drawingOrder) : undefined;
  if (found?.some((it) => it.index === undefined)) found = undefined;
  const each = <T>(list: readonly T[], kind: HitItem["kind"], idOf: (item: T) => string, draw: (item: T, index: number) => void) => {
    if (!found) {
      list.forEach(draw);
      return;
    }
    // An edge has an item per segment; a replaced list is checked by id.
    let last = -1;
    for (const it of found) {
      if (it.kind !== kind || it.index === undefined || it.index === last) continue;
      last = it.index;
      const item = list[it.index];
      if (item !== undefined && idOf(item) === (it.shapeId ?? it.id)) draw(item, it.index);
    }
  };
  // The edges in view the budget withholds are left out, with their labels.
  let withheld: EdgeSelection | undefined;
  if (options.edgeBudget !== undefined && options.edgeBudget !== "all") {
    const inView: number[] = [];
    if (found) each(scene.edges, "edge", edgeId, (_, i) => inView.push(i));
    withheld = budgetEdges(scene, options.edgeBudget, state, found && inView);
  }

  each(scene.groups, "group", groupId, (g) => drawGroup(ctx, scene, g, tokens, state.selection.groups.includes(g.group.id)));
  let shapes = 0;
  const marks = (layer: OverlayMark["layer"]) =>
    each(scene.marks, "overlay", markId, (m) => {
      if (m.layer !== layer || !m.inMap || lodZoom < m.minZoom) return;
      // Marks below the edges cover whole elements and are not highlighted on hover.
      drawMark(ctx, scene, m, tokens, layer !== "below" && state.hovered === m.id, options);
      shapes++;
    });
  marks("below");

  let edges = 0;
  each(scene.edges, "edge", edgeId, (e, i) => {
    if (withheld && !withheld.drawn.has(i)) return;
    const id = e.edge.id;
    const highlighted = state.selection.edges.includes(id) || state.hovered === id;
    const dimmed = !!state.bright && !state.bright.edges.has(id);
    drawEdge(ctx, e, tokens, scene.theme, highlighted, dimmed);
    edges++;
  });
  marks("between");

  let nodes = 0;
  each(scene.nodes, "node", nodeId, (n) => {
    drawNode(ctx, scene, n, tokens, state, lod, options);
    nodes++;
  });

  marks("above");

  each(scene.edges, "edge", edgeId, (e, i) => {
    if ((withheld && !withheld.drawn.has(i)) || (state.bright && !state.bright.edges.has(e.edge.id))) return;
    for (const tx of e.mark.texts) if (!tx.lod || lod[tx.lod]) drawText(ctx, scene, tx, paintOf(e.mark, tx.paint, tokens), tokens);
  });
  ctx.restore();
  return { nodes, edges, shapes, culled: cull, ...(withheld && { withheld }) };
}

/**
 * The scene's legend for the PNG export: its rows (`FlowScene.legend`) with
 * the pattern twins of the swatches and their texts shortened by the scene's
 * measure (`legendLayout`). Returns the height used.
 */
export function drawLegend(ctx: DrawContext, scene: PreparedScene, x: number, y: number, width: number, tokens: CanvasTokens = sceneTokens(scene), options: Pick<DrawOptions, "createCanvas"> = {}): number {
  const textTokens = scene.theme.text;
  const layout = legendLayout(scene.legend, { measure: scene.textMeasure, width, text: textTokens });
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = tokens.ink;
  const { legendTitle, legendItem, legendValue, legendKey, legendChip } = textTokens;
  const { legendSampleExport: sample, legendGradient: ramp, legendSwatchWidth: swatchWidth, legendSwatchHeight: swatchHeight } = dimensionTokens;
  const write = (role: { size: number; weight?: number }, s: string, tx: number, ty: number) => {
    ctx.font = fontOf(role, tokens.font);
    ctx.fillText(s, tx, ty);
  };
  write(legendTitle, scene.legend.title, x, y + 14);
  let keys = false;
  for (const { row, y: top, texts } of layout.rows) {
    const cy = y + top + legendMetrics.itemTitle;
    if (row.kind === "key" || row.kind === "chip") {
      if (!keys) ctx.fillStyle = tokens.ink;
      keys = true;
      if (row.kind === "key") {
        write(legendValue, row.glyph, x, y + top + 10);
        write(legendKey, texts[0], x + 22, y + top + 10);
      } else {
        write(legendChip, texts[0], x, y + top + 10);
        write(legendKey, texts[1], x, y + top + legendMetrics.chipLabel + 10);
      }
      continue;
    }
    ctx.fillStyle = tokens.ink;
    write(legendItem, row.title, x, y + top + 11);
    if (row.kind === "width") {
      ctx.strokeStyle = tokens.neutral;
      ctx.setLineDash([]);
      for (const [i, s] of row.samples.entries()) {
        ctx.lineWidth = s.width;
        ctx.beginPath();
        ctx.moveTo(x + (i * width) / 2, cy + 6);
        ctx.lineTo(x + (i * width) / 2 + sample, cy + 6);
        ctx.stroke();
      }
      ctx.fillStyle = tokens.ink;
      ctx.font = fontOf(legendValue, tokens.font);
      for (const [i, s] of row.samples.entries()) ctx.fillText(s.text, x + (i * width) / 2 + 46, cy + 10);
    } else if (row.kind === "ramp") {
      if (ctx.createLinearGradient) {
        const grad = ctx.createLinearGradient(x, 0, x + width - 10, 0);
        row.stops.forEach((c, i) => grad.addColorStop(i / (row.stops.length - 1), c));
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = row.stops[Math.floor(row.stops.length / 2)];
      }
      ctx.fillRect(x, cy, width - 10, ramp);
      ctx.fillStyle = tokens.ink;
      ctx.font = fontOf(legendValue, tokens.font);
      const aligns: CanvasTextAlign[] = row.values.length === 3 ? ["left", "center", "right"] : ["left", "right"];
      row.values.forEach((v, i) => {
        ctx.textAlign = aligns[i];
        ctx.fillText(v, x + ((width - 10) * (aligns[i] === "left" ? 0 : aligns[i] === "center" ? 1 : 2)) / 2, cy + 22);
      });
      ctx.textAlign = "left";
    } else {
      row.entries.forEach((e, i) => {
        const ey = cy + i * legendMetrics.entry;
        ctx.fillStyle = e.color;
        ctx.fillRect(x, ey, swatchWidth, swatchHeight);
        const pattern = patternFor(ctx, e.pattern, tokens.ink, scene.theme.pattern, options);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(x, ey, swatchWidth, swatchHeight);
        }
        ctx.fillStyle = tokens.ink;
        write(legendValue, texts[i], x + 20, ey + 10);
      });
    }
  }
  if (!keys) ctx.fillStyle = tokens.ink;
  return layout.height;
}
