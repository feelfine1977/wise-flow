import { describe, expect, it } from "vitest";
import { type Box, type FlowEdge, type FlowGraph, collapseGroups, createPositions, pathBetween, pathsFor, positionsBounds, unionBoxes } from "../../src/index";
import { prepareScene } from "../../src/canvas/index";

// Engines limit the number of arguments of a call (about 150,000 to a few
// hundred thousand); each of these inputs holds far more elements than that.
const MILLION = 1_000_000;

/**
 * 1,001 activities, each followed by every other one, so 1,001,000 follows
 * edges without self-loops; `selfLoops` turns the first edge of as many
 * activities into a repeat of the activity itself. Edge `e{i}` counts i + 1.
 */
function denseGraph(selfLoops = 0): FlowGraph {
  const n = 1001;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: "activity" as const, label: `N${i}` }));
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 1; k < n; k++) {
      const target = i < selfLoops && k === 1 ? i : (i + k) % n;
      edges.push({ id: `e${edges.length}`, kind: "follows", source: `n${i}`, target: `n${target}`, metrics: { count: edges.length + 1 } });
    }
  }
  return { nodes, edges };
}

/** Node boxes on a grid, without routed edges: drawing falls back to straight lines. */
function gridPositions(graph: FlowGraph) {
  const nodes: Record<string, Box> = {};
  graph.nodes.forEach((node, i) => {
    nodes[node.id] = { x: (i % 40) * 200, y: Math.floor(i / 40) * 100, width: 160, height: 60 };
  });
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}

describe("graph-sized inputs", () => {
  it("prepares the default scene of a million follows edges without self-loops", () => {
    const graph = denseGraph();
    expect(graph.edges.length).toBe(MILLION + 1000);
    const scene = prepareScene(graph, gridPositions(graph));
    expect(scene.shapes.filter((s) => s.kind === "selfLoop")).toHaveLength(0);
  });

  it("prepares the default scene of a million follows edges with self-loops", () => {
    const graph = denseGraph(3);
    const scene = prepareScene(graph, gridPositions(graph));
    const loops = scene.shapes.filter((s) => s.kind === "selfLoop");
    expect(loops.map((s) => s.overlay.target)).toEqual(["n0", "n1", "n2"]);
    // n2's repeat is e2000 with count 2,001; the largest follows count is 1,001,000.
    expect(loops[2].overlay.payload?.value).toBe(2001 / 1_001_000);
  });

  it("collapses a stage around a million follows edges, counting each once as an internal transition", () => {
    const dense = denseGraph();
    const graph: FlowGraph = { ...dense, nodes: dense.nodes.map((n) => ({ ...n, group: "s" })), groups: [{ id: "s", kind: "stage", label: "S" }] };
    const collapsed = collapseGroups(graph, ["s"]);
    expect(collapsed.edges).toEqual([]);
    // The counts 1 … 1,001,000 add up to 1,001,000 · 1,001,001 / 2.
    expect(collapsed.nodes.map((n) => [n.id, n.metrics?.internalCount])).toEqual([["s", 501_001_000_500]]);
  });

  it("lists the paths of an activity and the path between two of a million edges", () => {
    const graph = denseGraph();
    const paths = pathsFor(graph, "n0");
    expect(paths.outgoing).toHaveLength(1000);
    expect(paths.incoming).toHaveLength(1000);
    // n0 reaches n5 directly over e4; n5 reaches n0 directly over e5995.
    const between = pathBetween(graph, "n0", "n5");
    expect(between.direct?.id).toBe("e4");
    expect(between.edges).toEqual(["e4"]);
    expect(between.reverse?.edges).toEqual(["e5995"]);
  });

  it("bounds a million boxes and a route of a million points", () => {
    const boxes: Box[] = Array.from({ length: MILLION }, (_, i) => ({ x: i, y: -i, width: 2, height: 3 }));
    expect(unionBoxes(boxes)).toEqual({ x: 0, y: -(MILLION - 1), width: MILLION + 1, height: MILLION + 2 });
    const points = Array.from({ length: MILLION }, (_, i) => ({ x: i % 1000, y: Math.floor(i / 1000) }));
    const nodes = Object.fromEntries(boxes.map((b, i) => [`n${i}`, b]));
    expect(positionsBounds({ nodes: {}, groups: {}, edges: { long: { points } } })).toEqual({ x: 0, y: 0, width: 999, height: 999 });
    // The boxes reach down to y = 3, the route to y = 999.
    expect(createPositions({ nodes, groups: {}, edges: { long: { points } } }, "given", "RIGHT").bounds).toEqual({ x: 0, y: -(MILLION - 1), width: MILLION + 1, height: MILLION - 1 + 999 });
  });
});
