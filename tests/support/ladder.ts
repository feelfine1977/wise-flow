/**
 * The ladder of abstraction settings and the scenes a map is read on across
 * it. A rung is one setting of the map's controls: activities and paths at
 * 0 %, the stories' default (1 % and 3 %), 5 %, 10 %, 25 % and 50 %, each
 * with "keep connected" on and off, with stages shown and collapsed. The
 * scenes are the two committed ones (the whole BPIC log and one vendor) and
 * generated ones: one seeded log whose counts are multiplied by a whole
 * factor, so that the events span the magnitudes 10², 10⁴, 10⁶ and 10⁷ while
 * every relative strength, and so the map's shape at every rung, stays the
 * same. Each scene comes with constraint overlays (badges, arcs, a self-loop,
 * chips, hatching) from the library's presets, as a host sends them.
 */
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type AbstractOptions, type ConstraintDescription, type ConstraintStats, type FlowGraph, type FlowGroup, type Overlay, abstract, overlaysFor } from "../../src/index";
import { directlyFollows, eventLog } from "./logs";
import { type Random, createRandom } from "./random";

export interface Rung {
  /** For example `5 % · connected · stages shown`. */
  name: string;
  /** Index of the threshold step, 0 (0 %) … 5 (50 %). */
  step: number;
  minNodeShare: number;
  minEdgeShare: number;
  keepConnected: boolean;
  collapse: false | "all";
}

/** The threshold steps: activities and paths together, the default with its own two values. */
export const STEPS: readonly { label: string; minNodeShare: number; minEdgeShare: number }[] = [
  { label: "0 %", minNodeShare: 0, minEdgeShare: 0 },
  { label: "default", minNodeShare: 0.01, minEdgeShare: 0.03 },
  { label: "5 %", minNodeShare: 0.05, minEdgeShare: 0.05 },
  { label: "10 %", minNodeShare: 0.1, minEdgeShare: 0.1 },
  { label: "25 %", minNodeShare: 0.25, minEdgeShare: 0.25 },
  { label: "50 %", minNodeShare: 0.5, minEdgeShare: 0.5 },
];

export function rungOf(step: number, keepConnected: boolean, collapse: false | "all"): Rung {
  const s = STEPS[step];
  const name = `${s.label} · ${keepConnected ? "connected" : "not connected"} · stages ${collapse ? "collapsed" : "shown"}`;
  return { name, step, minNodeShare: s.minNodeShare, minEdgeShare: s.minEdgeShare, keepConnected, collapse };
}

/** All 24 rungs: stages shown, then collapsed; connected, then not; steps upwards. */
export const RUNGS: readonly Rung[] = ([false, "all"] as const).flatMap((collapse) => [true, false].flatMap((keep) => STEPS.map((_, step) => rungOf(step, keep, collapse))));

/** The options a map's controls hold at a rung. */
export const optionsOf = (r: Pick<Rung, "minNodeShare" | "minEdgeShare" | "keepConnected" | "collapse">): AbstractOptions => ({
  minNodeShare: r.minNodeShare,
  minEdgeShare: r.minEdgeShare,
  keepConnected: r.keepConnected,
  collapse: r.collapse,
});

/** The graph the thresholds are applied to: stages collapsed (without reconnection) where the setting collapses them. */
export function collapsedGraph(graph: FlowGraph, options: Pick<AbstractOptions, "collapse">): FlowGraph {
  return options.collapse ? abstract(graph, { collapse: options.collapse, keepConnected: false }) : graph;
}

/**
 * The graph a map shows at a setting, as the map computes it: stages
 * collapsed first (without reconnection), then the thresholds on the result.
 */
export function shownGraph(graph: FlowGraph, options: AbstractOptions): FlowGraph {
  return abstract(collapsedGraph(graph, options), { ...options, collapse: false });
}

export interface LadderScene {
  /** `global`, `vendor`, or `generated 1e4 seed 3`. */
  name: string;
  graph: FlowGraph;
  overlays: Overlay[];
  /** Events in the log the scene stands for. */
  events: number;
  /** The generated scenes' magnitude (10², 10⁴, 10⁶, 10⁷) and seed. */
  magnitude?: number;
  seed?: number;
}

/** Total events of a graph: the activities' `events`, or their `cases` where no events are counted. */
export function eventsOf(graph: FlowGraph): number {
  return graph.nodes.reduce((sum, n) => sum + (n.kind === "activity" ? n.metrics?.events ?? n.metrics?.cases ?? 0 : 0), 0);
}

/** The committed scenes with the overlays of the fixture's constraints. */
export function committedScenes(): LadderScene[] {
  return [
    { name: "global", graph: globalScene, overlays: overlaysFor(constraintItems("global"), { graph: globalScene }), events: eventsOf(globalScene) },
    { name: "vendor", graph: vendorScene, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendorScene }), events: eventsOf(vendorScene) },
  ];
}

/** The four magnitudes of the generated scenes, in events. */
export const MAGNITUDES: readonly number[] = [1e2, 1e4, 1e6, 1e7];

/** Activities in a generated log; small enough to lay out quickly, large enough to thin out at every step. */
const ACTIVITIES: readonly [number, number] = [9, 18];

/**
 * A log of the seed's shape: a random process tree played into traces with a
 * start and an end event, its activities in two to four stages in tree order,
 * a violation share on every path.
 */
function baseLog(seed: number): { graph: FlowGraph; rng: Random } {
  const rng = createRandom(seed);
  const size = rng.int(ACTIVITIES[0], ACTIVITIES[1]);
  // The first traces of a long log, as many (at least two) as bring the events nearest to 100.
  const traces = eventLog(size, seed, { traces: 60 }).traces;
  let best = 2;
  for (let k = 2, events = 0; k <= traces.length; k++) {
    events = traces.slice(0, k).reduce((sum, t) => sum + t.length, 0);
    if (Math.abs(events - 100) < Math.abs(traces.slice(0, best).reduce((sum, t) => sum + t.length, 0) - 100)) best = k;
  }
  const graph = directlyFollows(traces.slice(0, best), { events: true });
  const activities = graph.nodes.filter((n) => n.kind === "activity");
  const stageCount = Math.min(activities.length, rng.int(2, 4));
  const groups: FlowGroup[] = Array.from({ length: stageCount }, (_, i) => ({ id: `s${i}`, kind: "stage", label: `Stage ${i + 1}` }));
  activities.forEach((n, i) => (n.group = groups[Math.floor((i * stageCount) / activities.length)].id));
  for (const e of graph.edges) e.metrics = { ...e.metrics, violationShare: rng.int(0, 60) / 100 };
  return { graph: { ...graph, groups }, rng };
}

/** Every count of the graph times a whole factor; shares stay as they are. */
function scaled(graph: FlowGraph, factor: number): FlowGraph {
  const COUNTS = ["events", "cases", "count", "starts", "ends"];
  const times = <T extends { metrics?: Record<string, number> }>(el: T): T =>
    el.metrics ? { ...el, metrics: Object.fromEntries(Object.entries(el.metrics).map(([k, v]) => [k, COUNTS.includes(k) ? v * factor : v])) } : el;
  return { ...graph, nodes: graph.nodes.map(times), edges: graph.edges.map(times) };
}

/** Constraints on the generated activities: badges, a repeat with its self-loop, two arcs with a reverse arc, chips and a scope. */
function constraintsOf(graph: FlowGraph, rng: Random): { description: ConstraintDescription; stats: ConstraintStats }[] {
  const ids = graph.nodes.filter((n) => n.kind === "activity").map((n) => n.id);
  const pick = () => rng.pick(ids);
  const share = () => rng.int(1, 60) / 100;
  const [a, b, c, d] = rng.sample(ids, Math.min(4, ids.length));
  const out: { description: ConstraintDescription; stats: ConstraintStats }[] = [
    { description: { id: "present", type: "presence", label: "Present", activities: [pick()] }, stats: { cases: 100, evaluated: 100, violationShare: share() } },
    { description: { id: "once", type: "singularity", label: "At most once", activities: [pick()], params: { k: 1 } }, stats: { cases: 100, evaluated: 100, violationShare: share(), repeatShare: share() } },
    { description: { id: "never", type: "exclusion", label: "Never", activities: [pick()] }, stats: { cases: 100, evaluated: 100, violationShare: share() } },
    { description: { id: "balance", type: "balance", label: "Touches per case", params: { threshold: 2, width: 4 } }, stats: { cases: 100, evaluated: 100, violationShare: share(), mean: rng.int(0, 40) / 10, threshold: 2, width: 4 } },
  ];
  if (b !== undefined) {
    out.push({ description: { id: "lag", type: "lag", label: "Within 10 days", a: [a], b: [b] }, stats: { cases: 100, evaluated: 80, coverage: 0.8, violationShare: share(), medianDays: rng.int(1, 20), unit: "D" } });
    out.push({ description: { id: "order", type: "precedence", label: "In order", a: [c ?? a], b: [d ?? b] }, stats: { cases: 100, evaluated: 80, coverage: 0.8, violationShare: share(), reverseShare: share() } });
  }
  out.push({ description: { id: "scope", type: "applicability", label: "Scope" }, stats: { cases: 100, casesInScope: 40, inScopeShare: 0.4, nodeShareInScope: Object.fromEntries(ids.map((id) => [id, rng.chance(0.2) ? 0 : 0.5])) } });
  return out;
}

/** The generated scene of a seed at a magnitude; the same shape and overlays at every magnitude. */
export function generatedScene(seed: number, magnitude: number): LadderScene {
  const { graph: base, rng } = baseLog(seed);
  const factor = Math.max(1, Math.round(magnitude / eventsOf(base)));
  const graph = scaled(base, factor);
  const overlays = overlaysFor(constraintsOf(base, rng.fork()), { graph });
  return { name: `generated ${magnitude.toExponential(0).replace("+", "")} seed ${seed}`, graph, overlays, events: eventsOf(graph), magnitude, seed };
}

/** A random setting of the controls, on the sliders' grid of hundredths. */
export function randomSetting(rng: Random): Required<Pick<AbstractOptions, "minNodeShare" | "minEdgeShare" | "keepConnected">> & { collapse: false | "all" } {
  return { minNodeShare: rng.int(0, 60) / 100, minEdgeShare: rng.int(0, 60) / 100, keepConnected: rng.chance(), collapse: rng.chance(0.3) ? "all" : false };
}
