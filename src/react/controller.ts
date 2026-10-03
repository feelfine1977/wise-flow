/** The map controller in React: controlled or internal state, the live region and the host callbacks. */
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type MapContext, type MapEvent, type MapState, type MapStep, announceChange, initialMapState, mapStep } from "../core/map-controller.js";
import type { ProcessMapProps } from "./types.js";

type ControlledProps = Pick<
  ProcessMapProps,
  "selection" | "onSelect" | "onHover" | "focus" | "defaultFocus" | "onFocusChange" | "abstraction" | "defaultAbstraction" | "onAbstractionChange" | "view" | "onViewChange" | "announce"
>;

export interface MapController {
  /** The interaction state, with the values the host controls. */
  state: MapState;
  /** Text of the live region. */
  live: string;
  /** Announce a text from outside the controller (filter chips). */
  announce: (text: string) => void;
  /** Apply an event; the host's callbacks run, internal state updates, the step is returned for its other intents. */
  dispatch: (event: MapEvent) => MapStep;
  /** What the controller reads about the map; the map sets it on every render. */
  context: MutableRefObject<MapContext>;
}

/**
 * `selection`, `focus`, `abstraction` and `view` are controlled when their
 * prop is given and internal otherwise; either way the callbacks report every
 * change. Selection and focus changes the controller did not make (the host's)
 * are announced like its own.
 */
export function useMapController(props: ControlledProps): MapController {
  const [inner, setInner] = useState<MapState>(() => initialMapState({ focus: props.defaultFocus, abstraction: props.defaultAbstraction ?? {} }));
  const state = useMemo<MapState>(
    () => ({
      ...inner,
      selection: props.selection ?? inner.selection,
      focus: props.focus === undefined ? inner.focus : (props.focus ?? undefined),
      abstraction: props.abstraction ?? inner.abstraction,
      view: props.view ?? inner.view,
    }),
    [inner, props.selection, props.focus, props.abstraction, props.view],
  );
  const [live, setLive] = useState("");
  const context = useRef<MapContext>({ graph: { nodes: [], edges: [] } });
  const propsRef = useRef(props);
  propsRef.current = props;
  // The state the next event starts from: this render's, or the last step's within one handler.
  const latest = useRef(state);
  latest.current = state;
  // The selection and focus the live region has spoken about.
  const known = useRef<Pick<MapState, "selection" | "focus">>({ selection: state.selection, focus: undefined });

  const dispatch = useCallback((event: MapEvent): MapStep => {
    const previous = latest.current;
    const result = mapStep(previous, event, context.current);
    const next = result.state;
    latest.current = next;
    known.current = { selection: next.selection, focus: next.focus };
    const p = propsRef.current;
    const changed = (Object.keys(next) as (keyof MapState)[]).some((key) => next[key] !== previous[key]);
    if (changed) setInner((current) => ({
      ...next,
      selection: p.selection === undefined ? next.selection : current.selection,
      focus: p.focus === undefined ? next.focus : current.focus,
      abstraction: p.abstraction === undefined ? next.abstraction : current.abstraction,
      view: p.view === undefined ? next.view : current.view,
    }));
    if (result.announcement !== undefined) setLive(result.announcement);
    for (const intent of result.intents) {
      if (intent.kind === "select") p.onSelect?.(intent.selection);
      else if (intent.kind === "focus") p.onFocusChange?.(intent.focus);
      else if (intent.kind === "hover") p.onHover?.(intent.id);
      else if (intent.kind === "abstraction") p.onAbstractionChange?.(intent.abstraction);
      else if (intent.kind === "view") p.onViewChange?.(intent.view);
    }
    return result;
  }, []);

  const selectionKey = JSON.stringify(state.selection);
  const focusKey = JSON.stringify(state.focus ?? null);
  useEffect(() => {
    const text = announceChange(known.current, state, context.current.graph, context.current.locale);
    known.current = { selection: state.selection, focus: state.focus };
    if (text !== undefined) setLive(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, focusKey]);
  useEffect(() => {
    if (props.announce) setLive(props.announce);
  }, [props.announce]);

  return { state, live, announce: setLive, dispatch, context };
}
