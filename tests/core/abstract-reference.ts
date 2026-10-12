import type { AbstractOptions, FlowEdge, FlowGraph, FlowNode } from "../../src/index";

/**
 * A naive reading of `abstract` without collapse, written from the documentation
 * alone and sharing no code with `src/core/aggregate.ts`: strengths, thresholds,
 * the joining of components by every simple path, and the flow context. It is
 * slow on purpose (it enumerates every path at every join) and meant for graphs
 * of up to about ten nodes.
 *
 * Inputs: unique ids; metrics finite and not negative. Integer metrics keep a
 * relative-to-total strength exact, so the reference and the library divide the
 * same numbers.
 */

/** The objective of the joining step, quoted from docs/ARCHITECTURE.md §2.2. */
export const JOIN_OBJECTIVE = [
  "An edge costs a reconnecting path `1 + (1 − strength)`",
  "Constraint and flow edges have strength 1; self-loops never join anything.",
  "Node strength does not enter the cost. It only picks the component the joins start from: the one whose activities' strengths sum highest (events and gateways count 0; a tie goes to the component with the smallest node id).",
  "First the cheapest direct edges between kept nodes join components, a minimum spanning forest by cost, then edge id.",
  "Then every join takes the component nearest to all that is joined so far, through its cheapest path, and re-adds the removed nodes on it; each other component a re-added node touches joins at once through its cheapest direct edge (cost, then edge id).",
  "The objective holds per join, not for the total",
  "Ties are broken by id: of equally near nodes of other components the one with the smallest id is joined first, a node on equally cheap paths is entered by the edge with the smallest id, and a touched component joins by the smallest id among its cheapest direct edges.",
] as const;

const EDGE_METRICS = ["count", "cases", "share"];
const NODE_METRICS = ["cases", "events", "share"];
const structural = (n: FlowNode) => n.kind === "event" || n.kind === "gateway";
const valueOf = (el: { metrics?: Record<string, number> }, names: string[]) => {
  for (const name of names) {
    const v = el.metrics?.[name];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
};
const sorted = (ids: Iterable<string>) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Strength of every node and edge: its metric over the maximum or the total of its kind; 1 where it has none. */
export function referenceStrengths(graph: FlowGraph, relativeTo: "max" | "total" = "max") {
  const relative = <T extends { id: string; metrics?: Record<string, number> }>(items: T[], names: string[]) => {
    const values = items.map((it) => valueOf(it, names)).filter((v): v is number => v !== undefined);
    const denominator = relativeTo === "max" ? values.reduce((a, b) => Math.max(a, b), 0) : values.reduce((a, b) => a + b, 0);
    return (it: T) => {
      const v = valueOf(it, names);
      return v === undefined || denominator <= 0 ? 1 : Math.min(1, v / denominator);
    };
  };
  const follows = graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target);
  const edgeOf = relative(follows, EDGE_METRICS);
  const nodeOf = relative(graph.nodes.filter((n) => !structural(n)), NODE_METRICS);
  const edge = new Map(graph.edges.map((e) => [e.id, e.kind === "follows" ? edgeOf(e) : 1]));
  const node = new Map(graph.nodes.map((n) => [n.id, structural(n) ? 1 : nodeOf(n)]));
  return { edge, node };
}

export interface ReferenceState {
  graph: FlowGraph;
  edgeStrength: Map<string, number>;
  nodeStrength: Map<string, number>;
  /** Thresholded nodes and edges. */
  keptNodes: Set<string>;
  keptEdges: Set<string>;
}

export function referenceThresholds(graph: FlowGraph, options: AbstractOptions = {}): ReferenceState {
  const { minEdgeShare = 0, minNodeShare = 0, relativeTo = "max", keep = [] } = options;
  const { edge, node } = referenceStrengths(graph, relativeTo);
  const keptNodes = new Set(graph.nodes.filter((n) => structural(n) || keep.includes(n.id) || node.get(n.id)! >= minNodeShare).map((n) => n.id));
  const keptEdges = new Set(
    graph.edges.filter((e) => keptNodes.has(e.source) && keptNodes.has(e.target) && (e.kind !== "follows" || edge.get(e.id)! >= minEdgeShare)).map((e) => e.id),
  );
  return { graph, edgeStrength: edge, nodeStrength: node, keptNodes, keptEdges };
}

/** Components of the nodes over the edges, ignoring direction and self-loops: node id → smallest node id of its component. */
export function flood(nodes: Iterable<string>, edges: FlowEdge[]): Map<string, string> {
  const ids = new Set(nodes);
  const out = new Map<string, string>();
  for (const start of sorted(ids)) {
    if (out.has(start)) continue;
    const todo = [start];
    out.set(start, start);
    while (todo.length) {
      const at = todo.pop()!;
      for (const e of edges) {
        if (e.source === e.target || !ids.has(e.source) || !ids.has(e.target)) continue;
        const other = e.source === at ? e.target : e.target === at ? e.source : undefined;
        if (other !== undefined && !out.has(other)) {
          out.set(other, start);
          todo.push(other);
        }
      }
    }
  }
  return out;
}

export interface JoinOutcome {
  /** Removed nodes re-added on joining paths. */
  nodes: Set<string>;
  /** Edges re-added by the direct forest, the paths and the touched components. */
  edges: Set<string>;
  /** The cost of every re-added edge, summed in id order. */
  cost: number;
  /** The cost of each join through a path, in the order of the joins. */
  joins: number[];
  /** The kept nodes joined in the end: those of the input component of the heaviest kept component. */
  reached: Set<string>;
}

interface Path {
  edges: FlowEdge[];
  /** Nodes from the joined end to the far end, both included. */
  nodes: string[];
  cost: number;
}

/**
 * Step 1, as quoted in `JOIN_OBJECTIVE`. `choose` decides among the paths to the
 * nearest nodes that the documented rule leaves equal; the default is the rule's
 * own tie-break by id.
 */
export function referenceJoin(state: ReferenceState, choose?: (paths: Path[]) => Path[]): JoinOutcome[] {
  const { graph, edgeStrength, nodeStrength, keptNodes, keptEdges } = state;
  const cost = (e: FlowEdge) => 1 + (1 - edgeStrength.get(e.id)!);
  const byNode = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => e.source !== e.target);
  const added = new Set<string>();
  const kept = graph.edges.filter((e) => keptEdges.has(e.id));

  // The direct forest: again and again the cheapest edge (cost, then id) between two kept components.
  for (;;) {
    const comp = flood(keptNodes, [...kept, ...edges.filter((e) => added.has(e.id))]);
    const cheapest = edges
      .filter((e) => keptNodes.has(e.source) && keptNodes.has(e.target) && !keptEdges.has(e.id) && !added.has(e.id) && comp.get(e.source) !== comp.get(e.target))
      .sort((a, b) => cost(a) - cost(b) || (a.id < b.id ? -1 : 1))[0];
    if (!cheapest) break;
    added.add(cheapest.id);
  }
  const comp = flood(keptNodes, [...kept, ...edges.filter((e) => added.has(e.id))]);
  const weight = new Map<string, number>();
  for (const id of keptNodes) weight.set(comp.get(id)!, (weight.get(comp.get(id)!) ?? 0) + (structural(byNode.get(id)!) ? 0 : nodeStrength.get(id)!));
  let main: string | undefined;
  for (const root of sorted(weight.keys())) if (main === undefined || weight.get(root)! > weight.get(main)!) main = root;

  const outcomes: JoinOutcome[] = [];
  const grow = (joined: Set<string>, readded: Set<string>, edgeIds: Set<string>, joins: number[]) => {
    // Every simple path from a joined node through removed nodes not yet re-added; the
    // ones that end at a kept node not yet joined are the ways to join next.
    const paths: Path[] = [];
    const dist = new Map<string, number>();
    for (const id of joined) dist.set(id, 0);
    const walk = (path: Path) => {
      const at = path.nodes[path.nodes.length - 1];
      for (const e of edges) {
        const other = e.source === at ? e.target : e.target === at ? e.source : undefined;
        if (other === undefined || joined.has(other) || readded.has(other) || path.nodes.includes(other)) continue;
        const next = { edges: [...path.edges, e], nodes: [...path.nodes, other], cost: path.cost + cost(e) };
        if (!dist.has(other) || next.cost < dist.get(other)!) dist.set(other, next.cost);
        if (keptNodes.has(other)) paths.push(next);
        else walk(next);
      }
    };
    for (const id of sorted(joined)) walk({ edges: [], nodes: [id], cost: 0 });
    if (paths.length === 0) {
      const sum = sorted(edgeIds).reduce((s, id) => s + cost(graph.edges.find((e) => e.id === id)!), 0);
      outcomes.push({ nodes: readded, edges: edgeIds, cost: sum, joins, reached: new Set([...joined].filter((id) => keptNodes.has(id))) });
      return;
    }
    const nearest = paths.reduce((least, p) => Math.min(least, p.cost), Infinity);
    const tied = paths.filter((p) => p.cost === nearest);
    for (const path of choose ? choose(tied) : [byIdRule(tied)]) {
      const nextJoined = new Set(joined);
      const nextReadded = new Set(readded);
      const nextEdges = new Set(edgeIds);
      for (const e of path.edges) nextEdges.add(e.id);
      const far = path.nodes[path.nodes.length - 1];
      for (const id of keptNodes) if (comp.get(id) === comp.get(far)) nextJoined.add(id);
      const inner = path.nodes.slice(1, -1);
      for (const id of inner) {
        nextReadded.add(id);
        nextJoined.add(id);
      }
      // Components a re-added node touches join through their cheapest direct edge (cost, then id).
      const touching = new Map<string, FlowEdge>();
      for (const e of edges) {
        for (const [mine, other] of [[e.source, e.target], [e.target, e.source]]) {
          if (!inner.includes(mine) || !keptNodes.has(other) || nextJoined.has(other)) continue;
          const best = touching.get(comp.get(other)!);
          if (!best || cost(e) < cost(best) || (cost(e) === cost(best) && e.id < best.id)) touching.set(comp.get(other)!, e);
        }
      }
      for (const [root, e] of touching) {
        nextEdges.add(e.id);
        for (const id of keptNodes) if (comp.get(id) === root) nextJoined.add(id);
      }
      grow(nextJoined, nextReadded, nextEdges, [...joins, path.cost]);
    }

    /**
     * The documented tie-break: the far node with the smallest id, entered by the
     * edge with the smallest id among its cheapest ways in, and so on back to what
     * is joined.
     */
    function byIdRule(candidates: Path[]): Path {
      const far = sorted(candidates.map((p) => p.nodes[p.nodes.length - 1]))[0];
      const chosen: string[] = [];
      for (let at = far; !joined.has(at); ) {
        const ways = edges
          .map((e) => ({ e, from: e.source === at ? e.target : e.target === at ? e.source : undefined }))
          .filter(({ e, from }) => from !== undefined && from !== at && dist.has(from) && (joined.has(from) || !keptNodes.has(from)) && dist.get(from)! + cost(e) === dist.get(at))
          .sort((a, b) => (a.e.id < b.e.id ? -1 : 1));
        chosen.unshift(ways[0].e.id);
        at = ways[0].from!;
      }
      const path = candidates.find((p) => p.edges.length === chosen.length && p.edges.every((e, i) => e.id === chosen[i]));
      if (!path) throw new Error(`the path the rule names to ${far} is not one of the cheapest`);
      return path;
    }
  };
  if (main === undefined) return [{ nodes: new Set(), edges: added, cost: 0, joins: [], reached: new Set() }];
  grow(new Set([...keptNodes].filter((id) => comp.get(id) === main)), new Set(), added, []);
  return outcomes;
}

/**
 * Step 2, "one edge per activity that lost all incoming or all outgoing paths"
 * (docs/API.md), in the order the module documents: the original edge that closes
 * the most open needs at once, then the strongest, then the smallest id. Needs are
 * judged as they stand after each edge, and only kept activities have needs.
 */
export function referenceFlow(state: ReferenceState, nodes: Set<string>, edges: Set<string>): Set<string> {
  const { graph, edgeStrength, keptNodes } = state;
  const byNode = new Map(graph.nodes.map((n) => [n.id, n]));
  const open = (id: string) => keptNodes.has(id) && !structural(byNode.get(id)!);
  const present = new Set(edges);
  const added = new Set<string>();
  for (;;) {
    const inner = graph.edges.filter((e) => present.has(e.id) && e.source !== e.target);
    const needsOut = (id: string) => open(id) && !inner.some((e) => e.source === id);
    const needsIn = (id: string) => open(id) && !inner.some((e) => e.target === id);
    const score = (e: FlowEdge) => (needsOut(e.source) ? 1 : 0) + (needsIn(e.target) ? 1 : 0);
    const best = graph.edges
      .filter((e) => e.source !== e.target && nodes.has(e.source) && nodes.has(e.target) && !present.has(e.id) && score(e) > 0)
      .sort((a, b) => score(b) - score(a) || edgeStrength.get(b.id)! - edgeStrength.get(a.id)! || (a.id < b.id ? -1 : 1))[0];
    if (!best) return added;
    present.add(best.id);
    added.add(best.id);
  }
}

export interface ReferenceResult {
  nodes: Set<string>;
  edges: Set<string>;
  /** Re-added by joining (nodes and edges) and by the flow context (edges). */
  readded: Set<string>;
  /** The joining step alone. */
  join: JoinOutcome;
}

/** `abstract(graph, options)` without collapse, as the documentation describes it. */
export function referenceAbstract(graph: FlowGraph, options: AbstractOptions = {}): ReferenceResult {
  const state = referenceThresholds(graph, options);
  if (options.keepConnected === false) {
    return { nodes: state.keptNodes, edges: state.keptEdges, readded: new Set(), join: { nodes: new Set(), edges: new Set(), cost: 0, joins: [], reached: new Set() } };
  }
  const [join] = referenceJoin(state);
  const nodes = new Set([...state.keptNodes, ...join.nodes]);
  const edges = new Set([...state.keptEdges, ...join.edges]);
  const flow = referenceFlow(state, nodes, edges);
  const all = new Set([...edges, ...flow]);
  // A re-added activity brings back its constraint and flow edges to shown elements.
  const back = state.graph.edges.filter((e) => e.kind !== "follows" && !all.has(e.id) && nodes.has(e.source) && nodes.has(e.target)).map((e) => e.id);
  return { nodes, edges: new Set([...all, ...back]), readded: new Set([...join.nodes, ...join.edges, ...flow, ...back]), join };
}

/**
 * The least cost of any set of re-added edges and nodes that joins the kept nodes
 * the documented joining reaches (those in the input component of the heaviest kept
 * component): over every set of removed nodes, a minimum spanning tree in which kept
 * edges cost nothing. Exponential in the removed nodes of that component.
 */
export function globalMinimum(state: ReferenceState, reached: Set<string>): number {
  const { graph, edgeStrength, keptEdges, keptNodes } = state;
  const cost = (e: FlowEdge) => (keptEdges.has(e.id) ? 0 : 1 + (1 - edgeStrength.get(e.id)!));
  const edges = graph.edges.filter((e) => e.source !== e.target);
  const inputComponent = flood(graph.nodes.map((n) => n.id), edges);
  const someReached = [...reached][0];
  if (someReached === undefined) return 0;
  const removed = graph.nodes.map((n) => n.id).filter((id) => !keptNodes.has(id) && inputComponent.get(id) === inputComponent.get(someReached));
  let best = Infinity;
  for (let mask = 0; mask < 1 << removed.length; mask++) {
    const nodes = new Set([...reached, ...removed.filter((_, i) => mask & (1 << i))]);
    // Kruskal over the edges among these nodes, cheapest first.
    const within = edges.filter((e) => nodes.has(e.source) && nodes.has(e.target)).sort((a, b) => cost(a) - cost(b));
    const part = new Map([...nodes].map((id) => [id, id]));
    const root = (id: string): string => (part.get(id) === id ? id : root(part.get(id)!));
    let total = 0;
    let joined = 1;
    for (const e of within) {
      const [a, b] = [root(e.source), root(e.target)];
      if (a === b) continue;
      part.set(a, b);
      total += cost(e);
      joined++;
    }
    if (joined === nodes.size) best = Math.min(best, total);
  }
  return best;
}
