import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AbstractOptions,
  type ConstraintDescription,
  type ConstraintStats,
  type FlowGraph,
  type FlowScene,
  type FlowSceneOptions,
  type LayoutOptions,
  type Overlay,
  type OverlayPresetOptions,
  type Positions,
  type XY,
  abstract,
  buildScene,
  createPositions,
  defaultNodeSize,
  filterPositions,
  layoutUnion,
  overlaysFor,
} from "../core/index.js";

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
}

/**
 * Lay out the union of one or more scenes once; the result serves every scene so
 * that compared maps keep identical positions. Recomputes when the scenes or the
 * options change; stale results are discarded.
 */
export function useStableLayout(scenes: FlowGraph | FlowGraph[] | undefined, options?: LayoutOptions): StableLayout {
  const list = useMemo(() => (scenes === undefined ? [] : Array.isArray(scenes) ? scenes : [scenes]), [scenes]);
  const optionsKey = JSON.stringify({
    ...options,
    // Functions disappear from JSON. Compare their resolved dimensions instead of
    // identities so equivalent callbacks do not restart layout on every render.
    nodeSize: list.map((scene) => scene.nodes.map((node) => [node.id, typeof options?.nodeSize === "function" ? options.nodeSize(node) : options?.nodeSize ?? defaultNodeSize(node)])),
    elk: undefined,
    elkWorkerUrl: options?.elkWorkerUrl ? String(options.elkWorkerUrl) : undefined,
  });
  const [state, setState] = useState<StableLayout>({ positions: undefined, status: "idle" });
  const token = useRef(0);
  useEffect(() => {
    if (list.length === 0) {
      setState({ positions: undefined, status: "idle" });
      return;
    }
    const counter = token;
    const id = ++counter.current;
    setState((s) => ({ ...s, status: "pending" }));
    layoutUnion(list, options)
      .then((positions) => {
        if (counter.current === id) setState({ positions, status: "ready" });
      })
      .catch((error: Error) => {
        if (counter.current === id) setState({ positions: undefined, status: "error", error });
      });
    return () => {
      counter.current++;
    };
  }, [list, optionsKey]); // eslint-disable-line react-hooks/exhaustive-deps
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
