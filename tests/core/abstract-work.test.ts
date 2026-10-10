import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, abstract, isConnected } from "../../src/index";
import { seededCyclicGraph } from "./abstract-cases";

/** Elements whose every property read counts as one visit. */
function counted<T extends object>(items: T[]): { items: T[]; visits: () => number } {
  let visits = 0;
  const wrap = (item: T): T => {
    const out = {} as T;
    for (const [key, value] of Object.entries(item)) {
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
  return { items: items.map(wrap), visits: () => visits };
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

/**
 * n islands of two strong activities each, without an edge between two islands:
 * every island reaches the next one and one more, chosen by a seeded generator,
 * only through a rare activity of its own, which a node share of 0.5 removes.
 * Island 0 is the heaviest, so the map grows from there.
 */
function islands(n: number): FlowGraph {
  let s = 11;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const follows = (source: string, target: string, count: number) => edges.push({ id: `${source}->${target}`, kind: "follows", source, target, metrics: { count } });
  for (let i = 0; i < n; i++) {
    const cases = i === 0 ? 200 : 100;
    nodes.push({ id: `p${i}`, kind: "activity", label: `P${i}`, metrics: { cases } }, { id: `q${i}`, kind: "activity", label: `Q${i}`, metrics: { cases } }, { id: `r${i}`, kind: "activity", label: `R${i}`, metrics: { cases: 1 } });
    follows(`p${i}`, `q${i}`, 100);
    follows(`q${i}`, `r${i}`, 10 + Math.floor(rnd() * 5) * 10);
    follows(`r${i}`, `p${(i + 1) % n}`, 10 + Math.floor(rnd() * 5) * 10);
    const other = Math.floor(rnd() * n);
    if (other !== i) follows(`r${i}`, `q${other}`, 10 + Math.floor(rnd() * 5) * 10);
  }
  return { nodes, edges };
}

function visitsOf(graph: FlowGraph, options: Parameters<typeof abstract>[1]): { visits: number; result: FlowGraph } {
  const nodes = counted(graph.nodes);
  const edges = counted(graph.edges);
  const result = abstract({ ...graph, nodes: nodes.items, edges: edges.items }, options);
  return { visits: nodes.visits() + edges.visits(), result };
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

  it("joins the components of a simplified cyclic graph with work near-linear in its size", () => {
    const options = { minEdgeShare: 0.3, minNodeShare: 0.2 };
    const small = visitsOf(seededCyclicGraph(7, 5000), options);
    const large = visitsOf(seededCyclicGraph(7, 10000), options);
    expect(isConnected(small.result)).toBe(true);
    expect(isConnected(large.result)).toBe(true);
    expect(large.visits / small.visits).toBeLessThanOrEqual(2.3);
  });

  it("joins many small components through removed activities with work near-linear in their number", () => {
    const n = 2000;
    const small = visitsOf(islands(n), { minNodeShare: 0.5 });
    const large = visitsOf(islands(2 * n), { minNodeShare: 0.5 });
    for (const [result, size] of [[small.result, n], [large.result, 2 * n]] as const) {
      expect(isConnected(result)).toBe(true);
      // A rare activity touches at most three islands, so each one re-added joins at most two more.
      expect(result.nodes.filter((node) => node.id.startsWith("r")).length).toBeGreaterThanOrEqual((size - 1) / 2);
    }
    expect(large.visits / small.visits).toBeLessThanOrEqual(2.3);
  });

  it("reconnects a simplified cyclic graph of 100,000 activities", () => {
    // Slow: about two seconds here, where one search per join did not finish in 500 s.
    // The suite's time limit only stops a run that has gone back to that.
    const result = abstract(seededCyclicGraph(7, 100000), { minEdgeShare: 0.3, minNodeShare: 0.2 });
    expect(isConnected(result)).toBe(true);
    expect(result.nodes.some((node) => node.tags?.includes("reconnected"))).toBe(true);
  });
});
