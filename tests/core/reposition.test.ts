import { describe, expect, it } from "vitest";
import { layout, repositionNodes, routeSequenceFlows, type Box, type FlowGraph, type Positions, type XY } from "../../src/index";
import raw from "../fixtures/o2c-observed.json";

const graph = raw as unknown as FlowGraph;
/** Whether an axis-aligned segment runs through the open interior of a box. */
function crossesBox(a: XY, b: XY, r: Box) {
  const [lo, hi] = a.x === b.x ? [Math.min(a.y, b.y), Math.max(a.y, b.y)] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  return a.x === b.x ? a.x > r.x && a.x < r.x + r.width && hi > r.y && lo < r.y + r.height : a.y > r.y && a.y < r.y + r.height && hi > r.x && lo < r.x + r.width;
}
function onBoundary(p: XY, b: Box) {
  const inside = p.x >= b.x - 0.01 && p.x <= b.x + b.width + 0.01 && p.y >= b.y - 0.01 && p.y <= b.y + b.height + 0.01;
  return inside && Math.min(Math.abs(p.x - b.x), Math.abs(p.x - b.x - b.width), Math.abs(p.y - b.y), Math.abs(p.y - b.y - b.height)) < 0.01;
}
function attached(g: FlowGraph, positions: Positions) {
  for (const edge of g.edges.filter((e) => e.source !== e.target)) {
    const points = positions.edges[edge.id]?.points;
    expect(points, edge.id).toBeDefined();
    expect(onBoundary(points[0], positions.nodes[edge.source]), `source ${edge.id}`).toBe(true);
    expect(onBoundary(points.at(-1)!, positions.nodes[edge.target]), `target ${edge.id}`).toBe(true);
  }
}
function atCount(count: number): FlowGraph {
  const ids = new Set(graph.nodes.filter((n) => n.kind === "activity").sort((a, b) => b.metrics!.cases - a.metrics!.cases || a.id.localeCompare(b.id)).slice(0, count).map((n) => n.id));
  const nodes = graph.nodes.filter((n) => n.kind !== "activity" || ids.has(n.id));
  const visible = new Set(nodes.map((n) => n.id));
  return { ...graph, nodes, edges: graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)), groups: graph.groups?.filter((g) => nodes.some((n) => n.group === g.id)) };
}

describe("observed O2C geometry", () => {
  it.each([9, 10, 16])("docks every actual observed connection at %i activities", async (count) => {
    const scene = atCount(count);
    const positions = await layout(scene, { engine: "elk", edgeRouting: "ORTHOGONAL" });
    attached(scene, positions);
    expect(scene.edges.find((e) => e.source === "a_create_order" && e.target === "a_create_order_item")?.metrics?.cases).toBe(51149);
  });
  it("passes each grouped activity to ELK once", async () => {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
    const elk = new ELK();
    const original = elk.layout.bind(elk);
    elk.layout = async (input, options) => {
      const ids: string[] = [];
      const walk = (node: typeof input) => { ids.push(node.id); node.children?.forEach(walk); };
      walk(input);
      expect(new Set(ids).size).toBe(ids.length);
      return original(input, options);
    };
    await layout(atCount(9), { engine: "elk", elk });
  });
});

const simple: FlowGraph = {
  nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity", label: id })),
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 41 } }, { id: "ba", kind: "follows", source: "b", target: "a", metrics: { count: 2 } }],
};
const positions: Positions = { engine: "given", direction: "RIGHT", groups: {}, nodes: {
  a: { x: 0, y: 0, width: 100, height: 60 }, b: { x: 400, y: 0, width: 100, height: 60 }, c: { x: 200, y: 200, width: 100, height: 60 },
}, edges: { ab: { points: [{ x: 100, y: 30 }, { x: 400, y: 30 }] } }, bounds: { x: 0, y: 0, width: 500, height: 260 } };

describe("repositioning malformed input", () => {
  it("routes edges without an id like any other", () => {
    // A null column of a backend: typed around the model, so the ids read undefined.
    const none = undefined as unknown as string;
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }],
      edges: [{ id: "e1", kind: "follows", source: "a", target: "b" }, { id: none, kind: "follows", source: "b", target: "a" }],
    };
    const boxes = { a: { x: 0, y: 0, width: 180, height: 60 }, b: { x: 400, y: 0, width: 180, height: 60 } };
    const given: Positions = { nodes: boxes, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 580, height: 60 }, engine: "given", direction: "RIGHT" };
    const moved = repositionNodes(graph, given, { a: { x: 0, y: 200 } });
    expect(moved.nodes.a).toEqual({ x: 0, y: 200, width: 180, height: 60 });
    expect(moved.nodes.b).toEqual(boxes.b);
    expect(Object.keys(moved.edges).sort()).toEqual(["e1", "undefined"]);
  });

  it("leaves a box with a number that is not finite out of routing instead of searching without end", () => {
    // Shrunk from a search: the box of n3 is -Infinity high; the search ran in a loop until the route outgrew an array.
    const graph: FlowGraph = {
      nodes: ["n0", "n2", "n3"].map((id) => ({ id, kind: "activity" as const, label: id })),
      edges: [{ id: "n3->n2", kind: "follows", source: "n3", target: "n2" }, { id: "n0->n2", kind: "follows", source: "n0", target: "n2" }],
    };
    const nodes: Record<string, Box> = { n0: { x: 40, y: 40, width: 180, height: 48 }, n2: { x: 480, y: 0, width: 180, height: 48 }, n3: { x: 0, y: 100, width: 180, height: -Infinity } };
    const routes = routeSequenceFlows(graph, nodes, { allowOverlap: true });
    expect(Object.keys(routes)).toEqual(["n0->n2"]);
    expect(routes["n0->n2"].points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe("manual repositioning", () => {
  it("reroutes even nonincident edges around a moved obstacle and preserves evidence", () => {
    const before = structuredClone({ simple, positions });
    const moved = repositionNodes(simple, positions, { c: { x: 200, y: 0 } });
    attached(simple, moved);
    for (const route of Object.values(moved.edges)) for (let i = 1; i < route.points.length; i++) {
      expect(crossesBox(route.points[i - 1], route.points[i], moved.nodes.c)).toBe(false);
    }
    expect(new Set(Object.keys(moved.edges))).toEqual(new Set(["ab", "ba"]));
    expect(moved.nodes.a).toBe(positions.nodes.a);
    expect(moved.nodes.b).toBe(positions.nodes.b);
    expect({ simple, positions }).toEqual(before);
  });
  it("docks moved endpoints, updates bounds and restores exact original geometry on reset", () => {
    const moved = repositionNodes(simple, positions, { a: { x: -180, y: -140 } });
    attached(simple, moved);
    expect(moved.bounds.x).toBeLessThanOrEqual(-180);
    expect(moved.bounds.y).toBeLessThanOrEqual(-140);
    expect(repositionNodes(simple, positions, {})).toBe(positions);
    expect(repositionNodes(simple, positions, { missing: { x: 1, y: 2 }, a: { x: NaN, y: 2 } })).toBe(positions);
  });
  it("does not crash or leave stale endpoints while nodes temporarily overlap", () => {
    const moved = repositionNodes(simple, positions, { a: { x: 350, y: 10 } });
    attached(simple, moved);
    expect(Object.values(moved.edges).every((r) => r.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
  });
  it("reroutes the actual O2C graph after moving Create Order Item", async () => {
    const scene = atCount(10);
    const initial = await layout(scene, { engine: "elk", spacing: { node: 90, layer: 100 } });
    const moved = repositionNodes(scene, initial, { a_create_order_item: { x: initial.nodes.a_create_order_item.x, y: initial.bounds.y - 200 } });
    attached(scene, moved);
    expect(Object.keys(moved.edges).sort()).toEqual(scene.edges.filter((e) => e.source !== e.target).map((e) => e.id).sort());
  });
});
