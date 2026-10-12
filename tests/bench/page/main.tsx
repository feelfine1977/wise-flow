/**
 * The benchmark's browser measurements. `run.mjs` bundles this page against
 * the built library (`dist/`), serves it, and calls `window.bench(spec)` once
 * per case on a freshly loaded page; the samples come back as JSON. Times are
 * `performance.now()` differences in milliseconds; warm-up trials are run and
 * thrown away first, and the heap is collected between trials when the browser
 * exposes `gc` (`--js-flags=--expose-gc`).
 */
import { createRoot } from "react-dom/client";
import { type Box, type EdgeRoute, type FlowEdge, type FlowGraph, type FlowNode, type Positions, clearLayoutCache, layout } from "../../../src/index";
import { CanvasRenderer, prepareScene } from "../../../src/canvas/index";
import { ProcessMap } from "../../../src/react/index";
import { families } from "../../support/graphs";
import { createRandom } from "../../support/random";
import { positionsOf } from "../../support/scenes";
import "../../../dist/react-flow.css";
import "../../../dist/tokens.css";
import "../../../dist/style.css";
import elkWorkerUrl from "../../../dist/elk-worker.min.js?url";
import dagreWorkerUrl from "../../../dist/dagre-worker.min.js?url";

export type BrowserCase =
  | { kind: "draw"; scene: "sparse" | "hub" | "fitAll"; size: number; budget: "adaptive" | "all"; highlighted?: boolean; trials: number; warmup: number }
  | { kind: "ready"; activities: number; trials: number; warmup: number }
  | { kind: "firstScene"; shape: "sparse" | "dense"; activities: number; trials: number; warmup: number }
  | { kind: "abort"; trials: number; warmup: number };

/** Samples per measured quantity (one per trial), and what the case measured. */
export interface PageResult {
  samples: Record<string, number[]>;
  detail: Record<string, number | string | boolean>;
}

const WIDTH = 1280;
const HEIGHT = 800;
const FLOWS_PER_ACTIVITY = 20;
const GESTURE = 6;
/** Warm-up gestures beyond the asked ones that the adaptive budget may take to settle. */
const SETTLE_LIMIT = 8;
/** How long a map may take to draw or to lay out before the case fails. */
const LIMIT_MS = 120_000;
/** The pause after each trial of a map without positions. */
const REST_MS = 5_000;

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const collect = () => (globalThis as { gc?: () => void }).gc?.();
const settle = async () => {
  collect();
  for (let i = 0; i < 3; i++) await frame();
};

// When each Canvas 2D context last restored its state: a renderer's draw ends with `restore`.
const restored = new WeakMap<HTMLCanvasElement, number>();
const nativeRestore = CanvasRenderingContext2D.prototype.restore;
CanvasRenderingContext2D.prototype.restore = function restore(this: CanvasRenderingContext2D) {
  nativeRestore.call(this);
  restored.set(this.canvas, performance.now());
};

// When layout workers were started and terminated.
const workers = { started: [] as number[], terminated: [] as number[] };
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    workers.started.push(performance.now());
  }
  override terminate() {
    workers.terminated.push(performance.now());
    super.terminate();
  }
};

/**
 * A hub that follows and is followed by each of `flows / 2` leaves, with
 * straight routes, the leaves on a grid tight enough that a fitted view at the
 * renderer's smallest zoom holds them all: every flow is in view.
 */
function hubScene(flows: number): { graph: FlowGraph; positions: Positions } {
  const leaves = Math.ceil(flows / 2);
  const nodes: FlowNode[] = [{ id: "hub", kind: "activity", label: "Hub", metrics: { cases: leaves } }];
  const edges: FlowEdge[] = [];
  const boxes: Record<string, Box> = {};
  const routes: Record<string, EdgeRoute> = {};
  const [cellW, cellH] = [190, 56];
  const columns = Math.ceil(Math.sqrt((leaves * cellH * WIDTH) / (cellW * HEIGHT)));
  const rows = Math.ceil(leaves / columns);
  const centre = { x: (columns * cellW) / 2, y: (rows * cellH) / 2 };
  boxes.hub = { x: centre.x - 90, y: centre.y - 24, width: 180, height: 48 };
  for (let i = 0; i < leaves; i++) {
    const id = `l${i}`;
    nodes.push({ id, kind: "activity", label: `Leaf ${i}`, metrics: { cases: 1 + (i % 50) } });
    boxes[id] = { x: (i % columns) * cellW, y: Math.floor(i / columns) * cellH, width: 180, height: 48 };
    const leaf = { x: boxes[id].x + 90, y: boxes[id].y + 24 };
    for (const [source, target] of [["hub", id], [id, "hub"]]) {
      if (edges.length === flows) break;
      const edge = `${source}->${target}`;
      edges.push({ id: edge, kind: "follows", source, target, metrics: { count: 1 + ((edges.length * 7919) % 1000) } });
      routes[edge] = { points: source === "hub" ? [centre, leaf] : [leaf, centre] };
    }
  }
  const bounds = { x: 0, y: 0, width: columns * cellW, height: rows * cellH };
  return { graph: { nodes, edges }, positions: { nodes: boxes, groups: {}, edges: routes, bounds, engine: "given", direction: "RIGHT" } };
}

/** `activities` activities with `FLOWS_PER_ACTIVITY` flows each between distinct pairs drawn from a seeded stream. */
function denseGraph(activities: number): FlowGraph {
  const rng = createRandom(activities);
  const nodes: FlowNode[] = Array.from({ length: activities }, (_, i) => ({ id: `n${i}`, kind: "activity", label: `Activity ${i}`, metrics: { cases: rng.int(1, 500) } }));
  const seen = new Set<string>();
  const edges: FlowEdge[] = [];
  while (edges.length < activities * FLOWS_PER_ACTIVITY) {
    const [a, b] = [rng.int(0, activities - 1), rng.int(0, activities - 1)];
    const id = `n${a}->n${b}`;
    if (a === b || seen.has(id)) continue;
    seen.add(id);
    edges.push({ id, kind: "follows", source: `n${a}`, target: `n${b}`, metrics: { count: rng.int(1, 1000) } });
  }
  return { nodes, edges };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Frames of a moving view: a trial is a gesture of six frames, the view panned by a pixel before each; warm-up gestures come first, until the adaptive budget has settled. */
async function draw(spec: Extract<BrowserCase, { kind: "draw" }>): Promise<PageResult> {
  const { graph, positions } = spec.scene === "hub"
    ? hubScene(spec.size)
    : (() => {
      const g = spec.scene === "sparse" ? families.chain(spec.size, 1) : families.layered(spec.size, 1);
      return { graph: g, positions: positionsOf(g, "grid", 1, { routes: true }) };
    })();
  const scene = prepareScene(graph, positions);
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { edgeBudget: spec.budget } });
  renderer.resize(WIDTH, HEIGHT);
  renderer.setScene(scene);
  // Every flow on a highlighted path, as when the hub's paths are in focus: all are protected from the budget.
  if (spec.highlighted) renderer.setState({ highlighted: new Set(graph.edges.map((e) => e.id)) });
  if (spec.scene === "sparse") renderer.centerOn({ x: positions.bounds.x + positions.bounds.width / 2, y: positions.bounds.y + positions.bounds.height / 2 }, 1);
  else renderer.fit();
  await settle();
  /** One gesture: its frames' draw times and the flows each drew and had in view. */
  const gesture = async () => {
    const drawn = [];
    renderer.beginGesture();
    for (let i = 0; i < GESTURE; i++) {
      renderer.panBy(i % 2 ? -1 : 1, 0);
      renderer.draw();
      const last = renderer.lastDraw!;
      drawn.push({ ms: last.ms, shown: last.withheld?.shown ?? last.edges, inView: last.withheld?.total ?? last.edges });
    }
    renderer.endGesture();
    await frame();
    return drawn;
  };
  // The adaptive budget moves a step after each gesture until it suits the frame
  // time: warm up until a gesture draws as many flows as the one before, so that
  // the trials time the budget it settles on rather than the steps on the way.
  let warmupGestures = 0;
  let previous: number | undefined;
  for (let settled = spec.budget !== "adaptive"; warmupGestures < spec.warmup || (!settled && warmupGestures < spec.warmup + SETTLE_LIMIT); warmupGestures++) {
    const shown = (await gesture()).at(-1)!.shown;
    settled = spec.budget !== "adaptive" || shown === previous;
    previous = shown;
  }
  const frames = [];
  for (let i = 0; i < spec.trials; i++) frames.push(...(await gesture()));
  renderer.dispose();
  canvas.remove();
  const shown = frames.map((f) => f.shown);
  return {
    samples: { frame: frames.map((f) => f.ms) },
    detail: {
      activities: graph.nodes.length, flows: graph.edges.length, nodesInView: renderer.lastDraw!.nodes, flowsInView: median(frames.map((f) => f.inView)),
      flowsDrawn: median(shown), flowsDrawnMin: Math.min(...shown), flowsDrawnMax: Math.max(...shown), budget: spec.budget, framesPerTrial: GESTURE, warmupGestures,
    },
  };
}

/** A mounted map in a container of the page's size; `drawn(after)` is when the map was next drawn after `after`. */
function mountMap(element: React.ReactElement) {
  const host = document.createElement("div");
  host.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px`;
  document.body.append(host);
  const root = createRoot(host);
  const started = performance.now();
  root.render(element);
  const map = () => host.querySelector(".wf-process-map");
  /** The end of the first draw after `after`: the Canvas's last `restore`, or the frame in which React Flow shows its nodes. */
  const drawn = async (after: number): Promise<number> => {
    for (;;) {
      const now = await frame();
      if (now - after > LIMIT_MS) throw new Error(`the map was not drawn within ${LIMIT_MS} ms`);
      const canvas = host.querySelector("canvas");
      if (map()?.getAttribute("data-renderer") === "canvas" && canvas) {
        const at = restored.get(canvas);
        if (at !== undefined && at > after) return at;
      } else {
        const nodes = host.querySelectorAll<HTMLElement>(".react-flow__node");
        if (nodes.length && ![...nodes].some((n) => n.style.visibility === "hidden")) return now;
      }
    }
  };
  /** When the map's layout status leaves `pending`, read as the attribute changes. */
  const settled = () => new Promise<number>((resolve, reject) => {
    const element = map()!;
    const check = () => {
      if (status(element) === "pending") return false;
      observer.disconnect();
      clearTimeout(timer);
      resolve(performance.now());
      return true;
    };
    const observer = new MutationObserver(check);
    observer.observe(element, { attributes: true, attributeFilter: ["data-layout-status"] });
    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`the layout did not arrive within ${LIMIT_MS} ms`));
    }, LIMIT_MS);
    check();
  });
  /** When the map last drew on its canvas, if it is a Canvas map. */
  const lastDraw = () => {
    const canvas = host.querySelector("canvas");
    return canvas ? restored.get(canvas) : undefined;
  };
  const unmount = () => {
    root.unmount();
    host.remove();
  };
  return { started, map, drawn, settled, lastDraw, unmount };
}

const status = (map: Element | null) => map?.getAttribute("data-layout-status") ?? "";

async function ready(spec: Extract<BrowserCase, { kind: "ready" }>): Promise<PageResult> {
  const graph = families.layered(spec.activities, 1);
  const positions = positionsOf(graph, "grid", 1, { routes: true });
  const times: number[] = [];
  let renderer = "";
  for (let i = 0; i < spec.warmup + spec.trials; i++) {
    await settle();
    const mounted = mountMap(<ProcessMap graph={graph} positions={positions} />);
    const at = await mounted.drawn(mounted.started);
    renderer = mounted.map()?.getAttribute("data-renderer") ?? "";
    if (i >= spec.warmup) times.push(at - mounted.started);
    mounted.unmount();
  }
  return { samples: { ready: times }, detail: { activities: graph.nodes.length, flows: graph.edges.length, renderer } };
}

async function firstScene(spec: Extract<BrowserCase, { kind: "firstScene" }>): Promise<PageResult> {
  const graph = spec.shape === "dense" ? denseGraph(spec.activities) : families.layered(spec.activities, 1);
  const first: number[] = [];
  const refined: number[] = [];
  const outcomes = new Map<string, number>();
  let renderer = "";
  for (let i = 0; i < spec.warmup + spec.trials; i++) {
    clearLayoutCache();
    await settle();
    const mounted = mountMap(<ProcessMap graph={graph} layout={{ elkWorkerUrl, dagreWorkerUrl }} />);
    const shown = await mounted.drawn(mounted.started);
    const provisional = status(mounted.map()) === "pending";
    const settledAt = await mounted.settled();
    // A Canvas map draws the layout in the next frame, unless it drew it before its status changed.
    await frame();
    await frame();
    const replaced = Math.max(settledAt, mounted.lastDraw() ?? 0);
    const said = mounted.map()?.querySelector("[role=alert]")?.textContent;
    const outcome = `${provisional ? "provisional" : "no provisional"}, then ${status(mounted.map())} (engine ${mounted.map()?.getAttribute("data-engine") ?? "none"}${said ? `: "${said}"` : ""})`;
    renderer = mounted.map()?.getAttribute("data-renderer") ?? "";
    if (i >= spec.warmup) {
      first.push(shown - mounted.started);
      refined.push(replaced - mounted.started);
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
    }
    mounted.unmount();
    // Terminated layout workers give their memory back some time later; without the
    // rest, the dense graphs' workers pile up in the page's process until it dies.
    await new Promise((resolve) => setTimeout(resolve, REST_MS));
  }
  return {
    samples: { first, refined },
    detail: { activities: graph.nodes.length, flows: graph.edges.length, renderer, outcomes: [...outcomes].map(([o, n]) => `${n}× ${o}`).join("; ") },
  };
}

/** A layout in a worker, aborted once the worker has run for a while: from the abort to the worker's `terminate`. */
async function abort(spec: Extract<BrowserCase, { kind: "abort" }>): Promise<PageResult> {
  const graph = denseGraph(500);
  const terminated: number[] = [];
  const rejected: number[] = [];
  for (let i = 0; i < spec.warmup + spec.trials; i++) {
    clearLayoutCache();
    await settle();
    const before = { started: workers.started.length, terminated: workers.terminated.length };
    const controller = new AbortController();
    const running = layout(graph, { elkWorkerUrl, dagreWorkerUrl, signal: controller.signal }).then(() => "finished", () => performance.now());
    while (workers.started.length === before.started) await frame();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const at = performance.now();
    controller.abort();
    const outcome = await running;
    // The worker is stopped in a microtask once nobody waits; look after the next frame.
    await frame();
    if (typeof outcome !== "number" || workers.terminated.length === before.terminated) throw new Error("the aborted layout's worker was not terminated");
    if (i >= spec.warmup) {
      terminated.push(workers.terminated[before.terminated] - at);
      rejected.push(outcome - at);
    }
  }
  return { samples: { terminated, rejected }, detail: { activities: graph.nodes.length, flows: graph.edges.length, ranFor: 250 } };
}

declare global {
  interface Window {
    bench: (spec: BrowserCase) => Promise<PageResult>;
  }
}

window.bench = (spec) => {
  if (spec.kind === "draw") return draw(spec);
  if (spec.kind === "ready") return ready(spec);
  if (spec.kind === "firstScene") return firstScene(spec);
  return abort(spec);
};
document.documentElement.dataset.bench = "ready";
