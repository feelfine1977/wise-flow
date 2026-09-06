/**
 * Canvas renderer: owns a canvas element, a viewport and the interaction
 * state, draws on animation frames, and answers hit tests through the
 * scene's R-tree. Pointer and keyboard handling belong to the host (the
 * React wrapper), which calls `panBy`, `zoomBy`, `hitAt` and `setState`.
 */
import { type Box, type HitItem, type XY, emptySelection } from "../core/index";
import { type DrawContext, type DrawOptions, type DrawState, type View, drawScene } from "./draw";
import type { PreparedScene } from "./scene";
import { type CanvasTokens, defaultTokens } from "./tokens";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasRendererOptions {
  tokens?: CanvasTokens;
  devicePixelRatio?: number;
  minZoom?: number;
  maxZoom?: number;
  /** Forwarded to the drawing routines (culling, pattern tiles). */
  draw?: Omit<DrawOptions, "tokens">;
}

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: DrawContext | null;
  private scene: PreparedScene | undefined;
  private state: DrawState = { selection: emptySelection };
  private viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  private width = 0;
  private height = 0;
  private dpr: number;
  private frame: number | undefined;
  private disposed = false;
  tokens: CanvasTokens;
  minZoom: number;
  maxZoom: number;
  drawOptions: Omit<DrawOptions, "tokens">;
  /** Called after the viewport changed through `setViewport`, `panBy`, `zoomBy`, `centerOn` or `fit`. */
  onViewportChange?: (v: Viewport) => void;
  /** Statistics of the last draw. */
  lastDraw: { nodes: number; edges: number; shapes: number; culled: boolean; ms: number } | undefined;

  constructor(canvas: HTMLCanvasElement, options: CanvasRendererOptions = {}) {
    this.canvas = canvas;
    this.ctx = (canvas.getContext("2d") as DrawContext | null) ?? null;
    this.tokens = options.tokens ?? defaultTokens;
    this.dpr = options.devicePixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.minZoom = options.minZoom ?? 0.05;
    this.maxZoom = options.maxZoom ?? 3;
    this.drawOptions = options.draw ?? {};
  }

  /** Size in CSS pixels; the backing store follows the device pixel ratio. */
  resize(width: number, height: number): void {
    this.width = Math.max(0, Math.floor(width));
    this.height = Math.max(0, Math.floor(height));
    this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.requestDraw();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  setScene(scene: PreparedScene | undefined): void {
    this.scene = scene;
    this.requestDraw();
  }

  getScene(): PreparedScene | undefined {
    return this.scene;
  }

  setState(patch: Partial<DrawState>): void {
    this.state = { ...this.state, ...patch };
    this.requestDraw();
  }

  getState(): DrawState {
    return this.state;
  }

  setTokens(tokens: CanvasTokens): void {
    this.tokens = tokens;
    this.requestDraw();
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  setViewport(v: Viewport, notify = true): void {
    const zoom = Math.min(this.maxZoom, Math.max(this.minZoom, v.zoom));
    this.viewport = { x: v.x, y: v.y, zoom };
    this.requestDraw();
    if (notify) this.onViewportChange?.(this.viewport);
  }

  /** Fit the scene bounds into the canvas with a relative padding. */
  fit(padding = 0.08): void {
    if (!this.scene || this.width === 0 || this.height === 0) return;
    const b = this.scene.bounds;
    if (b.width <= 0 || b.height <= 0) return;
    const zoom = Math.min(this.width / (b.width * (1 + 2 * padding)), this.height / (b.height * (1 + 2 * padding)));
    const z = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.setViewport({ zoom: z, x: this.width / 2 - (b.x + b.width / 2) * z, y: this.height / 2 - (b.y + b.height / 2) * z });
  }

  panBy(dx: number, dy: number): void {
    this.setViewport({ ...this.viewport, x: this.viewport.x + dx, y: this.viewport.y + dy });
  }

  /** Zoom by a factor around a screen point (the centre when omitted). */
  zoomBy(factor: number, centre?: XY): void {
    const c = centre ?? { x: this.width / 2, y: this.height / 2 };
    const zoom = Math.min(this.maxZoom, Math.max(this.minZoom, this.viewport.zoom * factor));
    const k = zoom / this.viewport.zoom;
    this.setViewport({ zoom, x: c.x - (c.x - this.viewport.x) * k, y: c.y - (c.y - this.viewport.y) * k });
  }

  /** Centre a flow point on the canvas, keeping the zoom. */
  centerOn(point: XY, zoom = this.viewport.zoom): void {
    this.setViewport({ zoom, x: this.width / 2 - point.x * zoom, y: this.height / 2 - point.y * zoom });
  }

  toFlow(screenX: number, screenY: number): XY {
    return { x: (screenX - this.viewport.x) / this.viewport.zoom, y: (screenY - this.viewport.y) / this.viewport.zoom };
  }

  toScreen(flowX: number, flowY: number): XY {
    return { x: flowX * this.viewport.zoom + this.viewport.x, y: flowY * this.viewport.zoom + this.viewport.y };
  }

  /** Box of a node or group in screen coordinates. */
  screenBox(id: string): Box | undefined {
    const b = this.scene?.positions.nodes[id] ?? this.scene?.positions.groups[id];
    if (!b) return undefined;
    const p = this.toScreen(b.x, b.y);
    return { x: p.x, y: p.y, width: b.width * this.viewport.zoom, height: b.height * this.viewport.zoom };
  }

  /** The best hit under a screen point: overlays first, then nodes, edges, groups. */
  hitAt(screenX: number, screenY: number, tolerancePx = 4): HitItem | undefined {
    if (!this.scene) return undefined;
    const p = this.toFlow(screenX, screenY);
    return this.scene.hit.at(p.x, p.y, tolerancePx / this.viewport.zoom)[0];
  }

  requestDraw(): void {
    if (this.disposed || this.frame !== undefined) return;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
    this.frame = raf(() => {
      this.frame = undefined;
      this.draw();
    });
  }

  /** Draw now (synchronously). */
  draw(): void {
    if (this.disposed || !this.ctx || !this.scene || this.width === 0 || this.height === 0) return;
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    const view: View = { ...this.viewport, width: this.width, height: this.height };
    const stats = drawScene(ctx, this.scene, view, this.state, { ...this.drawOptions, tokens: this.tokens });
    ctx.restore();
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.lastDraw = { ...stats, ms: ended - started };
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
}
