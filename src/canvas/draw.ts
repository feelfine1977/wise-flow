/**
 * Drawing routines of the canvas renderer. They take the retained scene, a
 * viewport and the interaction state and issue plain 2D context calls, so
 * that they run on a screen canvas, an offscreen canvas (PNG export) and on
 * a recording stub in tests. Elements outside the viewport are skipped
 * through the scene's R-tree when the scene is large.
 */
import { type Box, type LegendItem, type OverlayShape, type Selection, type StringKey, MAP_TARGET, contrastText, fixedColors, formatCompact, formatNumber, formatShare, lodAt, t } from "../core/index";
import type { PreparedScene, SceneEdge, SceneGroup, SceneNode } from "./scene";
import { type CanvasTokens, defaultTokens } from "./tokens";

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
}

export interface DrawOptions {
  tokens?: CanvasTokens;
  /** Cull by viewport through the R-tree. Default: when the scene has more than 1,500 elements. */
  cull?: boolean;
  /** Fill the background with the paper colour (or a given colour). Default true. */
  background?: boolean | string;
  /** Factory for pattern tiles; `document.createElement("canvas")` when available. */
  createCanvas?: (width: number, height: number) => { getContext(kind: "2d"): unknown } | null;
}

export const emptyState: DrawState = { selection: { nodes: [], edges: [], groups: [] } };

const CULL_ABOVE = 1500;

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

function arrowhead(ctx: DrawContext, from: [number, number], to: [number, number], size: number, color: string) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  ctx.beginPath();
  ctx.moveTo(to[0], to[1]);
  ctx.lineTo(to[0] - ux * size - uy * size * 0.5, to[1] - uy * size + ux * size * 0.5);
  ctx.lineTo(to[0] - ux * size + uy * size * 0.5, to[1] - uy * size - ux * size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function haloText(ctx: DrawContext, text: string, x: number, y: number, tokens: CanvasTokens) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = tokens.paper;
  ctx.lineWidth = 3;
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

function patternFor(ctx: DrawContext, pattern: string, ink: string, options: DrawOptions): CanvasPattern | null {
  if (pattern === "solid" || !ctx.createPattern) return null;
  const cache = cacheOf(ctx);
  const key = `${pattern}:${ink}`;
  if (cache.has(key)) return cache.get(key)!;
  const create = tileFactory(options);
  const size = 6;
  const tile = create?.(size, size);
  const tc = tile?.getContext("2d") as DrawContext | null | undefined;
  if (!tc) {
    cache.set(key, null);
    return null;
  }
  tc.strokeStyle = ink;
  tc.fillStyle = ink;
  tc.lineWidth = 1;
  tc.globalAlpha = 0.6;
  tc.beginPath();
  switch (pattern) {
    case "diagonal":
      tc.moveTo(0, size);
      tc.lineTo(size, 0);
      break;
    case "diagonal-reverse":
      tc.moveTo(0, 0);
      tc.lineTo(size, size);
      break;
    case "crosshatch":
      tc.moveTo(0, size);
      tc.lineTo(size, 0);
      tc.moveTo(0, 0);
      tc.lineTo(size, size);
      break;
    case "horizontal":
      tc.moveTo(0, size / 2);
      tc.lineTo(size, size / 2);
      break;
    case "vertical":
      tc.moveTo(size / 2, 0);
      tc.lineTo(size / 2, size);
      break;
    case "grid":
      tc.moveTo(0, size / 2);
      tc.lineTo(size, size / 2);
      tc.moveTo(size / 2, 0);
      tc.lineTo(size / 2, size);
      break;
    case "dots":
      tc.arc(size / 2, size / 2, 1, 0, 2 * Math.PI);
      tc.fill();
      break;
  }
  tc.stroke();
  const out = ctx.createPattern(tile as unknown as CanvasImageSource, "repeat");
  cache.set(key, out);
  return out;
}

function hatchPattern(ctx: DrawContext, tokens: CanvasTokens, options: DrawOptions): CanvasPattern | null {
  if (!ctx.createPattern) return null;
  const cache = cacheOf(ctx);
  const key = `hatch:${tokens.outOfScope}`;
  if (cache.has(key)) return cache.get(key)!;
  const tile = tileFactory(options)?.(8, 8);
  const tc = tile?.getContext("2d") as DrawContext | null | undefined;
  if (!tc) {
    cache.set(key, null);
    return null;
  }
  tc.strokeStyle = tokens.outOfScope;
  tc.lineWidth = 2;
  tc.beginPath();
  tc.moveTo(0, 8);
  tc.lineTo(8, 0);
  tc.stroke();
  const out = ctx.createPattern(tile as unknown as CanvasImageSource, "repeat");
  cache.set(key, out);
  return out;
}

function truncate(ctx: DrawContext, scene: PreparedScene, text: string, maxWidth: number): string {
  const key = `${text} ${Math.round(maxWidth)}`;
  const cached = scene.labelCache.get(key);
  if (cached !== undefined) return cached;
  let out = text;
  if (ctx.measureText(text).width > maxWidth) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    out = `${text.slice(0, Math.max(1, lo))}…`;
  }
  scene.labelCache.set(key, out);
  return out;
}

function visibleBox(view: View): Box {
  return { x: -view.x / view.zoom, y: -view.y / view.zoom, width: view.width / view.zoom, height: view.height / view.zoom };
}

function drawGroup(ctx: DrawContext, g: SceneGroup, tokens: CanvasTokens, selected: boolean) {
  const b = g.box;
  if (g.band) {
    ctx.fillStyle = g.band.index % 2 === 0 ? `${g.color}0f` : `${g.color}05`;
    ctx.fillRect(b.x, b.y, b.width, b.height);
    if (g.tint) {
      ctx.fillStyle = g.tint;
      ctx.fillRect(b.x, b.y, b.width, b.height);
    }
    ctx.strokeStyle = tokens.line;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    if (g.band.axis === "main") {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x, b.y + b.height);
      ctx.moveTo(b.x + b.width, b.y);
      ctx.lineTo(b.x + b.width, b.y + b.height);
    } else {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + b.width, b.y);
      ctx.moveTo(b.x, b.y + b.height);
      ctx.lineTo(b.x + b.width, b.y + b.height);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = g.color;
    ctx.lineWidth = 3;
    if (g.band.axis === "main") {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + b.width, b.y);
    } else {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x, b.y + b.height);
    }
    ctx.stroke();
    if (selected) {
      ctx.strokeStyle = tokens.focus;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.rect(b.x + 1, b.y + 1, b.width - 2, b.height - 2);
      ctx.stroke();
    }
  } else {
    roundedRect(ctx, b, 10);
    ctx.fillStyle = g.tint ?? `${g.color}0f`;
    ctx.fill();
    ctx.strokeStyle = selected ? tokens.focus : g.color;
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = tokens.ink;
  ctx.font = `600 14px ${tokens.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(g.group.label, b.x + 12, b.y + 22);
}

function drawEdge(ctx: DrawContext, e: SceneEdge, tokens: CanvasTokens, highlighted: boolean, dimmed: boolean) {
  const pts = e.points;
  if (pts.length < 2) return;
  ctx.globalAlpha = dimmed ? 0.25 : 1;
  const color = highlighted ? tokens.focus : e.color;
  ctx.strokeStyle = color;
  ctx.lineWidth = highlighted ? Math.max(e.width, 2.5) : e.width;
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  ctx.setLineDash(e.dash ?? []);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.setLineDash([]);
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  arrowhead(ctx, [a.x, a.y], [b.x, b.y], Math.min(16, 8 + e.width), color);
  ctx.globalAlpha = 1;
}

function midpoint(pts: { x: number; y: number }[]): { x: number; y: number } {
  let total = 0;
  const lengths: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    lengths.push(l);
    total += l;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 0 : remaining / lengths[i];
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f };
    }
    remaining -= lengths[i];
  }
  return pts[pts.length - 1];
}

function drawNode(ctx: DrawContext, scene: PreparedScene, n: SceneNode, tokens: CanvasTokens, state: DrawState, lod: ReturnType<typeof lodAt>, options: DrawOptions) {
  const b = n.box;
  const id = n.node.id;
  const selected = state.selection.nodes.includes(id);
  const focused = state.focused === id;
  const hovered = state.hovered === id;
  const dimmed = !!state.bright && !state.bright.nodes.has(id);
  ctx.globalAlpha = dimmed ? 0.35 : 1;
  ctx.setLineDash(n.reconnected ? [4, 3] : []);
  if (n.node.kind === "event") {
    const r = Math.min(b.width, b.height) / 2;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fillStyle = hovered ? tokens.surface : tokens.paper;
    ctx.fill();
    ctx.strokeStyle = selected || focused ? tokens.focus : tokens.ink;
    ctx.lineWidth = n.end ? 3 : 1.5;
    ctx.stroke();
    if (lod.labels) {
      ctx.fillStyle = tokens.ink;
      ctx.font = `9px ${tokens.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(truncate(ctx, scene, n.label, b.width - 4), cx, cy);
    }
  } else if (n.node.kind === "gateway") {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const h = b.width / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h);
    ctx.lineTo(cx + h, cy);
    ctx.lineTo(cx, cy + h);
    ctx.lineTo(cx - h, cy);
    ctx.closePath();
    ctx.fillStyle = hovered ? tokens.surface : tokens.paper;
    ctx.fill();
    ctx.strokeStyle = selected || focused ? tokens.focus : tokens.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = tokens.ink;
    ctx.font = `700 14px ${tokens.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.glyph ?? "×", cx, cy + 1);
  } else {
    roundedRect(ctx, b, 6);
    ctx.fillStyle = hovered || n.node.kind === "note" ? tokens.surface : tokens.paper;
    ctx.fill();
    ctx.strokeStyle = selected || focused ? tokens.focus : n.color;
    ctx.lineWidth = n.node.kind === "stage" ? 3 : 2;
    if (n.node.kind === "note") ctx.setLineDash([2, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (n.node.kind !== "note") {
      const band: Box = { x: b.x, y: b.y, width: 8, height: b.height };
      ctx.fillStyle = n.color;
      ctx.fillRect(band.x, band.y, band.width, band.height);
      const pattern = patternFor(ctx, n.pattern, tokens.ink, options);
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(band.x, band.y, band.width, band.height);
      }
    }
    if (lod.labels) {
      ctx.fillStyle = tokens.ink;
      ctx.font = `${n.node.kind === "stage" ? "600 " : ""}12px ${tokens.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const metaWidth = n.meta ? ctx.measureText(n.meta).width * 0.8 + 8 : 0;
      ctx.fillText(truncate(ctx, scene, n.label, b.width - 24 - metaWidth), b.x + 16, b.y + b.height / 2);
      if (n.meta) {
        ctx.fillStyle = tokens.inkMuted;
        ctx.font = `9px ${tokens.font}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(n.meta, b.x + b.width - 6, b.y + b.height - 5);
      }
    }
    if (n.hatched && lod.hatch) {
      const hatch = hatchPattern(ctx, tokens, options);
      roundedRect(ctx, b, 6);
      ctx.globalAlpha = (dimmed ? 0.35 : 1) * 0.55;
      ctx.fillStyle = hatch ?? tokens.outOfScope;
      ctx.fill();
      ctx.globalAlpha = dimmed ? 0.35 : 1;
    }
  }
  if (selected) {
    ctx.strokeStyle = tokens.selection;
    ctx.lineWidth = 6;
    ctx.setLineDash([]);
    if (n.node.kind === "event") {
      ctx.beginPath();
      ctx.arc(b.x + b.width / 2, b.y + b.height / 2, Math.min(b.width, b.height) / 2 + 3, 0, 2 * Math.PI);
    } else {
      roundedRect(ctx, { x: b.x - 3, y: b.y - 3, width: b.width + 6, height: b.height + 6 }, 8);
    }
    ctx.stroke();
  }
  if (focused) {
    ctx.strokeStyle = tokens.focus;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function shapeColor(scene: PreparedScene, s: OverlayShape): string {
  const v = s.overlay.payload?.value;
  return typeof v === "number" && Number.isFinite(v) ? scene.scales.color(v, "sequential", [0, 1]) : fixedColors.neutral;
}

function drawShape(ctx: DrawContext, scene: PreparedScene, s: OverlayShape, tokens: CanvasTokens, hovered: boolean) {
  const p = s.overlay.payload ?? {};
  const own = shapeColor(scene, s);
  const color = hovered ? tokens.focus : own;
  const value = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, scene.locale) : "";
  switch (s.kind) {
    case "tint": {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.18;
      roundedRect(ctx, s, 10);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    case "arc": {
      const coverage = typeof p.coverage === "number" ? Math.max(0, Math.min(1, p.coverage)) : 1;
      const width = 2 + 8 * coverage;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.globalAlpha = 0.9;
      ctx.setLineDash(p.reverse ? [6, 4] : []);
      const end = tracePath(ctx, s.path ?? "");
      ctx.stroke();
      ctx.setLineDash([]);
      if (end.last && end.beforeLast) arrowhead(ctx, end.beforeLast, end.last, 12, color);
      ctx.globalAlpha = 1;
      if (s.labelX !== undefined && s.labelY !== undefined) {
        ctx.fillStyle = tokens.ink;
        ctx.font = `11px ${tokens.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        haloText(ctx, `${p.glyph ?? ""} ${value}`.trim(), s.labelX, s.labelY, tokens);
      }
      return;
    }
    case "selfLoop": {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      const end = tracePath(ctx, s.path ?? "");
      ctx.stroke();
      if (end.last && end.beforeLast) arrowhead(ctx, end.beforeLast, end.last, 10, color);
      if (s.labelX !== undefined && s.labelY !== undefined && value) {
        ctx.fillStyle = tokens.ink;
        ctx.font = `10px ${tokens.font}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        haloText(ctx, `↻ ${value}`, s.labelX, s.labelY, tokens);
      }
      return;
    }
    case "badge": {
      roundedRect(ctx, s, s.height / 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = tokens.paper;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.fillStyle = hovered ? fixedColors.paper : contrastText(own);
      ctx.font = `700 10px ${tokens.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.glyph ?? (value || "●"), s.x + s.width / 2, s.y + s.height / 2 + 0.5);
      if (value && p.glyph) {
        ctx.fillStyle = tokens.ink;
        ctx.font = `10px ${tokens.font}`;
        ctx.textAlign = "left";
        haloText(ctx, value, s.x + s.width + 4, s.y + s.height / 2 + 0.5, tokens);
      }
      return;
    }
    case "chip": {
      if (s.overlay.target === MAP_TARGET) return;
      roundedRect(ctx, s, 12);
      ctx.fillStyle = tokens.paper;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.fillStyle = tokens.ink;
      ctx.font = `10px ${tokens.font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(truncate(ctx, scene, `${p.glyph ?? ""} ${p.text ?? p.label ?? ""}`.trim(), s.width - 16), s.x + 8, s.y + s.height / 2 + 0.5);
      return;
    }
    default:
      return;
  }
}

/**
 * Draw the scene into a context for a viewport. Returns what was drawn so
 * that callers (and tests) can check the culling.
 */
export function drawScene(ctx: DrawContext, scene: PreparedScene, view: View, state: DrawState = emptyState, options: DrawOptions = {}): { nodes: number; edges: number; shapes: number; culled: boolean } {
  const tokens = options.tokens ?? defaultTokens;
  const lod = lodAt(view.zoom, scene.lod);
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

  let nodeIds: Set<string> | undefined;
  let edgeIds: Set<string> | undefined;
  let shapeIds: Set<string> | undefined;
  if (cull) {
    nodeIds = new Set();
    edgeIds = new Set();
    shapeIds = new Set();
    for (const it of scene.hit.within(visibleBox(view))) {
      if (it.kind === "node") nodeIds.add(it.id);
      else if (it.kind === "edge") edgeIds.add(it.id);
      else if (it.kind === "overlay" && it.shapeId) shapeIds.add(it.shapeId);
    }
  }

  for (const g of scene.groups) drawGroup(ctx, g, tokens, state.selection.groups.includes(g.group.id));
  for (const s of scene.shapes) if (s.kind === "tint") drawShape(ctx, scene, s, tokens, false);

  let edges = 0;
  for (const e of scene.edges) {
    if (edgeIds && !edgeIds.has(e.edge.id)) continue;
    const id = e.edge.id;
    const highlighted = state.selection.edges.includes(id) || state.hovered === id;
    const dimmed = !!state.bright && !state.bright.edges.has(id);
    drawEdge(ctx, e, tokens, highlighted, dimmed);
    edges++;
  }

  let nodes = 0;
  for (const n of scene.nodes) {
    if (nodeIds && !nodeIds.has(n.node.id)) continue;
    drawNode(ctx, scene, n, tokens, state, lod, options);
    nodes++;
  }

  let shapes = 0;
  for (const s of scene.shapes) {
    if (s.kind === "tint" || s.kind === "hatch") continue;
    if (shapeIds && !shapeIds.has(s.id)) continue;
    if ((s.kind === "badge" && !lod.badges) || (s.kind === "arc" && !lod.arcs) || (s.kind === "chip" && !lod.chips) || (s.kind === "selfLoop" && !lod.selfLoops)) continue;
    drawShape(ctx, scene, s, tokens, state.hovered === s.id);
    shapes++;
  }

  if (lod.edgeLabels) {
    ctx.fillStyle = tokens.ink;
    ctx.font = `10px ${tokens.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const e of scene.edges) {
      if (!e.label || (edgeIds && !edgeIds.has(e.edge.id))) continue;
      if (state.bright && !state.bright.edges.has(e.edge.id)) continue;
      const m = midpoint(e.points);
      haloText(ctx, e.label, m.x, m.y - 4, tokens);
    }
  }
  ctx.restore();
  return { nodes, edges, shapes, culled: cull };
}

/** Legend for the PNG export: scales, overlay glyphs and map-level chips. Returns the height used. */
export function drawLegend(ctx: DrawContext, scene: PreparedScene, x: number, y: number, width: number, tokens: CanvasTokens = defaultTokens): number {
  const L = scene.locale;
  let cy = y;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = tokens.ink;
  ctx.font = `700 13px ${tokens.font}`;
  ctx.fillText(t(L, "legend.title"), x, cy + 14);
  cy += 26;
  const item = (it: LegendItem) => {
    ctx.fillStyle = tokens.ink;
    ctx.font = `600 11px ${tokens.font}`;
    ctx.fillText(t(L, it.title as StringKey), x, cy + 11);
    cy += 16;
    if (it.kind === "width") {
      const [lo, hi] = it.range;
      ctx.strokeStyle = tokens.neutral;
      ctx.setLineDash([]);
      ctx.lineWidth = lo;
      ctx.beginPath();
      ctx.moveTo(x, cy + 6);
      ctx.lineTo(x + 40, cy + 6);
      ctx.stroke();
      ctx.lineWidth = hi;
      ctx.beginPath();
      ctx.moveTo(x + width / 2, cy + 6);
      ctx.lineTo(x + width / 2 + 40, cy + 6);
      ctx.stroke();
      ctx.fillStyle = tokens.ink;
      ctx.font = `10px ${tokens.font}`;
      ctx.fillText(formatCompact(it.domain[0], L), x + 46, cy + 10);
      ctx.fillText(formatCompact(it.domain[1], L), x + width / 2 + 46, cy + 10);
      cy += 20;
    } else if (it.kind === "sequential" || it.kind === "diverging") {
      if (ctx.createLinearGradient) {
        const grad = ctx.createLinearGradient(x, 0, x + width - 10, 0);
        it.stops.forEach((c, i) => grad.addColorStop(i / (it.stops.length - 1), c));
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = it.stops[Math.floor(it.stops.length / 2)];
      }
      ctx.fillRect(x, cy, width - 10, 10);
      const share = /share/i.test(it.metric);
      const f = (v: number) => (share ? formatShare(v, L) : formatNumber(v, 1, L));
      ctx.fillStyle = tokens.ink;
      ctx.font = `10px ${tokens.font}`;
      ctx.textAlign = "left";
      ctx.fillText(f(it.domain[0]), x, cy + 22);
      if (it.domain.length === 3) {
        ctx.textAlign = "center";
        ctx.fillText(f(it.domain[1]), x + (width - 10) / 2, cy + 22);
      }
      ctx.textAlign = "right";
      ctx.fillText(f(it.domain[it.domain.length - 1]), x + width - 10, cy + 22);
      ctx.textAlign = "left";
      cy += 30;
    } else if (it.kind === "categorical") {
      for (const e of it.entries) {
        ctx.fillStyle = e.color;
        ctx.fillRect(x, cy, 14, 12);
        ctx.fillStyle = tokens.ink;
        ctx.font = `10px ${tokens.font}`;
        ctx.fillText(truncate(ctx, scene, e.key, width - 24), x + 20, cy + 10);
        cy += 16;
      }
      cy += 4;
    }
  };
  for (const it of scene.scales.legend) item(it);
  const kinds = new Set(scene.overlays.map((o) => o.kind));
  const hasReverse = scene.overlays.some((o) => o.kind === "arc" && o.payload?.reverse);
  const keys: [string, StringKey, boolean][] = [
    ["●", "legend.badge", kinds.has("badge")],
    ["⌒", "legend.arc", kinds.has("arc")],
    ["⌒ ┄", "legend.reverse", hasReverse],
    ["↻", "legend.selfLoop", kinds.has("selfLoop")],
    ["▨", "legend.outOfScope", kinds.has("hatch")],
    ["┄", "legend.reconnected", true],
  ];
  ctx.fillStyle = tokens.ink;
  for (const [glyph, key, show] of keys) {
    if (!show) continue;
    ctx.font = `10px ${tokens.font}`;
    ctx.fillText(glyph, x, cy + 10);
    ctx.font = `9.5px ${tokens.font}`;
    ctx.fillText(truncate(ctx, scene, t(L, key), width - 24), x + 22, cy + 10);
    cy += 14;
  }
  const chips = scene.overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET);
  if (chips.length) cy += 6;
  for (const c of chips) {
    const p = c.payload ?? {};
    ctx.font = `600 10px ${tokens.font}`;
    ctx.fillText(truncate(ctx, scene, `${p.glyph ?? ""} ${p.label ?? ""}`.trim(), width - 4), x, cy + 10);
    cy += 13;
    ctx.font = `9.5px ${tokens.font}`;
    ctx.fillText(truncate(ctx, scene, String(p.text ?? ""), width - 4), x, cy + 10);
    cy += 15;
  }
  return cy - y;
}
