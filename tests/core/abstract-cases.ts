import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../../fixtures/p2p_stages";
import { importBpmn, liteFromStages } from "../../src/bpmn/headless";
import type { AbstractOptions, FlowEdge, FlowGraph, FlowNode, Metrics } from "../../src/index";

/**
 * A cyclic graph from a seeded generator: a ring of activities in three stage
 * groups with chords, a self-loop on every activity, start and end events and
 * a gateway. Metrics vary on purpose: most edges count, some carry only cases,
 * some loops carry nothing, and one chord counts negative.
 */
export function seededCyclicGraph(seed: number, n: number): FlowGraph {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const nodes: FlowNode[] = [{ id: "start", kind: "event", label: "Start", tags: ["start"] }];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `a${i}`, kind: "activity", label: `A${i}`, group: `g${i % 3}`, metrics: { cases: Math.round(1 + rnd() * 500) } });
  }
  nodes.push({ id: "x", kind: "gateway", label: "X", tags: ["xor"] }, { id: "end", kind: "event", label: "End", tags: ["end"] });
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  const add = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    const r = rnd();
    const metrics: Metrics | undefined = r < 0.1 ? { cases: Math.round(1 + rnd() * 300) } : r < 0.15 && source === target ? undefined : { count: Math.round(1 + rnd() * 1000), cases: Math.round(1 + rnd() * 300) };
    edges.push({ id, kind: "follows", source, target, ...(metrics ? { metrics } : {}) });
  };
  add("start", "a0");
  for (let i = 0; i < n; i++) {
    add(`a${i}`, `a${(i + 1) % n}`);
    add(`a${i}`, `a${i}`);
  }
  for (let k = 0; k < n; k++) add(`a${Math.floor(rnd() * n)}`, `a${Math.floor(rnd() * n)}`);
  add(`a${n - 1}`, "x");
  add("x", "end");
  add("x", "a0");
  edges.push({ id: "negative", kind: "follows", source: "a1", target: `a${n - 2}`, metrics: { count: -40 } });
  edges.push({ id: "constraint", kind: "constraint", source: "a2", target: "a5" });
  return {
    nodes,
    edges,
    groups: [0, 1, 2].map((g) => ({ id: `g${g}`, kind: "stage" as const, label: `G${g}` })),
    overlays: [{ kind: "badge", target: "a3->a3", payload: { text: "Loop evidence" } }],
  };
}

/**
 * A seeded connected graph whose counts and cases take four values each, so that
 * strengths are quarters and equally cheap reconnecting paths are common.
 */
export function tiedGraph(seed: number, n: number): FlowGraph {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const quarter = () => 25 * (1 + Math.floor(rnd() * 4));
  const nodes: FlowNode[] = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: "activity", label: `A${i}`, metrics: { cases: quarter() } }));
  const edges: FlowEdge[] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    const id = `a${a}->a${b}`;
    if (a === b || seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind: "follows", source: `a${a}`, target: `a${b}`, metrics: { count: quarter() } });
  };
  for (let i = 1; i < n; i++) add(Math.floor(rnd() * i), i);
  for (let k = 0; k < n; k++) add(Math.floor(rnd() * n), Math.floor(rnd() * n));
  return { nodes, edges };
}

/** Every committed fixture graph and the seeded cyclic graph, by name. */
export async function abstractionGraphs(): Promise<Record<string, FlowGraph>> {
  const xml = readFileSync(fileURLToPath(new URL("../../fixtures/p2p_small.bpmn", import.meta.url)), "utf8");
  return {
    global: globalScene,
    vendor: vendorScene,
    stages: liteFromStages(withSceneMetrics(p2pStages, globalScene)),
    bpmn: (await importBpmn(xml)).graph,
    cyclic: seededCyclicGraph(7, 90),
  };
}

const SHARES: [number, number][] = [[0, 0], [0.005, 0], [0.02, 0.02], [0.1, 0.05], [0.3, 0.2], [0.8, 0.5]];

/** The option combinations each graph is abstracted with, by name. */
export function abstractionCases(): Record<string, AbstractOptions> {
  const out: Record<string, AbstractOptions> = {};
  for (const relativeTo of ["max", "total"] as const) {
    for (const [minEdgeShare, minNodeShare] of SHARES) {
      for (const keepConnected of [true, false]) {
        for (const collapse of [false, "all"] as const) {
          out[`${relativeTo} e${minEdgeShare} n${minNodeShare}${keepConnected ? "" : " loose"}${collapse ? " collapsed" : ""}`] = { relativeTo, minEdgeShare, minNodeShare, keepConnected, collapse };
        }
      }
    }
  }
  return out;
}

/** A digest of the whole abstraction result, with counts to read a mismatch by. */
export function abstractionDigest(result: FlowGraph): { nodes: number; edges: number; sha256: string } {
  return { nodes: result.nodes.length, edges: result.edges.length, sha256: createHash("sha256").update(JSON.stringify(result)).digest("hex") };
}
