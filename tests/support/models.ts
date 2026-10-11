/**
 * Seeded BPMN-lite models, as the bridge's builders make them from random
 * input: `liteFromGraph` over the directly-follows graph of a random log or a
 * graph family (with and without an abstraction, every self-loop option, lanes
 * from the groups), and `liteFromStages` over a random stage model (optional
 * activities and stages, choices, parallel stages, loops, roles). On request
 * the input carries ids and labels that are hard for XML (markup, quotes,
 * spaces, separators, umlauts, ids of the exporter's own elements) and the
 * model marks one outgoing flow of some exclusive splits as the default flow,
 * as a host does. `describe` says what was drawn, for the failure message.
 */
import { type LiteFromGraphOptions, type Stage, type StageModel, liteFromGraph, liteFromStages } from "../../src/bpmn/headless";
import { type AbstractOptions, type FlowGraph, hasTag } from "../../src/index";
import { families } from "./graphs";
import { eventLog } from "./logs";
import { type Random, createRandom } from "./random";

export interface GeneratedModel {
  /** The input the builder got: a directly-follows graph, or undefined for a stage model. */
  input?: FlowGraph;
  stages?: StageModel;
  model: FlowGraph;
  /** What was drawn, e.g. `log 12 and flow lanes`. */
  describe: string;
}

export interface ModelOptions {
  /** Parallel gateways where the input shows them: `andGateways` for graphs, parallel stages for stage models. */
  parallel?: boolean;
  /** Ids and labels that XML must escape or that collide with the exporter's ids. Default false. */
  awkward?: boolean;
  /** Mark one outgoing flow of about half the exclusive splits as the default flow. Default false. */
  defaults?: boolean;
  /** Draw only from this source. */
  source?: "log" | "family" | "stages";
  /** Largest number of activities drawn (stages: about a third as many stages). Default 20. */
  maxSize?: number;
}

const FAMILY_NAMES = ["chain", "layered", "tree", "cyclic", "hub", "components", "stages", "lanes", "nested"] as const;

/** Labels with every character XML escapes, quotes, white space that attributes normalise, and an empty one. */
export const AWKWARD_LABELS = [
  "<b>Check</b> invoice",
  "Pay & close",
  'Order "urgent"',
  "Ship 'now'",
  "<script>alert(1)</script>",
  "a < b > c",
  "&amp;lt;tag&gt;",
  "]]> end of CDATA",
  "Prüfung der Rechnung",
  "  padded  ",
  "Line one\nline two",
  "Tab\tseparated",
  "",
];

/** Ids that are not XML names, or that name elements the exporter writes itself. */
export const AWKWARD_IDS = ["Check & approve <1>", "1st step", "a b", "x:y", "a->b", "ünïcode", "Process_wise", "Definitions_wise", "Collaboration_wise", "Lane_x", "Flow_1", "n1_di", "a-b.c"];

/** The model of a seed: the same for the same seed and options. */
export function generatedModel(seed: number, options: ModelOptions = {}): GeneratedModel {
  const rng = createRandom(seed);
  const source = options.source ?? rng.weighted([["log", 5], ["family", 3], ["stages", 2]] as const);
  if (source === "stages") {
    const stages = stageModel(rng.int(1, Math.ceil((options.maxSize ?? 20) / 3.5)), rng, options);
    const lanes = rng.pick(["stage", "role", "none"] as const);
    const model = decorate(liteFromStages(stages, { lanes }), rng, options);
    return { stages, model, describe: `stages ${stages.stages.length} lanes ${lanes}` };
  }
  const size = rng.int(source === "log" ? 1 : 0, options.maxSize ?? 20);
  let input: FlowGraph;
  let name: string;
  if (source === "log") {
    input = eventLog(size, rng.int(1, 1_000_000), { parallel: options.parallel ?? true, events: rng.chance(0.2), lanes: rng.chance(0.3) }).graph;
    name = `log ${size}`;
  } else {
    const family = rng.pick(FAMILY_NAMES);
    input = families[family](size, rng.int(1, 1_000_000));
    name = `${family} ${size}`;
  }
  if (options.awkward) input = awkwardGraph(input, rng);
  const lite: LiteFromGraphOptions = { andGateways: options.parallel ?? rng.chance(0.5), selfLoops: rng.weighted([["marker", 3], ["flow", 2], ["drop", 1]] as const), lanes: rng.chance(0.8) ? "groups" : "none" };
  if (rng.chance(0.3)) lite.abstraction = abstraction(rng);
  const model = decorate(liteFromGraph(input, lite), rng, options);
  const parts = [name, lite.andGateways ? "and" : "xor", lite.selfLoops, lite.lanes, lite.abstraction ? `abstraction ${lite.abstraction.minNodeShare}/${lite.abstraction.minEdgeShare}` : ""];
  return { input, model, describe: parts.filter(Boolean).join(" ") };
}

function abstraction(rng: Random): AbstractOptions {
  return { minNodeShare: rng.int(0, 30) / 100, minEdgeShare: rng.int(0, 40) / 100, keepConnected: true };
}

/** A random stage model of `count` stages with 1–4 activities each, ids `s<i>` and `t<i>_<j>`. */
export function stageModel(count: number, rng: Random, options: ModelOptions = {}): StageModel {
  const roles = ["clerk", "buyer", "approver"];
  const stages: Stage[] = Array.from({ length: count }, (_, i) => {
    const size = rng.int(1, 4);
    const flow = rng.weighted([["sequence", 3], ["choice", 1], ["parallel", options.parallel === false ? 0 : 1]] as const);
    return {
      id: `s${i}`,
      label: options.awkward ? rng.pick(AWKWARD_LABELS) : `Stage ${i}`,
      role: rng.pick(roles),
      flow,
      optional: rng.chance(0.2),
      activities: Array.from({ length: size }, (_, j) => ({
        id: options.awkward && rng.chance(0.3) ? `${rng.pick(AWKWARD_IDS)} ${i}.${j}` : `t${i}_${j}`,
        label: options.awkward ? rng.pick(AWKWARD_LABELS) : `Task ${i}.${j}`,
        role: rng.chance(0.3) ? rng.pick(roles) : undefined,
        optional: flow === "sequence" && rng.chance(0.25),
        loop: rng.chance(0.15),
        tags: rng.chance(0.2) ? [rng.pick(["userTask", "serviceTask", "manualTask"])] : undefined,
        metrics: rng.chance(0.5) ? { cases: rng.int(1, 500) } : undefined,
      })),
    };
  });
  return { id: "model", label: "Model", stages };
}

/** The graph with every node and group renamed to an awkward id (kept unique) and relabelled. */
function awkwardGraph(g: FlowGraph, rng: Random): FlowGraph {
  const renamed = new Map<string, string>();
  const rename = (id: string) => {
    if (!renamed.has(id)) renamed.set(id, rng.chance(0.5) ? `${rng.pick(AWKWARD_IDS)} ${renamed.size}` : id);
    return renamed.get(id)!;
  };
  const label = (fallback: string) => (rng.chance(0.6) ? rng.pick(AWKWARD_LABELS) : fallback);
  return {
    ...g,
    nodes: g.nodes.map((n) => ({ ...n, id: rename(n.id), label: label(n.label), group: n.group === undefined ? undefined : rename(n.group) })),
    edges: g.edges.map((e) => ({ ...e, id: `${rename(e.source)}->${rename(e.target)}`, source: rename(e.source), target: rename(e.target) })),
    groups: g.groups?.map((x) => ({ ...x, id: rename(x.id), label: label(x.label ?? x.id), parent: x.parent === undefined ? undefined : rename(x.parent) })),
    overlays: undefined,
  };
}

/** Default flows on some exclusive splits. */
function decorate(model: FlowGraph, rng: Random, options: ModelOptions): FlowGraph {
  if (!options.defaults) return model;
  const splits = model.nodes.filter((n) => n.kind === "gateway" && hasTag(n, "xor") && hasTag(n, "split") && rng.chance(0.5));
  const chosen = new Set(splits.map((s) => rng.pick(model.edges.filter((e) => e.source === s.id)).id));
  return { ...model, edges: model.edges.map((e) => (chosen.has(e.id) ? { ...e, tags: [...(e.tags ?? []), "default"] } : e)) };
}
