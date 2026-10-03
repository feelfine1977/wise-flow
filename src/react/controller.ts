/** The map controller in React: controlled or internal state, the live region, the host callbacks and the intents. */
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementRef } from "../core/index.js";
import { type MapContext, type MapEvent, type MapState, type MapStep, announceChange, initialMapState, mapStep } from "../core/map-controller.js";
import type { ProcessMapProps } from "./types.js";

type ControlledProps = Pick<
  ProcessMapProps,
  "selection" | "onSelect" | "onHover" | "focus" | "defaultFocus" | "onFocusChange" | "abstraction" | "defaultAbstraction" | "onAbstractionChange" | "view" | "onViewChange" | "announce" | "onAction"
>;

/** What the controller's intents need from the screen; the map sets it on every render. */
export interface MapScreen {
  /** Bring a node into view. */
  reveal?: (id: string) => void;
  /** Where the menu of an element opens, relative to the map body. */
  place?: (element: ElementRef) => { x: number; y: number };
  /** Give the input focus back to the map. */
  focus?: () => void;
}

export interface DispatchedStep extends MapStep {
  /**
   * The step's sentence waits for a controlling host to take the change it
   * describes and is not in the live region yet; `announcement` is still the
   * sentence for the change.
   */
  waiting: boolean;
}

export interface MapController {
  /** The interaction state, with the values the host controls. */
  state: MapState;
  /** Text of the live region. */
  live: string;
  /** Announce a text from outside the controller (filter chips). */
  announce: (text: string) => void;
  /** Apply an event; the host's callbacks run, internal state updates, the step is returned for its other intents. */
  dispatch: (event: MapEvent) => DispatchedStep;
  /** What the controller reads about the map; the map sets it on every render. */
  context: MutableRefObject<MapContext>;
  /** What the intents do on screen. */
  screen: MutableRefObject<MapScreen>;
}

/**
 * `selection`, `focus`, `abstraction` and `view` are controlled when their
 * prop is given and internal otherwise; either way the callbacks report every
 * change. Selection and focus changes the controller did not make (the host's)
 * are announced like its own; a change the controller asks a controlling host
 * for is announced when the host takes it. Every intent is carried out here:
 * the callbacks, running a chosen action (its `run`, then `onAction`) and
 * what `screen` does.
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
  const screen = useRef<MapScreen>({});
  const propsRef = useRef(props);
  propsRef.current = props;
  // The state the next event starts from: this render's, or the last step's within one handler.
  const latest = useRef(state);
  latest.current = state;
  // The selection and focus the live region has spoken about.
  const known = useRef<Pick<MapState, "selection" | "focus">>({ selection: state.selection, focus: undefined });

  const dispatch = useCallback(function dispatch(event: MapEvent): DispatchedStep {
    const previous = latest.current;
    const result = mapStep(previous, event, context.current);
    const next = result.state;
    latest.current = next;
    const p = propsRef.current;
    // A sentence the step derived from a selection or focus change waits for a controlling host to
    // take that change (the effect below announces it then); the step's own sentences do not.
    const taken = { selection: p.selection === undefined ? next.selection : previous.selection, focus: p.focus === undefined ? next.focus : previous.focus };
    const { graph, locale } = context.current;
    const announcement = result.describesChange ? announceChange(previous, { ...taken, menu: next.menu }, graph, locale) : result.announcement;
    // The step's own sentence speaks for its whole state (a menu names the selection, an action's text the focus it set),
    // except an action's default sentence, which names only the action. A silent step speaks only for what it changed,
    // so a change still waiting for the host is announced when the host takes it.
    const own = result.announcement !== undefined && !(event.type === "actionDone" && event.text === undefined);
    known.current = result.describesChange
      ? taken
      : own
        ? { selection: next.selection, focus: next.focus }
        : { selection: next.selection === previous.selection ? known.current.selection : next.selection, focus: next.focus === previous.focus ? known.current.focus : next.focus };
    const changed = (Object.keys(next) as (keyof MapState)[]).some((key) => next[key] !== previous[key]);
    if (changed) setInner((current) => ({
      ...next,
      selection: p.selection === undefined ? next.selection : current.selection,
      focus: p.focus === undefined ? next.focus : current.focus,
      abstraction: p.abstraction === undefined ? next.abstraction : current.abstraction,
      view: p.view === undefined ? next.view : current.view,
    }));
    if (announcement !== undefined) setLive(announcement);
    for (const intent of result.intents) {
      if (intent.kind === "select") p.onSelect?.(intent.selection);
      else if (intent.kind === "focus") p.onFocusChange?.(intent.focus);
      else if (intent.kind === "hover") p.onHover?.(intent.id);
      else if (intent.kind === "abstraction") p.onAbstractionChange?.(intent.abstraction);
      else if (intent.kind === "view") p.onViewChange?.(intent.view);
      else if (intent.kind === "reveal") screen.current.reveal?.(intent.id);
      else if (intent.kind === "menu") dispatch({ type: "openMenu", element: intent.element, at: screen.current.place?.(intent.element) ?? { x: 0, y: 0 } });
      else if (intent.kind === "returnFocus") screen.current.focus?.();
      else if (intent.kind === "run") {
        // The host's text wins over the action's own.
        const fromRun = intent.action.run?.(intent.target);
        const fromHost = p.onAction?.(intent.action, intent.target);
        dispatch({ type: "actionDone", action: intent.action, text: typeof fromHost === "string" ? fromHost : typeof fromRun === "string" ? fromRun : undefined });
      }
    }
    return { ...result, waiting: announcement !== result.announcement };
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

  return { state, live, announce: setLive, dispatch, context, screen };
}
