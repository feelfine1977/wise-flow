import { describe, expect, it } from "vitest";
import {
  type FlowGraph,
  abstract,
  collapseGroups,
  focusHighlight,
  focusMembers,
  indexGraph,
  laneAssignment,
  laneGroups,
  neighbourhood,
  relatedToSelection,
} from "../../src/index";

// Two levels: stage `outer` holds activity a and stage `inner`, which holds b and c.
// d sits in a separate stage; e has no group.
const nested: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "Approve", group: "outer" },
    { id: "b", kind: "activity", label: "Book", group: "inner" },
    { id: "c", kind: "activity", label: "Check", group: "inner" },
    { id: "d", kind: "activity", label: "Dispatch", group: "other" },
    { id: "e", kind: "activity", label: "End" },
  ],
  edges: [
    { id: "e->a", kind: "follows", source: "e", target: "a", metrics: { count: 4 } },
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 4 } },
    { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 4 } },
    { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { count: 3 } },
  ],
  groups: [
    { id: "outer", kind: "stage", label: "Outer stage" },
    { id: "inner", kind: "stage", label: "Inner stage", parent: "outer" },
    { id: "other", kind: "stage", label: "Other stage" },
  ],
};

const ids = (items: { id: string }[]) => items.map((x) => x.id);

describe("graph index", () => {
  it("answers the ancestors of nodes and groups, innermost first", () => {
    const idx = indexGraph(nested);
    expect(ids(idx.ancestors("b"))).toEqual(["inner", "outer"]);
    expect(ids(idx.ancestors("a"))).toEqual(["outer"]);
    expect(ids(idx.ancestors("e"))).toEqual([]);
    expect(ids(idx.ancestors("inner"))).toEqual(["outer"]);
    expect(ids(idx.ancestors("outer"))).toEqual([]);
    expect(ids(idx.ancestors("unknown"))).toEqual([]);
  });

  it("reads an id shared by a node and a group as the node unless told otherwise", () => {
    const g: FlowGraph = {
      nodes: [{ id: "s", kind: "stage", label: "Stage node", group: "top" }],
      edges: [],
      groups: [
        { id: "top", kind: "pool", label: "Pool" },
        { id: "mid", kind: "lane", label: "Lane", parent: "top" },
        { id: "s", kind: "stage", label: "Stage group", parent: "mid" },
      ],
    };
    const idx = indexGraph(g);
    expect(ids(idx.ancestors("s"))).toEqual(["top"]);
    expect(ids(idx.ancestors("s", "group"))).toEqual(["mid", "top"]);
    expect(idx.label("s")).toBe("Stage node");
  });

  it("ends the chain at unknown parents and before a group repeats", () => {
    const g: FlowGraph = {
      nodes: [{ id: "n", kind: "activity", label: "N", group: "x" }],
      edges: [],
      groups: [
        { id: "x", kind: "lane", label: "X", parent: "y" },
        { id: "y", kind: "lane", label: "Y", parent: "x" },
        { id: "z", kind: "lane", label: "Z", parent: "gone" },
      ],
    };
    const idx = indexGraph(g);
    expect(ids(idx.ancestors("n"))).toEqual(["x", "y"]);
    expect(ids(idx.ancestors("x"))).toEqual(["y"]);
    expect(ids(idx.ancestors("z"))).toEqual([]);
    expect(ids(idx.allMembers("y"))).toEqual(["n"]);
  });

  it("lists all members of a group including nested groups, in graph order", () => {
    const idx = indexGraph(nested);
    expect(ids(idx.allMembers("outer"))).toEqual(["a", "b", "c"]);
    expect(ids(idx.allMembers("inner"))).toEqual(["b", "c"]);
    expect(ids(idx.allMembers("other"))).toEqual(["d"]);
    expect(ids(idx.allMembers("unknown"))).toEqual([]);
    // Direct members stay available separately.
    expect(ids(idx.members.get("outer")!)).toEqual(["a"]);
  });

  it("labels nodes, then groups, then falls back to the id", () => {
    const idx = indexGraph(nested);
    expect(idx.label("b")).toBe("Book");
    expect(idx.label("inner")).toBe("Inner stage");
    expect(idx.label("nowhere")).toBe("nowhere");
  });
});

describe("members of a nested group", () => {
  it("are the same for selection and for paths", () => {
    // Selecting the outer stage keeps its nested activities bright, exactly the
    // nodes the outer stage stands for as a path focus.
    const selected = relatedToSelection(nested, { nodes: [], edges: [], groups: ["outer"] });
    expect([...selected.nodes].sort()).toEqual(["a", "b", "c"]);
    expect([...focusMembers(nested, "outer")].sort()).toEqual(["a", "b", "c"]);
    expect([...relatedToSelection(nested, { nodes: [], edges: [], groups: ["inner"] }).nodes].sort()).toEqual([...focusMembers(nested, "inner")].sort());
  });

  it("cross the outer boundary only, for paths and the focus highlight", () => {
    const n = neighbourhood(nested, "outer");
    expect(ids(n.incoming)).toEqual(["e->a"]);
    expect(ids(n.outgoing)).toEqual(["c->d"]);
    const lit = focusHighlight(nested, "outer");
    expect([...lit.nodes].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect([...lit.edges].sort()).toEqual(["c->d", "e->a"]);
  });

  it("collapse into the outer stage and keep the groups used by kept nodes", () => {
    const collapsed = collapseGroups(nested, ["outer"]);
    expect(ids(collapsed.nodes)).toEqual(["outer", "d", "e"]);
    expect(ids(collapsed.groups ?? [])).toEqual(["other"]);
    expect(collapsed.meta?.collapsedMembers).toEqual({ outer: ["a", "b", "c"] });
    // Collapsing the inner stage as well still yields one stage node for the outer one.
    expect(ids(collapseGroups(nested, ["inner", "outer"]).nodes)).toEqual(["outer", "d", "e"]);
    expect(ids(collapseGroups(nested, ["inner"]).nodes)).toEqual(["a", "inner", "d", "e"]);
    const kept = abstract(nested, { minNodeShare: 0, minEdgeShare: 0 });
    expect(ids(kept.groups ?? [])).toEqual(["outer", "inner", "other"]);
  });

  it("put nodes into the first lane on their group chain", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "x", kind: "activity", label: "X", group: "team" },
        { id: "y", kind: "activity", label: "Y", group: "back" },
      ],
      edges: [],
      groups: [
        { id: "pool", kind: "pool", label: "Pool" },
        { id: "front", kind: "lane", label: "Front", parent: "pool" },
        { id: "back", kind: "lane", label: "Back", parent: "pool" },
        { id: "team", kind: "lane", label: "Team", parent: "front" },
      ],
    };
    const lanes = laneGroups(g, "roles");
    expect(ids(lanes)).toEqual(["front", "back"]);
    expect(Object.fromEntries(laneAssignment(g, lanes))).toEqual({ x: "front", y: "back" });
  });
});
