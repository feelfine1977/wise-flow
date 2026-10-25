/**
 * PNG export: the scene drawn with the canvas routines into an offscreen
 * canvas, in the same figure frame and with the same legend as `toSVG`.
 */
import { type ColorScheme, type EdgeBudget, type FigurePreset, type Readable, type Scene, type ShownEdges, type Strings, type TextMeasure, type ThemeSetting, budgetEdges, figureFrame, figureMetrics } from "../core/index.js";
import { figureFloor, figureHeading, millimetres } from "../core/figure.js";
import { type DrawContext, drawLegend, drawScene, fontOf } from "./draw.js";
import { assertExportable } from "../core/model.js";
import { shownReadable } from "../core/readable.js";
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
  /** Replay a live map's text state and numbered full-name key, as in `ExportOptions.readable`. Default the figure's text state. */
  readable?: Readable;
  /** Figure preset setting the output width in CSS pixels. */
  preset?: FigurePreset;
  /** Explicit output width in CSS pixels; overrides the preset. */
  width?: number;
  /**
   * The width the figure is declared to be printed at, in millimetres: the
   * figure is laid out at it (one figure unit a CSS pixel of it, 0.75 pt) and
   * drawn `width` CSS pixels wide, or as wide as it is laid out.
   */
  widthMm?: number;
  /** Pixel density of the bitmap. Default: the device pixel ratio, at least 2. */
  scale?: number;
  background?: string;
  legend?: boolean;
  padding?: number;
  /** Zoom level for the level-of-detail decisions. Default as for `toSVG`: the map's scale in the figure in a theme with a figure floor, otherwise 1. */
  lodZoom?: number;
  /** Colours and font over the scene's (`sceneTokens`). */
  tokens?: Partial<CanvasTokens>;
  /** The theme the figure is drawn in, as for `toSVG`: a preset's name or changes over a preset (`resolveTheme`). Default the `print` preset. */
  theme?: ThemeSetting;
  /** The colour scheme of the theme. Default `light`; the print theme has no other. */
  scheme?: ColorScheme;
  /** What the figure's texts are measured by (`FlowSceneOptions.textMeasure`). Default `estimateTextWidth`. */
  textMeasure?: TextMeasure;
  /** The host's wording of some strings over the table's (`Strings`): the legend's sentence, the caption, Start and End. */
  strings?: Strings;
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
  const prepared = prepareScene(scene.graph, scene.positions, { measure: scene.measure, style: scene.style, overlays: scene.overlays, locale, lanes: scene.lanes, stageView: scene.stageView, labelPlacement: scene.labelPlacement, laneOptions: scene.laneOptions, selfLoops: scene.selfLoops, activityLabels: scene.activityLabels, lodBySize: false, theme: options.theme ?? "print", scheme: options.scheme, textMeasure: options.textMeasure, strings: options.strings });
  const tokens: CanvasTokens = { ...sceneTokens(prepared), ...(options.tokens ?? {}) };
  const { text: textTokens } = prepared.theme;
  const { edgeBudget } = options;
  const floor = figureFloor(prepared.theme);
  const declared = options.widthMm !== undefined ? millimetres(options.widthMm) : undefined;
  const frame = figureFrame(prepared, { title: !!scene.title, context: options.context, legend: options.legend, padding: options.padding, preset: options.preset, width: declared ?? options.width, withheld: budgetEdges(prepared, edgeBudget), caption: options.caption, floor, readable: shownReadable(prepared, options) });
  const { padding: pad, width: totalW } = frame;
  // A figure declared in millimetres is drawn at the given width in CSS pixels, or as wide as it is laid out.
  const cssWidth = declared !== undefined ? (options.width ?? frame.outWidth) : frame.outWidth;
  const cssHeight = frame.outHeight * (cssWidth / frame.outWidth || 1);
  const k = totalW > 0 ? cssWidth / totalW : 1;
  const { offset, scale: mapScale } = frame.map;
  const scale = options.scale ?? Math.max(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const create = options.createCanvas ?? defaultCreateCanvas;
  const canvas = create(Math.max(1, Math.round(cssWidth * scale)), Math.max(1, Math.round(cssHeight * scale)));
  const ctx = canvas.getContext("2d") as DrawContext | null;
  if (!ctx) throw new Error("toPNG: the canvas has no 2D context");
  ctx.save();
  ctx.scale(scale, scale);
  drawScene(ctx, prepared, { x: offset.x * k, y: offset.y * k, zoom: k * mapScale, width: cssWidth, height: cssHeight }, undefined, {
    tokens,
    // Level of detail is decided at `lodZoom`, without a figure floor independent of the figure scale; the texts as the frame decided at the map's scale.
    lodZoom: options.lodZoom ?? (floor > 0 ? mapScale : 1),
    readable: frame.readable,
    numbers: frame.numbers?.texts.map((n) => n.text),
    cull: false,
    background: options.background ?? tokens.paper,
    createCanvas: (w, h) => create(w, h),
    edgeBudget,
  });
  ctx.save();
  ctx.scale(k, k);
  if (scene.title) {
    const heading = figureHeading(prepared, frame, scene.title, scene.subtitle);
    ctx.fillStyle = tokens.ink;
    ctx.font = fontOf(textTokens.figureTitle, tokens.font);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(heading.title, pad, figureMetrics.titleBaseline);
    if (options.context !== false) {
      ctx.fillStyle = tokens.neutral;
      ctx.font = fontOf(textTokens.figureText, tokens.font);
      ctx.fillText(heading.context, pad, figureMetrics.contextBaseline);
    }
  }
  if (frame.legend) {
    const { rule, x, y, width } = frame.legend;
    if (rule) {
      ctx.strokeStyle = tokens.neutral;
      ctx.globalAlpha = prepared.theme.opacity.legendRule;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(rule.x, rule.top);
      ctx.lineTo(rule.x, rule.bottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawLegend(ctx, prepared, x, y, width, tokens, { createCanvas: (w, h) => create(w, h) });
  }
  if (frame.caption || frame.note || frame.key.lines.length || frame.numbers) {
    ctx.fillStyle = tokens.ink;
    ctx.font = fontOf(textTokens.figureText, tokens.font);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (frame.caption) frame.caption.lines.forEach((line, i) => ctx.fillText(line, frame.caption!.x, frame.caption!.y + i * figureMetrics.keyLine));
    if (frame.note) ctx.fillText(frame.note.text, frame.note.x, frame.note.y);
    frame.key.lines.forEach((line, i) => ctx.fillText(line, pad, frame.key.y + i * figureMetrics.keyLine));
    frame.numbers?.lines.forEach((line, i) => ctx.fillText(line, frame.numbers!.x, frame.numbers!.y + i * figureMetrics.keyLine));
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
