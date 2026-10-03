/**
 * Map controller: the interaction state of a map (selection, the focus of
 * paths, abstraction, view, the element the keyboard is on, hover, the
 * actions menu) and the transitions a click, a key, a hover or a focus makes.
 * A transition returns the next state, the sentence for the live region and
 * the intents the host carries out (callbacks, bringing an element into view,
 * placing the menu on screen). No DOM and no React.
 */
import { type MenuAction, type MenuTarget, defaultActions, menuTargetFor } from "./actions.js";
import { type AbstractOptions } from "./aggregate.js";
import { describeEdge } from "./describe.js";
import { type Locale } from "./format.js";
import { type Positions } from "./layout.js";
import { type FlowGraph, indexGraph } from "./model.js";
import { type Focus } from "./paths.js";
import { type ElementRef, type Selection, describeSelection, emptySelection, isSelected, selectElement, selectionEquals } from "./selection.js";
import { t } from "./strings.js";

export type MapView = "map" | "table";

export interface MapMenu {
  /** The element the menu was opened on. */
  element: ElementRef;
  target: MenuTarget;
  actions: MenuAction[];
  /** Where the menu is shown, relative to the map body. */
  at: { x: number; y: number };
}

export interface MapState {
  selection: Selection;
  /** The focus of paths the map was given or chose (not the pair a selection implies). */
  focus: Focus | undefined;
  abstraction: AbstractOptions;
  view: MapView;
  /** Node or edge the keyboard is on (`aria-activedescendant`). */
  active: string | null;
  hovered: string | null;
  /** The map or an element inside it has the input focus. */
  focusWithin: boolean;
  /** Index of the path last chosen with Alt and an arrow key, per activity and direction. */
  cycle: Readonly<Record<string, number>>;
  menu: MapMenu | null;
}

export type MapEvent =
  /** A click on an element, or beside all elements (`null`); Shift, Ctrl or Cmd make it `multi`. */
  | { type: "click"; element: ElementRef | null; multi?: boolean }
  /** A selection chosen elsewhere (a table row, a path in the list, an arc). */
  | { type: "select"; selection: Selection }
  | { type: "hover"; id: string | null }
  /** The input focus entered the map, on the element `id` if it is one. */
  | { type: "focusIn"; id?: string }
  | { type: "focusOut" }
  | { type: "key"; key: string; shiftKey?: boolean; altKey?: boolean }
  | { type: "openMenu"; element: ElementRef; at: { x: number; y: number } }
  /** The menu was closed by the user (Escape, a click outside); announced. */
  | { type: "closeMenu" }
  /** The menu goes away because something else happened; not announced. */
  | { type: "dismissMenu" }
  /** An action of the open menu ran; `text` is what it or the host asked to announce. */
  | { type: "actionDone"; action: MenuAction; text?: string }
  | { type: "setFocus"; focus: Focus | undefined }
  | { type: "setAbstraction"; abstraction: AbstractOptions }
  /** Collapse or expand a stage. */
  | { type: "collapse"; group: string; collapsed: boolean }
  | { type: "setView"; view: MapView };

export type MapIntent =
  | { kind: "select"; selection: Selection }
  | { kind: "focus"; focus: Focus | undefined }
  | { kind: "hover"; id: string | null }
  | { kind: "abstraction"; abstraction: AbstractOptions }
  | { kind: "view"; view: MapView }
  /** Bring the node into view. */
  | { kind: "reveal"; id: string }
  /** Open the actions menu on the element; the host finds it on screen and answers with `openMenu`. */
  | { kind: "menu"; element: ElementRef };

export interface MapStep {
  state: MapState;
  /** Sentence for the live region, if the step has one. */
  announcement?: string;
  /** The sentence is the one `announceChange` gives for the step's change of selection or focus, not one of the event's own. */
  describesChange: boolean;
  intents: MapIntent[];
  /** The event meant something to the map (a key the host should not pass on). */
  handled: boolean;
}

export interface MapContext {
  /** The graph on the map. */
  graph: FlowGraph;
  /** Boxes the keyboard moves between; without them keys do nothing. */
  positions?: Positions;
  locale?: Locale;
  /** Offer the actions menu. Default true. */
  contextMenu?: boolean;
  /** Top-level stages, for collapsing one while all are collapsed. */
  stages?: string[];
  /** The actions the menu offers for a target, from the defaults; `false` or none: no menu. */
  actions?: (target: MenuTarget, defaults: MenuAction[]) => MenuAction[] | false;
}

export function initialMapState(init: Partial<MapState> = {}): MapState {
  return { selection: emptySelection, focus: undefined, abstraction: {}, view: "map", active: null, hovered: null, focusWithin: false, cycle: {}, menu: null, ...init };
}

const DIRECTIONS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

const focusKey = (focus: Focus | undefined) => (focus === undefined ? "" : typeof focus === "string" ? focus : focus.join("\n"));

/**
 * What the live region says when the selection or the focus of paths changed
 * from `previous` to `next`: the focus first; the selection unless a menu is
 * open, whose sentence has named it.
 */
export function announceChange(previous: Pick<MapState, "selection" | "focus">, next: Pick<MapState, "selection" | "focus" | "menu">, graph: FlowGraph, locale: Locale = "en"): string | undefined {
  if (next.focus !== undefined && focusKey(previous.focus) !== focusKey(next.focus)) {
    const label = indexGraph(graph).label;
    const f = next.focus;
    return typeof f === "string" ? t(locale, "map.focus", { label: label(f) }) : t(locale, "map.focusPair", { a: label(f[0]), b: label(f[1]) });
  }
  if (!next.menu && !selectionEquals(previous.selection, next.selection)) return describeSelection(graph, next.selection, locale);
  return undefined;
}

/** Nodes with a box, left to right and top to bottom: the order of Home and End. */
function nodeOrder(graph: FlowGraph, positions: Positions): string[] {
  const box = positions.nodes;
  return graph.nodes
    .filter((n) => box[n.id])
    .sort((a, b) => box[a.id].x - box[b.id].x || box[a.id].y - box[b.id].y)
    .map((n) => n.id);
}

function collapseList(current: AbstractOptions["collapse"], group: string, stages: string[], collapse: boolean): AbstractOptions["collapse"] {
  const list = current === "all" ? stages : Array.isArray(current) ? current : [];
  const next = collapse ? (list.includes(group) ? list : [...list, group]) : list.filter((id) => id !== group);
  return next.length === 0 ? false : next;
}

/** Apply one event to the interaction state. */
export function mapStep(state: MapState, event: MapEvent, context: MapContext): MapStep {
  const { graph } = context;
  const locale = context.locale ?? "en";
  const step = (change: Partial<MapState>, intents: MapIntent[] = [], announcement?: string): MapStep => {
    const next = { ...state, ...change };
    if (announcement !== undefined) return { state: next, intents, announcement, describesChange: false, handled: true };
    const derived = announceChange(state, next, graph, locale);
    return { state: next, intents, announcement: derived, describesChange: derived !== undefined, handled: true };
  };
  const select = (selection: Selection, change: Partial<MapState> = {}, intents: MapIntent[] = []) => step({ selection, ...change }, [{ kind: "select", selection }, ...intents]);
  switch (event.type) {
    case "click": {
      const ref = event.element;
      if (!ref) return select(emptySelection, { menu: null });
      return select(selectElement(state.selection, ref, event.multi ? "toggle" : "replace"), ref.kind === "node" ? { menu: null, active: ref.id } : { menu: null });
    }
    case "select":
      return select(event.selection);
    case "hover":
      return step({ hovered: event.id }, [{ kind: "hover", id: event.id }]);
    case "focusIn": {
      const onActivity = event.id !== undefined && graph.nodes.some((n) => n.id === event.id && n.kind === "activity");
      return step(onActivity ? { focusWithin: true, active: event.id! } : { focusWithin: true });
    }
    case "focusOut":
      return step({ focusWithin: false });
    case "key":
      return keyStep(state, event, context, step, select);
    case "openMenu": {
      if (context.contextMenu === false) return { state, intents: [], describesChange: false, handled: false };
      const ref = event.element;
      // The element joins the selection unless it is part of the multi-selection already.
      const inSelection = isSelected(state.selection, ref);
      const selection = inSelection ? state.selection : selectElement(emptySelection, ref, "add");
      const intents: MapIntent[] = inSelection ? [] : [{ kind: "select", selection }];
      const target = menuTargetFor(graph, ref, selection);
      const collapse = state.abstraction.collapse;
      const collapsed = ref.kind === "group" && (collapse === "all" || (Array.isArray(collapse) && collapse.includes(ref.id)));
      const defaults = defaultActions(graph, target, locale, { collapsed, hasFocus: state.focus !== undefined });
      const actions = context.actions ? context.actions(target, defaults) : defaults;
      if (actions === false || actions.length === 0) return step({ selection }, intents);
      const opened = t(locale, "menu.opened", { label: target.label, count: actions.length });
      return step({ selection, menu: { element: ref, target, actions, at: event.at } }, intents, inSelection ? opened : `${describeSelection(graph, selection, locale)} ${opened}`);
    }
    case "closeMenu":
      return step({ menu: null }, [], t(locale, "menu.closed"));
    case "dismissMenu":
      return step({ menu: null });
    case "actionDone": {
      if (!state.menu) return { state, intents: [], describesChange: false, handled: false };
      return step({ menu: null }, [], event.text ?? t(locale, "menu.announce", { action: event.action.label, target: state.menu.target.label }));
    }
    case "setFocus":
      return step({ focus: event.focus }, [{ kind: "focus", focus: event.focus }]);
    case "setAbstraction":
      return step({ abstraction: event.abstraction }, [{ kind: "abstraction", abstraction: event.abstraction }]);
    case "collapse": {
      const abstraction = { ...state.abstraction, collapse: collapseList(state.abstraction.collapse, event.group, context.stages ?? [], event.collapsed) };
      return step({ abstraction }, [{ kind: "abstraction", abstraction }]);
    }
    case "setView":
      return step({ view: event.view }, [{ kind: "view", view: event.view }]);
  }
}

/**
 * The keyboard routes: arrow keys move to the nearest activity in that
 * direction (Shift adds it to the selection), Alt with an arrow key moves
 * along the paths (from an activity to each of its outgoing or incoming paths
 * in turn, from a path to its end or start), Home and End go to the first and
 * last activity, Space toggles the selection, Enter opens the actions menu,
 * Escape clears the selection, the keyboard position and the focus of paths.
 */
function keyStep(
  state: MapState,
  event: Extract<MapEvent, { type: "key" }>,
  context: MapContext,
  step: (change: Partial<MapState>, intents?: MapIntent[], announcement?: string) => MapStep,
  select: (selection: Selection, change?: Partial<MapState>, intents?: MapIntent[]) => MapStep,
): MapStep {
  const { graph, positions } = context;
  const ignored: MapStep = { state, intents: [], describesChange: false, handled: false };
  if (state.menu || !positions) return ignored;
  const order = nodeOrder(graph, positions);
  if (order.length === 0) return ignored;
  const locale = context.locale ?? "en";
  const edge = state.active !== null ? graph.edges.find((e) => e.id === state.active) : undefined;
  const current = edge ? null : (state.active ?? state.selection.nodes[0] ?? null);
  const reveal = (id: string) => step({ active: id }, [{ kind: "reveal", id }]);
  const dir = DIRECTIONS[event.key];
  if (dir && event.altKey) {
    const forward = dir[0] > 0 || dir[1] > 0;
    if (edge) return reveal(forward ? edge.target : edge.source);
    if (!current) return reveal(order[0]);
    const list = graph.edges.filter((x) => x.kind !== "constraint" && x.source !== x.target && positions.nodes[x.source] && positions.nodes[x.target] && (forward ? x.source === current : x.target === current));
    if (!list.length) return step({});
    const key = `${current}:${forward ? "out" : "in"}`;
    const index = ((state.cycle[key] ?? -1) + 1) % list.length;
    return step({ active: list[index].id, cycle: { ...state.cycle, [key]: index } }, [], t(locale, "map.focused", { label: describeEdge(list[index], graph, locale) }));
  }
  if (dir) {
    const start = current ?? edge?.target ?? null;
    const from = start ? positions.nodes[start] : undefined;
    if (!start || !from) return reveal(order[0]);
    const cx = from.x + from.width / 2;
    const cy = from.y + from.height / 2;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const id of order) {
      if (id === start) continue;
      const b = positions.nodes[id];
      const dx = b.x + b.width / 2 - cx;
      const dy = b.y + b.height / 2 - cy;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 0) continue;
      const score = along + 2 * (Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]));
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (!best) return step({});
    if (event.shiftKey) return select(selectElement(state.selection, { kind: "node", id: best }, "add"), { active: best }, [{ kind: "reveal", id: best }]);
    return reveal(best);
  }
  const ref: ElementRef | undefined = edge ? { kind: "edge", id: edge.id } : current ? { kind: "node", id: current } : undefined;
  switch (event.key) {
    case "Home":
      return reveal(order[0]);
    case "End":
      return reveal(order[order.length - 1]);
    case " ":
      return ref ? select(selectElement(state.selection, ref, "toggle")) : ignored;
    case "Enter":
      if (!ref) return ignored;
      if (context.contextMenu === false) return select(selectElement(state.selection, ref, "toggle"));
      return step({}, [{ kind: "menu", element: ref }]);
    case "Escape":
      return state.focus !== undefined
        ? select(emptySelection, { active: null, focus: undefined }, [{ kind: "focus", focus: undefined }])
        : select(emptySelection, { active: null });
    default:
      return ignored;
  }
}
