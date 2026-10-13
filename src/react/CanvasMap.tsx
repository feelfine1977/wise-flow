import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Box, type EdgeBudget, type HitItem, type Insets, type Locale, type ShownEdges, type ThemeSetting, type XY, formatCount, t, themeColors, viewTokens } from "../core/index.js";
import { CanvasRenderer, type DrawState, type PreparedScene, type Viewport } from "../canvas/index.js";
import { sceneTokens } from "../canvas/tokens.js";
import { PathsNotShown, useEdgesShown } from "./hooks.js";
import { part } from "./parts.js";
import { MapOverview, ZoomControl, clearOfPanels, openingIn } from "./primitives.js";
import { useFlowTheme } from "./theme.js";

export interface CanvasMapProps {
  scene: PreparedScene | undefined;
  state: DrawState;
  locale?: Locale;
  /** Changes when a new layout arrived; the map opens again (`opening`). */
  fitKey?: string;
  fitView?: boolean;
  /**
   * The view the map opens at, and opens at again when `fitKey` changes:
   * `"readable"` (default) fits it where the whole map fits at a zoom of 0.75
   * or more, and otherwise opens at 0.75 on the start of the process with an
   * overview of the whole map in a free corner; `"fit"` always fits it.
   */
  opening?: "readable" | "fit";
  /**
   * Changes when the map's graph is replaced: the map opens again by
   * `opening`. Until then, once the person pressed the fit button, a change
   * of `fitKey` fits the map instead of opening it. Default: the scene's graph object.
   */
  openKey?: string | number;
  /**
   * The narrowest line, in screen pixels, of a path the map draws
   * (`pathsAtZoom`), decided at the zoom the view last rested at. Default
   * `viewTokens.pathPx` (0.5); 0 draws every path at every zoom.
   */
  minPathPx?: number;
  /** Room kept clear along each side when the view is fitted, in screen pixels; by default clear of the panels over the map. */
  fitInsets?: Partial<Insets>;
  /** Tooltip text for a hit. */
  describe?: (hit: HitItem) => string | undefined;
  onHover?: (hit: HitItem | null) => void;
  onClick?: (hit: HitItem | undefined, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  /** Right click; `at` is relative to the map body. */
  onContextMenu?: (hit: HitItem | undefined, at: XY) => void;
  onViewportChange?: (v: { x: number; y: number; zoom: number }) => void;
  /** Elements listed for assistive technology (`aria-activedescendant` targets). */
  descendants?: { id: string; kind: "node" | "edge" | "group"; description: string }[];
  /** How many of the edges in view are drawn (`budgetEdges`), or `"adaptive"` (default): a step fitted to the frame time of gestures. A note says when edges are withheld, by the budget or at a small zoom. */
  edgeBudget?: EdgeBudget | "adaptive";
  /** The clock (ms) the adaptive edge budget times frames with, read from mount. Default `performance.now`. */
  clock?: () => number;
  /** Called with the note once its numbers have settled, for a live region. */
  onAnnounce?: (text: string) => void;
  /** Called when the edges drawn change: while the budget withholds some, with those drawn (for `toSVG` and `toPNG`); undefined once every edge is drawn again. */
  onEdgesShown?: (shown: ShownEdges | undefined) => void;
  /**
   * The colours and font the map is drawn in: a preset's name or changes over
   * a preset, over the `--wf-*` CSS variables of the map's element, set there
   * or inherited (`useFlowTheme`). Sizes, radii and strokes are the scene's.
   */
  theme?: ThemeSetting;
  className?: string;
  children?: React.ReactNode;
}

export interface CanvasMapHandle {
  centerOn(id: string, zoom?: number): void;
  /**
   * Fit the map into the canvas less `insets` (screen pixels kept clear along
   * each side); without them, clear of the panels over the map (its
   * `.wf-overlay-panel` children), so that none covers an activity.
   */
  fit(insets?: Partial<Insets>): void;
  /** True when the view changed since the map last opened or was fitted. */
  moved(): boolean;
  zoomBy(factor: number): void;
  /** Box of a node or group relative to the map body. */
  screenBox(id: string): Box | undefined;
  renderer(): CanvasRenderer | null;
}

const ZOOM_STEP = 1.2;
const FIT_PADDING = 0.08;

/** The note shown while the edge budget withholds edges, announced once its numbers settle. */
export function EdgeNote({ withheld, locale, onAnnounce }: { withheld?: { shown: number; total: number; highlightedNotShown?: number }; locale: Locale; onAnnounce?: (text: string) => void }) {
  // How many highlighted paths are not shown, where the budget withholds some of them.
  const highlighted = withheld?.highlightedNotShown;
  const text = withheld && t(locale, highlighted ? "map.edges.withheldHighlighted" : "map.edges.withheld", { shown: formatCount(withheld.shown, locale), total: formatCount(withheld.total, locale), highlighted: formatCount(highlighted ?? 0, locale) });
  useEffect(() => {
    if (!text || !onAnnounce) return;
    const timer = setTimeout(() => onAnnounce(text), 400);
    return () => clearTimeout(timer);
  }, [text, onAnnounce]);
  return text ? (
    <div className="wf-panel wf-edge-note" {...part("status")} role="note" data-testid="wf-edge-note">
      {text}
    </div>
  ) : null;
}

/**
 * Canvas renderer host: a full-size canvas with pan (drag, wheel), zoom
 * (Ctrl or Cmd with the wheel, pinch, buttons), hover and click through the
 * scene's R-tree, a tooltip with the element's description and a hidden
 * list of the elements for assistive technology. The map state (selection,
 * focus, dimming) comes from the parent; keyboard handling stays there.
 */
export const CanvasMap = forwardRef<CanvasMapHandle, CanvasMapProps>(function CanvasMap(
  { scene, state, locale = "en", fitKey, fitView = true, fitInsets, opening = "readable", openKey, minPathPx = viewTokens.pathPx, describe, onHover, onClick, onContextMenu, onViewportChange, descendants, edgeBudget = "adaptive", clock, onAnnounce, onEdgesShown, theme, className, children },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);
  const wheeling = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overHit, setOverHit] = useState(false);
  const fitted = useRef<{ key?: string; graph: unknown }>(undefined);
  const fittedView = useRef<unknown>(undefined);
  const [zoom, setZoom] = useState<number>();
  const fitInsetsRef = useRef(fitInsets);
  fitInsetsRef.current = fitInsets;
  const openingRef = useRef(opening);
  openingRef.current = opening;
  // The overview while the map opened on its start, and the view it marks.
  const [overview, setOverview] = useState<Box>();
  const [view, setView] = useState<Viewport>();
  // Once the person pressed the fit button, the map is fitted rather than opened, until its graph is replaced (`openKey`).
  const fittedByPerson = useRef(false);
  const fitNow = (insets?: Partial<Insets>, overviewToo = true) => {
    const r = rendererRef.current;
    const host = hostRef.current;
    const bounds = r?.getScene()?.bounds;
    if (!r) return;
    r.fit(FIT_PADDING, insets ?? fitInsetsRef.current ?? (host && bounds ? clearOfPanels(host, bounds, FIT_PADDING, r, host, overviewToo) : undefined));
    fittedView.current = r.getViewport();
  };
  /** Opens the map: fitted where that is readable, otherwise on its start with the overview (`opening`). */
  const openNow = () => {
    const r = rendererRef.current;
    const host = hostRef.current;
    const opened = r?.getScene();
    if (!r || !host || !opened) return;
    const open = openingRef.current === "fit" || fittedByPerson.current || !(opened.bounds.width > 0) || !(opened.bounds.height > 0) ? undefined : openingIn(host, opened.bounds, opened.graph.nodes, opened.positions, { padding: FIT_PADDING, minZoom: r.minZoom, maxZoom: r.maxZoom, insets: fitInsetsRef.current });
    setOverview(open?.overview);
    if (!open || open.fitted) return fitNow(undefined, false);
    r.setViewport(open);
    fittedView.current = r.getViewport();
  };
  const [ready, setReady] = useState(false);
  const [withheld, setWithheld] = useState<{ shown: number; total: number; highlightedNotShown: number }>();
  const withheldKey = useRef("");
  const reportShown = useEdgesShown(onEdgesShown);
  const tellPaths = useRef<((count: number | undefined) => void) | undefined>(undefined);
  tellPaths.current = useContext(PathsNotShown);
  // The colours and the font follow the theme, the host's CSS variables and the colour scheme.
  const look = useFlowTheme(hostRef, theme);
  const tokens = useMemo(() => sceneTokens({ theme: look.theme, colors: themeColors(look.theme, look.scheme) }), [look]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const renderer = new CanvasRenderer(canvas, { tokens, clock });
    renderer.onViewportChange = (v) => {
      setZoom(v.zoom);
      setView(v);
      onViewportChange?.(v);
    };
    renderer.onDraw = ({ withheld: w }) => {
      reportShown(w, renderer.getScene()?.edgeMarks ?? []);
      tellPaths.current?.(w?.pathsNotShown);
      const key = w ? `${w.shown}/${w.total}/${w.highlightedNotShown}` : "";
      if (key === withheldKey.current) return;
      withheldKey.current = key;
      setWithheld(w && { shown: w.shown, total: w.total, highlightedNotShown: w.highlightedNotShown });
    };
    rendererRef.current = renderer;
    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.resize(rect.width || host.clientWidth || 800, rect.height || host.clientHeight || 600);
      setReady(true);
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : undefined;
    ro?.observe(host);
    return () => {
      ro?.disconnect();
      clearTimeout(wheeling.current);
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setScene(scene);
    if (scene && fitView && ready && (!fitted.current || fitted.current.key !== fitKey || fitted.current.graph !== (openKey ?? scene.graph))) {
      if (fitted.current?.graph !== (openKey ?? scene.graph)) fittedByPerson.current = false;
      fitted.current = { key: fitKey, graph: openKey ?? scene.graph };
      openNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, fitKey, openKey, fitView, ready]);

  useEffect(() => {
    rendererRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    const r = rendererRef.current;
    if (r && r.tokens !== tokens) r.setTokens(tokens);
  }, [tokens]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.drawOptions = { ...r.drawOptions, edgeBudget, pathRule: minPathPx > 0 ? { minPx: minPathPx } : undefined };
    r.requestDraw();
  }, [edgeBudget, minPathPx]);

  // A host that starts listening is told what the next draw withholds.
  const listening = !!onEdgesShown;
  useEffect(() => {
    if (listening) rendererRef.current?.requestDraw();
  }, [listening]);

  useImperativeHandle(
    ref,
    () => ({
      centerOn(id, zoom) {
        const r = rendererRef.current;
        const b = r?.getScene()?.positions.nodes[id] ?? r?.getScene()?.positions.groups[id];
        if (!r || !b) return;
        r.centerOn({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, zoom);
      },
      fit: (insets) => fitNow(insets),
      moved() {
        return !!fittedView.current && rendererRef.current?.getViewport() !== fittedView.current;
      },
      zoomBy(factor) {
        rendererRef.current?.zoomBy(factor);
      },
      screenBox(id) {
        return rendererRef.current?.screenBox(id);
      },
      renderer() {
        return rendererRef.current;
      },
    }),
    [],
  );

  const local = (e: { clientX: number; clientY: number }): XY => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest(".wf-panel")) return;
    // A drag whose release was lost ends here.
    if (drag.current?.moved) rendererRef.current?.endGesture();
    const p = local(e);
    drag.current = { x: p.x, y: p.y, moved: false, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const r = rendererRef.current;
      if (!r) return;
      const p = local(e);
      if (drag.current) {
        const dx = p.x - drag.current.x;
        const dy = p.y - drag.current.y;
        if (drag.current.moved || Math.hypot(dx, dy) > 3) {
          if (!drag.current.moved) r.beginGesture();
          drag.current.moved = true;
          setDragging(true);
          r.panBy(dx, dy);
          drag.current.x = p.x;
          drag.current.y = p.y;
          setTooltip(null);
        }
        return;
      }
      const hit = r.hitAt(p.x, p.y);
      const id = hit ? (hit.kind === "overlay" ? (hit.shapeId ?? hit.id) : hit.id) : null;
      const prev = r.getState().hovered ?? null;
      if (id !== prev) onHover?.(hit ?? null);
      setOverHit(!!hit);
      const text = hit ? describe?.(hit) : undefined;
      setTooltip(text ? { x: p.x + 12, y: p.y + 14, text } : null);
    },
    [onHover, describe],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const r = rendererRef.current;
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      if (!r || !d) return;
      if (d.moved) return r.endGesture();
      const p = local(e);
      onClick?.(r.hitAt(p.x, p.y), { shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
    },
    [onClick],
  );

  const onPointerLeave = useCallback(() => {
    setTooltip(null);
    setOverHit(false);
    if (rendererRef.current?.getState().hovered) onHover?.(null);
  }, [onHover]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const r = rendererRef.current;
    if (!r) return;
    e.preventDefault();
    // A wheel gesture ends 200 ms after its last event.
    if (wheeling.current === undefined) r.beginGesture();
    clearTimeout(wheeling.current);
    wheeling.current = setTimeout(() => {
      wheeling.current = undefined;
      r.endGesture();
    }, 200);
    const p = local(e);
    if (e.ctrlKey || e.metaKey) {
      r.zoomBy(Math.exp(-e.deltaY * 0.01), p);
    } else {
      r.panBy(-e.deltaX, -e.deltaY);
    }
    setTooltip(null);
  }, []);

  // React attaches wheel listeners passively; a native listener is needed to prevent page scrolling.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handler = (e: WheelEvent) => e.preventDefault();
    host.addEventListener("wheel", handler, { passive: false });
    return () => host.removeEventListener("wheel", handler);
  }, []);

  const onContext = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const r = rendererRef.current;
      if (!r) return;
      const p = local(e);
      onContextMenu?.(r.hitAt(p.x, p.y), p);
    },
    [onContextMenu],
  );

  // Not rebuilt when the note changes.
  const listed = useMemo(
    () =>
      descendants ? (
        <div className="wf-sr-only" data-testid="wf-canvas-descendants">
          {descendants.map((d) => (
            <span key={`${d.kind}:${d.id}`} id={`wf-${d.kind}-${d.id}`} role="img" aria-label={d.description} data-id={d.id} data-kind={d.kind} />
          ))}
        </div>
      ) : null,
    [descendants],
  );

  return (
    <div
      ref={hostRef}
      className={`wf-canvas-map${dragging ? " wf-canvas-map--dragging" : ""}${overHit && !dragging ? " wf-canvas-map--hit" : ""}${className ? ` ${className}` : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onWheel={onWheel}
      onContextMenu={onContext}
      data-testid="wf-canvas-map"
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      {listed}
      {tooltip ? (
        <div className="wf-tooltip wf-canvas-map__tooltip" {...part("tooltip")} role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      ) : null}
      {withheld ? (
        <div className="wf-overlay-panel wf-overlay-panel--bottom-center">
          <EdgeNote withheld={withheld} locale={locale} onAnnounce={onAnnounce} />
        </div>
      ) : null}
      <div className="wf-overlay-panel wf-overlay-panel--bottom-left">
        <ZoomControl zoom={zoom} locale={locale} onZoomIn={() => rendererRef.current?.zoomBy(ZOOM_STEP)} onZoomOut={() => rendererRef.current?.zoomBy(1 / ZOOM_STEP)} onFit={() => {
            fittedByPerson.current = true;
            fitNow();
          }}
        />
      </div>
      {overview && scene && view && rendererRef.current ? (
        <MapOverview bounds={scene.bounds} nodes={scene.positions.nodes} view={view} area={rendererRef.current.size} at={overview} locale={locale} onMove={(p) => rendererRef.current?.centerOn(p)} />
      ) : null}
      {children}
    </div>
  );
});
