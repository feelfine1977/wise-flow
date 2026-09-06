import { describe, expect, it } from "vitest";
import { type FlowGraph, type MenuAction, COLLAPSED_TAG, MENU_GROUP_ORDER, defaultActions, emptySelection, menuTargetFor, menuTitle, sortActions } from "../../src/index";

const g: FlowGraph = {
  nodes: [
    { id: "__start", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "A", group: "s1" },
    { id: "b", kind: "activity", label: "B", group: "s1" },
    { id: "c", kind: "activity", label: "C", group: "s2" },
    { id: "gw", kind: "gateway", label: "×", tags: ["xor", "split"] },
    { id: "s3", kind: "stage", label: "Stage 3", tags: [COLLAPSED_TAG], metrics: { members: 2 } },
    { id: "__end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 10 } },
    { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 8 } },
    { id: "k", kind: "constraint", source: "a", target: "c" },
  ],
  groups: [
    { id: "s1", kind: "stage", label: "Stage 1" },
    { id: "s2", kind: "stage", label: "Stage 2" },
    { id: "s3", kind: "stage", label: "Stage 3" },
  ],
};

const ids = (actions: MenuAction[]) => actions.map((a) => a.id);
const groupsInOrder = (actions: MenuAction[]) => actions.every((a, i) => i === 0 || MENU_GROUP_ORDER.indexOf(actions[i - 1].group) <= MENU_GROUP_ORDER.indexOf(a.group));
const uniqueAccelerators = (actions: MenuAction[]) => {
  const keys = actions.map((a) => a.accelerator).filter(Boolean);
  return new Set(keys).size === keys.length;
};

describe("menu targets", () => {
  it("targets the element, or the pair or set it belongs to", () => {
    expect(menuTargetFor(g, { kind: "node", id: "a" }, emptySelection)).toEqual({ kind: "node", id: "a", ids: ["a"], label: "A", nodeKind: "activity" });
    const pair = menuTargetFor(g, { kind: "node", id: "b" }, { nodes: ["a", "b"], edges: [], groups: [] });
    expect(pair).toMatchObject({ kind: "pair", id: "b", ids: ["b", "a"], label: "B, A" });
    const set = menuTargetFor(g, { kind: "node", id: "a" }, { nodes: ["a", "b", "c"], edges: [], groups: [] });
    expect(set).toMatchObject({ kind: "set", ids: ["a", "b", "c"] });
    // An element outside the multi-selection is targeted alone.
    expect(menuTargetFor(g, { kind: "node", id: "c" }, { nodes: ["a", "b"], edges: [], groups: [] }).kind).toBe("node");
    expect(menuTargetFor(g, { kind: "edge", id: "a->b" }, emptySelection)).toEqual({ kind: "edge", id: "a->b", ids: ["a->b"], label: "A → B", edgeKind: "follows" });
    expect(menuTargetFor(g, { kind: "group", id: "s1" }, emptySelection)).toEqual({ kind: "group", id: "s1", ids: ["s1"], label: "Stage 1", groupKind: "stage" });
  });

  it("titles the menu", () => {
    expect(menuTitle(menuTargetFor(g, { kind: "node", id: "a" }, emptySelection), g)).toBe("Actions for A");
    expect(menuTitle(menuTargetFor(g, { kind: "node", id: "b" }, { nodes: ["a", "b"], edges: [], groups: [] }), g)).toBe("Actions for B and A");
    expect(menuTitle(menuTargetFor(g, { kind: "node", id: "a" }, { nodes: ["a", "b", "c"], edges: [], groups: [] }), g)).toBe("Actions for 3 activities");
    expect(menuTitle(menuTargetFor(g, { kind: "node", id: "a" }, emptySelection), g, "de")).toBe("Aktionen für A");
  });
});

describe("defaultActions", () => {
  it("offers the activity actions with their filter clauses, in group order with unique accelerators", () => {
    const actions = defaultActions(g, menuTargetFor(g, { kind: "node", id: "a" }, emptySelection));
    expect(ids(actions)).toEqual(["filter-to", "exclude", "paths", "lens", "worst-cases", "pin", "add-constraint"]);
    expect(groupsInOrder(actions)).toBe(true);
    expect(uniqueAccelerators(actions)).toBe(true);
    expect(actions[0]).toMatchObject({ label: "Filter to cases with this activity", accelerator: "f", clause: { kind: "activity", op: "contains", activity: "a" } });
    expect(actions[1].clause).toEqual({ kind: "activity", op: "never", activity: "a" });
    expect(actions.map((a) => a.group)).toEqual(["filter", "filter", "explore", "explore", "explore", "compare", "author"]);
  });

  it("offers pair and set actions on a multi-selection", () => {
    const pair = defaultActions(g, menuTargetFor(g, { kind: "node", id: "a" }, { nodes: ["a", "b"], edges: [], groups: [] }));
    expect(ids(pair)).toEqual(["filter-to", "exclude", "paths", "lens", "pin", "add-constraint"]);
    expect(pair[0].clause).toEqual({ kind: "follows", a: "a", b: "b", directly: false, never: undefined });
    expect(pair.find((a) => a.id === "paths")?.label).toBe("Path between A and B");
    expect(pair.find((a) => a.id === "add-constraint")?.label).toBe("Add lag or precedence expectation A → B");
    const set = defaultActions(g, menuTargetFor(g, { kind: "node", id: "a" }, { nodes: ["a", "b", "c"], edges: [], groups: [] }));
    expect(ids(set)).toEqual(["filter-to", "exclude", "pin"]);
    expect(set[0].clause).toHaveLength(3);
  });

  it("offers path, stage, event and gateway actions", () => {
    const edge = defaultActions(g, menuTargetFor(g, { kind: "edge", id: "a->b" }, emptySelection));
    expect(ids(edge)).toEqual(["filter-to", "exclude", "paths", "worst-cases", "pin", "add-constraint"]);
    expect(edge[0].clause).toMatchObject({ kind: "follows", a: "a", b: "b", directly: true });
    expect(edge.find((a) => a.id === "paths")?.label).toBe("Path analysis A → B");
    expect(ids(defaultActions(g, menuTargetFor(g, { kind: "edge", id: "k" }, emptySelection)))).toEqual(["lens", "pin"]);

    const stage = defaultActions(g, menuTargetFor(g, { kind: "group", id: "s1" }, emptySelection));
    expect(ids(stage)).toEqual(["filter-to", "exclude", "collapse", "paths", "worst-cases", "pin"]);
    expect(stage[0].clause).toEqual({ kind: "any", clauses: [{ kind: "activity", op: "contains", activity: "a" }, { kind: "activity", op: "contains", activity: "b" }] });
    expect(ids(defaultActions(g, menuTargetFor(g, { kind: "group", id: "s1" }, emptySelection), "en", { collapsed: true }))).toContain("expand");
    // A stage without members has nothing to filter by.
    const empty = defaultActions(g, menuTargetFor(g, { kind: "group", id: "s3" }, emptySelection));
    expect(empty.find((a) => a.id === "filter-to")?.disabled).toBe(true);
    // A collapsed stage node offers to expand.
    expect(ids(defaultActions(g, menuTargetFor(g, { kind: "node", id: "s3" }, emptySelection)))).toContain("expand");

    const end = defaultActions(g, menuTargetFor(g, { kind: "node", id: "__end" }, emptySelection));
    expect(ids(end)).toEqual(["filter-to", "exclude", "pin"]);
    expect(end[0]).toMatchObject({ label: "Filter to closed cases", clause: { kind: "open", value: false } });
    expect(end[1]).toMatchObject({ label: "Filter to open cases", clause: { kind: "open", value: true } });
    expect(ids(defaultActions(g, menuTargetFor(g, { kind: "node", id: "__start" }, emptySelection)))).toEqual(["pin"]);
    expect(ids(defaultActions(g, menuTargetFor(g, { kind: "node", id: "gw" }, emptySelection)))).toEqual(["pin"]);
  });

  it("adds the entry that hides the paths while a focus is shown, and sorts stably by group", () => {
    const withFocus = defaultActions(g, menuTargetFor(g, { kind: "node", id: "a" }, emptySelection), "en", { hasFocus: true });
    expect(ids(withFocus)).toEqual(["filter-to", "exclude", "paths", "lens", "worst-cases", "clear-focus", "pin", "add-constraint"]);
    expect(withFocus.find((a) => a.id === "clear-focus")?.accelerator).toBe("h");
    const unsorted: MenuAction[] = [
      { id: "x", label: "x", group: "author" },
      { id: "y", label: "y", group: "filter" },
      { id: "z", label: "z", group: "filter" },
      { id: "w", label: "w", group: "explore" },
    ];
    expect(ids(sortActions(unsorted))).toEqual(["y", "z", "w", "x"]);
    expect(defaultActions(g, menuTargetFor(g, { kind: "node", id: "a" }, emptySelection), "de")[0].label).toBe("Auf Fälle mit dieser Aktivität filtern");
  });
});
