import { describe, expect, it } from "vitest";
import { type FlowGraph, type MenuAction, type Positions } from "../../src/index";
import { type MapContext, type MapEvent, type MapState, announceChange, initialMapState, mapStep } from "../../src/core/map-controller";

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
const key = (k: string, mod: { shiftKey?: boolean; altKey?: boolean } = {}): MapEvent => ({ type: "key", key: k, ...mod });
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
