import type { FlowEdge, FlowGraph, FlowNode } from "../../src/index";

/** A seeded pseudo-random number generator (LCG) in [0, 1). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * A seeded graph for the detail shares: one or two starts and ends, activities
 * in three stage groups whose cases and events take few values (ties), every
 * activity on a way from a start to an end, chords that close cycles, self-loops,
 * sometimes a gateway and a path nobody measured, and an activity more frequent
 * than all others that is entered only from the rarest one.
 */
export function detailGraph(seed: number): FlowGraph {
  const rnd = seeded(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const n = 4 + Math.floor(rnd() * 18);
  const starts = Array.from({ length: 1 + Math.floor(rnd() * 2) }, (_, i) => `s${i}`);
  const ends = Array.from({ length: 1 + Math.floor(rnd() * 2) }, (_, i) => `e${i}`);
  const activities = Array.from({ length: n }, (_, i) => `a${i}`);
  const nodes: FlowNode[] = [
    ...starts.map((id) => ({ id, kind: "event" as const, label: id, tags: ["start"] })),
    ...activities.map((id, i) => {
      const cases = pick([10, 20, 40, 80, 160]);
      return { id, kind: "activity" as const, label: id, group: `g${i % 3}`, metrics: { cases, events: cases + pick([0, 5]) } };
    }),
    { id: "hub", kind: "activity", label: "Hub", group: "g0", metrics: { cases: 1000, events: 1200 } },
    { id: "rare", kind: "activity", label: "Rare", group: "g1", metrics: { cases: 1, events: 1 } },
    ...ends.map((id) => ({ id, kind: "event" as const, label: id, tags: ["end"] })),
  ];
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string, measured = true) => {
    const id = `${source}->${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind: "follows", source, target, ...(measured && { metrics: { count: pick([1, 2, 5, 10, 50, 100]) } }) });
  };
  activities.forEach((id, i) => add(i === 0 || rnd() < 0.3 ? pick(starts) : activities[Math.floor(rnd() * i)], id));
  for (let i = n - 1; i >= 0; i--) add(activities[i], i === n - 1 || rnd() < 0.3 ? pick(ends) : activities[i + 1 + Math.floor(rnd() * (n - 1 - i))]);
  for (let k = 0; k < n; k++) add(pick(activities), pick(activities));
  for (const id of activities) if (rnd() < 0.3) add(id, id);
  // The hub is entered only from the rare activity.
  add(pick(starts), "rare");
  add("rare", "hub");
  add("hub", pick(activities));
  add("hub", pick(ends));
  if (rnd() < 0.5) {
    nodes.push({ id: "x", kind: "gateway", label: "X", tags: ["xor"] });
    add(pick(activities), "x");
    add("x", pick(activities));
    add("x", pick(ends));
  }
  if (rnd() < 0.3) add(pick(activities), pick(activities), false);
  return { nodes, edges, groups: [0, 1, 2].map((g) => ({ id: `g${g}`, kind: "stage" as const, label: `G${g}` })) };
}

/** The same graph with its nodes and edges in a seeded other order. */
export function shuffled(graph: FlowGraph, seed: number): FlowGraph {
  const rnd = seeded(seed);
  const mix = <T>(list: T[]) => list.map((x) => ({ x, k: rnd() })).sort((a, b) => a.k - b.k).map(({ x }) => x);
  return { ...graph, nodes: mix(graph.nodes), edges: mix(graph.edges) };
}

const isPath = (e: FlowEdge) => e.kind !== "constraint";

/**
 * The activities and stages of a graph that do not lie on a directed way from a
 * start event to an end event over its paths: a search forward from the starts
 * and one backward from the ends.
 */
export function offWays(graph: FlowGraph): string[] {
  const forward = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  const backward = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges.filter(isPath)) {
    forward.get(e.source)!.push(e.target);
    backward.get(e.target)!.push(e.source);
  }
  const search = (from: string[], next: Map<string, string[]>) => {
    const reached = new Set(from);
    const queue = [...from];
    while (queue.length) {
      for (const id of next.get(queue.shift()!)!) {
        if (reached.has(id)) continue;
        reached.add(id);
        queue.push(id);
      }
    }
    return reached;
  };
  const events = (tag: string) => graph.nodes.filter((n) => n.kind === "event" && n.tags?.includes(tag)).map((n) => n.id);
  const fromStart = search(events("start"), forward);
  const toEnd = search(events("end"), backward);
  return graph.nodes.filter((n) => (n.kind === "activity" || n.kind === "stage") && !(fromStart.has(n.id) && toEnd.has(n.id))).map((n) => n.id);
}

/** Whether the graph has a way from `source` to `target` through at least one node, all of them outside `shown`. */
export function wayThroughHidden(graph: FlowGraph, source: string, target: string, shown: Set<string>): boolean {
  const reached = new Set([source]);
  const queue = [source];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of graph.edges) {
      if (!isPath(e) || e.source !== at || e.source === e.target) continue;
      if (e.target === target && at !== source) return true;
      if (shown.has(e.target) || reached.has(e.target)) continue;
      reached.add(e.target);
      queue.push(e.target);
    }
  }
  return false;
}
