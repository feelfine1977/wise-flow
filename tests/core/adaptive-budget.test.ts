import { describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, createPositions, emptySelection } from "../../src/index";
import { CanvasRenderer, type DrawContext, prepareScene } from "../../src/canvas/index";
import { FIRST_STEP, type FrameCounts, edgeBudgetAdapter } from "../../src/core/edge-budget";

/** A clock whose reads come in pairs, start and end of a frame: each pair spans the next duration queued (ms). */
function frameClock() {
  const queue: number[] = [];
  let now = 0;
  let reads = 0;
  const clock = vi.fn(() => (reads++ % 2 ? (now += queue.shift() ?? 0) : now));
  return Object.assign(clock, { queue });
}

const SLOW = 25;
const FAST = 5;
// Neither above 16.7 ms nor below half of it.
const NEUTRAL = 12;

/** One gesture whose frames last `frames` ms and draw `counts`; the budget stays the same until it ends. */
function gesture(adapter: ReturnType<typeof edgeBudgetAdapter>, clock: ReturnType<typeof frameClock>, frames: number[], counts: (budget: number) => FrameCounts) {
  const before = adapter.budget;
  clock.queue.push(...frames);
  adapter.start();
  for (let k = 0; k < frames.length; k++) {
    adapter.frame(counts);
    expect(adapter.budget).toBe(before);
  }
  expect(clock.queue).toEqual([]);
  return adapter.end();
}

const times = (n: number, ms: number) => Array<number>(n).fill(ms);
// 10,000 edges in view: every budget below that withholds edges.
const dense = (budget: number) => ({ shown: budget, total: 10_000 });

describe("adaptive edge budget", () => {
  it("starts at 2,000 and steps down one step per gesture after sustained slow frames, to 500", () => {
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    expect(adapter.budget).toBe(FIRST_STEP);
    expect(FIRST_STEP).toBe(2000);
    expect(gesture(adapter, clock, times(20, SLOW), dense)).toBe(true);
    expect(adapter.budget).toBe(1000);
    expect(gesture(adapter, clock, times(5, SLOW), dense)).toBe(true);
    expect(adapter.budget).toBe(500);
    // 500 is the smallest step.
    expect(gesture(adapter, clock, times(20, SLOW), dense)).toBe(false);
    expect(adapter.budget).toBe(500);
  });

  it("steps up one step per gesture after sustained fast frames that withheld edges", () => {
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    expect(gesture(adapter, clock, times(20, FAST), dense)).toBe(true);
    expect(adapter.budget).toBe(4000);
    expect(gesture(adapter, clock, times(5, FAST), dense)).toBe(true);
    expect(adapter.budget).toBe(8000);
    // At 16,000 the 10,000 edges in view are all drawn: no step above that.
    expect(gesture(adapter, clock, times(5, FAST), dense)).toBe(true);
    expect(adapter.budget).toBe(16_000);
    expect(gesture(adapter, clock, times(20, FAST), (budget) => ({ shown: Math.min(budget, 10_000), total: 10_000 }))).toBe(false);
    expect(adapter.budget).toBe(16_000);
  });

  it("changes nothing after a single slow frame, or fewer than five in a row", () => {
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    expect(gesture(adapter, clock, [NEUTRAL, SLOW, NEUTRAL, NEUTRAL], dense)).toBe(false);
    expect(gesture(adapter, clock, [SLOW], dense)).toBe(false);
    expect(gesture(adapter, clock, [...times(4, SLOW), NEUTRAL, ...times(4, SLOW)], dense)).toBe(false);
    expect(gesture(adapter, clock, [...times(4, FAST), SLOW, ...times(4, FAST)], dense)).toBe(false);
    expect(adapter.budget).toBe(2000);
  });

  it("does not count slow frames that drew no more than the step below, nor fast frames that withheld nothing", () => {
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    // 1,000 edges drawn of 1,000 in view: halving the budget to 1,000 would draw the same.
    expect(gesture(adapter, clock, times(10, SLOW), () => ({ shown: 1000, total: 1000 }))).toBe(false);
    expect(gesture(adapter, clock, times(10, FAST), () => ({ shown: 1500, total: 1500 }))).toBe(false);
    expect(adapter.budget).toBe(2000);
  });

  it("takes the last run that reached five frames in a gesture", () => {
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    expect(gesture(adapter, clock, [...times(5, SLOW), ...times(5, FAST)], dense)).toBe(true);
    expect(adapter.budget).toBe(4000);
    expect(gesture(adapter, clock, [...times(5, FAST), ...times(5, SLOW)], dense)).toBe(true);
    expect(adapter.budget).toBe(2000);
  });

  it("counts each gesture on its own and reads no clock outside a gesture", () => {
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    expect(gesture(adapter, clock, times(4, SLOW), dense)).toBe(false);
    expect(gesture(adapter, clock, times(4, SLOW), dense)).toBe(false);
    clock.mockClear();
    for (let k = 0; k < 10; k++) adapter.frame(dense);
    expect(clock).not.toHaveBeenCalled();
    // An end without a start changes nothing.
    expect(adapter.end()).toBe(false);
    expect(adapter.budget).toBe(2000);
  });

  it("does not step down after slow frames whose drawn edges the step below would draw as well, being protected", () => {
    // 2,500 protected edges of 5,000 in view: 2,000 draws them and nothing else, and so would 1,000 and 500. No
    // step that draws the same edges is taken.
    const clock = frameClock();
    const adapter = edgeBudgetAdapter(clock);
    const mostlyProtected = (budget: number) => ({ shown: Math.max(2500, budget), total: 5000, kept: 2500 });
    expect(gesture(adapter, clock, times(5, SLOW), mostlyProtected)).toBe(false);
    expect(gesture(adapter, clock, times(20, SLOW), mostlyProtected)).toBe(false);
    expect(adapter.budget).toBe(2000);
    // Likewise when every edge in view is protected and drawn, so that nothing was withheld to begin with.
    const other = frameClock();
    const all = edgeBudgetAdapter(other);
    expect(gesture(all, other, times(5, SLOW), () => ({ shown: 1500, total: 1500, kept: 1500 }))).toBe(false);
    expect(all.budget).toBe(2000);
    // 1,200 protected of 5,000: 2,000 draws 800 more than 1,000 would, and 1,000 none more than 500 would.
    const some = frameClock();
    const part = edgeBudgetAdapter(some);
    const partlyProtected = (budget: number) => ({ shown: Math.max(1200, budget), total: 5000, kept: 1200 });
    expect(gesture(part, some, times(5, SLOW), partlyProtected)).toBe(true);
    expect(part.budget).toBe(1000);
    expect(gesture(part, some, times(5, SLOW), partlyProtected)).toBe(false);
    expect(part.budget).toBe(1000);
  });

  it("does not change while overlapping gestures are under way, and moves once the last ends", () => {
    let now = 0;
    const clock = vi.fn(() => (now += SLOW));
    const adapter = edgeBudgetAdapter(clock);
    adapter.start(); // pan
    for (let k = 0; k < 6; k++) adapter.frame(dense);
    adapter.start(); // zoom while panning
    expect(adapter.end()).toBe(false); // the pan ends
    for (let k = 0; k < 6; k++) adapter.frame(dense);
    expect(adapter.budget).toBe(2000);
    expect(adapter.end()).toBe(true); // the zoom ends
    expect(adapter.budget).toBe(1000);
  });
});

// A hub `h` with paths to `n` activities; h->t1 is the heaviest, h->t<n> the lightest.
function hubScene(n: number) {
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "h" }, ...Array.from({ length: n }, (_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `t${k + 1}` }))];
  const edges: FlowEdge[] = Array.from({ length: n }, (_, k) => ({ id: `h->t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count: n - k } }));
  const boxes = Object.fromEntries(nodes.map((node, i) => [node.id, i === 0 ? { x: 0, y: 0, width: 60, height: 40 } : { x: 200 + 80 * ((i - 1) % 100), y: 60 * Math.floor((i - 1) / 100), width: 60, height: 40 }]));
  const graph: FlowGraph = { nodes, edges };
  return prepareScene(graph, createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false, lodBySize: false });
}

const quiet = new Proxy({} as Record<string | symbol, unknown>, { get: (target, key) => (key in target ? target[key] : () => ({ width: 0 })), set: (target, key, value) => ((target[key] = value), true) }) as unknown as DrawContext;

function rendererOf(n: number, clock: () => number, edgeBudget: number | "all" | "adaptive" = "adaptive") {
  const canvas = { width: 0, height: 0, style: {}, getContext: () => quiet } as unknown as HTMLCanvasElement;
  const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { edgeBudget }, clock });
  const scene = hubScene(n);
  renderer.setScene(scene);
  renderer.resize(800, 600);
  renderer.fit();
  return { renderer, scene };
}

describe("adaptive edge budget in the Canvas renderer", () => {
  const n = 5000;
  // The lightest edge, selected: protected at every budget.
  const lightest = n - 1;
  const selection = { nodes: [], edges: [`h->t${n}`], groups: [] };

  function pan(renderer: CanvasRenderer, frames: number, protectedEdge = true) {
    const shown: number[] = [];
    renderer.beginGesture();
    for (let k = 0; k < frames; k++) {
      renderer.panBy(1, 0);
      renderer.draw();
      shown.push(renderer.lastDraw!.withheld!.shown);
      if (protectedEdge) expect(renderer.lastDraw!.withheld!.drawn.has(lightest)).toBe(true);
    }
    renderer.endGesture();
    renderer.draw();
    return shown;
  }

  it("steps down after slow frames of a gesture, draws protected edges at every budget and reports the current numbers", () => {
    let now = 0;
    const clock = vi.fn(() => (now += SLOW));
    const { renderer } = rendererOf(n, clock);
    renderer.setState({ selection });
    renderer.draw();
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 2000, total: n });
    expect(pan(renderer, 6)).toEqual(times(6, 2000));
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 1000, total: n });
    expect(renderer.lastDraw!.withheld!.drawn.has(lightest)).toBe(true);
    expect(pan(renderer, 6)).toEqual(times(6, 1000));
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 500, total: n });
    expect(renderer.lastDraw!.withheld!.drawn.has(lightest)).toBe(true);
    // A budget of 1 with a protected edge: the protected edge and nothing else. The order is h->t1, h->t2, … by count.
    const drawn = renderer.lastDraw!.withheld!.drawn;
    expect([...drawn].filter((i) => i !== lightest).sort((a, b) => a - b)).toEqual(Array.from({ length: 499 }, (_, i) => i));
  });

  it("does not step down while the edges it draws are protected ones that every step below would draw too", () => {
    let now = 0;
    const clock = vi.fn(() => (now += SLOW));
    const { renderer } = rendererOf(n, clock);
    // Half the hub's paths selected: 2,500 protected edges of 5,000 in view.
    const half = { nodes: [], edges: Array.from({ length: n / 2 }, (_, k) => `h->t${2 * k + 1}`), groups: [] };
    renderer.setState({ selection: half });
    renderer.draw();
    expect(renderer.lastDraw).toMatchObject({ kept: 2500, withheld: { shown: 2500, total: n, kept: 2500 } });
    expect(pan(renderer, 6, false)).toEqual(times(6, 2500));
    expect(pan(renderer, 6, false)).toEqual(times(6, 2500));
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 2500, total: n });
    // Once the selection is cleared the budget is still the first step.
    renderer.setState({ selection: emptySelection });
    renderer.draw();
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 2000, total: n, kept: 0 });
  });

  it("does not step down while every edge in view is protected and drawn, though nothing is withheld", () => {
    let now = 0;
    const clock = vi.fn(() => (now += SLOW));
    const { renderer } = rendererOf(1500, clock);
    renderer.setState({ selection: { nodes: [], edges: Array.from({ length: 1500 }, (_, k) => `h->t${k + 1}`), groups: [] } });
    for (let g = 0; g < 2; g++) {
      renderer.beginGesture();
      for (let k = 0; k < 6; k++) {
        renderer.panBy(1, 0);
        renderer.draw();
        expect(renderer.lastDraw).toMatchObject({ edges: 1500, kept: 1500 });
        expect(renderer.lastDraw!.withheld).toBeUndefined();
      }
      renderer.endGesture();
    }
    // Without the selection the next slow gesture finds 1,500 drawn where 1,000 would draw 1,000.
    renderer.setState({ selection: emptySelection });
    renderer.beginGesture();
    for (let k = 0; k < 6; k++) renderer.draw();
    renderer.endGesture();
    renderer.draw();
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 1000, total: 1500, kept: 0 });
  });

  it("steps up after fast frames of a gesture while edges are withheld", () => {
    let now = 0;
    const clock = vi.fn(() => (now += FAST));
    const { renderer } = rendererOf(n, clock);
    renderer.draw();
    expect(pan(renderer, 6, false)).toEqual(times(6, 2000));
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 4000, total: n });
    renderer.beginGesture();
    for (let k = 0; k < 6; k++) renderer.draw();
    renderer.endGesture();
    renderer.draw();
    // 8,000 covers the 5,000 edges in view.
    expect(renderer.lastDraw!.withheld).toBeUndefined();
  });

  it("reads no clock with a fixed number or all, and none outside a gesture when adaptive", () => {
    for (const edgeBudget of [3000, 0, "all"] as const) {
      const clock = vi.fn(() => 0);
      const { renderer } = rendererOf(n, clock, edgeBudget);
      renderer.draw();
      renderer.beginGesture();
      for (let k = 0; k < 6; k++) {
        renderer.zoomBy(0.9);
        renderer.draw();
      }
      renderer.endGesture();
      renderer.draw();
      expect(clock).not.toHaveBeenCalled();
      expect(renderer.lastDraw!.withheld?.shown).toBe(edgeBudget === "all" ? undefined : edgeBudget);
    }
    const clock = vi.fn(() => 0);
    const { renderer } = rendererOf(n, clock);
    for (let k = 0; k < 6; k++) renderer.draw();
    expect(clock).not.toHaveBeenCalled();
  });

  it("counts a gesture that began while the budget was fixed, so its end cannot apply a step while a later gesture is still under way", () => {
    let now = 0;
    const clock = vi.fn(() => (now += SLOW));
    const { renderer } = rendererOf(n, clock, "all");
    renderer.draw();
    // A wheel run starts on a fixed budget; the host then turns the budget adaptive, and a drag starts.
    renderer.beginGesture();
    renderer.drawOptions = { ...renderer.drawOptions, edgeBudget: "adaptive" };
    renderer.beginGesture();
    for (let k = 0; k < 6; k++) {
      renderer.panBy(1, 0);
      renderer.draw();
      expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 2000, total: n });
    }
    // The wheel run ends while the drag goes on: the view is not at rest, so the budget stays.
    renderer.endGesture();
    renderer.draw();
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 2000, total: n });
    // The drag ends: now the slow frames take their step.
    renderer.endGesture();
    renderer.draw();
    expect(renderer.lastDraw!.withheld).toMatchObject({ shown: 1000, total: n });
  });

  it("reads no clock once its host turns an adaptive budget fixed", () => {
    let now = 0;
    const clock = vi.fn(() => (now += SLOW));
    const { renderer } = rendererOf(n, clock);
    expect(pan(renderer, 6, false)).toEqual(times(6, 2000));
    expect(clock).toHaveBeenCalled();
    for (const edgeBudget of [3000, "all"] as const) {
      renderer.drawOptions = { ...renderer.drawOptions, edgeBudget };
      clock.mockClear();
      renderer.beginGesture();
      for (let k = 0; k < 6; k++) {
        renderer.panBy(1, 0);
        renderer.draw();
      }
      renderer.endGesture();
      renderer.draw();
      expect(clock).not.toHaveBeenCalled();
      expect(renderer.lastDraw!.withheld?.shown).toBe(edgeBudget === "all" ? undefined : 3000);
    }
  });
});
