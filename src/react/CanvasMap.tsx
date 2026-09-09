import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { type Box, type HitItem, type Locale, type XY, t } from "../core/index.js";
import { CanvasRenderer, type DrawState, type PreparedScene, readTokens } from "../canvas/index.js";

export interface CanvasMapProps {
  scene: PreparedScene | undefined;
  state: DrawState;
  locale?: Locale;
  /** Changes when a new layout arrived; the view is fitted again. */
  fitKey?: string;
  fitView?: boolean;
  /** Tooltip text for a hit. */
  describe?: (hit: HitItem) => string | undefined;
  onHover?: (hit: HitItem | null) => void;
  onClick?: (hit: HitItem | undefined, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
  /** Right click; `at` is relative to the map body. */
  onContextMenu?: (hit: HitItem | undefined, at: XY) => void;
  onViewportChange?: (v: { x: number; y: number; zoom: number }) => void;
  /** Elements listed for assistive technology (`aria-activedescendant` targets). */
  descendants?: { id: string; kind: "node" | "edge" | "group"; description: string }[];
  className?: string;
  children?: React.ReactNode;
}

export interface CanvasMapHandle {
  centerOn(id: string, zoom?: number): void;
  fit(): void;
  zoomBy(factor: number): void;
  /** Box of a node or group relative to the map body. */
  screenBox(id: string): Box | undefined;
  renderer(): CanvasRenderer | null;
}

const ZOOM_STEP = 1.2;

/**
 * Canvas renderer host: a full-size canvas with pan (drag, wheel), zoom
 * (Ctrl or Cmd with the wheel, pinch, buttons), hover and click through the
 * scene's R-tree, a tooltip with the element's description and a hidden
 * list of the elements for assistive technology. The map state (selection,
 * focus, dimming) comes from the parent; keyboard handling stays there.
 */
export const CanvasMap = forwardRef<CanvasMapHandle, CanvasMapProps>(function CanvasMap(
  { scene, state, locale = "en", fitKey, fitView = true, describe, onHover, onClick, onContextMenu, onViewportChange, descendants, className, children },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; pointerId: number } | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [overHit, setOverHit] = useState(false);
  const fitted = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const renderer = new CanvasRenderer(canvas, { tokens: readTokens(host) });
    renderer.onViewportChange = (v) => onViewportChange?.(v);
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
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setScene(scene);
    if (scene && fitView && ready && fitted.current !== fitKey) {
      fitted.current = fitKey;
      r.fit();
    }
  }, [scene, fitKey, fitView, ready]);

  useEffect(() => {
    rendererRef.current?.setState(state);
  }, [state]);

  useImperativeHandle(
    ref,
    () => ({
      centerOn(id, zoom) {
        const r = rendererRef.current;
        const b = r?.getScene()?.positions.nodes[id] ?? r?.getScene()?.positions.groups[id];
        if (!r || !b) return;
        r.centerOn({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, zoom);
      },
      fit() {
        rendererRef.current?.fit();
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
    if (e.button !== 0) return;
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
      if (d.moved) return;
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
      {descendants ? (
        <div className="wf-sr-only" data-testid="wf-canvas-descendants">
          {descendants.map((d) => (
            <span key={`${d.kind}:${d.id}`} id={`wf-${d.kind}-${d.id}`} role="img" aria-label={d.description} data-id={d.id} data-kind={d.kind} />
          ))}
        </div>
      ) : null}
      {tooltip ? (
        <div className="wf-canvas-map__tooltip" role="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      ) : null}
      <div className="wf-overlay-panel wf-overlay-panel--bottom-left">
        <div className="wf-panel wf-zoom" role="group" aria-label={t(locale, "map.fit")}>
          <button type="button" className="wf-button" aria-label={t(locale, "map.zoomIn")} onClick={() => rendererRef.current?.zoomBy(ZOOM_STEP)}>
            +
          </button>
          <button type="button" className="wf-button" aria-label={t(locale, "map.zoomOut")} onClick={() => rendererRef.current?.zoomBy(1 / ZOOM_STEP)}>
            −
          </button>
          <button type="button" className="wf-button" aria-label={t(locale, "map.fit")} onClick={() => rendererRef.current?.fit()}>
            ⤢
          </button>
        </div>
      </div>
      {children}
    </div>
  );
});
