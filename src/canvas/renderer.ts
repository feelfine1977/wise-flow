/** Canvas renderer: a canvas, a viewport and the interaction state, drawn on animation frames; the host handles input. */
import { type Box, type EdgeBudget, type HitItem, type Insets, type XY, emptySelection, fitViewport } from "../core/index.js";
import { type EdgeBudgetAdapter, edgeBudgetAdapter } from "../core/edge-budget.js";
import { type DrawContext, type DrawOptions, type DrawState, type View, drawScene } from "./draw.js";
import type { PreparedScene } from "./scene.js";
import { type CanvasTokens, defaultTokens } from "./tokens.js";

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
  /**
   * Forwarded to the drawing routines (culling, pattern tiles); the edge
   * budget may also be `"adaptive"`, and the paths drawn at a small zoom
   * (`pathRule`) are decided at the zoom the view last rested at unless it
   * names one.
   */
  draw?: RendererDrawOptions;
  /** The clock (ms) the adaptive edge budget times frames with. Default `performance.now`. */
  clock?: () => number;
}

export type RendererDrawOptions = Omit<DrawOptions, "tokens" | "edgeBudget"> & { edgeBudget?: EdgeBudget | "adaptive" };

export class CanvasRenderer {
  readonly canvas: HTMLCanvasElement;
  private ctx?: DrawContext | null;
  private scene: PreparedScene | undefined;
  private state: DrawState = { selection: emptySelection };
  private viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  private width = 0;
  private height = 0;
  private dpr: number;
  private frame: number | undefined;
  private disposed = false;
  private clock: () => number;
  private adapter: EdgeBudgetAdapter | undefined;
  /** Gestures under way, and the zoom the view last rested at, which the paths drawn at a small zoom are decided at. */
  private gestures: number | undefined;
  private restZoom: number | undefined;
  private gestureZoom: number | undefined;
  /** Once the scene changed, the ids of the edges the last draw drew while withholding some. */
  private drawnIds: Set<string> | undefined;
  tokens: CanvasTokens;
  minZoom: number;
  maxZoom: number;
  drawOptions: RendererDrawOptions;
  /** Called after the viewport changed through `setViewport`, `panBy`, `zoomBy`, `centerOn` or `fit`. */
  onViewportChange?: (v: Viewport) => void;
  /** Statistics of the last draw; `withheld` when the edge budget left edges in view out. */
  lastDraw: (ReturnType<typeof drawScene> & { ms: number }) | undefined;
  /** Called after every draw with its statistics. */
  onDraw?: (stats: NonNullable<CanvasRenderer["lastDraw"]>) => void;

  constructor(canvas: HTMLCanvasElement, options: CanvasRendererOptions = {}) {
    this.canvas = canvas;
    this.ctx = (canvas.getContext("2d") as DrawContext | null) ?? null;
    this.tokens = options.tokens ?? defaultTokens;
    this.dpr = options.devicePixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.minZoom = options.minZoom ?? 0.05;
    this.maxZoom = options.maxZoom ?? 3;
    this.drawOptions = options.draw ?? {};
    this.clock = options.clock ?? (() => performance.now());
  }

  /** Size in CSS pixels; the backing store follows the device pixel ratio. */
  resize(width: number, height: number): void {
    if (this.disposed) return;
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
    if (this.disposed || scene === this.scene) return void this.requestDraw();
    const cut = this.lastDraw?.withheld;
    if (cut && !this.drawnIds) this.drawnIds = new Set([...cut.drawn].map((i) => this.scene!.edgeMarks[i].id));
    this.scene = scene;
    this.requestDraw();
  }

  getScene(): PreparedScene | undefined {
    return this.scene;
  }

  setState(patch: Partial<DrawState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.requestDraw();
  }

  getState(): DrawState {
    return this.state;
  }

  setTokens(tokens: CanvasTokens): void {
    if (this.disposed) return;
    this.tokens = tokens;
    this.requestDraw();
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  setViewport(v: Viewport, notify = true): void {
    if (this.disposed) return;
    const zoom = Math.min(this.maxZoom, Math.max(this.minZoom, v.zoom));
    this.viewport = { x: v.x, y: v.y, zoom };
    this.requestDraw();
    if (notify) this.onViewportChange?.(this.viewport);
  }

  /** Fit the scene bounds into the canvas less `insets` (screen pixels kept clear along each side), with a relative padding. */
  fit(padding = 0.08, insets?: Partial<Insets>): void {
    if (!this.scene || this.width === 0 || this.height === 0) return;
    const b = this.scene.bounds;
    if (b.width <= 0 || b.height <= 0) return;
    this.setViewport(fitViewport(b, this.size, { padding, insets, minZoom: this.minZoom, maxZoom: this.maxZoom }));
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

  /** The best hit under a screen point: overlays first, then nodes, edges, groups; not an edge the last draw withheld. */
  hitAt(screenX: number, screenY: number, tolerancePx = 4): HitItem | undefined {
    if (!this.scene) return undefined;
    const p = this.toFlow(screenX, screenY);
    const cut = this.lastDraw?.withheld;
    // A scene not drawn yet is answered by the ids the last draw drew.
    return this.scene.hit.at(p.x, p.y, tolerancePx / this.viewport.zoom).find((it) => !cut || it.kind !== "edge" || (this.drawnIds ? this.drawnIds.has(it.id) : it.index === undefined || cut.drawn.has(it.index)));
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
    const { edgeBudget, pathRule, ...options } = this.drawOptions;
    // The paths drawn at a small zoom change only when the view is at rest, as the adaptive budget does.
    if (!this.gestures) this.restZoom = this.viewport.zoom;
    const rule = pathRule && { ...pathRule, zoom: pathRule.zoom ?? this.restZoom };
    let stats!: ReturnType<typeof drawScene>;
    const run = (budget: EdgeBudget | undefined) => {
      // The level of detail is picked per frame, within the hysteresis of the frame before.
      stats = drawScene(ctx, this.scene!, view, this.state, { readableFrom: this.lastDraw?.readable, ...options, edgeBudget: budget, pathRule: rule, tokens: this.tokens });
      return { shown: stats.edges, total: stats.withheld?.total ?? stats.edges, kept: stats.kept };
    };
    if (edgeBudget === "adaptive") (this.adapter ??= edgeBudgetAdapter(this.clock)).frame(run);
    else run(edgeBudget);
    ctx.restore();
    const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
    this.drawnIds = undefined;
    this.lastDraw = { ...stats, ms: ended - started };
    this.onDraw?.(this.lastDraw);
  }

  /** A pan or zoom starts: an adaptive edge budget times its frames, and the paths drawn stay as they are until the view rests. */
  beginGesture(): void {
    if (this.disposed) return;
    if (!this.gestures) this.gestureZoom = this.viewport.zoom;
    this.gestures = (this.gestures ?? 0) + 1;
    (this.adapter ??= edgeBudgetAdapter(this.clock)).start();
  }

  /** It ends: an adaptive edge budget may move a step, only with the zoom direction when a path rule is active; once no gesture is under way the view is at rest and drawn. */
  endGesture(): void {
    if (this.gestures) this.gestures--;
    const stepped = this.adapter?.end(this.drawOptions.pathRule ? this.viewport.zoom - this.gestureZoom! : undefined);
    if (stepped || (!this.gestures && this.drawOptions.pathRule && this.restZoom !== this.viewport.zoom)) this.requestDraw();
  }

  /** Lets go of the scene, the context and the callbacks; every method that changes something then returns early. */
  dispose(): void {
    this.disposed = true;
    if (this.frame !== undefined && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
    this.frame = this.scene = this.drawnIds = this.ctx = this.adapter = this.onDraw = this.onViewportChange = this.gestures = this.restZoom = this.gestureZoom = undefined;
  }
}
