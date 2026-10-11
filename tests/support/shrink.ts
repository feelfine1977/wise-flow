/**
 * Shrinking: from a failing case to a small failing case. `shrinkList` is a
 * delta-debugging minimiser over an array; `shrinkGraph` applies it to the
 * nodes, edges, groups and overlays of a graph in turn, keeping the graph
 * consistent (an edge goes with its node, an overlay with its target); and
 * `shrinkCase` first tries smaller sizes of a generated case and then shrinks
 * the elements of the smallest failing size.
 *
 * A predicate that throws counts as failing, so a test can shrink a case
 * that crashes as well as one that returns the wrong answer.
 */
import type { FlowGraph } from "../../src/index";

export type Fails<T> = (value: T) => boolean;

function failing<T>(fails: Fails<T>): Fails<T> {
  return (value) => {
    try {
      return fails(value);
    } catch {
      return true;
    }
  };
}

/**
 * The smallest subsequence of `items` for which `fails` still holds, by
 * Zeller's ddmin: try each of `n` chunks alone, then each complement, and
 * refine the chunking until no single chunk can go. `items` must fail as given.
 */
export function shrinkList<T>(items: readonly T[], fails: Fails<T[]>): T[] {
  const test = failing(fails);
  let current = [...items];
  let n = 2;
  while (current.length >= 2) {
    const size = Math.ceil(current.length / n);
    const chunks: T[][] = [];
    for (let i = 0; i < current.length; i += size) chunks.push(current.slice(i, i + size));
    let reduced = false;
    for (const chunk of chunks) {
      if (chunk.length < current.length && test(chunk)) {
        current = chunk;
        n = 2;
        reduced = true;
        break;
      }
    }
    if (reduced) continue;
    if (chunks.length > 1) {
      for (let i = 0; i < chunks.length; i++) {
        const rest = chunks.filter((_, k) => k !== i).flat();
        if (test(rest)) {
          current = rest;
          n = Math.max(2, n - 1);
          reduced = true;
          break;
        }
      }
    }
    if (reduced) continue;
    if (n >= current.length) break;
    n = Math.min(current.length, n * 2);
  }
  return current;
}

/** The graph restricted to the given nodes: edges keep both endpoints, overlays keep their target, nodes of a dropped group leave it. */
function restrict(graph: FlowGraph, keep: { nodes?: Set<string>; edges?: Set<string>; groups?: Set<string>; overlays?: Set<number> }): FlowGraph {
  const nodes = keep.nodes ? graph.nodes.filter((n) => keep.nodes!.has(n.id)) : graph.nodes;
  const nodeIds = new Set(nodes.map((n) => n.id));
  const groups = graph.groups?.filter((g) => !keep.groups || keep.groups.has(g.id));
  const groupIds = new Set((groups ?? []).map((g) => g.id));
  const droppedNodes = graph.nodes.length !== nodes.length;
  const edges = graph.edges.filter((e) => (!keep.edges || keep.edges.has(e.id)) && (!droppedNodes || (nodeIds.has(e.source) && nodeIds.has(e.target))));
  const edgeIds = new Set(edges.map((e) => e.id));
  const gone = (id: string) => (graph.nodes.some((n) => n.id === id) && !nodeIds.has(id)) || (graph.edges.some((e) => e.id === id) && !edgeIds.has(id)) || (graph.groups?.some((g) => g.id === id) && !groupIds.has(id));
  const overlays = graph.overlays?.filter((o, i) => (!keep.overlays || keep.overlays.has(i)) && !gone(o.target));
  const parentOf = new Map((graph.groups ?? []).map((g) => [g.id, g.parent]));
  const lift = (id: string | undefined): string | undefined => {
    const seen = new Set<string>();
    let cur = id;
    while (cur !== undefined && !groupIds.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return cur;
  };
  const out: FlowGraph = {
    ...graph,
    nodes: keep.groups ? nodes.map((n) => (n.group !== undefined && !groupIds.has(n.group) ? { ...n, group: lift(n.group) } : n)) : nodes,
    edges,
  };
  if (groups) out.groups = keep.groups ? groups.map((g) => (g.parent !== undefined && !groupIds.has(g.parent) ? { ...g, parent: lift(g.parent) } : g)) : groups;
  if (overlays) out.overlays = overlays;
  return out;
}

/** Number of elements a graph holds: nodes, edges, groups and overlays. */
export function elementCount(graph: FlowGraph): number {
  return graph.nodes.length + graph.edges.length + (graph.groups?.length ?? 0) + (graph.overlays?.length ?? 0);
}

/**
 * The smallest graph derived from `graph` by removing elements for which
 * `fails` still holds. Rounds of node, edge, group and overlay minimisation
 * run until a round removes nothing. `graph` must fail as given.
 */
export function shrinkGraph(graph: FlowGraph, fails: Fails<FlowGraph>): FlowGraph {
  const test = failing(fails);
  let current = graph;
  for (;;) {
    const before = elementCount(current);
    const nodes = shrinkList(current.nodes, (kept) => test(restrict(current, { nodes: new Set(kept.map((n) => n.id)) })));
    current = restrict(current, { nodes: new Set(nodes.map((n) => n.id)) });
    const edges = shrinkList(current.edges, (kept) => test(restrict(current, { edges: new Set(kept.map((e) => e.id)) })));
    current = restrict(current, { edges: new Set(edges.map((e) => e.id)) });
    if (current.groups?.length) {
      const groups = shrinkList(current.groups, (kept) => test(restrict(current, { groups: new Set(kept.map((g) => g.id)) })));
      current = restrict(current, { groups: new Set(groups.map((g) => g.id)) });
    }
    if (current.overlays?.length) {
      const indexed = current.overlays.map((_, i) => i);
      const overlays = shrinkList(indexed, (kept) => test(restrict(current, { overlays: new Set(kept) })));
      current = restrict(current, { overlays: new Set(overlays) });
    }
    if (elementCount(current) >= before) return current;
  }
}

export interface GeneratedCase<T> {
  /** Size the case was generated with. */
  size: number;
  /** The case of a size; the seed is bound into it. */
  generate: (size: number) => T;
  /** Shrinks the elements of a case once its size is minimal; `shrinkGraph` for graphs. */
  shrink?: (value: T, fails: Fails<T>) => T;
}

export interface ShrunkCase<T> {
  size: number;
  value: T;
  /** How many times the predicate ran. */
  tests: number;
}

/**
 * The smallest failing case: sizes are tried downward (half the size, then
 * one less) while the predicate still fails, then the elements of the
 * smallest failing size are shrunk. The case of `size` must fail as given.
 */
export function shrinkCase<T>(c: GeneratedCase<T>, fails: Fails<T>): ShrunkCase<T> {
  let tests = 0;
  const test = failing((value: T) => {
    tests++;
    return fails(value);
  });
  let size = c.size;
  let value = c.generate(size);
  for (;;) {
    const candidates = [Math.floor(size / 2), size - 1].filter((s, i, a) => s >= 0 && s < size && a.indexOf(s) === i);
    let smaller: { size: number; value: T } | undefined;
    for (const s of candidates) {
      const v = c.generate(s);
      if (test(v)) {
        smaller = { size: s, value: v };
        break;
      }
    }
    if (!smaller) break;
    ({ size, value } = smaller);
  }
  if (c.shrink) value = c.shrink(value, test);
  return { size, value, tests };
}
