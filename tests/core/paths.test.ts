import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, focusHighlight, focusMembers, indexGraph, neighbourhood, pathBetween, pathRows, pathsFor } from "../../src/index";

const g: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1", metrics: { cases: 100 } },
    { id: "b", kind: "activity", label: "B", group: "s1", metrics: { cases: 80 } },
    { id: "c", kind: "activity", label: "C", group: "s2", metrics: { cases: 60 } },
    { id: "d", kind: "activity", label: "D", group: "s2", metrics: { cases: 40 } },
    { id: "e", kind: "activity", label: "E", group: "s2", metrics: { cases: 10 } },
  ],
  edges: [
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 70, cases: 70, medianLagHours: 12, violationShare: 0.1 } },
    { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { count: 30, cases: 30, medianLagHours: 48, violationShare: 0.5 } },
    { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 60, cases: 60 } },
    { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { count: 40, cases: 40, medianLagHours: 5 } },
    { id: "c->e", kind: "follows", source: "c", target: "e", metrics: { count: 2, cases: 2 } },
    { id: "c->c", kind: "follows", source: "c", target: "c", metrics: { count: 5, cases: 5 } },
    { id: "d->b", kind: "follows", source: "d", target: "b", metrics: { count: 4, cases: 4 } },
    { id: "k", kind: "constraint", source: "a", target: "d" },
  ],
  groups: [
    { id: "s1", kind: "stage", label: "Stage 1" },
    { id: "s2", kind: "stage", label: "Stage 2" },
  ],
};

describe("pathsFor", () => {
  it("lists the follows paths at an activity from the map, sorted by count, with shares and totals", () => {
    const p = pathsFor(g, "c");
    expect(p.source).toBe("graph");
    expect(p.incoming.map((r) => r.edgeId)).toEqual(["b->c", "a->c"]);
    expect(p.outgoing.map((r) => r.edgeId)).toEqual(["c->d", "c->e"]);
    expect(p.totals).toEqual({ incoming: 90, outgoing: 42 });
    expect(p.incoming[0]).toMatchObject({ from: "b", to: "c", count: 60, cases: 60, share: 1 });
    expect(p.incoming[1]).toMatchObject({ from: "a", to: "c", count: 30, share: 0.5, medianLagHours: 48, violationShare: 0.5 });
    expect(p.outgoing[0].medianLagHours).toBe(5);
    expect(p.outgoing[1].medianLagHours).toBeUndefined();
  });

  it("sorts by any column and by the other endpoint's label", () => {
    expect(pathsFor(g, "c", { sort: "label" }).incoming.map((r) => r.from)).toEqual(["a", "b"]);
    expect(pathsFor(g, "c", { sort: "label", ascending: false }).incoming.map((r) => r.from)).toEqual(["b", "a"]);
    expect(pathsFor(g, "c", { sort: "medianLagHours" }).incoming.map((r) => r.edgeId)).toEqual(["a->c", "b->c"]);
    expect(pathsFor(g, "c", { sort: "count", ascending: true }).incoming.map((r) => r.edgeId)).toEqual(["a->c", "b->c"]);
  });

  it("reads the contract's paths block when it belongs to the focus and resolves its edge ids", () => {
    const withPaths: FlowGraph = {
      ...g,
      focus: "c",
      paths: {
        incoming: [{ from: "a", count: 35, cases: 33, median_lag: 50, violation_share: 0.4 }],
        outgoing: [{ to: "d", count: 41, cases: 40, median_lag: 5 }],
      },
    };
    const p = pathsFor(withPaths, "c");
    expect(p.source).toBe("payload");
    expect(p.incoming).toEqual([{ edgeId: "a->c", from: "a", to: "c", count: 35, cases: 33, share: 0.55, medianLagHours: 50, p90LagHours: undefined, violationShare: 0.4 }]);
    expect(p.outgoing[0]).toMatchObject({ edgeId: "c->d", from: "c", to: "d", count: 41, medianLagHours: 5 });
    expect(p.totals).toEqual({ incoming: 35, outgoing: 41 });
    // The block of another activity is not used for this focus.
    expect(pathsFor(withPaths, "b").source).toBe("graph");
    // A block given through the options wins over the graph's own.
    const override = pathsFor(g, "c", { paths: { focus: "c", incoming: [{ from: "b", count: 1 }], outgoing: [] } });
    expect(override.source).toBe("payload");
    expect(override.incoming.map((r) => r.edgeId)).toEqual(["b->c"]);
    expect(override.outgoing).toEqual([]);
  });

  it("sums to the activity's in- and out-counts on the fixture", () => {
    const idx = indexGraph(globalScene);
    const focus = "record_invoice_receipt";
    const p = pathsFor(globalScene, focus);
    const sum = (edges: { source: string; target: string; metrics?: Record<string, number> }[]) => edges.filter((e) => e.source !== e.target).reduce((s, e) => s + (e.metrics?.count ?? 0), 0);
    expect(p.totals.incoming).toBe(sum(idx.incoming.get(focus)!));
    expect(p.totals.outgoing).toBe(sum(idx.outgoing.get(focus)!));
    const fromGoodsReceipt = p.incoming.find((r) => r.from === "record_goods_receipt");
    expect(fromGoodsReceipt).toMatchObject({ edgeId: "record_goods_receipt->record_invoice_receipt", count: 112924, medianLagHours: 296.6667, violationShare: 0.4522 });
    expect(p.incoming.every((r) => r.from !== focus)).toBe(true);
  });
});

describe("neighbourhood and focus", () => {
  it("treats a group as its members and ignores self-loops, constraints and internal paths", () => {
    expect([...focusMembers(g, "s2")].sort()).toEqual(["c", "d", "e"]);
    expect([...focusMembers(g, "a")]).toEqual(["a"]);
    const n = neighbourhood(g, "s2");
    expect(n.incoming.map((e) => e.id).sort()).toEqual(["a->c", "b->c"]);
    expect(n.outgoing.map((e) => e.id)).toEqual(["d->b"]);
    expect(n.predecessors.sort()).toEqual(["a", "b"]);
    expect(n.successors).toEqual(["b"]);
    const c = neighbourhood(g, "c");
    expect(c.incoming.map((e) => e.id).sort()).toEqual(["a->c", "b->c"]);
    expect(c.outgoing.map((e) => e.id).sort()).toEqual(["c->d", "c->e"]);
  });

  it("highlights an activity with its predecessors, successors and paths", () => {
    const h = focusHighlight(g, "c");
    expect([...h.nodes].sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect([...h.edges].sort()).toEqual(["a->c", "b->c", "c->d", "c->e"]);
    const group = focusHighlight(g, "s2");
    expect([...group.edges].sort()).toEqual(["a->c", "b->c", "d->b"]);
  });
});

describe("pathBetween", () => {
  it("finds the shortest, then strongest path and the reverse path", () => {
    const ad = pathBetween(g, "a", "d");
    expect(ad.found).toBe(true);
    expect(ad.direct).toBeUndefined();
    expect(ad.nodes).toEqual(["a", "c", "d"]);
    expect(ad.edges).toEqual(["a->c", "c->d"]);
    expect(ad.reverse).toBeUndefined();
    const bd = pathBetween(g, "b", "d");
    expect(bd.edges).toEqual(["b->c", "c->d"]);
    expect(bd.reverse?.direct?.id).toBe("d->b");
    expect(bd.reverse?.edges).toEqual(["d->b"]);
    const ab = pathBetween(g, "a", "b");
    expect(ab.direct?.id).toBe("a->b");
    expect(ab.edges).toEqual(["a->b"]);
    const none = pathBetween(g, "e", "a");
    expect(none.found).toBe(false);
    expect(none.nodes).toEqual([]);
  });

  it("returns rows in path order and highlights both directions", () => {
    const bd = pathBetween(g, "b", "d");
    expect(pathRows(g, bd).map((r) => [r.from, r.to, r.count])).toEqual([
      ["b", "c", 60],
      ["c", "d", 40],
    ]);
    expect(pathRows(g, bd, "reverse").map((r) => r.edgeId)).toEqual(["d->b"]);
    const h = focusHighlight(g, ["b", "d"]);
    expect([...h.nodes].sort()).toEqual(["b", "c", "d"]);
    expect([...h.edges].sort()).toEqual(["b->c", "c->d", "d->b"]);
  });

  it("finds the path between goods receipt and payment on the fixture", () => {
    const p = pathBetween(globalScene, "record_goods_receipt", "clear_invoice");
    expect(p.found).toBe(true);
    expect(p.nodes[0]).toBe("record_goods_receipt");
    expect(p.nodes[p.nodes.length - 1]).toBe("clear_invoice");
    expect(p.edges.length).toBe(p.nodes.length - 1);
  });
});
