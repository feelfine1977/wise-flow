/**
 * PNG export: the scene drawn with the canvas routines into an offscreen
 * canvas, with the same figure presets and embedded legend as `toSVG`.
 */
import { type Box, type FigurePreset, type LodRules, type Scene, FIGURE_WIDTHS, MAP_TARGET, formatCount, t } from "../core/index";
import { type DrawContext, drawLegend, drawScene } from "./draw";
import { prepareScene } from "./scene";
import { type CanvasTokens, defaultTokens } from "./tokens";

/** What `toPNG` needs from a canvas; `HTMLCanvasElement` and `OffscreenCanvas` both fit. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d"): unknown;
  toBlob?(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
  convertToBlob?(options?: { type?: string; quality?: number }): Promise<Blob>;
  toDataURL?(type?: string, quality?: number): string;
}

export interface PngOptions {
  /** Figure preset setting the output width in CSS pixels. */
  preset?: FigurePreset;
  /** Explicit output width in CSS pixels; overrides the preset. */
  width?: number;
  /** Pixel density of the bitmap. Default: the device pixel ratio, at least 2. */
  scale?: number;
  background?: string;
  legend?: boolean;
  padding?: number;
  /** Zoom level for the level-of-detail decisions. Default 1 (everything visible). */
  lodZoom?: number;
  tokens?: Partial<CanvasTokens>;
  /** Canvas factory for environments without a document (Node with a canvas package, tests). */
  createCanvas?: (width: number, height: number) => CanvasLike;
  /** Show the scene context line under the title. Default true. */
  context?: boolean;
}

export interface PngCanvas {
  canvas: CanvasLike;
  /** Bitmap size. */
  width: number;
  height: number;
  /** CSS size. */
  cssWidth: number;
  cssHeight: number;
  scale: number;
}

/** Level-of-detail thresholds multiplied by a factor, so that `lodZoom` decides what a figure shows. */
function scaleLod(rules: LodRules, factor: number): LodRules {
  return {
    labels: rules.labels * factor,
    edgeLabels: rules.edgeLabels * factor,
    badges: rules.badges * factor,
    arcs: rules.arcs * factor,
    chips: rules.chips * factor,
    hatch: rules.hatch * factor,
    selfLoops: rules.selfLoops * factor,
  };
}

function defaultCreateCanvas(width: number, height: number): CanvasLike {
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    return c as unknown as CanvasLike;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height) as unknown as CanvasLike;
  throw new Error("toPNG needs a canvas: pass options.createCanvas");
}

/** Draw the scene into a canvas and return it (synchronous). */
export function toPNGCanvas(scene: Scene, options: PngOptions = {}): PngCanvas {
  const tokens: CanvasTokens = { ...defaultTokens, ...(options.tokens ?? {}) };
  const locale = scene.locale ?? "en";
  const prepared = prepareScene(scene.graph, scene.positions, { style: scene.style, overlays: scene.overlays ?? scene.graph.overlays, locale, lanes: scene.lanes, selfLoops: false });
  const pad = options.padding ?? 24;
  const legend = options.legend ?? true;
  const legendWidth = legend ? 220 : 0;
  const content: Box = prepared.bounds.width > 0 && prepared.bounds.height > 0 ? prepared.bounds : { x: 0, y: 0, width: 1, height: 1 };
  const headerHeight = scene.title ? 40 + (options.context !== false ? 18 : 0) : 0;
  const mapW = content.width + 2 * pad;
  const mapH = content.height + 2 * pad;
  // The legend's height is only known after drawing; reserve a column for it.
  const mapChips = prepared.overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET).length;
  const legendEstimate = legend ? 40 + prepared.scales.legend.reduce((s, it) => s + (it.kind === "categorical" ? 20 + it.entries.length * 16 : 46), 0) + 6 * 14 + mapChips * 28 : 0;
  const totalW = mapW + legendWidth;
  const totalH = Math.max(mapH, legendEstimate + 2 * pad) + headerHeight;
  const cssWidth = options.width ?? (options.preset && options.preset !== "none" ? FIGURE_WIDTHS[options.preset] : totalW);
  const k = cssWidth / totalW;
  const cssHeight = totalH * k;
  const scale = options.scale ?? Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const create = options.createCanvas ?? defaultCreateCanvas;
  const canvas = create(Math.max(1, Math.round(cssWidth * scale)), Math.max(1, Math.round(cssHeight * scale)));
  const ctx = canvas.getContext("2d") as DrawContext | null;
  if (!ctx) throw new Error("toPNG: the canvas has no 2D context");
  ctx.save();
  ctx.scale(scale, scale);
  // Level of detail is decided at `lodZoom`, independent of the figure scale.
  const lodScene = options.lodZoom !== undefined && options.lodZoom !== k ? { ...prepared, lod: scaleLod(prepared.lod, k / options.lodZoom) } : prepared;
  drawScene(ctx, lodScene, { x: (pad - content.x) * k, y: (headerHeight + pad - content.y) * k, zoom: k, width: cssWidth, height: cssHeight }, undefined, {
    tokens,
    cull: false,
    background: options.background ?? tokens.paper,
    createCanvas: (w, h) => create(w, h),
  });
  ctx.save();
  ctx.scale(k, k);
  if (scene.title) {
    ctx.fillStyle = tokens.ink;
    ctx.font = `700 18px ${tokens.font}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scene.title, pad, 26);
    if (options.context !== false) {
      const meta = scene.graph.meta ?? {};
      const label = scene.subtitle ?? String(meta.label ?? meta.scene ?? "");
      const cases = typeof meta.cases === "number" ? formatCount(meta.cases, locale) : "–";
      const events = typeof meta.events === "number" ? formatCount(meta.events, locale) : "–";
      ctx.fillStyle = tokens.neutral;
      ctx.font = `11px ${tokens.font}`;
      ctx.fillText(t(locale, "export.context", { label, cases, events }), pad, 44);
    }
  }
  if (legend) {
    ctx.strokeStyle = tokens.neutral;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(mapW, headerHeight + pad);
    ctx.lineTo(mapW, totalH - pad);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawLegend(ctx, prepared, mapW + 16, headerHeight + pad, legendWidth - 32, tokens);
  }
  ctx.restore();
  ctx.restore();
  return { canvas, width: canvas.width, height: canvas.height, cssWidth, cssHeight, scale };
}

/** The scene as a PNG blob. */
export async function toPNG(scene: Scene, options: PngOptions = {}): Promise<Blob> {
  const { canvas } = toPNGCanvas(scene, options);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  if (canvas.toBlob) {
    return new Promise((resolve, reject) => canvas.toBlob!((blob) => (blob ? resolve(blob) : reject(new Error("toPNG: the canvas produced no blob"))), "image/png"));
  }
  throw new Error("toPNG: the canvas cannot produce a blob");
}

/** The scene as a PNG data URL (synchronous; needs `toDataURL` on the canvas). */
export function toPNGDataUrl(scene: Scene, options: PngOptions = {}): string {
  const { canvas } = toPNGCanvas(scene, options);
  if (!canvas.toDataURL) throw new Error("toPNGDataUrl: the canvas has no toDataURL");
  return canvas.toDataURL("image/png");
}
