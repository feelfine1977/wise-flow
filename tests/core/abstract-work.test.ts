import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, abstract } from "../../src/index";

/** Edges whose every property read counts as one visit. */
function counted(edges: FlowEdge[]): { edges: FlowEdge[]; visits: () => number } {
  let visits = 0;
  const wrap = (edge: FlowEdge): FlowEdge => {
    const out = {} as FlowEdge;
    for (const [key, value] of Object.entries(edge)) {
      Object.defineProperty(out, key, {
        enumerable: true,
        get: () => {
          visits++;
          return value;
        },
      });
    }
    return out;
  };
  return { edges: edges.map(wrap), visits: () => visits };
}

/** A ring of n activities, each repeating itself: n follows edges and n self-loops. */
function loopRing(n: number): FlowGraph {
  const nodes: FlowNode[] = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: "activity", label: `A${i}`, metrics: { cases: 10 } }));
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i++) {
    edges.push({ id: `a${i}->a${(i + 1) % n}`, kind: "follows", source: `a${i}`, target: `a${(i + 1) % n}`, metrics: { count: 100 + (i % 7) } });
    edges.push({ id: `a${i}->a${i}`, kind: "follows", source: `a${i}`, target: `a${i}`, metrics: { count: 1 + (i % 50) } });
  }
  return { nodes, edges };
}

/**
 * A hub that follows each of n leaves strongly and is followed by each weakly:
 * removing the weak edges leaves every leaf without an outgoing edge, and each
 * leaf gets its own back again.
 */
function backStar(n: number): FlowGraph {
  const nodes: FlowNode[] = [{ id: "hub", kind: "activity", label: "Hub", metrics: { cases: 10 } }];
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `l${i}`, kind: "activity", label: `L${i}`, metrics: { cases: 10 } });
    edges.push({ id: `hub->l${i}`, kind: "follows", source: "hub", target: `l${i}`, metrics: { count: 100 } });
    edges.push({ id: `l${i}->hub`, kind: "follows", source: `l${i}`, target: "hub", metrics: { count: 1 + (i % 9) } });
  }
  return { nodes, edges };
}

function visitsOf(graph: FlowGraph, options: Parameters<typeof abstract>[1]): { visits: number; result: FlowGraph } {
  const c = counted(graph.edges);
  const result = abstract({ ...graph, edges: c.edges }, options);
  return { visits: c.visits(), result };
}

describe("abstraction work", () => {
  for (const relativeTo of ["max", "total"] as const) {
    it(`visits the edges of a cyclic graph linearly in the number of self-loops (${relativeTo})`, () => {
      const n = 2000;
      const small = visitsOf(loopRing(n), { relativeTo });
      const large = visitsOf(loopRing(2 * n), { relativeTo });
      expect(small.result.edges).toHaveLength(2 * n);
      expect(large.result.edges).toHaveLength(4 * n);
      expect(large.visits / small.visits).toBeLessThanOrEqual(2.2);
    });

    it(`gives n leaves their way back with work linear in n (${relativeTo})`, () => {
      const n = 2000;
      // A back edge counts at most 9, a hub edge 100, and the n hub edges make up more
      // than 9/10 of the total: half the maximum or half a hub edge's share of the total
      // keeps the hub edges and removes every back edge.
      const share = (leaves: number) => (relativeTo === "max" ? 0.5 : 0.5 / leaves);
      const small = visitsOf(backStar(n), { relativeTo, minEdgeShare: share(n) });
      const large = visitsOf(backStar(2 * n), { relativeTo, minEdgeShare: share(2 * n) });
      expect(small.result.edges).toHaveLength(2 * n);
      expect(small.result.edges.filter((e) => e.target === "hub").every((e) => e.tags?.includes("reconnected"))).toBe(true);
      expect(large.result.edges).toHaveLength(4 * n);
      expect(large.visits / small.visits).toBeLessThanOrEqual(2.2);
    });
  }
});
