/**
 * The view a map opens at, on the React map and the Canvas map, in a view of
 * 1,400 × 900 with the panels where a browser puts them (`panels.ts`): the
 * whole log at the default setting opens at 0.75 on its start with the
 * overview, one vendor and the whole log at 50 % open fitted; no panel covers
 * an activity; the overview marks the view and moves it by pointer and
 * keyboard; a view the person moved stays when a control changes, a new graph
 * opens again.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { type AbstractOptions, type Box, type FlowGraph, type Positions, abstract, layout } from "../../src/index";
import { createRef } from "react";
import { CanvasMap, type CanvasMapHandle, ProcessMap } from "../../src/react/index";
import { prepareScene } from "../../src/canvas/index";
import { type PanelSizes, browserBoxes, panelBox } from "./panels";

const AREA = { width: 1400, height: 900 };
/** The detail panel, the zoom control and the legend's strip, about as large as in a browser. */
const PANELS: PanelSizes = { "top-left": { width: 330, height: 300 }, "bottom-left": { width: 150, height: 44 }, "bottom-right": { width: 440, height: 44 } };
const DEFAULT: AbstractOptions = { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true };
const HALF: AbstractOptions = { minNodeShare: 0.5, minEdgeShare: 0.5, keepConnected: true };
type Renderer = "svg" | "canvas";

const laid = new Map<string, Promise<Positions>>();
const positionsOf = (graph: FlowGraph, options: AbstractOptions) => {
  const key = `${graph === globalScene ? "global" : "vendor"} ${JSON.stringify(options)}`;
  if (!laid.has(key)) laid.set(key, layout(abstract(graph, options)));
  return laid.get(key)!;
};

let restore = () => {};
// jsdom has no pointer events; the overview listens to them.
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
beforeAll(async () => {
  await Promise.all([positionsOf(globalScene, DEFAULT), positionsOf(vendorScene, HALF), positionsOf(globalScene, HALF)]);
}, 60_000);
afterEach(() => {
  restore();
  cleanup();
  vi.restoreAllMocks();
});

/** Records the view of the Canvas map's last frame: the drawing translates by (x, y) and scales by the zoom. */
function recordCanvas() {
  const view = { x: NaN, y: NaN, zoom: NaN };
  const noop = () => {};
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 6 }), createPattern: () => null } as Record<string, unknown>, {
    get: (target, key: string) => target[key] ?? (key === "translate" ? (x: number, y: number) => void Object.assign(view, { x, y }) : key === "scale" ? (zoom: number) => void (view.zoom = zoom) : noop),
    set: () => true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return view;
}

/** Mounts a map and returns how to read its view, after the map opened. */
async function mount(renderer: Renderer, graph: FlowGraph, options: AbstractOptions, extra: Partial<React.ComponentProps<typeof ProcessMap>> = {}) {
  restore = browserBoxes(AREA, PANELS);
  const recorded = renderer === "canvas" ? recordCanvas() : undefined;
  const positions = await positionsOf(graph, options);
  const element = (g: FlowGraph, o: AbstractOptions, placed = positions) => (
    <div style={{ width: AREA.width, height: AREA.height }}>
      <ProcessMap graph={g} abstraction={o} positions={placed} renderer={renderer} edgeBudget="all" {...extra} />
    </div>
  );
  const result = render(element(graph, options));
  const view = () => {
    if (recorded) return { ...recorded };
    const m = result.container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
  };
  // The map opens 50 and 400 ms after its nodes render (the Canvas map at once): let both pass.
  await act(() => new Promise((done) => setTimeout(done, 600)));
  return { ...result, positions, view, element };
}

const screenBox = (b: Box, v: { x: number; y: number; zoom: number }): Box => ({ x: b.x * v.zoom + v.x, y: b.y * v.zoom + v.y, width: b.width * v.zoom, height: b.height * v.zoom });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const panelBoxes = () => Object.entries(PANELS).map(([corner, size]) => panelBox(corner as keyof PanelSizes, size!, AREA));
const overview = () => screen.queryByRole("application", { name: "Overview of the map" });
const overviewBox = (el: HTMLElement): Box => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height) });
/** The activities a panel or the overview covers on the screen. */
function covered(graph: FlowGraph, positions: Positions, v: { x: number; y: number; zoom: number }): string[] {
  const panels = [...panelBoxes(), ...(overview() ? [overviewBox(overview()!)] : [])];
  return graph.nodes.filter((n) => n.kind === "activity" && positions.nodes[n.id] && panels.some((p) => overlaps(screenBox(positions.nodes[n.id], v), p))).map((n) => n.id);
}

describe.each(["svg", "canvas"] as const)("the %s map opens", (renderer) => {
  it("the whole log at the default setting at 0.75 on its start, with the overview, no panel over an activity", async () => {
    const { positions, view } = await mount(renderer, globalScene, DEFAULT);
    const v = view();
    expect(v.zoom).toBe(0.75);
    // The start 8 inside the free area's left edge: the area's (0) or the detail panel's right edge and its gap (12 + 330 + 8).
    const start = screenBox(positions.nodes.__start, v);
    expect([8, 358].map((x) => Math.abs(start.x - x) < 1e-6)).toContain(true);
    expect(covered(globalScene, positions, v)).toEqual([]);
    // The overview in the top right corner, the one no panel occupies, marking the view in the map's units.
    const shown = overview()!;
    expect(shown).not.toBeNull();
    expect(panelBoxes().some((p) => overlaps(overviewBox(shown), p))).toBe(false);
    expect(overviewBox(shown).x + overviewBox(shown).width).toBe(AREA.width - 8);
    const marked = within(shown).getByTestId("wf-overview-view");
    for (const [name, value] of [["x", -v.x / v.zoom], ["y", -v.y / v.zoom], ["width", AREA.width / v.zoom], ["height", AREA.height / v.zoom]] as const) expect(Number(marked.getAttribute(name)), name).toBeCloseTo(value, 6);
    expect(shown.getAttribute("aria-describedby")).toBeTruthy();
    expect(shown.tabIndex).toBe(0);
  });

  it.each([
    ["one vendor at 50 %", vendorScene],
    ["the whole log at 50 %", globalScene],
  ] as const)("%s fitted, without the overview, no panel over an activity", async (_, graph) => {
    const { positions, view } = await mount(renderer, graph, HALF);
    const v = view();
    expect(v.zoom).toBeGreaterThanOrEqual(0.75);
    expect(overview()).toBeNull();
    // The whole map is in view.
    for (const box of Object.values(positions.nodes)) {
      const s = screenBox(box, v);
      expect(s.x >= 0 && s.y >= 0 && s.x + s.width <= AREA.width && s.y + s.height <= AREA.height).toBe(true);
    }
    expect(covered(graph, positions, v)).toEqual([]);
  });

  it("asked for the plain fit, the whole log fitted below 0.75 without the overview", async () => {
    const { view } = await mount(renderer, globalScene, DEFAULT, { opening: "fit" });
    expect(view().zoom).toBeLessThan(0.75);
    expect(overview()).toBeNull();
  });

  it("moves the view with the overview: a click centres it, the arrow keys move it by a tenth of what is in view", async () => {
    const { positions, view } = await mount(renderer, globalScene, DEFAULT);
    const shown = overview()!;
    const box = overviewBox(shown);
    // The map's bounds as the overview shows them (its view box): the nodes' for React Flow, the scene's on the Canvas map.
    const [bx, by, bw, bh] = shown.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(bw * bh).toBeGreaterThanOrEqual(positions.bounds.width * positions.bounds.height * 0.9);
    const bounds = { x: bx, y: by, width: bw, height: bh };
    const centre = () => {
      const v = view();
      return { x: (AREA.width / 2 - v.x) / v.zoom, y: (AREA.height / 2 - v.y) / v.zoom };
    };
    // A click at three quarters of the overview's width and half its height: that point of the map comes to the centre.
    await act(async () => {
      fireEvent.pointerDown(shown, { button: 0, clientX: box.x + box.width * 0.75, clientY: box.y + box.height / 2, pointerId: 1 });
      fireEvent.pointerUp(shown, { pointerId: 1 });
    });
    await waitFor(() => expect(centre().x).toBeCloseTo(bounds.x + bounds.width * 0.75, 3));
    expect(centre().y).toBeCloseTo(bounds.y + bounds.height / 2, 3);
    expect(view().zoom).toBe(0.75);
    // A drag follows the pointer.
    await act(async () => {
      fireEvent.pointerDown(shown, { button: 0, clientX: box.x + box.width * 0.25, clientY: box.y + box.height / 2, pointerId: 2 });
      fireEvent.pointerMove(shown, { clientX: box.x + box.width * 0.5, clientY: box.y + box.height / 2, pointerId: 2 });
      fireEvent.pointerUp(shown, { pointerId: 2 });
    });
    await waitFor(() => expect(centre().x).toBeCloseTo(bounds.x + bounds.width * 0.5, 3));
    // ArrowRight: a tenth of the 1,400 / 0.75 in view; ArrowUp: a tenth of the 900 / 0.75.
    const before = centre();
    act(() => void fireEvent.keyDown(shown, { key: "ArrowRight" }));
    await waitFor(() => expect(centre().x).toBeCloseTo(before.x + AREA.width / 0.75 / 10, 3));
    act(() => void fireEvent.keyDown(shown, { key: "ArrowUp" }));
    await waitFor(() => expect(centre().y).toBeCloseTo(before.y - AREA.height / 0.75 / 10, 3));
    // The marked part follows the view.
    const v = view();
    expect(Number(within(shown).getByTestId("wf-overview-view").getAttribute("x"))).toBeCloseTo(-v.x / v.zoom, 6);
  });

  it("keeps a view the person moved when a control changes, and opens again for a new graph", async () => {
    const mounted = await mount(renderer, globalScene, DEFAULT);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await act(() => new Promise((done) => setTimeout(done, 300)));
    const moved = mounted.view();
    expect(moved.zoom).toBeGreaterThan(0.75);
    // Another setting, laid out alike: the view stays.
    mounted.rerender(mounted.element(globalScene, { ...DEFAULT, minEdgeShare: 0.05 }));
    await act(() => new Promise((done) => setTimeout(done, 600)));
    expect(mounted.view().zoom).toBe(moved.zoom);
    // A new graph (the same log, another object): it opens again.
    mounted.rerender(mounted.element(structuredClone(globalScene), DEFAULT));
    await act(() => new Promise((done) => setTimeout(done, 600)));
    expect(mounted.view().zoom).toBe(0.75);
    expect(overview()).not.toBeNull();
  });

  it("keeps the overview around the whole map when controls rearrange a moved view", async () => {
    const mounted = await mount(renderer, globalScene, DEFAULT);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await act(() => new Promise((done) => setTimeout(done, 300)));
    const before = overview()!.querySelector("svg")!.getAttribute("viewBox");
    const positions = { ...mounted.positions, nodes: { ...mounted.positions.nodes, __end: { ...mounted.positions.nodes.__end, x: mounted.positions.nodes.__end.x + 2000 } }, bounds: { ...mounted.positions.bounds, width: mounted.positions.bounds.width + 2000 } };
    mounted.rerender(mounted.element(globalScene, DEFAULT, positions));
    await act(() => new Promise((done) => setTimeout(done, 600)));
    expect(overview()!.querySelector("svg")!.getAttribute("viewBox")).not.toBe(before);
    const [x, , width] = overview()!.querySelector("svg")!.getAttribute("viewBox")!.split(" ").map(Number);
    expect(x + width).toBeGreaterThanOrEqual(positions.nodes.__end.x + positions.nodes.__end.width);
    expect(mounted.view().zoom).toBeGreaterThan(0.75);
  });

  it("shows the whole map with the fit button, and fits it again rather than opening it when a control changes", async () => {
    const mounted = await mount(renderer, globalScene, DEFAULT);
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    await act(() => new Promise((done) => setTimeout(done, 300)));
    const fitted = mounted.view();
    expect(fitted.zoom).toBeLessThan(0.75);
    mounted.rerender(mounted.element(globalScene, { ...DEFAULT, minEdgeShare: 0.05 }));
    await act(() => new Promise((done) => setTimeout(done, 600)));
    expect(mounted.view().zoom).toBeLessThan(0.75);
  });
});


describe("a standalone Canvas map", () => {
  it("opens without layout keys, keeps a move on scene refresh, and reopens for a replacement graph or openKey", async () => {
    restore = browserBoxes(AREA, PANELS);
    recordCanvas();
    const graph: FlowGraph = {
      nodes: [{ id: "s", kind: "event", label: "Start", tags: ["start"] }, { id: "a", kind: "activity", label: "A" }, { id: "e", kind: "event", label: "End", tags: ["end"] }],
      edges: [{ id: "sa", kind: "follows", source: "s", target: "a" }, { id: "ae", kind: "follows", source: "a", target: "e" }],
    };
    const positions: Positions = { nodes: { s: { x: 0, y: 0, width: 36, height: 36 }, a: { x: 200, y: 0, width: 180, height: 64 }, e: { x: 4000, y: 0, width: 36, height: 36 } }, edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 4036, height: 64 }, engine: "given", direction: "RIGHT" };
    const ref = createRef<CanvasMapHandle>();
    const element = (g = graph, openKey?: number, fitView = true) => <CanvasMap ref={ref} scene={prepareScene(g, positions)} state={{ selection: { nodes: [], edges: [], groups: [] } }} openKey={openKey} fitView={fitView} />;
    const mounted = render(element());
    const zoom = () => ref.current!.renderer()!.getViewport().zoom;
    await waitFor(() => expect(zoom()).toBe(0.75));
    const capture = vi.fn();
    const host = mounted.container.querySelector<HTMLElement>(".wf-canvas-map")!;
    host.setPointerCapture = capture;
    fireEvent.pointerDown(screen.getByRole("button", { name: "Zoom in" }), { button: 0, pointerId: 3 });
    expect(capture).not.toHaveBeenCalled();
    act(() => ref.current!.zoomBy(1.2));
    const moved = ref.current!.renderer()!.getViewport();
    mounted.rerender(element());
    expect(ref.current!.renderer()!.getViewport()).toEqual(moved);
    mounted.rerender(element(structuredClone(graph)));
    await waitFor(() => expect(zoom()).toBe(0.75));
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    expect(zoom()).toBeLessThan(0.75);
    mounted.rerender(element(graph, 1));
    await waitFor(() => expect(zoom()).toBe(0.75));
    act(() => ref.current!.zoomBy(1.2));
    mounted.rerender(element(graph, 2, false));
    expect(zoom()).toBeCloseTo(0.9);
  });
});


it("keeps an early move while React Flow is still measuring its nodes", async () => {
  restore = browserBoxes(AREA, PANELS);
  const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }], edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }] };
  const positions: Positions = { nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 4000, y: 0, width: 180, height: 64 } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 4180, height: 64 }, engine: "given", direction: "RIGHT" };
  const { container } = render(<ProcessMap graph={graph} positions={positions} controls={false} legend={false} renderer="svg" />);
  const zoom = () => Number(container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/scale\(([-\d.e]+)\)/)![1]);
  await waitFor(() => expect(zoom()).toBe(0.75));
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  await act(() => new Promise((done) => setTimeout(done, 500)));
  expect(zoom()).toBeCloseTo(0.9);
});
