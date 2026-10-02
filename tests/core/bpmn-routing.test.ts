import { describe, expect, it } from "vitest";
import type { Box, FlowGraph, Positions, XY } from "../../src/core/index";
import { layoutBpmn, liteFromGraph } from "../../src/bpmn/index";
import { routeSequenceFlows } from "../../src/bpmn/routing";
import { globalScene } from "../../fixtures/bpic2019";

function assertRoutes(graph: FlowGraph, nodes: Record<string, Box>, routes: Positions["edges"]) {
  expect(Object.keys(routes).sort()).toEqual(graph.edges.map((e) => e.id).sort());
  const interior = (a: XY, b: XY, r: Box) => a.x === b.x
    ? a.x > r.x && a.x < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height
    : a.y > r.y && a.y < r.y + r.height && Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width;
  const collisions: string[] = [];
  for (const e of graph.edges) {
    const points = routes[e.id].points;
    expect(points.length).toBeGreaterThanOrEqual(2);
    const atBoundary = (p: XY, r: Box) => (p.x === r.x || p.x === r.x + r.width) && p.y >= r.y && p.y <= r.y + r.height || (p.y === r.y || p.y === r.y + r.height) && p.x >= r.x && p.x <= r.x + r.width;
    expect(atBoundary(points[0], nodes[e.source])).toBe(true);
    expect(atBoundary(points.at(-1)!, nodes[e.target])).toBe(true);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      expect(a.x === b.x || a.y === b.y, `orthogonal ${e.id}`).toBe(true);
      for (const [id, box] of Object.entries(nodes)) if (interior(a, b, box)) collisions.push(`${e.id} crosses ${id}`);
    }
  }
  expect(collisions).toEqual([]);
}
const nodes: Record<string, Box> = {
  a: { x: 50, y: 50, width: 100, height: 80 },
  obstacle: { x: 250, y: 50, width: 100, height: 80 },
  b: { x: 450, y: 50, width: 100, height: 80 },
  c: { x: 250, y: 240, width: 100, height: 80 },
  d: { x: 450, y: 240, width: 50, height: 50 },
};
const graph = (pairs: string[][]): FlowGraph => ({
  nodes: Object.keys(nodes).map((id) => ({ id, label: id, kind: id === "d" ? "gateway" : "activity" })),
  edges: pairs.map(([source, target], i) => ({ id: `e${i}`, source, target, kind: "flow" })),
});

describe("swimlane connector routing", () => {
  it("routes a long forward connection around the intervening task", () => {
    const g = graph([["a", "b"]]);
    const routes = routeSequenceFlows(g, nodes);
    assertRoutes(g, nodes, routes);
    expect(routes.e0.points.length).toBeGreaterThan(2);
  });
  it("preserves returns, crossed lanes, gateway tips, shared endpoints and a self-loop", () => {
    const g = graph([["a", "b"], ["b", "a"], ["a", "d"], ["b", "c"], ["c", "a"], ["d", "obstacle"], ["c", "c"]]);
    const routes = routeSequenceFlows(g, nodes);
    assertRoutes(g, nodes, routes);
    for (const edge of g.edges.filter((e) => e.target === "d")) {
      const tip = routes[edge.id].points.at(-1)!;
      expect(tip.x === nodes.d.x + nodes.d.width / 2 || tip.y === nodes.d.y + nodes.d.height / 2).toBe(true);
    }
    expect(routeSequenceFlows(g, nodes)).toEqual(routes);
  });
  it("keeps a clear straight connection simple and provides alternate tracks for duplicates", () => {
    const g = graph([["a", "obstacle"], ["a", "obstacle"]]);
    const routes = routeSequenceFlows(g, nodes);
    assertRoutes(g, nodes, routes);
    expect(routes.e0.points.length).toBe(2);
    expect(routes.e1.points).not.toEqual(routes.e0.points);
  });
  it("handles an empty graph and rejects overlapping geometry instead of drawing through a task", () => {
    expect(routeSequenceFlows({ nodes: [], edges: [] }, {})).toEqual({});
    const overlap = { ...nodes, b: { ...nodes.a } };
    expect(() => routeSequenceFlows(graph([["a", "b"]]), overlap)).toThrow(/Cannot route/);
  });
  it("routes the complete dense recorded process without crossing shapes", async () => {
    const g = liteFromGraph(globalScene, { lanes: "groups", selfLoops: "marker" });
    const p = await layoutBpmn(g, { engine: "dagre" });
    assertRoutes(g, p.nodes, p.edges);
    const pool = p.groups.__pool;
    for (const route of Object.values(p.edges)) for (const point of route.points) {
      expect(point.x).toBeGreaterThanOrEqual(pool.x); expect(point.x).toBeLessThanOrEqual(pool.x + pool.width);
      expect(point.y).toBeGreaterThanOrEqual(pool.y); expect(point.y).toBeLessThanOrEqual(pool.y + pool.height);
    }
  }, 120000);
  it("reserves the actual custom node height when placing rows", async () => {
    const g = liteFromGraph(globalScene, { lanes: "groups" });
    const p = await layoutBpmn(g, { engine: "dagre", nodeSize: { width: 160, height: 140 } });
    assertRoutes(g, p.nodes, p.edges);
    for (const n of g.nodes.filter((n) => n.group)) {
      const b = p.nodes[n.id], lane = p.groups[n.group!];
      expect(b.y).toBeGreaterThanOrEqual(lane.y);
      expect(b.y + b.height).toBeLessThanOrEqual(lane.y + lane.height);
    }
  }, 120000);
});
