import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  type AbstractOptions,
  type Box,
  type ConstraintDescription,
  type ConstraintStats,
  type EdgeSelection,
  type FlowGraph,
  type FlowScene,
  type FlowSceneOptions,
  type LayoutOptions,
  type Overlay,
  type OverlayPresetOptions,
  type Positions,
  type ShownEdges,
  type XY,
  LayoutUnavailableError,
  abstract,
  buildScene,
  createLayoutScope,
  createPositions,
  filterPositions,
  overlaysFor,
  unionGraph,
} from "../core/index.js";
import { knownLayout } from "../core/layout.js";
import { layoutInputKey } from "../core/layout-key.js";
import { provisionalLayout, reusePositions } from "../core/provisional.js";

/** Abstracted graph, recomputed when the graph or the options change. */
export function useFlowGraph(graph: FlowGraph, options?: AbstractOptions): FlowGraph {
  const key = JSON.stringify(options ?? {});
  return useMemo(() => (options ? abstract(graph, options) : graph), [graph, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type LayoutStatus = "idle" | "pending" | "ready" | "error";

export interface StableLayout {
  positions: Positions | undefined;
  status: LayoutStatus;
  error?: Error;
  /**
   * True while `positions` are an arrangement shown until the layout arrives
   * (status `pending`): the earlier positions of the nodes still present with
   * new nodes beside their neighbours, or a provisional arrangement. Also true
   * when they stay instead of a layout that is unavailable (status `error`
   * with a `LayoutUnavailableError`).
   */
  provisional: boolean;
}

/**
 * Lay out the union of one or more scenes once; the result serves every scene so
 * that compared maps keep identical positions. Recomputes when the scenes or the
 * options change; stale results are discarded. Layouts are kept per component
 * by their inputs and released on unmount. Until a layout arrives, `positions`
 * holds a finished layout of the same inputs if the component has one (status
 * `ready`), otherwise a provisional arrangement (`provisional`, status `pending`).
 * A layout the component no longer shows is aborted.
 */
export function useStableLayout(scenes: FlowGraph | FlowGraph[] | undefined, options?: LayoutOptions): StableLayout {
  const list = useMemo(() => (scenes === undefined ? [] : Array.isArray(scenes) ? scenes : [scenes]), [scenes]);
  const union = useMemo(() => (list.length === 0 ? undefined : unionGraph(list)), [list]);
  // Size callbacks count by the dimensions they return, and an `elk` instance made anew on each render is the same
  // engine, so equivalent options do not restart layout.
  const inputs = union ? layoutInputKey(union, { ...options, elk: undefined }) : undefined;
  const [scope] = useState(createLayoutScope);
  // Released on unmount; mounted again before the task ends (StrictMode), the scope keeps its layouts and the
  // layout that is running is joined again rather than started twice.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      queueMicrotask(() => mounted.current || scope.dispose());
    };
  }, [scope]);
  const shown = useRef<Positions>(undefined);
  // What a request shows until its layout arrives.
  const request = useMemo(() => {
    if (!union) return undefined;
    const known = knownLayout(scope, union, options);
    const reused = known ?? (shown.current && reusePositions(union, shown.current, options));
    return { known, positions: reused ?? provisionalLayout(union, options) };
  }, [union, inputs, options?.cacheKey, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const [result, setResult] = useState<{ request: unknown; positions?: Positions; error?: Error }>();
  useEffect(() => {
    if (!union) return;
    const stop = new AbortController();
    scope.layout(union, { ...options, signal: stop.signal }).then(
      (positions) => !stop.signal.aborted && setResult({ request, positions }),
      (error: Error) => !stop.signal.aborted && setResult({ request, error }),
    );
    return () => stop.abort();
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = useMemo<StableLayout>(() => {
    if (!request) return { positions: undefined, status: "idle", provisional: false };
    if (result?.request === request) {
      const { error } = result;
      if (!error) return { positions: result.positions, status: "ready", provisional: false };
      const kept = error instanceof LayoutUnavailableError;
      return { positions: kept ? request.positions : undefined, status: "error", error, provisional: kept };
    }
    return request.known ? { positions: request.known, status: "ready", provisional: false } : { positions: request.positions, status: "pending", provisional: true };
  }, [request, result]);
  if (state.positions) shown.current = state.positions;
  return state;
}

/** Overlays for a list of constraints with statistics, memoised. */
export function useOverlays(
  items: { description: ConstraintDescription; stats?: ConstraintStats }[] | undefined,
  options?: OverlayPresetOptions,
): Overlay[] {
  return useMemo(() => (items ? overlaysFor(items, options) : []), [items, options?.graph, options?.locale, options?.outOfScopeMinShare]); // eslint-disable-line react-hooks/exhaustive-deps
}

export type MapSceneOptions = Pick<FlowSceneOptions, "overlays" | "style" | "locale" | "lanes" | "activityLabels" | "selfLoops" | "lod">;

export interface MapScene {
  /** Built on empty positions while none are known. */
  scene: FlowScene;
  positions: Positions | undefined;
  /** Before the manual moves. */
  laidPositions: Positions | undefined;
}

const NO_POSITIONS = createPositions({ nodes: {}, groups: {}, edges: {} }, "given", "RIGHT");

/** The scene of a live map; the scene before the manual moves is kept for dragging. */
export function useMapScene(graph: FlowGraph, source: Positions | undefined, moved: Readonly<Record<string, XY>>, options: MapSceneOptions): MapScene {
  const { overlays, style, locale, lanes, activityLabels, selfLoops, lod } = options;
  const filtered = useMemo(() => source && filterPositions(source, graph), [source, graph]);
  const sceneOptions = useMemo<FlowSceneOptions>(
    () => ({ overlays, style, locale, lanes, activityLabels, selfLoops, lod, lodBySize: true }),
    [overlays, style, locale, lanes, activityLabels, selfLoops, lod],
  );
  const laid = useMemo(() => buildScene(graph, filtered ?? NO_POSITIONS, sceneOptions), [graph, filtered, sceneOptions]);
  const hasMoves = filtered !== undefined && Object.keys(moved).length > 0;
  const scene = useMemo(() => (hasMoves ? buildScene(graph, filtered, { ...sceneOptions, moved }) : laid), [hasMoves, graph, filtered, sceneOptions, moved, laid]);
  return { scene, positions: filtered && scene.positions, laidPositions: filtered && laid.positions };
}

/** True when the user asked for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return reduced;
}

/** Milliseconds a layout takes to move into the place of a provisional arrangement. */
const ARRIVAL_MS = 300;

export interface Arrival {
  /** The positions to draw; on the way from the provisional arrangement to the layout while `moving`. */
  positions: Positions | undefined;
  moving: boolean;
  /** Counts the layouts that replaced a provisional arrangement. */
  count: number;
}

const mix = (a: Box, b: Box, t: number): Box => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, width: a.width + (b.width - a.width) * t, height: a.height + (b.height - a.height) * t });

function between(from: Positions, to: Positions, t: number): Positions {
  const s = t * t * (3 - 2 * t);
  const part = (a: Record<string, Box>, b: Record<string, Box>) => {
    const out: Record<string, Box> = {};
    for (const id in b) out[id] = a[id] ? mix(a[id], b[id], s) : b[id];
    return out;
  };
  // Edges are drawn straight between the moving boxes until the layout's routes arrive.
  return createPositions({ nodes: part(from.nodes, to.nodes), groups: part(from.groups, to.groups), edges: {} }, to.engine, to.direction);
}

/**
 * Positions as drawn: a layout that replaces a provisional arrangement moves
 * there over a short time, or at once when `still` (reduced motion); any other
 * change is drawn at once.
 */
export function useArrival(positions: Positions | undefined, provisional: boolean, still: boolean): Arrival {
  const [arrival, setArrival] = useState<{ to?: Positions; provisional: boolean; from?: Positions; count: number }>({ to: positions, provisional, count: 0 });
  const [progress, setProgress] = useState(1);
  const drawn = useMemo(() => (arrival.from && arrival.to && progress < 1 ? between(arrival.from, arrival.to, progress) : arrival.to), [arrival, progress]);
  if (arrival.to !== positions || arrival.provisional !== provisional) {
    const replaces = arrival.provisional && !provisional && !!drawn && !!positions;
    setArrival({ to: positions, provisional, from: replaces ? drawn : undefined, count: arrival.count + (replaces ? 1 : 0) });
    setProgress(replaces && !still && typeof requestAnimationFrame === "function" ? 0 : 1);
  }
  useEffect(() => {
    if (!arrival.from || progress >= 1) return;
    let start: number | undefined;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / ARRIVAL_MS);
      setProgress(t);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    let frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [arrival]); // eslint-disable-line react-hooks/exhaustive-deps
  return { positions: drawn, moving: progress < 1, count: arrival.count };
}

/** Reports the edges a map draws to `onEdgesShown` when they change. */
export function useEdgesShown(onEdgesShown: ((shown: ShownEdges | undefined) => void) | undefined) {
  const callback = useRef(onEdgesShown);
  const last = useRef("");
  useLayoutEffect(() => {
    // Nobody listens: whoever listens next is told from every edge drawn.
    if (!onEdgesShown) last.current = "";
    callback.current = onEdgesShown;
  });
  return useCallback((withheld: EdgeSelection | undefined, marks: readonly { id: string }[]) => {
    // Nobody listens: start again from every edge drawn.
    if (!callback.current) return void (last.current = "");
    const edges = withheld ? [...withheld.drawn].sort((a, b) => a - b).map((i) => marks[i].id) : [];
    const key = withheld ? `${withheld.total}\n${edges.join("\n")}` : "";
    if (key === last.current) return;
    last.current = key;
    callback.current(withheld && { edges, total: withheld.total });
  }, []);
}

/** Reports for both renderers; a switch, and a Canvas map drawn again after the table view, start again from every edge drawn. */
export function useEdgesShownAcross(onEdgesShown: ((shown: ShownEdges | undefined) => void) | undefined, canvas: boolean, mapShown = true) {
  const callback = useRef(onEdgesShown);
  useLayoutEffect(() => void (callback.current = onEdgesShown));
  const told = useRef<ShownEdges | undefined>(undefined);
  const tell = useCallback((shown: ShownEdges | undefined) => {
    told.current = shown;
    callback.current?.(shown);
  }, []);
  useLayoutEffect(() => {
    if (told.current) tell(undefined);
  }, [canvas, tell]);
  // A Canvas map that comes back reports only what it withholds, not that it withholds nothing.
  const canvasShown = canvas && mapShown;
  useLayoutEffect(() => {
    if (canvasShown && told.current) tell(undefined);
  }, [canvasShown, tell]);
  return onEdgesShown && tell;
}
