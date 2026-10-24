import { describe, expect, it } from "vitest";
import { layoutBpmn } from "../../src/bpmn/headless";
import { type Box, type FlowGraph, laneModel, laneRoutes, routeSequenceFlows, spanLanes, stackLanes } from "../../src/index";

// P (pool) ⊃ L1, L2 ⊃ L2a, L2b; X (stage) and L3 at the top level; Q is a pool without children.
const nested: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "P" },
    { id: "b", kind: "activity", label: "B", group: "L1" },
    { id: "c", kind: "activity", label: "C", tags: ["role:Two"] },
    { id: "d", kind: "activity", label: "D", group: "L2a" },
    { id: "e", kind: "activity", label: "E", group: "X" },
    { id: "f", kind: "activity", label: "F", tags: ["lane:L1"] },
    { id: "h", kind: "event", label: "H", group: "missing" },
  ],
  edges: [
    { id: "a-b", kind: "flow", source: "a", target: "b" },
    { id: "b-c", kind: "flow", source: "b", target: "c" },
    { id: "c-d", kind: "flow", source: "c", target: "d" },
    { id: "d-e", kind: "flow", source: "d", target: "e" },
    { id: "e-f", kind: "flow", source: "e", target: "f" },
    { id: "b-f", kind: "flow", source: "b", target: "f" },
    { id: "f-f", kind: "flow", source: "f", target: "f" },
    { id: "f-h", kind: "flow", source: "f", target: "h" },
  ],
  groups: [
    { id: "P", kind: "pool", label: "Pool" },
    { id: "L1", kind: "lane", label: "One", parent: "P" },
    { id: "L2", kind: "lane", label: "Two", parent: "P" },
    { id: "L2a", kind: "lane", label: "Two a", parent: "L2" },
    { id: "L2b", kind: "lane", label: "Two b", parent: "L2" },
    { id: "X", kind: "stage", label: "X" },
    { id: "L3", kind: "lane", label: "Three" },
    { id: "Q", kind: "pool", label: "Empty" },
  ],
};

describe("lane model", () => {
  it("takes the leaves of the group tree as nested lanes and puts a parent group's node into its first leaf", () => {
    const m = laneModel(nested, { lanes: "nested", crossLaneEdges: "routed" });
    expect(m.lanes.map((l) => l.id)).toEqual(["L1", "L2a", "L2b", "X", "L3"]);
    // a: first leaf under P; c, f: tags are not read, so they follow their first predecessor; h: unknown group.
    expect(Object.fromEntries(m.laneOf)).toEqual({ a: "L1", b: "L1", c: "L1", d: "L2a", e: "X", f: "X", h: "X" });
  });

  it("puts the members of groups on a cycle of parents into the lanes of their neighbours, and lays such a graph out", async () => {
    // g1 and g2 are each other's parent, s is its own parent: no leaf lies under them, so their nodes follow a -> b -> c -> d into L.
    const cyclic: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "g1" },
        { id: "b", kind: "activity", label: "B", group: "g2" },
        { id: "c", kind: "activity", label: "C", group: "s" },
        { id: "d", kind: "activity", label: "D", group: "L" },
      ],
      edges: [
        { id: "a->b", kind: "flow", source: "a", target: "b" },
        { id: "b->c", kind: "flow", source: "b", target: "c" },
        { id: "c->d", kind: "flow", source: "c", target: "d" },
      ],
      groups: [
        { id: "g1", kind: "lane", label: "G1", parent: "g2" },
        { id: "g2", kind: "lane", label: "G2", parent: "g1" },
        { id: "s", kind: "lane", label: "S", parent: "s" },
        { id: "L", kind: "lane", label: "L" },
      ],
    };
    const model = laneModel(cyclic, { lanes: "nested", crossLaneEdges: "routed" });
    expect(model.lanes.map((l) => l.id)).toEqual(["L"]);
    expect([...model.laneOf]).toEqual([["d", "L"], ["c", "L"], ["b", "L"], ["a", "L"]]);
    const positions = await layoutBpmn(cyclic);
    for (const n of cyclic.nodes) expect(Object.values(positions.nodes[n.id]).every(Number.isFinite), n.id).toBe(true);
  });

  it("takes the top-level lane groups as role lanes and reads tags", () => {
    const m = laneModel(nested, { lanes: "roles", crossLaneEdges: "direct" });
    expect(m.lanes.map((l) => l.id)).toEqual(["L1", "L2", "L3"]);
    // a: no lane on its chain (P is a pool), so it follows its successor b; d: L2 is on its chain; c: tag by label.
    expect(Object.fromEntries(m.laneOf)).toEqual({ a: "L1", b: "L1", c: "L2", d: "L2", e: "L2", f: "L1", h: "L1" });
  });

  it("stacks the lanes from a start, a gap apart, with the members in graph order", () => {
    const m = laneModel(nested, { lanes: "roles", crossLaneEdges: "direct" });
    const seen: Record<string, string[]> = {};
    const sizes: Record<string, number> = { L1: 10, L2: 20, L3: 30 };
    const { slots, end } = stackLanes(nested, m, 5, 2, (lane, members, start) => {
      seen[lane.id] = members.map((n) => `${n.id}@${start}`);
      return sizes[lane.id];
    });
    expect(slots.map((s) => [s.lane.id, s.start, s.size])).toEqual([["L1", 5, 10], ["L2", 17, 20], ["L3", 39, 30]]);
    expect(end).toBe(69);
    expect(seen).toEqual({ L1: ["a@5", "b@5", "f@5", "h@5"], L2: ["c@17", "d@17", "e@17"], L3: [] });
  });

  it("spans nested groups over their children with a label strip and a top-level pool over all lanes", () => {
    const m = laneModel(nested, { lanes: "nested", crossLaneEdges: "routed" });
    const lane = (y: number, height: number): Box => ({ x: 30, y, width: 470, height });
    const boxes = { L1: lane(0, 100), L2a: lane(100, 50), L2b: lane(150, 60), X: lane(210, 20), L3: lane(230, 20) };
    const spans = spanLanes(nested, m, boxes, { main: "x", labelSpace: 30 });
    expect(Object.keys(spans)).toEqual(["P", "L2", "Q"]);
    expect(spans.L2).toEqual({ x: 0, y: 100, width: 500, height: 110 });
    expect(spans.P).toEqual({ x: 0, y: 0, width: 500, height: 250 });
    expect(spans.Q).toEqual({ x: 0, y: 0, width: 500, height: 250 });
  });

  it("spans every pool over its role lanes and the lanes without a parent", () => {
    const g: FlowGraph = {
      nodes: [],
      edges: [],
      groups: [
        { id: "P", kind: "pool", label: "P" },
        { id: "R", kind: "pool", label: "R" },
        { id: "L1", kind: "lane", label: "One", parent: "P" },
        { id: "L3", kind: "lane", label: "Three" },
        { id: "L4", kind: "lane", label: "Four", parent: "R" },
      ],
    };
    const m = laneModel(g, { lanes: "roles", crossLaneEdges: "direct" });
    // Flow downwards: lanes stacked along x.
    const boxes = { L1: { x: 0, y: -24, width: 100, height: 500 }, L3: { x: 108, y: -24, width: 80, height: 500 }, L4: { x: 196, y: -24, width: 60, height: 500 } };
    expect(spanLanes(g, m, boxes, { main: "y" })).toEqual({
      P: { x: 0, y: -24, width: 188, height: 500 },
      R: { x: 108, y: -24, width: 148, height: 500 },
    });
  });

  it("moves routes with their ends or drops them across lanes for direct edges", () => {
    const g: FlowGraph = {
      nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "activity" as const, label: id })),
      edges: [
        { id: "ab", kind: "follows", source: "a", target: "b" },
        { id: "ac", kind: "follows", source: "a", target: "c" },
        { id: "de", kind: "follows", source: "d", target: "e" },
      ],
      groups: [{ id: "L", kind: "lane", label: "L" }],
    };
    const m = laneModel(g, { lanes: "roles", crossLaneEdges: "direct" });
    const kept = { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] };
    const routes = { ab: { points: [{ x: 0, y: 1 }, { x: 9, y: 2 }] }, ac: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, de: kept, gone: kept };
    const offsets = new Map([["a", 10], ["b", 10], ["c", -5]]);
    const r = laneRoutes(g, m, {}, { routes, axis: "y", offsets });
    expect(r).toEqual({ ab: { points: [{ x: 0, y: 11 }, { x: 9, y: 12 }] }, de: kept });
    expect(r.de).toBe(kept);
    expect(laneRoutes(g, m, {})).toEqual({});
  });

  it("routes every edge around the shapes for routed edges", () => {
    const g: FlowGraph = {
      nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity" as const, label: id })),
      edges: [
        { id: "ab", kind: "flow", source: "a", target: "b" },
        { id: "ac", kind: "flow", source: "a", target: "c" },
      ],
      groups: [{ id: "L1", kind: "lane", label: "1" }, { id: "L2", kind: "lane", label: "2" }],
    };
    const nodes = { a: { x: 0, y: 0, width: 100, height: 80 }, b: { x: 200, y: 0, width: 100, height: 80 }, c: { x: 200, y: 200, width: 100, height: 80 } };
    const m = laneModel(g, { lanes: "nested", crossLaneEdges: "routed" });
    const before = { routes: { ab: { points: [] } }, axis: "y" as const, offsets: new Map() };
    const r = laneRoutes(g, m, nodes, before);
    expect(Object.keys(r).sort()).toEqual(["ab", "ac"]);
    expect(r.ab.points).toEqual([{ x: 100, y: 40 }, { x: 200, y: 40 }]);
    expect(r).toEqual(routeSequenceFlows(g, nodes));
  });
});
