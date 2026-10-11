import { describe, expect, it } from "vitest";
import type { FlowGraph } from "../../src/index";
import { families } from "../support/graphs";
import { elementCount, shrinkCase, shrinkGraph, shrinkList } from "../support/shrink";

describe("shrinkList", () => {
  it("finds the two numbers a planted failure needs among five hundred", () => {
    const items = Array.from({ length: 500 }, (_, i) => i + 1);
    const fails = (xs: number[]) => xs.includes(17) && xs.includes(400);
    const small = shrinkList(items, fails);
    expect(small).toEqual([17, 400]);
    expect(fails(small)).toBe(true);
  });

  it("keeps a single failing element and keeps the input order", () => {
    expect(shrinkList([5, 9, 3, 7], (xs) => xs.includes(3))).toEqual([3]);
    const evens = shrinkList([4, 1, 8, 2, 6, 10], (xs) => xs.filter((x) => x % 2 === 0).length >= 3);
    expect(evens).toHaveLength(3);
    expect(evens.every((x) => x % 2 === 0)).toBe(true);
    expect([4, 1, 8, 2, 6, 10].filter((x) => evens.includes(x))).toEqual(evens);
    expect(shrinkList([], () => true)).toEqual([]);
  });

  it("returns the empty list when the failure needs no element", () => {
    expect(shrinkList([1], () => true)).toEqual([]);
    expect(shrinkList([1, 2, 3], () => true)).toEqual([]);
  });

  it("treats a predicate that throws as failing", () => {
    const small = shrinkList([1, 2, 3, 4, 5, 6, 7, 8], (xs) => {
      if (xs.includes(6)) throw new Error("boom");
      return false;
    });
    expect(small).toEqual([6]);
  });
});

describe("shrinkGraph", () => {
  it("reduces a planted failure in a chain of more than five hundred elements to fewer than ten", () => {
    const graph = families.chain(260, 5);
    expect(elementCount(graph)).toBeGreaterThanOrEqual(500);
    const fails = (g: FlowGraph) => g.edges.some((e) => e.target === "n200");
    const small = shrinkGraph(graph, fails);
    expect(fails(small)).toBe(true);
    expect(elementCount(small)).toBeLessThan(10);
    expect(small.nodes.map((n) => n.id)).toEqual(["n199", "n200"]);
    expect(small.edges.map((e) => e.id)).toEqual(["n199->n200"]);
  });

  it("reduces a planted failure that needs a self-loop in a cyclic graph to one node and one edge", () => {
    const graph = families.cyclic(300, 2);
    expect(elementCount(graph)).toBeGreaterThanOrEqual(500);
    const fails = (g: FlowGraph) => g.edges.some((e) => e.source === e.target);
    const small = shrinkGraph(graph, fails);
    expect(fails(small)).toBe(true);
    expect(small.nodes).toHaveLength(1);
    expect(small.edges).toHaveLength(1);
    expect(small.edges[0].source).toBe(small.nodes[0].id);
  });

  it("drops groups and overlays with their targets and keeps what the failure needs", () => {
    const graph = families.overlaid(230, 9);
    expect(elementCount(graph)).toBeGreaterThanOrEqual(500);
    const fails = (g: FlowGraph) => g.overlays!.some((o) => o.kind === "tint" && g.nodes.some((n) => n.group === o.target));
    const small = shrinkGraph(graph, fails);
    expect(fails(small)).toBe(true);
    expect(small.nodes).toHaveLength(1);
    expect(small.edges).toHaveLength(0);
    expect(small.groups).toHaveLength(1);
    expect(small.overlays).toHaveLength(1);
    expect(small.groups![0].id).toBe(small.nodes[0].group);
    expect(small.overlays![0]).toMatchObject({ kind: "tint", target: small.groups![0].id });
  });

  it("keeps a nested group's members in the nearest surviving ancestor and never leaves a dangling reference", () => {
    const graph = families.nested(40, 4);
    const nestedNode = graph.nodes.find((n) => graph.groups!.find((g) => g.id === n.group)?.parent)!;
    const fails = (g: FlowGraph) => g.nodes.some((n) => n.id === nestedNode.id && n.group !== undefined);
    const small = shrinkGraph(graph, fails);
    expect(fails(small)).toBe(true);
    expect(small.nodes).toHaveLength(1);
    expect(small.groups).toHaveLength(1);
    expect(small.groups![0].parent).toBeUndefined();
    expect(small.nodes[0].group).toBe(small.groups![0].id);
    expect(small.overlays ?? []).toEqual([]);
  });

  it("keeps a node's unknown group and a group's unknown parent that the failure needs", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "nowhere" },
        { id: "b", kind: "activity", label: "B", group: "s" },
      ],
      edges: [{ id: "a->b", kind: "follows", source: "a", target: "b" }],
      groups: [
        { id: "s", kind: "stage", label: "S" },
        { id: "orphan", kind: "stage", label: "Orphan", parent: "missing" },
      ],
    };
    const unknownGroup = shrinkGraph(graph, (g) => g.nodes.some((n) => n.group === "nowhere"));
    expect(unknownGroup.nodes).toEqual([{ id: "a", kind: "activity", label: "A", group: "nowhere" }]);
    expect(unknownGroup.groups).toEqual([]);
    const unknownParent = shrinkGraph(graph, (g) => g.groups!.some((x) => x.parent === "missing"));
    expect(unknownParent.groups).toEqual([{ id: "orphan", kind: "stage", label: "Orphan", parent: "missing" }]);
  });

  it("keeps an edge whose endpoint was never a node while other nodes go", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A" },
        { id: "b", kind: "activity", label: "B" },
        { id: "c", kind: "activity", label: "C" },
      ],
      edges: [
        { id: "a->b", kind: "follows", source: "a", target: "b" },
        { id: "gone->c", kind: "follows", source: "gone", target: "c" },
      ],
    };
    const small = shrinkGraph(graph, (g) => g.edges.some((e) => e.source === "gone"));
    expect(small.nodes.map((n) => n.id)).toEqual(["c"]);
    expect(small.edges.map((e) => e.id)).toEqual(["gone->c"]);
  });

  it("drops the last group and the last overlay when the failure needs neither", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", group: "s" }],
      edges: [],
      groups: [{ id: "s", kind: "stage", label: "S" }],
      overlays: [{ kind: "badge", target: "a", payload: { constraintId: "c" } }],
    };
    const small = shrinkGraph(graph, (g) => g.nodes.some((n) => n.id === "a"));
    expect(small).toEqual({ nodes: [{ id: "a", kind: "activity", label: "A", group: undefined }], edges: [], groups: [], overlays: [] });
  });

  it("returns the graph itself when nothing can go", () => {
    const graph = families.tree(6, 1);
    const small = shrinkGraph(graph, (g) => g.nodes.length === 6 && g.edges.length === 5);
    expect(small.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
    expect(small.edges.map((e) => e.id)).toEqual(graph.edges.map((e) => e.id));
  });
});

describe("shrinkCase", () => {
  it("finds the smallest failing size first and then the smallest failing graph of that size", () => {
    const result = shrinkCase({ size: 500, generate: (size) => families.chain(size, 7), shrink: shrinkGraph }, (g) => g.nodes.some((n) => n.id === "n36"));
    expect(result.size).toBe(37);
    expect(result.value.nodes.map((n) => n.id)).toEqual(["n36"]);
    expect(result.value.edges).toEqual([]);
    expect(result.tests).toBeLessThan(200);
  });

  it("stops at size zero when even the empty case fails, and at the given size when nothing smaller does", () => {
    expect(shrinkCase({ size: 64, generate: (size) => families.chain(size, 1) }, () => true).size).toBe(0);
    expect(shrinkCase({ size: 64, generate: (size) => families.chain(size, 1) }, (g) => g.nodes.length === 64).size).toBe(64);
  });

  it("shrinks a case whose predicate throws", () => {
    const result = shrinkCase({ size: 100, generate: (size) => families.tree(size, 3), shrink: shrinkGraph }, (g) => {
      if (g.nodes.length >= 10) throw new RangeError("too big");
      return false;
    });
    expect(result.size).toBe(10);
    expect(result.value.nodes).toHaveLength(10);
  });
});
