/**
 * PNG export: the scene drawn with the canvas routines into an offscreen
 * canvas, in the same figure frame and with the same legend as `toSVG`.
 */
import { type ColorScheme, type EdgeBudget, type FigurePreset, type Scene, type ShownEdges, type TextMeasure, type ThemeSetting, budgetEdges, figureFrame, figureMetrics, formatCount, t } from "../core/index.js";
import { type DrawContext, drawLegend, drawScene, fontOf } from "./draw.js";
import { assertExportable } from "../core/model.js";
import { prepareScene } from "./scene.js";
import { type CanvasTokens, sceneTokens } from "./tokens.js";

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
  /** Colours and font over the scene's (`sceneTokens`). */
  tokens?: Partial<CanvasTokens>;
  /** The theme the figure is drawn in: a preset's name or changes over a preset (`resolveTheme`). Default the `default` preset. */
  theme?: ThemeSetting;
  /** The colour scheme of the theme. Default `light`. */
  scheme?: ColorScheme;
  /** What the figure's texts are measured by (`FlowSceneOptions.textMeasure`). Default `estimateTextWidth`. */
  textMeasure?: TextMeasure;
  /** Canvas factory for environments without a document (Node with a canvas package, tests). */
  createCanvas?: (width: number, height: number) => CanvasLike;
  /** Show the scene context line under the title. Default true. */
  context?: boolean;
  /** The edges drawn, as in `toSVG`: those a map reported, or a budget. Default every edge. */
  edgeBudget?: EdgeBudget | ShownEdges;
  /** The caption line under the map and the legend, as in `toSVG` (`figureCaption`). Default true. */
  caption?: boolean;
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
  assertExportable(scene.graph);
  const locale = scene.locale ?? "en";
  const prepared = prepareScene(scene.graph, scene.positions, { style: scene.style, overlays: scene.overlays, locale, lanes: scene.lanes, selfLoops: scene.selfLoops, activityLabels: scene.activityLabels, lodBySize: false, theme: options.theme, scheme: options.scheme, textMeasure: options.textMeasure });
  const tokens: CanvasTokens = { ...sceneTokens(prepared), ...(options.tokens ?? {}) };
  const { text: textTokens } = prepared.theme;
  const { edgeBudget } = options;
  const frame = figureFrame(prepared, { title: !!scene.title, context: options.context, legend: options.legend, padding: options.padding, preset: options.preset, width: options.width, withheld: budgetEdges(prepared, edgeBudget), caption: options.caption });
  const { padding: pad, width: totalW, outWidth: cssWidth, outHeight: cssHeight } = frame;
  const k = totalW > 0 ? cssWidth / totalW : 1;
  const scale = options.scale ?? Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const create = options.createCanvas ?? defaultCreateCanvas;
  const canvas = create(Math.max(1, Math.round(cssWidth * scale)), Math.max(1, Math.round(cssHeight * scale)));
  const ctx = canvas.getContext("2d") as DrawContext | null;
  if (!ctx) throw new Error("toPNG: the canvas has no 2D context");
  ctx.save();
  ctx.scale(scale, scale);
  drawScene(ctx, prepared, { x: frame.map.offset.x * k, y: frame.map.offset.y * k, zoom: k, width: cssWidth, height: cssHeight }, undefined, {
    tokens,
    // Level of detail is decided at `lodZoom`, independent of the figure scale.
    lodZoom: options.lodZoom ?? 1,
    cull: false,
    background: options.background ?? tokens.paper,
    createCanvas: (w, h) => create(w, h),
    edgeBudget,
  });
  ctx.save();
  ctx.scale(k, k);
  if (scene.title) {
    ctx.fillStyle = tokens.ink;
    ctx.font = fontOf(textTokens.figureTitle, tokens.font);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scene.title, pad, figureMetrics.titleBaseline);
    if (options.context !== false) {
      const meta = scene.graph.meta ?? {};
      const label = scene.subtitle ?? String(meta.label ?? meta.scene ?? "");
      const cases = typeof meta.cases === "number" ? formatCount(meta.cases, locale) : "–";
      const events = typeof meta.events === "number" ? formatCount(meta.events, locale) : "–";
      ctx.fillStyle = tokens.neutral;
      ctx.font = fontOf(textTokens.figureText, tokens.font);
      ctx.fillText(t(locale, "export.context", { label, cases, events }), pad, figureMetrics.contextBaseline);
    }
  }
  if (frame.legend) {
    const { rule, x, y, width } = frame.legend;
    ctx.strokeStyle = tokens.neutral;
    ctx.globalAlpha = prepared.theme.opacity.legendRule;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(rule.x, rule.top);
    ctx.lineTo(rule.x, rule.bottom);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawLegend(ctx, prepared, x, y, width, tokens, { createCanvas: (w, h) => create(w, h) });
  }
  if (frame.caption || frame.note || frame.key.lines.length) {
    ctx.fillStyle = tokens.ink;
    ctx.font = fontOf(textTokens.figureText, tokens.font);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (frame.caption) frame.caption.lines.forEach((line, i) => ctx.fillText(line, frame.caption!.x, frame.caption!.y + i * figureMetrics.keyLine));
    if (frame.note) ctx.fillText(frame.note.text, frame.note.x, frame.note.y);
    frame.key.lines.forEach((line, i) => ctx.fillText(line, pad, frame.key.y + i * figureMetrics.keyLine));
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
