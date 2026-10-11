/**
 * Map controller: the interaction state of a map (selection, the focus of
 * paths, abstraction, view, the element the keyboard is on, hover, the
 * actions menu) and the transitions a click, a key, a hover or a focus makes.
 * A transition returns the next state, the sentence for the live region and
 * the intents the host carries out (callbacks, bringing an element into view,
 * placing the menu on screen). No DOM and no React.
 */
import { type MenuAction, type MenuTarget, defaultActions, menuTargetFor, menuTitle } from "./actions.js";
import { type AbstractOptions } from "./aggregate.js";
import { describeEdge } from "./describe.js";
import { type Locale } from "./format.js";
import { type Positions } from "./layout.js";
import { type FlowGraph, type Overlay, indexGraph } from "./model.js";
import { describeOverlay } from "./overlays.js";
import { type Focus, focusHighlight } from "./paths.js";
import { type ElementRef, type Selection, describeSelection, emptySelection, isSelected, relatedToSelection, selectElement, selectionEquals } from "./selection.js";
import { type StringKey, t } from "./strings.js";

export type MapView = "map" | "table";

export interface MapMenu {
  /** The element the menu was opened on. */
  element: ElementRef;
  target: MenuTarget;
  actions: MenuAction[];
  /** Where the menu is shown, relative to the map body. */
  at: { x: number; y: number };
  /** Index of the entry the keyboard is on; the first enabled entry when the menu opens. */
  active: number;
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
  /** A click on an overlay: an arc selects the pair it joins, any other overlay its target. */
  | { type: "clickOverlay"; overlay: Overlay }
  /** A key on the map, or in the actions menu while it is open. */
  | { type: "key"; key: string; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }
  | { type: "openMenu"; element: ElementRef; at: { x: number; y: number } }
  /** The pointer moved onto the menu's entry `index`. */
  | { type: "pointMenu"; index: number }
  /** The menu's entry `index` was clicked. */
  | { type: "chooseMenu"; index: number }
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
  | { kind: "menu"; element: ElementRef }
  /** Run the chosen action of the open menu; the host answers with `actionDone`. */
  | { kind: "run"; action: MenuAction; target: MenuTarget }
  /** Give the input focus back to the map (the menu closed or an action ran). */
  | { kind: "returnFocus" };

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

/**
 * The selection after a click on an element: it alone, or nothing when it was
 * selected alone; with Shift, Ctrl or Cmd (`multi`) it is added or removed.
 */
export function clickSelection(selection: Selection, element: ElementRef, multi = false): Selection {
  return selectElement(selection, element, multi ? "toggle" : "replace");
}

export interface MapEmphasis {
  /** The focus of paths in effect: the map's, else the pair of activities or stages a selection of two names. */
  focus: Focus | undefined;
  /** Every element of the focus is on the graph, so its paths are shown. */
  focusShown: boolean;
  /** What stays bright (the rest is dimmed): the paths of a shown focus, else what relates to the selection; nothing dims without either. */
  bright: { nodes: Set<string>; edges: Set<string> } | undefined;
}

/** What the map emphasises for its selection and focus on the graph it shows. */
export function mapEmphasis(state: Pick<MapState, "selection" | "focus">, graph: FlowGraph): MapEmphasis {
  const { selection } = state;
  const idx = indexGraph(graph);
  const pairable = (id: string) => ["activity", "stage"].includes(idx.nodes.get(id)?.kind ?? "");
  const pair: Focus | undefined =
    selection.nodes.length === 2 && !selection.edges.length && !selection.groups.length && pairable(selection.nodes[0]) && pairable(selection.nodes[1]) ? [selection.nodes[0], selection.nodes[1]] : undefined;
  const focus = state.focus ?? pair;
  const has = (id: string) => idx.nodes.has(id) || idx.groups.has(id);
  const focusShown = focus !== undefined && (typeof focus === "string" ? has(focus) : has(focus[0]) && has(focus[1]));
  const any = selection.nodes.length + selection.edges.length + selection.groups.length > 0;
  const bright = focusShown ? focusHighlight(graph, focus!) : any ? relatedToSelection(graph, selection) : undefined;
  return { focus, focusShown, bright };
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
      return select(clickSelection(state.selection, ref, event.multi), ref.kind === "node" ? { menu: null, active: ref.id } : { menu: null });
    }
    case "clickOverlay": {
      const { source, target } = event.overlay.payload ?? {};
      const nodes = typeof source === "string" && typeof target === "string" ? [source, target] : [event.overlay.target];
      return select({ nodes, edges: [], groups: [] }, { menu: null });
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
      return state.menu ? menuKeyStep(state, state.menu, event, step, locale) : keyStep(state, event, context, step, select);
    case "openMenu": {
      if (context.contextMenu === false) return ignore(state);
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
      const menu = { element: ref, target, actions, at: event.at, active: firstEntry(actions) };
      return step({ selection, menu }, intents, inSelection ? opened : `${describeSelection(graph, selection, locale)} ${opened}`);
    }
    case "pointMenu":
      return state.menu && enabled(state.menu.actions, event.index) ? step({ menu: { ...state.menu, active: event.index } }) : ignore(state);
    case "chooseMenu":
      return state.menu ? choose(state.menu, event.index, step) : ignore(state);
    case "closeMenu":
      return step({ menu: null }, [{ kind: "returnFocus" }], t(locale, "menu.closed"));
    case "dismissMenu":
      return step({ menu: null });
    case "actionDone": {
      if (!state.menu) return ignore(state);
      return step({ menu: null }, [{ kind: "returnFocus" }], event.text ?? t(locale, "menu.announce", { action: event.action.label, target: state.menu.target.label }));
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

const ignore = (state: MapState): MapStep => ({ state, intents: [], describesChange: false, handled: false });

const enabled = (actions: readonly MenuAction[], index: number) => actions[index] !== undefined && !actions[index].disabled;

/** The entry the keyboard starts on: the first enabled one. */
export function firstEntry(actions: readonly MenuAction[]): number {
  const index = actions.findIndex((a) => !a.disabled);
  return index < 0 ? 0 : index;
}

/** What a key does in a menu whose keyboard is on entry `active`. */
export interface MenuKey {
  /** The entry the keyboard is on afterwards. */
  active: number;
  /** The entry the key chose. */
  choose?: number;
  /** The key closes the menu. */
  close?: boolean;
  /** The key meant something to the menu (the host prevents its default). */
  handled: boolean;
}

/**
 * The keyboard of an actions menu: Arrow Down and Arrow Up move over the
 * enabled entries and wrap, Home and End go to the first and the last one,
 * Enter and Space choose the entry the keyboard is on, an accelerator letter
 * chooses its entry, Escape closes the menu, and Tab closes it and moves on.
 */
export function menuKey(actions: readonly MenuAction[], active: number, event: Pick<Extract<MapEvent, { type: "key" }>, "key" | "altKey" | "ctrlKey" | "metaKey">): MenuKey {
  const entries = actions.map((a, i) => (a.disabled ? -1 : i)).filter((i) => i >= 0);
  const move = (delta: number) => {
    if (!entries.length) return active;
    const at = entries.indexOf(active);
    return entries[(at + delta + entries.length) % entries.length];
  };
  switch (event.key) {
    case "ArrowDown":
      return { active: move(1), handled: true };
    case "ArrowUp":
      return { active: move(-1), handled: true };
    case "Home":
      return { active: entries[0] ?? active, handled: true };
    case "End":
      return { active: entries[entries.length - 1] ?? active, handled: true };
    case "Enter":
    case " ":
      return { active, choose: active, handled: true };
    case "Escape":
      return { active, close: true, handled: true };
    case "Tab":
      return { active, close: true, handled: false };
    default: {
      if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return { active, handled: false };
      const letter = event.key.toLowerCase();
      const hit = actions.findIndex((a) => !a.disabled && a.accelerator?.toLowerCase() === letter);
      return hit < 0 ? { active, handled: false } : { active, choose: hit, handled: true };
    }
  }
}

type Step = (change: Partial<MapState>, intents?: MapIntent[], announcement?: string) => MapStep;

/** Choosing an enabled entry asks the host to run its action; a disabled or missing one does nothing. */
function choose(menu: MapMenu, index: number, step: Step): MapStep {
  if (!enabled(menu.actions, index)) return step({});
  return step({}, [{ kind: "run", action: menu.actions[index], target: menu.target }]);
}

/** A key while the menu is open moves its keyboard, chooses an entry or closes it; the map's routes wait. */
function menuKeyStep(state: MapState, menu: MapMenu, event: Extract<MapEvent, { type: "key" }>, step: Step, locale: Locale): MapStep {
  const r = menuKey(menu.actions, menu.active, event);
  if (r.close) return { ...step({ menu: null }, [{ kind: "returnFocus" }], t(locale, "menu.closed")), handled: r.handled };
  if (r.choose !== undefined) return choose(menu, r.choose, step);
  if (!r.handled) return ignore(state);
  return step(r.active === menu.active ? {} : { menu: { ...menu, active: r.active } });
}

/** Title, kind line and the worst expectation touching the target, for the header of the actions menu. */
export function menuHeading(target: MenuTarget, graph: FlowGraph, overlays: readonly Overlay[], locale: Locale = "en"): { title: string; subtitle: string; note?: string } {
  const kindKey: StringKey =
    target.kind === "node"
      ? (`kind.${target.nodeKind ?? "activity"}` as StringKey)
      : target.kind === "edge"
        ? (`kind.${target.edgeKind ?? "follows"}` as StringKey)
        : target.kind === "group"
          ? (`group.${target.groupKind ?? "stage"}` as StringKey)
          : "kind.activity";
  const idx = indexGraph(graph);
  const groupId = target.kind === "node" ? idx.nodes.get(target.id)?.group : undefined;
  const subtitle = `${t(locale, kindKey)}${groupId ? ` (${idx.groups.get(groupId)?.label ?? groupId})` : ""}`;
  let worst: Overlay | undefined;
  for (const o of overlays) {
    const ids = target.ids;
    const touches = ids.includes(o.target) || (o.kind === "arc" && (ids.includes(String(o.payload?.source)) || ids.includes(String(o.payload?.target))));
    const v = o.payload?.value;
    if (!touches || !o.payload?.constraintId || typeof v !== "number") continue;
    if (!worst || v > (worst.payload?.value as number)) worst = o;
  }
  return { title: menuTitle(target, graph, locale), subtitle, note: worst ? t(locale, "menu.worst", { text: describeOverlay(worst, locale) }) : undefined };
}

/**
 * The keyboard routes: arrow keys move to the nearest activity in that
 * direction (Shift adds it to the selection), Alt with an arrow key moves
 * along the paths (from an activity to each of its outgoing or incoming paths
 * in turn, from a path to its end or start), Home and End go to the first and
 * last activity, Space toggles the selection, Enter opens the actions menu,
 * Escape clears the selection, the keyboard position and the focus of paths.
 * The keys start from the element the keyboard is on, else from the first
 * selected activity; one that is not on the map counts as none.
 */
function keyStep(
  state: MapState,
  event: Extract<MapEvent, { type: "key" }>,
  context: MapContext,
  step: Step,
  select: (selection: Selection, change?: Partial<MapState>, intents?: MapIntent[]) => MapStep,
): MapStep {
  const { graph, positions } = context;
  const ignored = ignore(state);
  if (!positions) return ignored;
  const order = nodeOrder(graph, positions);
  if (order.length === 0) return ignored;
  const locale = context.locale ?? "en";
  const edge = state.active !== null ? graph.edges.find((e) => e.id === state.active) : undefined;
  // A position whose element left the map (a stage expanded, a threshold raised) counts as none.
  const onMap = (id: string | null | undefined) => (id != null && positions.nodes[id] && graph.nodes.some((n) => n.id === id) ? id : null);
  const current = edge ? null : (onMap(state.active) ?? onMap(state.selection.nodes[0]));
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
    // The description ends a sentence of its own; the announcement adds the full stop.
    const label = describeEdge(list[index], graph, locale).replace(/\.$/, "");
    return step({ active: list[index].id, cycle: { ...state.cycle, [key]: index } }, [], t(locale, "map.focused", { label }));
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
