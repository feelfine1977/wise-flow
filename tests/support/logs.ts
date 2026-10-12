/**
 * Seeded event logs and the directly-follows graphs a process-mining host
 * computes from them. A random process tree (sequence, exclusive choice,
 * parallel block, loop) is played into traces, and the graph counts which
 * activity directly follows which, as `GET /runs/{id}/flow` does: every
 * activity lies on a path from a trace's first event to its last, branches of
 * a parallel block follow each other in both orders, a repeated activity
 * becomes a self-loop. The trees and traces are returned with the graph so a
 * failure can show where a path came from.
 */
import type { FlowEdge, FlowGraph, FlowGroup, FlowNode } from "../../src/index";
import { type Random, createRandom } from "./random";

export type ProcessTree =
  | { task: string }
  | { seq: ProcessTree[] }
  /** One of the children; with `skip` also none of them. */
  | { xor: ProcessTree[]; skip?: boolean }
  /** All children, their traces interleaved at random. */
  | { and: ProcessTree[] }
  /** The body, then any number of times the redo part (if any) and the body again. */
  | { loop: ProcessTree; redo?: ProcessTree };

export interface LogOptions {
  /** Parallel blocks in the tree. Default true. */
  parallel?: boolean;
  /** Loops and self-loops in the tree. Default true. */
  loops?: boolean;
  /** Number of traces; drawn between 10 and 40 by default. */
  traces?: number;
  /** A start and an end event in the graph, joined to the first and last activities, as some hosts send. Default false. */
  events?: boolean;
  /** A lane group of 2–4 for every activity. Default false. */
  lanes?: boolean;
}

export interface Log {
  tree: ProcessTree;
  traces: string[][];
  graph: FlowGraph;
}

/** A random process tree over `size` activities `a0 … a(size-1)`, each used once. */
export function processTree(size: number, rng: Random, options: LogOptions = {}): ProcessTree {
  let next = 0;
  const parallel = options.parallel ?? true;
  const loops = options.loops ?? true;
  const build = (n: number): ProcessTree => {
    if (n === 1) {
      const task = { task: `a${next++}` };
      return loops && rng.chance(0.12) ? { loop: task } : task;
    }
    const op = rng.weighted([["seq", 4], ["xor", 3], ["and", parallel ? 3 : 0], ["loop", loops ? 1 : 0]] as const);
    // Concurrent single activities between one activity before and one after them:
    // the block a builder can show as a parallel pair.
    if (op === "and" && n <= 6 && rng.chance(0.8)) {
      const singles = (k: number) => Array.from({ length: k }, () => build(1));
      return n >= 4 ? { seq: [build(1), { and: singles(n - 2) }, build(1)] } : { and: singles(n) };
    }
    if (op === "loop") {
      const redo = rng.int(0, n - 1);
      const body = build(n - redo);
      return redo ? { loop: body, redo: build(redo) } : { loop: body };
    }
    const parts: number[] = [];
    let left = n;
    const k = rng.int(2, Math.min(4, n));
    for (let i = k; i > 1; i--) {
      const part = rng.int(1, left - i + 1);
      parts.push(part);
      left -= part;
    }
    parts.push(left);
    const children = parts.map(build);
    if (op === "seq") return { seq: children };
    if (op === "and") return { and: children };
    return { xor: children, skip: rng.chance(0.2) };
  };
  return build(Math.max(1, size));
}

/** One trace of the tree: the activity ids in the order they happened. */
export function playTree(tree: ProcessTree, rng: Random): string[] {
  if ("task" in tree) return [tree.task];
  if ("seq" in tree) return tree.seq.flatMap((t) => playTree(t, rng));
  if ("xor" in tree) return tree.skip && rng.chance(0.2) ? [] : playTree(rng.pick(tree.xor), rng);
  if ("and" in tree) {
    const queues = tree.and.map((t) => playTree(t, rng)).filter((q) => q.length);
    const out: string[] = [];
    while (queues.length) {
      const i = rng.int(0, queues.length - 1);
      out.push(queues[i].shift()!);
      if (!queues[i].length) queues.splice(i, 1);
    }
    return out;
  }
  const out = playTree(tree.loop, rng);
  for (let round = 0; round < 3 && rng.chance(0.4); round++) {
    if (tree.redo) out.push(...playTree(tree.redo, rng));
    out.push(...playTree(tree.loop, rng));
  }
  return out;
}

/** The directly-follows graph of traces: node and edge metrics as a host computes them. */
export function directlyFollows(traces: string[][], options: Pick<LogOptions, "events"> = {}): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge & { caseSet: Set<number> }>();
  const caseSets = new Map<string, Set<number>>();
  const bump = (m: Record<string, number>, key: string) => (m[key] = (m[key] ?? 0) + 1);
  const pass = (source: string, target: string, trace: number) => {
    const id = `${source}->${target}`;
    let e = edges.get(id);
    if (!e) edges.set(id, (e = { id, kind: "follows", source, target, metrics: { count: 0, cases: 0 }, caseSet: new Set() }));
    bump(e.metrics!, "count");
    e.caseSet.add(trace);
  };
  traces.forEach((trace, t) => {
    if (!trace.length) return;
    trace.forEach((a, i) => {
      let n = nodes.get(a);
      if (!n) nodes.set(a, (n = { id: a, kind: "activity", label: `Activity ${a.slice(1)}`, metrics: { events: 0 } }));
      bump(n.metrics!, "events");
      if (!caseSets.has(a)) caseSets.set(a, new Set());
      caseSets.get(a)!.add(t);
      if (i === 0) bump(n.metrics!, "starts");
      if (i === trace.length - 1) bump(n.metrics!, "ends");
      if (i > 0) pass(trace[i - 1], a, t);
    });
    if (options.events) {
      pass("start", trace[0], t);
      pass(trace[trace.length - 1], "end", t);
    }
  });
  const graphNodes = [...nodes.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const n of graphNodes) n.metrics!.cases = caseSets.get(n.id)!.size;
  if (options.events && graphNodes.length) {
    graphNodes.unshift({ id: "start", kind: "event", label: "Start", tags: ["start"] });
    graphNodes.push({ id: "end", kind: "event", label: "End", tags: ["end"] });
  }
  return {
    nodes: graphNodes,
    edges: [...edges.values()].map(({ caseSet, ...e }) => ({ ...e, metrics: { ...e.metrics, cases: caseSet.size } })),
  };
}

/** A log of a random process tree over `size` activities and its directly-follows graph, the same for the same seed. */
export function eventLog(size: number, seed: number, options: LogOptions = {}): Log {
  const rng = createRandom(seed);
  const tree = processTree(size, rng.fork(), options);
  const play = rng.fork();
  const traces = Array.from({ length: options.traces ?? rng.int(10, 40) }, () => playTree(tree, play));
  const graph = directlyFollows(traces, options);
  if (options.lanes) {
    const count = rng.int(2, 4);
    const groups: FlowGroup[] = Array.from({ length: count }, (_, i) => ({ id: `lane${i}`, kind: "lane", label: `Lane ${i}` }));
    for (const n of graph.nodes) if (n.kind === "activity") n.group = rng.pick(groups).id;
    graph.groups = groups;
  }
  return { tree, traces, graph };
}
