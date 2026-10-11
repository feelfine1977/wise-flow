import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, createPositions } from "../../src/index";
import { CanvasRenderer, type DrawContext, prepareScene } from "../../src/canvas/index";
import { edgeBudgetAdapter } from "../../src/core/edge-budget";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { shrinkList } from "../support/shrink";

// ---------------------------------------------------------------------------
// The adaptive budget as docs/API.md describes it, written here from its words and shared with
// nothing under src/. The steps are 500, 1,000, 2,000, 4,000 and so on, starting at 2,000. The
// frames of a gesture are timed; frames at rest are not. The budget changes only when the last of
// the overlapping gestures ends, by at most one step: down after 5 consecutive frames above
// 16.7 ms that drew more edges than the step below would (so never below 500, the smallest step),
// up after 5 consecutive frames below 8.35 ms that withheld edges. A single slow frame changes
// nothing, a step that would draw the same edges is not taken, and when both runs reached five in
// one gesture the later one decides.

const TARGET = 16.7;
const SMALLEST = 500;
const FIRST = 2000;
const RUN = 5;

/** What a step draws of a view of `total` edges, `kept` of them protected: the protected ones, then up to the step. */
const draws = (step: number, total: number, kept: number) => Math.min(total, Math.max(kept, step));

function referenceBudget() {
  let budget = FIRST;
  let open = 0;
  let slowRun = 0;
  let fastRun = 0;
  let decision: "down" | "up" | undefined;
  return {
    get budget() {
      return budget;
    },
    get open() {
      return open > 0;
    },
    start() {
      if (open === 0) {
        slowRun = 0;
        fastRun = 0;
        decision = undefined;
      }
      open++;
    },
    /** True when the budget moved. */
    end(): boolean {
      if (open === 0) return false;
      open--;
      if (open > 0) return false;
      const before = budget;
      if (decision === "down") budget /= 2;
      if (decision === "up") budget *= 2;
      return budget !== before;
    },
    frame(ms: number, total: number, kept: number) {
      if (open === 0) return;
      const slow = ms > TARGET && budget > SMALLEST && draws(budget, total, kept) > draws(budget / 2, total, kept);
      const fast = ms < TARGET / 2 && draws(budget, total, kept) < total;
      slowRun = slow ? slowRun + 1 : 0;
      fastRun = fast ? fastRun + 1 : 0;
      if (slowRun >= RUN) decision = "down";
      if (fastRun >= RUN) decision = "up";
    },
  };
}

// ---------------------------------------------------------------------------
// Traces: gestures that start and end (overlapping too, and ends without a start), bursts of
// frames with times from one of three classes, frames at rest, and views that change under way.

type FrameClass = "fast" | "neutral" | "slow";
const CLASSES: readonly FrameClass[] = ["fast", "neutral", "slow"];
/** What a trace's frames lean to: one class, any, or a class of its own for each burst. */
type Bias = FrameClass | "mixed" | "turning";
const BIASES: readonly Bias[] = [...CLASSES, "mixed", "turning"];

/** A frame time of the class: below 8.35 ms, from 8.35 to 16.7 ms (the boundaries count as neither), above 16.7 ms. */
function frameMs(rng: Random, kind: FrameClass): number {
  switch (kind) {
    case "fast":
      return rng.chance(0.1) ? 0 : rng.float(0, TARGET / 2);
    case "neutral":
      return rng.pick([TARGET / 2, TARGET, rng.float(TARGET / 2, TARGET)]);
    case "slow":
      return rng.chance(0.1) ? TARGET + 1e-6 : rng.float(TARGET + 0.01, 120);
  }
}

/** Mostly frames of the trace's own class, so that runs of five happen; sometimes another class breaks a run. */
function someMs(rng: Random, bias: FrameClass | "mixed"): number {
  return frameMs(rng, bias === "mixed" || !rng.chance(0.85) ? rng.pick(CLASSES) : bias);
}

/** The class a burst of frames leans to. A turning trace picks one per burst, so that one gesture holds a run of five slow frames and then one of five fast frames, or the reverse. */
const burstOf = (rng: Random, bias: Bias): FrameClass | "mixed" => (bias === "turning" ? rng.pick(CLASSES) : bias);

type Step = { kind: "start" } | { kind: "end" } | { kind: "frame"; ms: number } | { kind: "view"; total: number; kept: number };

// Views: edge counts around the steps, and protected edges below half the smallest step. Above that the
// adapter and the documented rule part: the adapter counts a slow frame that drew more than half its
// budget, the rule one that drew more than the step below would, and with 2,500 protected edges of 5,000
// in view these differ (pinned as a finding in adaptive-budget.test.ts). The search stays where they agree.
const TOTALS = [0, 1, 100, 499, 500, 501, 999, 1000, 1500, 2000, 2001, 3000, 4000, 5000, 7999, 8000, 20_000, 100_000];
const view = (rng: Random) => {
  const total = rng.pick(TOTALS);
  return { total, kept: Math.min(total, rng.chance(0.5) ? 0 : rng.int(0, 200)) };
};

interface Trace {
  steps: Step[];
  total: number;
  kept: number;
  bias: Bias;
}

function traceOf(seed: number): Trace {
  const rng = createRandom(seed);
  const bias = rng.pick(BIASES);
  const { total, kept } = view(rng);
  const steps: Step[] = [];
  const length = rng.int(1, 60);
  let open = 0;
  while (steps.length < length) {
    const kind = rng.weighted([["start", 2], ["end", 2], ["frames", 8], ["view", 1]] as const);
    if (kind === "frames") {
      const burst = burstOf(rng, bias);
      for (let k = rng.int(1, 8); k > 0; k--) steps.push({ kind: "frame", ms: someMs(rng, burst) });
    } else if (kind === "view") steps.push({ kind: "view", ...view(rng) });
    else {
      steps.push({ kind });
      open = kind === "start" ? open + 1 : Math.max(0, open - 1);
    }
  }
  // Every gesture ends, so that each decision is observed; a frame at rest then draws the budget it left.
  for (; open > 0; open--) steps.push({ kind: "end" });
  steps.push({ kind: "frame", ms: someMs(rng, burstOf(rng, bias)) });
  return { steps, total, kept, bias };
}

/** Searching tests run fifty times longer in deep mode; so may their timeout. */
const TIMEOUT = 30_000 * caseCount(1);

const isStep = (budget: number) => Number.isInteger(Math.log2(budget / SMALLEST)) && budget >= SMALLEST;

/** The first step at which the adapter parts from the reference: a move on a frame, a move of more than one step, another budget, a clock read outside a timed frame. */
function traceProblem(trace: Trace): string | undefined {
  let ms = 0;
  let reads = 0;
  // Two reads per timed frame, 0 and then the frame's length, so that a frame lasts exactly `ms`.
  const clock = () => (reads++ % 2 ? ms : 0);
  const adapter = edgeBudgetAdapter(clock);
  const ref = referenceBudget();
  let { total, kept } = trace;
  if (adapter.budget !== FIRST) return `starts at ${adapter.budget} instead of ${FIRST}`;
  for (const [i, step] of trace.steps.entries()) {
    const at = `step ${i} ${JSON.stringify(step)}`;
    const before: number = adapter.budget;
    if (step.kind === "start") {
      adapter.start();
      ref.start();
    } else if (step.kind === "end") {
      const movedRef = ref.end();
      const moved = adapter.end();
      if (moved !== movedRef) return `${at}: end() says ${moved}, the reference ${movedRef}`;
      // One step at most, and only as the last gesture ends.
      if (movedRef ? adapter.budget !== before / 2 && adapter.budget !== before * 2 : adapter.budget !== before) return `${at}: the budget went from ${before} to ${adapter.budget}`;
    } else if (step.kind === "frame") {
      const timed = ref.open;
      const readsBefore = reads;
      let drewWith: number | undefined;
      ms = step.ms;
      adapter.frame((budget) => {
        drewWith = budget;
        return { shown: draws(budget, total, kept), total };
      });
      ref.frame(step.ms, total, kept);
      if (drewWith !== before) return `${at}: the frame drew with ${drewWith} instead of ${before}`;
      if (adapter.budget !== before) return `${at}: the budget moved on a frame, from ${before} to ${adapter.budget}`;
      if (reads - readsBefore !== (timed ? 2 : 0)) return `${at}: the clock was read ${reads - readsBefore} times instead of ${timed ? 2 : 0}`;
    } else {
      ({ total, kept } = step);
    }
    if (adapter.budget !== ref.budget) return `${at}: the budget is ${adapter.budget}, the reference's ${ref.budget}`;
    if (!isStep(adapter.budget)) return `${at}: the budget ${adapter.budget} is not a step`;
  }
  return undefined;
}

/** The fewest steps of a failing trace that still fail, and their problem. */
function smallestTrace(trace: Trace): string {
  const steps = shrinkList(trace.steps, (some) => traceProblem({ ...trace, steps: some }) !== undefined);
  return `smallest failing trace (${steps.length} of ${trace.steps.length} steps; ${trace.total} edges in view, ${trace.kept} protected):\n${JSON.stringify(steps)}\n→ ${traceProblem({ ...trace, steps })}`;
}

describe("the adaptive budget against the documented rules, on random traces", () => {
  it("moves as the reference does, never on a frame, by one step at the end of the last gesture, and reads the clock only for the frames of a gesture", () => {
    for (const seed of seeds(caseCount(300))) {
      const trace = traceOf(seed);
      const problem = traceProblem(trace);
      if (problem !== undefined) expect(problem, `${caseLabel(seed, trace.bias)}: ${problem}\n${smallestTrace(trace)}`).toBeUndefined();
    }
  }, TIMEOUT);

  it("settles on a constant trace within two gestures down or ⌈log₂(total / 2,000)⌉ gestures up, never oscillates, and reaches every edge when frames are fast", () => {
    for (const seed of seeds(caseCount(300))) {
      const rng = createRandom(seed);
      const { total, kept } = view(rng);
      const kind = rng.pick(CLASSES);
      const ms = frameMs(rng, kind);
      const perGesture = rng.int(1, 9);
      let reads = 0;
      const adapter = edgeBudgetAdapter(() => (reads++ % 2 ? ms : 0));
      const budgets: number[] = [adapter.budget];
      for (let g = 0; g < 10; g++) {
        adapter.start();
        for (let k = 0; k < perGesture; k++) adapter.frame((budget) => ({ shown: draws(budget, total, kept), total }));
        adapter.end();
        budgets.push(adapter.budget);
      }
      const label = caseLabel(seed, `${kind} ${ms.toFixed(2)} ms, ${perGesture} frames per gesture, ${total} edges, ${kept} protected`);
      // Monotone: no oscillation.
      const signs = new Set(budgets.slice(1).map((b, i) => Math.sign(b - budgets[i])).filter((s) => s !== 0));
      expect(signs.size, label).toBeLessThanOrEqual(1);
      // The bound: nothing with fewer than five frames per gesture; else two steps down to 500, or up until the step covers the view.
      const bound = perGesture < RUN ? 0 : kind === "slow" ? Math.log2(FIRST / SMALLEST) : kind === "fast" ? Math.max(0, Math.ceil(Math.log2(Math.max(1, total) / FIRST))) : 0;
      expect(new Set(budgets.slice(bound)).size, label).toBe(1);
      // Fast frames reach every edge in view.
      if (kind === "fast" && perGesture >= RUN) expect(draws(budgets[bound], total, kept), label).toBe(total);
      if (kind === "neutral" || perGesture < RUN) expect(new Set(budgets).size, label).toBe(1);
    }
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------
// The renderer: the same traces through `CanvasRenderer`, with a fake clock, a selection of
// protected edges, and a host that switches the budget between adaptive, a number and "all".

/** A hub `h` with a path to each of `n` activities; h->t1 is the heaviest, h->t<n> the lightest. */
function hubScene(n: number) {
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "h" }, ...Array.from({ length: n }, (_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `t${k + 1}` }))];
  const edges: FlowEdge[] = Array.from({ length: n }, (_, k) => ({ id: `h->t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count: n - k } }));
  const boxes = Object.fromEntries(nodes.map((node, i) => [node.id, i === 0 ? { x: 0, y: 0, width: 60, height: 40 } : { x: 200 + 80 * ((i - 1) % 100), y: 60 * Math.floor((i - 1) / 100), width: 60, height: 40 }]));
  const graph: FlowGraph = { nodes, edges };
  return prepareScene(graph, createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false, lodBySize: false });
}

/** A 2D context that draws nothing, as a plain object: cheaper than a Proxy for a thousand edges a frame. */
const noop = () => {};
const quiet: DrawContext = {
  fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "alphabetic", globalAlpha: 1, lineJoin: "miter", lineCap: "butt",
  save: noop, restore: noop, translate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop, arc: noop, rect: noop,
  fill: noop, stroke: noop, fillRect: noop, clearRect: noop, fillText: noop, strokeText: noop, setLineDash: noop,
  measureText: () => ({ width: 0 }),
  createPattern: () => null,
  createLinearGradient: () => ({ addColorStop: noop }) as unknown as CanvasGradient,
};

// Hubs above 1,000 paths can leave the first step of 2,000 downward, above 2,000 upward too; 600 cannot move at all.
const SIZES = [600, 1030, 1100, 1500, 2100];
const scenes = new Map<number, { scene: ReturnType<typeof hubScene>; at: Map<string, number> }>();
/** The hub scene of `n` paths and the position of each path in its edge marks. */
function sceneOf(n: number) {
  let known = scenes.get(n);
  if (!known) {
    const scene = hubScene(n);
    known = { scene, at: new Map(scene.edgeMarks.map((m, i) => [m.id, i])) };
    scenes.set(n, known);
  }
  return known;
}

type Budget = number | "all" | "adaptive";
type HostStep = { kind: "begin" } | { kind: "end" } | { kind: "frame"; ms: number } | { kind: "select"; edges: string[] } | { kind: "budget"; budget: Budget };

/** The budget the map starts with and what the host then does. */
function hostTraceOf(seed: number, n: number): { budget: Budget; steps: HostStep[] } {
  const rng = createRandom(seed);
  const bias = rng.pick(BIASES);
  const fixed = () => rng.weighted<Budget>([[rng.pick([0, 300, 700, 1500, 3000]), 2], ["all", 1]]);
  const budget = rng.chance(0.7) ? "adaptive" : fixed();
  const steps: HostStep[] = [];
  const length = rng.int(1, 18);
  const ids = Array.from({ length: n }, (_, k) => `h->t${k + 1}`);
  const frames = (count: number) => {
    const burst = burstOf(rng, bias);
    for (let k = count; k > 0; k--) steps.push({ kind: "frame", ms: someMs(rng, burst) });
  };
  let open = 0;
  while (steps.length < length) {
    // Gestures begin more often than they end, so that they overlap.
    const kind = rng.weighted([["begin", 4], ["end", 3], ["frames", 8], ["overlap", 2], ["switch", 1], ["select", 1], ["budget", 1]] as const);
    if (kind === "frames") frames(rng.int(2, 6));
    else if (kind === "overlap" || kind === "switch") {
      // Two gestures that overlap, with enough frames inside them to decide, and a frame after each end; in a
      // switch the first begins on a fixed budget that the host turns adaptive before the second begins.
      if (kind === "switch") steps.push({ kind: "budget", budget: fixed() });
      steps.push({ kind: "begin" });
      if (kind === "switch") steps.push({ kind: "budget", budget: "adaptive" });
      steps.push({ kind: "begin" });
      frames(rng.int(5, 7));
      steps.push({ kind: "end" });
      frames(1);
      steps.push({ kind: "end" });
      frames(1);
    } else if (kind === "select") steps.push({ kind: "select", edges: rng.sample(ids, rng.pick([0, 1, 5, 30])) });
    else if (kind === "budget") steps.push({ kind: "budget", budget: rng.chance(0.5) ? "adaptive" : fixed() });
    else {
      steps.push({ kind });
      open = kind === "begin" ? open + 1 : Math.max(0, open - 1);
    }
  }
  // Every gesture ends, so that each decision is observed, and a frame at rest draws the budget it left.
  for (; open > 0; open--) {
    steps.push({ kind: "end" });
    frames(1);
  }
  return { budget, steps };
}

/** The first frame the renderer draws otherwise than the reference says, or with a clock read it should not make. */
function hostProblem(n: number, first: Budget, steps: readonly HostStep[]): string | undefined {
  const { scene, at } = sceneOf(n);
  let nextMs = 0;
  let reads = 0;
  // Two reads per timed frame, 0 and then the frame's length: the frame lasts exactly `nextMs`.
  const clock = () => (reads++ % 2 ? nextMs : 0);
  const canvas = { width: 0, height: 0, style: {}, getContext: () => quiet } as unknown as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { edgeBudget: first, cull: false }, clock });
  renderer.setScene(scene);
  renderer.resize(800, 600);
  renderer.fit();
  const ref = referenceBudget();
  let budget: Budget = first;
  let selected: string[] = [];
  try {
    for (const [i, step] of steps.entries()) {
      const where = `step ${i} ${JSON.stringify(step)}`;
      if (step.kind === "begin") {
        renderer.beginGesture();
        ref.start();
      } else if (step.kind === "end") {
        renderer.endGesture();
        ref.end();
      } else if (step.kind === "select") {
        selected = step.edges;
        renderer.setState({ selection: { nodes: [], edges: selected, groups: [] } });
      } else if (step.kind === "budget") {
        budget = step.budget;
        renderer.drawOptions = { ...renderer.drawOptions, edgeBudget: budget };
      } else {
        const timed = budget === "adaptive" && ref.open;
        const readsBefore = reads;
        nextMs = step.ms;
        renderer.draw();
        if (budget === "adaptive") ref.frame(step.ms, n, selected.length);
        if (reads - readsBefore !== (timed ? 2 : 0)) return `${where}: the clock was read ${reads - readsBefore} times instead of ${timed ? 2 : 0}`;
        const wanted = budget === "adaptive" ? ref.budget : budget;
        const shown = wanted === "all" ? n : draws(wanted, n, selected.length);
        const withheld = renderer.lastDraw!.withheld;
        const drew = withheld ? `${withheld.shown} of ${withheld.total}` : "every edge";
        if (shown === n ? withheld : !withheld || withheld.shown !== shown || withheld.total !== n) return `${where}: drew ${drew} instead of ${shown === n ? "every edge" : `${shown} of ${n}`}`;
        const lost = withheld && selected.find((id) => !withheld.drawn.has(at.get(id)!));
        if (lost) return `${where}: withheld the selected edge ${lost}`;
      }
    }
  } finally {
    renderer.dispose();
  }
  return undefined;
}

describe("the Canvas renderer on random traces of gestures, frames, selections and budget changes", () => {
  it("draws every frame with the reference's budget, keeps the selected edges, counts gestures whatever the budget is, and reads the clock only for the timed frames of an adaptive budget", () => {
    for (const seed of seeds(caseCount(300))) {
      const n = createRandom(seed + 42).pick(SIZES);
      const { budget: first, steps } = hostTraceOf(seed, n);
      const problem = hostProblem(n, first, steps);
      if (problem === undefined) continue;
      const small = shrinkList(steps, (some) => hostProblem(n, first, some) !== undefined);
      const smallest = `smallest failing trace (${small.length} of ${steps.length} steps; hub ${n}, starting budget ${first}):\n${JSON.stringify(small)}\n→ ${hostProblem(n, first, small)}`;
      expect(problem, `${caseLabel(seed, `hub ${n}`)}: ${problem}\n${smallest}`).toBeUndefined();
    }
  }, TIMEOUT);
});
