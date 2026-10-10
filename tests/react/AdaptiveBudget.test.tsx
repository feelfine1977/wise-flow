import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, type ShownEdges, createPositions, resolveViews, toSVG } from "../../src/index";
import { prepareScene } from "../../src/canvas/index";
import { CanvasMap, type CanvasMapHandle, ProcessMap, ViewSwitcher } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no pointer events; the Canvas map listens to them.
const hadPointer = "PointerEvent" in window;
beforeAll(() => {
  if (hadPointer) return;
  class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: PointerEvent });
});
afterAll(() => {
  if (!hadPointer) delete (window as { PointerEvent?: unknown }).PointerEvent;
});

/** A hub `h` with a path to each of `n` activities; h->t1 is the heaviest. */
function hub(n: number) {
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "Hub" }, ...Array.from({ length: n }, (_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `T${k + 1}` }))];
  const edges: FlowEdge[] = Array.from({ length: n }, (_, k) => ({ id: `h->t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count: n - k } }));
  const boxes = Object.fromEntries(nodes.map((node, i) => [node.id, i === 0 ? { x: 0, y: 0, width: 100, height: 40 } : { x: 300 + 160 * ((i - 1) % 50), y: 80 * Math.floor((i - 1) / 50), width: 100, height: 40 }]));
  return { graph: { nodes, edges } satisfies FlowGraph, positions: createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT") };
}

const large = hub(2500);
const scene = prepareScene(large.graph, large.positions, { selfLoops: false });
const state = { selection: { nodes: [], edges: [], groups: [] } };

function quietCanvas() {
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

const note = () => screen.queryByTestId("wf-edge-note")?.textContent;
const SLOW = 25;

/** The Canvas map of 2,500 edges, all in view, with a clock that makes every timed frame last `ms`. */
async function mountMap(edgeBudget: number | "all" | "adaptive" | undefined, ms = SLOW) {
  quietCanvas();
  let now = 0;
  const clock = vi.fn(() => (now += ms));
  const ref = createRef<CanvasMapHandle>();
  // What the host is told to export.
  const reported: (ShownEdges | undefined)[] = [];
  render(
    <div style={{ width: 1200, height: 800 }}>
      <CanvasMap ref={ref} scene={scene} state={state} fitKey="fit" edgeBudget={edgeBudget} clock={clock} onEdgesShown={(s) => reported.push(s)} />
    </div>,
  );
  await waitFor(() => expect(ref.current?.renderer()?.lastDraw).toBeDefined());
  const renderer = ref.current!.renderer()!;
  // Every draw from here on, with the edges it showed.
  const shown: (number | undefined)[] = [];
  const onDraw = renderer.onDraw!;
  renderer.onDraw = (stats) => {
    shown.push(stats.withheld?.shown);
    onDraw(stats);
  };
  const host = screen.getByTestId("wf-canvas-map");
  // An animation frame of the gesture: drawn at once, so the test sees each.
  const frame = () => act(() => renderer.draw());
  /** A drag of six moves, with the note after each frame; `release: false` loses its release. */
  async function pan(release = true) {
    const during: (string | undefined)[] = [];
    fireEvent.pointerDown(host, { clientX: 600, clientY: 400, button: 0, pointerId: 1 });
    for (let k = 1; k <= 6; k++) {
      fireEvent.pointerMove(host, { clientX: 600 + 10 * k, clientY: 400, pointerId: 1 });
      frame();
      during.push(note());
    }
    if (release) fireEvent.pointerUp(host, { clientX: 660, clientY: 400, button: 0, pointerId: 1 });
    return during;
  }
  /** Six turns of the wheel with Ctrl, zooming out around the centre, with the note after each frame. */
  async function zoom() {
    const during: (string | undefined)[] = [];
    for (let k = 0; k < 6; k++) {
      fireEvent.wheel(host, { clientX: 600, clientY: 400, deltaY: 10, ctrlKey: true });
      frame();
      during.push(note());
    }
    return during;
  }
  return { renderer, clock, shown, pan, zoom, host, reported };
}

describe("adaptive edge budget on the Canvas map", () => {
  it("changes the budget neither during a pan nor during a zoom, only once the view is at rest", async () => {
    const map = await mountMap(undefined);
    await waitFor(() => expect(note()).toBe("Showing 2,000 of 2,500 flows"));
    expect(await map.pan()).toEqual(Array(6).fill("Showing 2,000 of 2,500 flows"));
    // The drag ended: the next frame draws with one step less.
    await waitFor(() => expect(note()).toBe("Showing 1,000 of 2,500 flows"));
    expect(await map.zoom()).toEqual(Array(6).fill("Showing 1,000 of 2,500 flows"));
    // The wheel gesture ends 200 ms after its last turn.
    expect(note()).toBe("Showing 1,000 of 2,500 flows");
    await waitFor(() => expect(note()).toBe("Showing 500 of 2,500 flows"), { timeout: 2000 });
    expect(map.clock).toHaveBeenCalled();
  });

  it("ends a drag whose release was lost at the next press", async () => {
    const map = await mountMap(undefined);
    await map.pan(false);
    await act(() => new Promise((done) => setTimeout(done, 50)));
    expect(note()).toBe("Showing 2,000 of 2,500 flows");
    fireEvent.pointerDown(map.host, { clientX: 600, clientY: 400, button: 0, pointerId: 2 });
    await waitFor(() => expect(note()).toBe("Showing 1,000 of 2,500 flows"));
  });

  it("reports the edges of the new step to the host, which an export then draws with the note", async () => {
    const { pan, reported } = await mountMap("adaptive");
    await waitFor(() => expect(note()).toBe("Showing 2,000 of 2,500 flows"));
    expect(reported).toEqual([expect.objectContaining({ total: 2500 })]);
    expect(reported[0]!.edges).toHaveLength(2000);
    await pan();
    await waitFor(() => expect(note()).toBe("Showing 1,000 of 2,500 flows"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    // Told once per step; the 1,000 heaviest are h->t1 … h->t1000 (counts 2,500 … 1,501).
    expect(reported).toHaveLength(2);
    const last = reported[1]!;
    expect(last.total).toBe(2500);
    expect(last.edges).toEqual(Array.from({ length: 1000 }, (_, k) => `h->t${k + 1}`));
    const svg = toSVG(large, { edgeBudget: last });
    expect(svg.match(/<g class="wf-edge" /g)).toHaveLength(1000);
    expect(svg).toMatch(/class="wf-edge-note"[^>]*>Showing 1,000 of 2,500 flows</);
  });

  it("steps up after a gesture of fast frames", async () => {
    const map = await mountMap("adaptive", 2);
    await map.pan();
    // 4,000 covers the 2,500 edges in view: the note goes.
    await waitFor(() => expect(note()).toBeUndefined());
  });

  it("reads no clock with a fixed number or all", async () => {
    for (const edgeBudget of [2000, "all"] as const) {
      const map = await mountMap(edgeBudget);
      await map.pan();
      await map.zoom();
      await act(() => new Promise((done) => setTimeout(done, 300)));
      expect(map.clock).not.toHaveBeenCalled();
      expect(note()).toBe(edgeBudget === "all" ? undefined : "Showing 2,000 of 2,500 flows");
      cleanup();
    }
  });

  it("applies a change in one frame, without animation, when reduced motion is asked for", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList,
    );
    const map = await mountMap(undefined);
    await map.pan();
    const ended = map.shown.length;
    await waitFor(() => expect(note()).toBe("Showing 1,000 of 2,500 flows"));
    // The first frame after the gesture draws the new budget in full; there is no frame in between.
    expect(map.shown.slice(ended)[0]).toBe(1000);
    expect(new Set(map.shown.slice(ended))).toEqual(new Set([1000]));
  });
});

describe("adaptive edge budget as the default of the maps", () => {
  it("starts at 2,000 on the Canvas map of ProcessMap", async () => {
    quietCanvas();
    render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={large.graph} positions={large.positions} renderer="canvas" controls={false} legend={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(note()).toBe("Showing 2,000 of 2,500 flows"));
  });

  it("keeps its first step, 2,000, on the React Flow map, and a view switcher passes a fixed budget on", async () => {
    quietCanvas();
    // 2,050 paths between two activities.
    const nodes: FlowNode[] = [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }];
    const edges: FlowEdge[] = Array.from({ length: 2050 }, (_, k) => ({ id: `e${k}`, kind: "follows", source: "a", target: "b", metrics: { count: 1 + k } }));
    const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 100, height: 40 }, b: { x: 300, y: 0, width: 100, height: 40 } }, groups: {}, edges: {} }, "dagre", "RIGHT");
    const graph: FlowGraph = { nodes, edges };
    const { container, unmount } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={positions} renderer="svg" controls={false} legend={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(2000));
    expect(note()).toBe("Showing 2,000 of 2,050 flows");
    unmount();
    const views = resolveViews(graph, [{ id: "v", label: "V" }], positions);
    const switched = render(
      <div style={{ width: 1200, height: 800 }}>
        <ViewSwitcher views={views} edgeBudget={3} legend={false} />
      </div>,
    );
    // 2,052 activities plus paths: the view's map draws on Canvas.
    await waitFor(() => expect(note()).toBe("Showing 3 of 2,050 flows"));
    expect(switched.container.querySelector(".wf-canvas-map")).not.toBeNull();
  });
});
