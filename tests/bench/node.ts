/**
 * The benchmark's Node measurements. `run.mjs` bundles this file against the
 * built library (`dist/`) and starts it once per case in its own process with
 * `--expose-gc`; the case comes as JSON in the first argument, the samples go
 * to standard output as JSON. Each trial is timed alone, after a collection,
 * and the warm-up trials are run and thrown away first.
 */
import { type AbstractOptions, type Box, type FlowEdge, type FlowGraph, abstract, createPositions } from "../../src/index";
import { prepareScene } from "../../src/canvas/index";
import { families } from "../support/graphs";

export type NodeCase =
  | { kind: "prepare"; flows: number; selfLoops: boolean; trials: number; warmup: number }
  | { kind: "simplify"; activities: number; options: AbstractOptions; trials: number; warmup: number };

export interface Samples {
  /** One duration per trial, in milliseconds. */
  samples: number[];
  /** What the case measured, for the record (sizes, counts). */
  detail: Record<string, number | string | boolean>;
}

const collect = (): void => (globalThis as { gc?: () => void }).gc?.();

/** Times `work`: `warmup` runs thrown away, then `count` runs, each after a collection. */
function trials(count: number, warmup: number, work: () => void): number[] {
  const out: number[] = [];
  for (let i = 0; i < warmup + count; i++) {
    collect();
    const started = performance.now();
    work();
    const ms = performance.now() - started;
    if (i >= warmup) out.push(ms);
  }
  return out;
}

/**
 * At least `flows` follows edges among the fewest activities that hold them:
 * each activity is followed by every other one, as in the graph-size tests.
 * With `selfLoops`, the first edge of every activity is a repeat of itself.
 */
export function denseFlows(flows: number, selfLoops: boolean): FlowGraph {
  let n = 2;
  while (n * (n - 1) < flows) n++;
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: "activity" as const, label: `N${i}`, metrics: { cases: 1000 + (i % 97) } }));
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 1; k < n; k++) {
      const target = selfLoops && k === 1 ? i : (i + k) % n;
      edges.push({ id: `e${edges.length}`, kind: "follows", source: `n${i}`, target: `n${target}`, metrics: { count: edges.length + 1 } });
    }
  }
  return { nodes, edges };
}

/** Node boxes on a grid forty wide, without routes: the edges are drawn straight. */
function gridPositions(graph: FlowGraph) {
  const nodes: Record<string, Box> = {};
  graph.nodes.forEach((node, i) => {
    nodes[node.id] = { x: (i % 40) * 200, y: Math.floor(i / 40) * 100, width: 160, height: 60 };
  });
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}

export function measure(spec: NodeCase): Samples {
  if (spec.kind === "prepare") {
    const graph = denseFlows(spec.flows, spec.selfLoops);
    const positions = gridPositions(graph);
    let loops = 0;
    const samples = trials(spec.trials, spec.warmup, () => {
      loops = prepareScene(graph, positions).shapes.filter((s) => s.kind === "selfLoop").length;
    });
    return { samples, detail: { activities: graph.nodes.length, flows: graph.edges.length, selfLoops: loops } };
  }
  const graph = families.cyclic(spec.activities, 1);
  let shown: FlowGraph = graph;
  const samples = trials(spec.trials, spec.warmup, () => {
    shown = abstract(graph, spec.options);
  });
  return { samples, detail: { activities: graph.nodes.length, flows: graph.edges.length, shownActivities: shown.nodes.length, shownFlows: shown.edges.length } };
}

const given = process.argv[2];
if (given) process.stdout.write(JSON.stringify(measure(JSON.parse(given) as NodeCase)));
