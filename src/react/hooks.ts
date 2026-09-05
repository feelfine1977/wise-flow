import { useEffect, useMemo, useRef, useState } from "react";
import {
  type AbstractOptions,
  type ConstraintDescription,
  type ConstraintStats,
  type FlowGraph,
  type LayoutOptions,
  type Overlay,
  type OverlayPresetOptions,
  type Positions,
  abstract,
  layoutUnion,
  overlaysFor,
} from "../core/index";

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
  const optionsKey = JSON.stringify({ ...options, elk: undefined, elkWorkerUrl: options?.elkWorkerUrl ? String(options.elkWorkerUrl) : undefined });
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
