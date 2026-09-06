import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import {
  type FlowGraph,
  clearSelection,
  describeSelection,
  emptySelection,
  isSelected,
  relatedToSelection,
  selectElement,
  selectMany,
  selectionElements,
  selectionEquals,
  selectionShape,
  selectionSize,
} from "../../src/index";

const small: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1" },
    { id: "b", kind: "activity", label: "B", group: "s1" },
    { id: "c", kind: "activity", label: "C", group: "s2" },
    { id: "d", kind: "activity", label: "D", group: "s2" },
  ],
  edges: [
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 10 } },
    { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 8 } },
    { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { count: 6 } },
    { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { count: 2 } },
  ],
  groups: [
    { id: "s1", kind: "stage", label: "Stage 1" },
    { id: "s2", kind: "stage", label: "Stage 2" },
  ],
};

describe("selection", () => {
  it("replaces, toggles, adds and removes; a click on the only selected element clears", () => {
    let s = selectElement(emptySelection, { kind: "node", id: "a" });
    expect(s).toEqual({ nodes: ["a"], edges: [], groups: [] });
    s = selectElement(s, { kind: "node", id: "b" }, "toggle");
    expect(s.nodes).toEqual(["a", "b"]);
    s = selectElement(s, { kind: "node", id: "a" }, "toggle");
    expect(s.nodes).toEqual(["b"]);
    s = selectElement(s, { kind: "edge", id: "a->b" }, "add");
    expect(s).toEqual({ nodes: ["b"], edges: ["a->b"], groups: [] });
    s = selectElement(s, { kind: "edge", id: "a->b" }, "add");
    expect(s.edges).toEqual(["a->b"]);
    s = selectElement(s, { kind: "edge", id: "a->b" }, "remove");
    expect(s.edges).toEqual([]);
    s = selectElement(s, { kind: "node", id: "b" }, "replace");
    expect(s).toEqual(emptySelection);
    s = selectElement({ nodes: ["a", "b"], edges: [], groups: [] }, { kind: "node", id: "a" }, "replace");
    expect(s.nodes).toEqual(["a"]);
    expect(clearSelection()).toEqual(emptySelection);
    expect(emptySelection).toEqual({ nodes: [], edges: [], groups: [] });
  });

  it("selects groups alone and drops them when a node or edge joins", () => {
    let s = selectElement({ nodes: ["a"], edges: ["a->b"], groups: [] }, { kind: "group", id: "s1" });
    expect(s).toEqual({ nodes: [], edges: [], groups: ["s1"] });
    s = selectElement(s, { kind: "node", id: "a" }, "add");
    expect(s).toEqual({ nodes: ["a"], edges: [], groups: [] });
    expect(selectElement({ nodes: [], edges: [], groups: ["s1"] }, { kind: "group", id: "s1" }, "toggle")).toEqual(emptySelection);
    expect(selectElement({ nodes: [], edges: [], groups: ["s1"] }, { kind: "group", id: "s2" }, "toggle")).toEqual({ nodes: [], edges: [], groups: ["s2"] });
  });

  it("selects many, measures, compares and lists the selection", () => {
    const refs = [
      { kind: "node" as const, id: "a" },
      { kind: "node" as const, id: "b" },
      { kind: "edge" as const, id: "a->b" },
    ];
    const s = selectMany(emptySelection, refs);
    expect(s).toEqual({ nodes: ["a", "b"], edges: ["a->b"], groups: [] });
    expect(selectionSize(s)).toBe(3);
    expect(selectionElements(s)).toEqual(refs);
    expect(isSelected(s, { kind: "node", id: "b" })).toBe(true);
    expect(isSelected(s, { kind: "node", id: "c" })).toBe(false);
    expect(selectMany(s, [{ kind: "node", id: "a" }], "remove")).toEqual({ nodes: ["b"], edges: ["a->b"], groups: [] });
    expect(selectMany(s, [{ kind: "node", id: "c" }])).toEqual({ nodes: ["c"], edges: [], groups: [] });
    expect(selectionEquals(s, { nodes: ["a", "b"], edges: ["a->b"], groups: [] })).toBe(true);
    expect(selectionEquals(s, { nodes: ["b", "a"], edges: ["a->b"], groups: [] })).toBe(false);
  });

  it("classifies the shape of a selection", () => {
    const shape = (nodes: string[], edges: string[] = [], groups: string[] = []) => selectionShape({ nodes, edges, groups });
    expect(shape([])).toBe("none");
    expect(shape(["a"])).toBe("node");
    expect(shape(["a", "b"])).toBe("pair");
    expect(shape(["a", "b", "c"])).toBe("set");
    expect(shape([], ["a->b"])).toBe("edge");
    expect(shape([], ["a->b", "b->c"])).toBe("edges");
    expect(shape([], [], ["s1"])).toBe("group");
    expect(shape(["a"], ["a->b"])).toBe("mixed");
    expect(shape(["a"], [], ["s1"])).toBe("mixed");
  });

  it("keeps the selected elements and their neighbours bright", () => {
    const node = relatedToSelection(small, { nodes: ["b"], edges: [], groups: [] });
    expect([...node.nodes].sort()).toEqual(["b"]);
    expect([...node.edges].sort()).toEqual(["a->b", "b->c"]);
    const edge = relatedToSelection(small, { nodes: [], edges: ["c->d"], groups: [] });
    expect([...edge.nodes].sort()).toEqual(["c", "d"]);
    expect([...edge.edges]).toEqual(["c->d"]);
    const group = relatedToSelection(small, { nodes: [], edges: [], groups: ["s1"] });
    expect([...group.nodes].sort()).toEqual(["a", "b"]);
    const fixture = relatedToSelection(globalScene, { nodes: ["record_goods_receipt"], edges: [], groups: [] });
    expect(fixture.edges.has("record_goods_receipt->record_invoice_receipt")).toBe(true);
    expect(fixture.nodes.size).toBe(1);
  });

  it("announces the selection in English and German", () => {
    expect(describeSelection(small, emptySelection)).toBe("Selection cleared.");
    expect(describeSelection(small, { nodes: ["a"], edges: [], groups: [] })).toBe("Selected: A.");
    expect(describeSelection(small, { nodes: ["a", "b"], edges: [], groups: [] })).toBe("Selected: A and B.");
    expect(describeSelection(small, { nodes: ["a", "b", "c"], edges: [], groups: [] })).toBe("Selected: 3 activities: A, B, C.");
    expect(describeSelection(small, { nodes: [], edges: ["a->b"], groups: [] })).toBe("Selected: path A → B.");
    expect(describeSelection(small, { nodes: [], edges: ["a->b", "b->c"], groups: [] })).toBe("Selected: 2 paths.");
    expect(describeSelection(small, { nodes: [], edges: [], groups: ["s1"] })).toBe("Selected: Stage 1 (stage).");
    expect(describeSelection(small, { nodes: ["a"], edges: ["a->b"], groups: [] })).toBe("Selected: 2 elements.");
    expect(describeSelection(small, { nodes: ["a"], edges: [], groups: [] }, "de")).toBe("Ausgewählt: A.");
    expect(describeSelection(small, { nodes: [], edges: [], groups: ["s1"] }, "de")).toBe("Ausgewählt: Stage 1 (Phase).");
  });
});
