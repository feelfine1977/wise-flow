import { describe, expect, it } from "vitest";
import { type FlowGraph, type MenuAction, type Positions } from "../../src/index";
import { type MapContext, type MapEvent, type MapState, announceChange, initialMapState, mapEmphasis, mapStep, menuHeading, menuKey } from "../../src/core/map-controller";

// A ─→ B ─→ D, A ─→ C ─→ D; B loops on itself; a constraint arc A → D.
//
//   A (0,0)     B (200,0)     D (400,0)
//               C (200,120)
const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1" },
    { id: "b", kind: "activity", label: "B", group: "s1" },
    { id: "c", kind: "activity", label: "C" },
    { id: "d", kind: "activity", label: "D" },
  ],
  edges: [
    { id: "ab", kind: "follows", source: "a", target: "b" },
    { id: "ac", kind: "follows", source: "a", target: "c" },
    { id: "bb", kind: "follows", source: "b", target: "b" },
    { id: "bd", kind: "follows", source: "b", target: "d" },
    { id: "cd", kind: "follows", source: "c", target: "d" },
    { id: "k", kind: "constraint", source: "a", target: "d" },
  ],
  groups: [{ id: "s1", kind: "stage", label: "Intake" }],
};
const box = (x: number, y: number) => ({ x, y, width: 100, height: 40 });
const positions: Positions = {
  nodes: { a: box(0, 0), b: box(200, 0), c: box(200, 120), d: box(400, 0) },
  groups: { s1: { x: -10, y: -10, width: 320, height: 60 } },
  edges: {},
  bounds: { x: -10, y: -10, width: 520, height: 170 },
  engine: "dagre",
  direction: "RIGHT",
};
const context: MapContext = { graph, positions, locale: "en", stages: ["s1", "s2"] };
const sel = (nodes: string[] = [], edges: string[] = [], groups: string[] = []) => ({ nodes, edges, groups });
const state = (change: Partial<MapState> = {}) => initialMapState(change);
const key = (k: string, mod: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}): MapEvent => ({ type: "key", key: k, ...mod });
const step = (s: MapState, event: MapEvent, ctx: Partial<MapContext> = {}) => mapStep(s, event, { ...context, ...ctx });
const at = { x: 10, y: 20 };

describe("map controller: keyboard routes", () => {
  it("starts at the first activity, left to right, and moves with the arrow keys to the nearest activity that way", () => {
    const first = step(state(), key("ArrowRight"));
    expect(first).toMatchObject({ handled: true, intents: [{ kind: "reveal", id: "a" }] });
    expect(first.state.active).toBe("a");
    expect(first.announcement).toBeUndefined();
    const moves: [string, string, string][] = [
      ["a", "ArrowRight", "b"],
      ["b", "ArrowDown", "c"],
      ["c", "ArrowRight", "d"], // B is straight above C, not to its right
      ["d", "ArrowLeft", "b"], // B is closer across than C
      ["c", "ArrowUp", "b"],
    ];
    for (const [from, k, to] of moves) {
      const r = step(state({ active: from }), key(k));
      expect(r.state.active, `${from} ${k}`).toBe(to);
      expect(r.intents).toEqual([{ kind: "reveal", id: to }]);
      expect(r.state.selection).toEqual(sel());
    }
  });

  it("stays put at the edge of the map but keeps the key", () => {
    const r = step(state({ active: "a" }), key("ArrowUp"));
    expect(r).toMatchObject({ handled: true, intents: [] });
    expect(r.state.active).toBe("a");
  });

  it("moves from the first selected activity when the keyboard has no position yet", () => {
    expect(step(state({ selection: sel(["c"]) }), key("ArrowUp")).state.active).toBe("b");
  });

  it("moves from a path's end with an arrow key", () => {
    expect(step(state({ active: "ab" }), key("ArrowDown")).state.active).toBe("c");
    // From B, the end of A → B, A is to the left; from A nothing is.
    expect(step(state({ active: "ab" }), key("ArrowLeft")).state.active).toBe("a");
  });

  it("goes to the first and the last activity with Home and End", () => {
    expect(step(state({ active: "c" }), key("Home"))).toMatchObject({ state: { active: "a" }, intents: [{ kind: "reveal", id: "a" }] });
    expect(step(state({ active: "a" }), key("End"))).toMatchObject({ state: { active: "d" }, intents: [{ kind: "reveal", id: "d" }] });
  });

  it("walks the outgoing paths in turn with Alt and an arrow key, skipping self-loops and constraints, and announces each", () => {
    let s = state({ active: "a" });
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = step(s, key("ArrowRight", { altKey: true }));
      seen.push(r.state.active!);
      expect(r.intents).toEqual([]);
      if (i === 0) expect(r.announcement).toBe("Focused: path A → B..");
      s = { ...r.state, active: "a" };
    }
    expect(seen).toEqual(["ab", "ac", "ab"]);
    expect(step(state({ active: "b" }), key("ArrowDown", { altKey: true })).state.active).toBe("bd");
    expect(step(state({ active: "d" }), key("ArrowLeft", { altKey: true })).state.active).toBe("bd");
    expect(step(state({ active: "d" }), key("ArrowUp", { altKey: true })).announcement).toBe("Focused: path B → D..");
  });

  it("goes from a path to its end or its start with Alt and an arrow key", () => {
    expect(step(state({ active: "ac" }), key("ArrowRight", { altKey: true }))).toMatchObject({ state: { active: "c" }, intents: [{ kind: "reveal", id: "c" }] });
    expect(step(state({ active: "ac" }), key("ArrowLeft", { altKey: true }))).toMatchObject({ state: { active: "a" }, intents: [{ kind: "reveal", id: "a" }] });
  });

  it("starts Alt routes at the first activity and keeps the key where no path leads", () => {
    expect(step(state(), key("ArrowDown", { altKey: true })).state.active).toBe("a");
    const r = step(state({ active: "a" }), key("ArrowLeft", { altKey: true }));
    expect(r).toMatchObject({ handled: true, intents: [] });
    expect(r.state.active).toBe("a");
  });

  it("extends the selection with Shift and an arrow key", () => {
    const r = step(state({ active: "a", selection: sel(["a"]) }), key("ArrowRight", { shiftKey: true }));
    expect(r.state).toMatchObject({ active: "b", selection: sel(["a", "b"]) });
    expect(r.intents).toEqual([{ kind: "select", selection: sel(["a", "b"]) }, { kind: "reveal", id: "b" }]);
    expect(r.announcement).toBe("Selected: A and B.");
    // An activity that is selected already stays selected.
    const again = step(state({ active: "a", selection: sel(["a", "b"]) }), key("ArrowRight", { shiftKey: true }));
    expect(again.state).toMatchObject({ active: "b", selection: sel(["a", "b"]) });
  });

  it("toggles the activity or the path the keyboard is on with Space", () => {
    const on = step(state({ active: "b" }), key(" "));
    expect(on.state.selection).toEqual(sel(["b"]));
    expect(on.intents).toEqual([{ kind: "select", selection: sel(["b"]) }]);
    expect(on.announcement).toBe("Selected: B.");
    const off = step(on.state, key(" "));
    expect(off.state.selection).toEqual(sel());
    expect(off.announcement).toBe("Selection cleared.");
    expect(step(state({ active: "ab" }), key(" ")).announcement).toBe("Selected: path A → B.");
    expect(step(state(), key(" ")).handled).toBe(false);
  });

  it("asks the host to open the actions menu with Enter, or toggles the selection without a menu", () => {
    const r = step(state({ active: "b" }), key("Enter"));
    expect(r).toMatchObject({ handled: true, intents: [{ kind: "menu", element: { kind: "node", id: "b" } }] });
    expect(r.state.menu).toBeNull();
    expect(r.announcement).toBeUndefined();
    expect(step(state({ active: "ab" }), key("Enter")).intents).toEqual([{ kind: "menu", element: { kind: "edge", id: "ab" } }]);
    const plain = step(state({ active: "b" }), key("Enter"), { contextMenu: false });
    expect(plain.intents).toEqual([{ kind: "select", selection: sel(["b"]) }]);
    expect(step(state(), key("Enter")).handled).toBe(false);
  });

  it("clears the selection, the keyboard position and the focus of paths with Escape", () => {
    const r = step(state({ active: "b", selection: sel(["b", "c"]), focus: "b" }), key("Escape"));
    expect(r.state).toMatchObject({ active: null, selection: sel(), focus: undefined });
    expect(r.intents).toEqual([{ kind: "select", selection: sel() }, { kind: "focus", focus: undefined }]);
    expect(r.announcement).toBe("Selection cleared.");
    const bare = step(state({ active: "b" }), key("Escape"));
    expect(bare.intents).toEqual([{ kind: "select", selection: sel() }]);
    expect(bare.announcement).toBeUndefined();
  });

  it("leaves keys alone while the menu is open, without positions, without activities and for other keys", () => {
    const menu = step(state(), { type: "openMenu", element: { kind: "node", id: "b" }, at }).state;
    for (const [s, ctx] of [
      [menu, {}],
      [state(), { positions: undefined }],
      [state(), { graph: { nodes: [], edges: [] } }],
    ] as [MapState, Partial<MapContext>][]) {
      const r = step(s, key("ArrowRight"), ctx);
      expect(r.handled).toBe(false);
      expect(r.state).toBe(s);
    }
    expect(step(state({ active: "a" }), key("x")).handled).toBe(false);
  });

  it("starts as from no keyboard position when its element left the map", () => {
    // A collapsed stage "s1" the keyboard was on has been expanded: the graph has no node "s1" any more.
    const gone = state({ active: "s1" });
    expect(step(gone, key(" "))).toMatchObject({ handled: false, intents: [] });
    expect(step(gone, key("Enter"))).toMatchObject({ handled: false, intents: [] });
    expect(step(gone, key("ArrowRight", { altKey: true })).state.active).toBe("a");
    expect(step(gone, key("ArrowDown")).state.active).toBe("a");
    // From the first selected activity, as without a keyboard position.
    const selected = state({ active: "s1", selection: sel(["c"]) });
    expect(step(selected, key("ArrowRight")).state.active).toBe("d");
    expect(step(selected, key(" ")).state.selection).toEqual(sel());
    // A node without a box is not on the map either.
    expect(step(state({ active: "b" }), key("ArrowDown"), { positions: { ...positions, nodes: { a: positions.nodes.a, c: positions.nodes.c, d: positions.nodes.d } } }).state.active).toBe("a");
  });
});

describe("map controller: pointer, hover and focus", () => {
  it("selects on click, toggles with a modifier, clears beside the elements and closes the menu silently", () => {
    const one = step(state(), { type: "click", element: { kind: "node", id: "a" } });
    expect(one.state).toMatchObject({ selection: sel(["a"]), active: "a" });
    expect(one.announcement).toBe("Selected: A.");
    const two = step(one.state, { type: "click", element: { kind: "node", id: "c" }, multi: true });
    expect(two.state.selection).toEqual(sel(["a", "c"]));
    expect(two.announcement).toBe("Selected: A and C.");
    const edge = step(two.state, { type: "click", element: { kind: "edge", id: "cd" } });
    expect(edge.state).toMatchObject({ selection: sel([], ["cd"]), active: "c" });
    const group = step(edge.state, { type: "click", element: { kind: "group", id: "s1" }, multi: true });
    expect(group.state.selection).toEqual(sel([], [], ["s1"]));
    expect(group.announcement).toBe("Selected: Intake (stage).");
    const open = step(group.state, { type: "openMenu", element: { kind: "group", id: "s1" }, at }).state;
    const away = step(open, { type: "click", element: null });
    expect(away.state).toMatchObject({ selection: sel(), menu: null });
    expect(away.intents).toEqual([{ kind: "select", selection: sel() }]);
    expect(away.announcement).toBe("Selection cleared.");
  });

  it("takes a selection made elsewhere and reports hover", () => {
    expect(step(state(), { type: "select", selection: sel(["a", "d"]) })).toMatchObject({ announcement: "Selected: A and D.", intents: [{ kind: "select" }] });
    const hover = step(state(), { type: "hover", id: "ab" });
    expect(hover).toMatchObject({ state: { hovered: "ab" }, intents: [{ kind: "hover", id: "ab" }] });
    expect(hover.announcement).toBeUndefined();
  });

  it("puts the keyboard on an activity that receives the input focus", () => {
    expect(step(state(), { type: "focusIn", id: "c" }).state).toMatchObject({ focusWithin: true, active: "c" });
    expect(step(state({ active: "a" }), { type: "focusIn", id: "s1" }).state).toMatchObject({ focusWithin: true, active: "a" });
    const withEvent = { ...graph, nodes: [...graph.nodes, { id: "e", kind: "event" as const, label: "Start" }] };
    expect(step(state({ active: "a" }), { type: "focusIn", id: "e" }, { graph: withEvent }).state.active).toBe("a");
    // Leaving the map keeps the keyboard's element for its return.
    expect(step(state({ focusWithin: true, active: "b" }), { type: "focusOut" }).state).toMatchObject({ focusWithin: false, active: "b" });
  });
});

describe("map controller: menu and announcements", () => {
  const pin: MenuAction = { id: "pin", label: "Pin", group: "compare" };
  const lens: MenuAction = { id: "lens", label: "Lens", group: "explore" };

  it("selects the element and opens the menu in one step, with one sentence for both", () => {
    const r = step(state(), { type: "openMenu", element: { kind: "node", id: "b" }, at }, { actions: () => [pin, lens] });
    expect(r.state.selection).toEqual(sel(["b"]));
    expect(r.state.menu).toMatchObject({ element: { kind: "node", id: "b" }, target: { kind: "node", id: "b", label: "B" }, actions: [pin, lens], at });
    expect(r.intents).toEqual([{ kind: "select", selection: sel(["b"]) }]);
    expect(r.announcement).toBe("Selected: B. Actions menu for B opened; 2 actions.");
    // The selection the host reports back is not announced over the menu.
    expect(announceChange(state(), r.state, graph)).toBeUndefined();
  });

  it("opens the menu on the multi-selection an element belongs to without changing it", () => {
    const r = step(state({ selection: sel(["a", "b"]) }), { type: "openMenu", element: { kind: "node", id: "b" }, at });
    expect(r.intents).toEqual([]);
    expect(r.state.menu?.target).toMatchObject({ kind: "pair", ids: ["b", "a"] });
    expect(r.announcement).toBe(`Actions menu for B, A opened; ${r.state.menu!.actions.length} actions.`);
  });

  it("hands the host the default actions and opens nothing when it suppresses them", () => {
    let defaults: MenuAction[] = [];
    const r = step(state(), { type: "openMenu", element: { kind: "node", id: "a" }, at }, { actions: (_, d) => ((defaults = d), false) });
    expect(defaults.map((a) => a.id)).toEqual(["filter-to", "exclude", "paths", "lens", "worst-cases", "pin", "add-constraint"]);
    expect(r.state.menu).toBeNull();
    expect(r.announcement).toBe("Selected: A.");
    expect(step(state(), { type: "openMenu", element: { kind: "node", id: "a" }, at }, { contextMenu: false })).toMatchObject({ handled: false, intents: [] });
  });

  it("offers expanding a collapsed stage and clearing a focus", () => {
    const r = step(state({ abstraction: { collapse: ["s1"] }, focus: "a" }), { type: "openMenu", element: { kind: "group", id: "s1" }, at });
    const ids = r.state.menu!.actions.map((a) => a.id);
    expect(ids).toContain("expand");
    expect(ids).toContain("clear-focus");
    expect(ids).not.toContain("collapse");
  });

  it("closes the menu, announcing it, and announces the action that ran", () => {
    const open = step(state(), { type: "openMenu", element: { kind: "node", id: "b" }, at }, { actions: () => [pin] }).state;
    expect(step(open, { type: "closeMenu" })).toMatchObject({ state: { menu: null }, announcement: "Actions menu closed." });
    expect(step(open, { type: "actionDone", action: pin })).toMatchObject({ state: { menu: null }, announcement: "Pin: B." });
    expect(step(open, { type: "actionDone", action: pin, text: "Pinned." }).announcement).toBe("Pinned.");
    expect(step(open, { type: "dismissMenu" })).toMatchObject({ state: { menu: null } });
    expect(step(open, { type: "dismissMenu" }).announcement).toBeUndefined();
    expect(step(state(), { type: "actionDone", action: pin }).handled).toBe(false);
  });

  it("marks which sentences describe a change of selection or focus and which belong to the event", () => {
    expect(step(state(), { type: "click", element: { kind: "node", id: "a" } }).describesChange).toBe(true);
    expect(step(state(), { type: "setFocus", focus: "b" }).describesChange).toBe(true);
    expect(step(state({ selection: sel(["b"]) }), key("Escape")).describesChange).toBe(true);
    expect(step(state(), { type: "hover", id: "a" }).describesChange).toBe(false);
    expect(step(state({ active: "a" }), key("ArrowRight", { altKey: true })).describesChange).toBe(false);
    // Selecting and opening in one step speaks the menu's own sentence.
    expect(step(state(), { type: "openMenu", element: { kind: "node", id: "b" }, at }, { actions: () => [pin] }).describesChange).toBe(false);
    // A host's text is the event's own even when it reads like a selection sentence.
    const open = step(state(), { type: "openMenu", element: { kind: "node", id: "b" }, at }, { actions: () => [pin] }).state;
    expect(step(open, { type: "actionDone", action: pin, text: "Selected: B." })).toMatchObject({ announcement: "Selected: B.", describesChange: false });
  });

  it("announces a new focus of paths but not its removal or a repeat", () => {
    const one = step(state(), { type: "setFocus", focus: "b" });
    expect(one).toMatchObject({ intents: [{ kind: "focus", focus: "b" }], announcement: "Paths of B are shown; unrelated activities are dimmed." });
    expect(step(one.state, { type: "setFocus", focus: "b" }).announcement).toBeUndefined();
    expect(step(one.state, { type: "setFocus", focus: ["a", "d"] }).announcement).toBe("The path between A and D is shown; unrelated activities are dimmed.");
    expect(step(one.state, { type: "setFocus", focus: undefined }).announcement).toBeUndefined();
    expect(announceChange(state({ selection: sel(["a"]) }), state({ selection: sel(["c"]), focus: "c" }), graph, "de")).toBe("Die Pfade von C werden gezeigt; unbeteiligte Aktivitäten sind abgeblendet.");
  });

  it("collapses and expands stages and switches the abstraction and the view", () => {
    const expand = step(state({ abstraction: { minNodeShare: 0.1, collapse: "all" } }), { type: "collapse", group: "s1", collapsed: false });
    expect(expand.state.abstraction).toEqual({ minNodeShare: 0.1, collapse: ["s2"] });
    expect(expand.intents).toEqual([{ kind: "abstraction", abstraction: { minNodeShare: 0.1, collapse: ["s2"] } }]);
    expect(step(expand.state, { type: "collapse", group: "s2", collapsed: false }).state.abstraction.collapse).toBe(false);
    expect(step(state(), { type: "collapse", group: "s1", collapsed: true }).state.abstraction.collapse).toEqual(["s1"]);
    expect(step(state({ abstraction: { collapse: ["s1"] } }), { type: "collapse", group: "s1", collapsed: true }).state.abstraction.collapse).toEqual(["s1"]);
    expect(step(state(), { type: "setAbstraction", abstraction: { minEdgeShare: 0.2 } })).toMatchObject({ state: { abstraction: { minEdgeShare: 0.2 } }, intents: [{ kind: "abstraction" }] });
    expect(step(state(), { type: "setView", view: "table" })).toMatchObject({ state: { view: "table" }, intents: [{ kind: "view", view: "table" }] });
  });
});

describe("map controller: the actions menu", () => {
  // Entries 0 and 3 are disabled: the keyboard moves over 1, 2 and 4.
  const actions: MenuAction[] = [
    { id: "filter-to", label: "Filter", group: "filter", accelerator: "f", disabled: true },
    { id: "paths", label: "Paths", group: "explore", accelerator: "i" },
    { id: "lens", label: "Lens", group: "explore", accelerator: "l" },
    { id: "exclude", label: "Exclude", group: "filter", accelerator: "x", disabled: true },
    { id: "pin", label: "Pin", group: "compare", accelerator: "P" },
  ];
  const open = (s: MapState = state({ active: "b" })) => step(s, { type: "openMenu", element: { kind: "node", id: "b" }, at }, { actions: () => actions }).state;
  const target = { kind: "node", id: "b", ids: ["b"], label: "B", nodeKind: "activity" };

  it("opens with the keyboard on the first enabled entry", () => {
    expect(open().menu?.active).toBe(1);
    expect(step(state(), { type: "openMenu", element: { kind: "node", id: "b" }, at }, { actions: () => [actions[0]] }).state.menu?.active).toBe(0);
  });

  it("moves over the enabled entries with the arrow keys, Home, End and the pointer, while the map's keyboard stays", () => {
    let s = open();
    const path: [string, number][] = [
      ["ArrowDown", 2],
      ["ArrowDown", 4], // over the disabled 3
      ["ArrowDown", 1], // wraps past the disabled 0
      ["ArrowUp", 4],
      ["Home", 1],
      ["End", 4],
    ];
    for (const [k, to] of path) {
      const r = step(s, key(k));
      expect(r, k).toMatchObject({ handled: true, intents: [] });
      expect(r.announcement).toBeUndefined();
      expect(r.state.menu?.active, k).toBe(to);
      expect(r.state.active).toBe("b");
      s = r.state;
    }
    expect(step(s, { type: "pointMenu", index: 2 }).state.menu?.active).toBe(2);
    expect(step(s, { type: "pointMenu", index: 3 }).state).toBe(s);
    expect(step(s, { type: "pointMenu", index: 9 }).state).toBe(s);
    // Keys the menu does not know are left to the host.
    for (const k of [key("ArrowRight"), key("q"), key("i", { ctrlKey: true }), key("l", { altKey: true }), key("p", { metaKey: true })]) {
      const r = step(s, k);
      expect(r.handled).toBe(false);
      expect(r.state).toBe(s);
    }
  });

  it("asks the host to run the entry chosen with Enter, Space, an accelerator or a click, and keeps the menu until it ran", () => {
    const s = step(open(), key("ArrowDown")).state; // on Lens
    for (const event of [key("Enter"), key(" "), key("l"), key("L"), { type: "chooseMenu", index: 2 } as MapEvent]) {
      const r = step(s, event);
      expect(r, JSON.stringify(event)).toMatchObject({ handled: true, intents: [{ kind: "run", action: actions[2], target }] });
      expect(r.state.menu).not.toBeNull();
      expect(r.announcement).toBeUndefined();
    }
    expect(step(s, key("p")).intents).toEqual([{ kind: "run", action: actions[4], target }]);
    // Disabled entries are not chosen; their letter means nothing to the menu.
    expect(step(s, { type: "chooseMenu", index: 0 })).toMatchObject({ handled: true, intents: [] });
    expect(step(s, key("x")).handled).toBe(false);
    expect(step(state(), { type: "chooseMenu", index: 1 }).handled).toBe(false);
    expect(step(state(), { type: "pointMenu", index: 1 }).handled).toBe(false);
  });

  it("closes with Escape and Tab, and returns the input focus to the map after closing and after an action", () => {
    const s = open();
    const escape = step(s, key("Escape"));
    expect(escape).toMatchObject({ handled: true, state: { menu: null, active: "b" }, intents: [{ kind: "returnFocus" }], announcement: "Actions menu closed." });
    // Tab closes too but lets the input focus move on from the map.
    expect(step(s, key("Tab"))).toMatchObject({ handled: false, state: { menu: null }, intents: [{ kind: "returnFocus" }], announcement: "Actions menu closed." });
    expect(step(s, { type: "closeMenu" }).intents).toEqual([{ kind: "returnFocus" }]);
    expect(step(s, { type: "actionDone", action: actions[1] })).toMatchObject({ state: { menu: null }, intents: [{ kind: "returnFocus" }], announcement: "Paths: B." });
    // A menu that goes away because of something else leaves the focus where it is.
    expect(step(s, { type: "dismissMenu" }).intents).toEqual([]);
    expect(step(s, { type: "click", element: { kind: "node", id: "c" } }).intents).toEqual([{ kind: "select", selection: sel(["c"]) }]);
    // Once closed, the map's keys are the map's again.
    expect(step(escape.state, key("ArrowRight")).state.active).toBe("d");
  });

  it("selects the pair an arc joins or the target of another overlay, closing the menu silently", () => {
    const arc = step(open(), { type: "clickOverlay", overlay: { kind: "arc", target: "a", payload: { source: "a", target: "d" } } });
    expect(arc).toMatchObject({ state: { selection: sel(["a", "d"]), menu: null }, intents: [{ kind: "select", selection: sel(["a", "d"]) }], announcement: "Selected: A and D." });
    expect(step(state(), { type: "clickOverlay", overlay: { kind: "badge", target: "c" } })).toMatchObject({ state: { selection: sel(["c"]) }, announcement: "Selected: C." });
  });

  it("heads the menu with the target's title, its kind and group and the worst expectation touching it", () => {
    const overlays = [
      { kind: "badge" as const, target: "b", payload: { constraintId: "c1", constraintType: "existence", value: 0.2 } },
      { kind: "arc" as const, target: "a", payload: { constraintId: "c2", constraintType: "precedence", source: "a", target: "b", value: 0.4, label: "late", text: "40 % late" } },
      // Without a constraint, or with no number, an overlay is not an expectation.
      { kind: "badge" as const, target: "b", payload: { value: 0.9 } },
      { kind: "badge" as const, target: "b", payload: { constraintId: "c3" } },
      { kind: "badge" as const, target: "c", payload: { constraintId: "c4", value: 0.8 } },
    ];
    const heading = menuHeading({ kind: "node", id: "b", ids: ["b"], label: "B", nodeKind: "activity" }, graph, overlays);
    expect(heading.title).toBe("Actions for B");
    expect(heading.subtitle).toBe("activity (Intake)");
    // The arc ends at B and is worse than B's own badge; C's badge does not touch B.
    expect(heading.note).toBe("Worst expectation: arc: late — 40 % late");
    expect(menuHeading({ kind: "edge", id: "cd", ids: ["c", "d"], label: "C → D", edgeKind: "follows" }, graph, [], "de")).toEqual({ title: "Aktionen für C → D", subtitle: "Pfad", note: undefined });
    expect(menuHeading({ kind: "group", id: "s1", ids: ["s1"], label: "Intake", groupKind: "stage" }, graph, []).subtitle).toBe("stage");
    expect(menuHeading({ kind: "pair", id: "a", ids: ["a", "d"], label: "A, D" }, graph, []).title).toBe("Actions for A and D");
  });

  it("is the same keyboard for a menu without a map", () => {
    expect(menuKey(actions, 1, { key: "ArrowUp" })).toEqual({ active: 4, handled: true });
    expect(menuKey([], 0, { key: "ArrowDown" })).toEqual({ active: 0, handled: true });
    expect(menuKey([], 0, { key: "End" })).toEqual({ active: 0, handled: true });
  });
});

describe("map controller: what the map emphasises", () => {
  const set = (e: { nodes: Set<string>; edges: Set<string> } | undefined) => e && { nodes: [...e.nodes].sort(), edges: [...e.edges].sort() };

  it("shows the paths of the focus, or of the pair of activities a selection of two names", () => {
    // C's paths: A → C in, C → D out.
    const own = mapEmphasis(state({ focus: "c", selection: sel(["a", "b"]) }), graph);
    expect(own).toMatchObject({ focus: "c", focusShown: true });
    expect(set(own.bright)).toEqual({ nodes: ["a", "c", "d"], edges: ["ac", "cd"] });
    // A and C are joined by A → C alone.
    const pair = mapEmphasis(state({ selection: sel(["a", "c"]) }), graph);
    expect(pair).toMatchObject({ focus: ["a", "c"], focusShown: true });
    expect(set(pair.bright)).toEqual({ nodes: ["a", "c"], edges: ["ac"] });
  });

  it("brightens what relates to the selection when no focus is shown, and nothing without a selection", () => {
    const withEvent: FlowGraph = { ...graph, nodes: [...graph.nodes, { id: "e", kind: "event", label: "End" }] };
    for (const [s, g] of [
      [state({ selection: sel(["a", "e"]) }), withEvent], // an event does not make a pair
      [state({ selection: sel(["a", "c"], ["ab"]) }), graph], // nor does a pair with a path
      [state({ selection: sel(["b"]), focus: "gone" }), graph], // a focus on an element not shown
    ] as [MapState, FlowGraph][]) {
      const r = mapEmphasis(s, g);
      expect(r.focusShown).toBe(false);
      expect(r.bright?.nodes.has(s.selection.nodes[0])).toBe(true);
    }
    expect(mapEmphasis(state({ selection: sel(["b"]), focus: "gone" }), graph).focus).toBe("gone");
    expect(mapEmphasis(state(), graph)).toEqual({ focus: undefined, focusShown: false, bright: undefined });
  });
});
