/**
 * The smallest zoom asked for as a readable level, the floored fit from the
 * start, an element brought into view at a host's request, the part of the
 * map in view said to the host, the panel and the overview, and `openKey`,
 * on the React map and the Canvas map of the whole BPIC log at 1,400 × 900
 * with the panels where a browser puts them (`panels.ts`).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useStore } from "@xyflow/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type AbstractOptions, type Box, type FlowGraph, type Positions, abstract, buildScene, layout, readableZoom } from "../../src/index";
import { type InView, ProcessMap } from "../../src/react/index";
import { type PanelSizes, browserBoxes } from "./panels";

const AREA = { width: 1400, height: 900 };
const PANELS: PanelSizes = { "bottom-left": { width: 150, height: 44 } };
const DEFAULT: AbstractOptions = { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true };
type Renderer = "svg" | "canvas";
type View = { x: number; y: number; zoom: number };

let graph: FlowGraph;
let positions: Positions;
/** The smallest zoom at which every card still shows its name on two lines, as the map derives it from its scene. */
let nameFloor: number;
beforeAll(async () => {
  graph = abstract(globalScene, DEFAULT);
  positions = await layout(graph);
  const scene = buildScene(graph, positions);
  nameFloor = readableZoom(scene.readable, scene.theme.text.minScreenPx, "name");
}, 60_000);

let restore = () => {};
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
afterEach(() => {
  restore();
  cleanup();
  vi.restoreAllMocks();
});

/** Records the view of the Canvas map's last frame. */
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

/** The smallest zoom React Flow holds, read from inside the map. */
let storedMinZoom = NaN;
function ReadMinZoom() {
  storedMinZoom = useStore((s) => s.minZoom);
  return null;
}

const settle = (ms = 700) => act(() => new Promise((done) => setTimeout(done, ms)));
const centreOf = (v: View) => ({ x: (AREA.width / 2 - v.x) / v.zoom, y: (AREA.height / 2 - v.y) / v.zoom });
const boxCentre = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overview = () => screen.queryByRole("application", { name: "Overview of the map" });

async function mount(renderer: Renderer, extra: Partial<React.ComponentProps<typeof ProcessMap>> = {}, area = AREA) {
  restore = browserBoxes(area, PANELS);
  const recorded = renderer === "canvas" ? recordCanvas() : undefined;
  const element = (more: Partial<React.ComponentProps<typeof ProcessMap>> = {}, g = graph) => (
    <div style={{ width: area.width, height: area.height }}>
      <ProcessMap graph={g} abstraction={DEFAULT} positions={positions} renderer={renderer} edgeBudget="all" controls={false} legend={false} {...extra} {...more}>
        {renderer === "svg" ? <ReadMinZoom /> : null}
      </ProcessMap>
    </div>
  );
  const result = render(element());
  const view = (): View => {
    if (recorded) return { ...recorded };
    const m = result.container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
  };
  await settle();
  return { ...result, view, element };
}

describe.each(["svg", "canvas"] as const)("the %s map with a readable smallest zoom", (renderer) => {
  it("derives the floor from its cards, never zooms below it, and fits from the start at it where the whole map does not fit", async () => {
    const { view } = await mount(renderer, { minZoom: { readable: "name" } });
    // The whole log fits at 0.32, under the floor of about 0.4: the map opens at 0.75 on its start all the same.
    expect(nameFloor).toBeGreaterThan(0.3);
    expect(nameFloor).toBeLessThan(0.75);
    expect(view().zoom).toBe(0.75);
    if (renderer === "svg") expect(storedMinZoom).toBeCloseTo(nameFloor, 9);
    // Zoomed out ten times by the button (÷ 1.2 each) the zoom stops at the floor.
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await settle(400);
    expect(view().zoom).toBeCloseTo(nameFloor, 6);
    // In this area the whole map fits above the floor: the fit button shows it whole.
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    await settle(400);
    expect(view().zoom).toBeGreaterThan(nameFloor);
  });

  it("fits from the start at the floor, with the overview, where the whole map does not fit at it", async () => {
    // Half the area: the whole map would fit at about 0.23, under the floor.
    const { view } = await mount(renderer, { minZoom: { readable: "name" } }, { width: 700, height: 450 });
    expect(view().zoom).toBe(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    await settle(400);
    const fitted = view();
    expect(fitted.zoom).toBeCloseTo(nameFloor, 6);
    // The start 8 inside the area's left edge, the reading edge.
    const start = positions.nodes.__start;
    expect(start.x * fitted.zoom + fitted.x).toBeCloseTo(8, 3);
    expect(overview()).not.toBeNull();
  });

  it("brings an element into view at a host's request, at its zoom but at least the floor, once the map has opened", async () => {
    const mounted = await mount(renderer, { minZoom: { readable: "name" } });
    const end = positions.nodes.__end;
    expect(centreOf(mounted.view())).not.toEqual(boxCentre(end));
    mounted.rerender(mounted.element({ bringIntoView: { element: { kind: "node", id: "__end" } } }));
    await settle();
    const moved = mounted.view();
    expect(moved.zoom).toBe(0.75);
    expect(centreOf(moved).x).toBeCloseTo(boxCentre(end).x, 3);
    expect(centreOf(moved).y).toBeCloseTo(boxCentre(end).y, 3);
    // An edge is brought to the middle of its route; the keyboard position follows a node or an edge.
    const edge = graph.edges.find((e) => positions.edges[e.id]?.points.length)!;
    mounted.rerender(mounted.element({ bringIntoView: { element: { kind: "edge", id: edge.id }, token: 2 } }));
    await settle();
    const route = positions.edges[edge.id].points;
    const middle = route.length % 2 ? route[Math.floor(route.length / 2)] : { x: (route[route.length / 2 - 1].x + route[route.length / 2].x) / 2, y: (route[route.length / 2 - 1].y + route[route.length / 2].y) / 2 };
    expect(centreOf(mounted.view()).x).toBeCloseTo(middle.x, 3);
    expect(centreOf(mounted.view()).y).toBeCloseTo(middle.y, 3);
    expect(mounted.container.querySelector(".wf-process-map")!.getAttribute("aria-activedescendant")).toBe(`wf-edge-${edge.id}`);
    // The same request again asks nothing; a new token asks again after the view moved.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await settle(400);
    const zoomed = mounted.view();
    expect(zoomed.zoom).toBeGreaterThan(0.75);
    mounted.rerender(mounted.element({ bringIntoView: { element: { kind: "node", id: "__end" }, token: 3 } }));
    await settle();
    expect(mounted.view().zoom).toBe(zoomed.zoom);
    expect(centreOf(mounted.view()).x).toBeCloseTo(boxCentre(end).x, 3);
  });
});

describe("what the view shows", () => {
  it("is told to the host when the view rests on another part, and said by the panel and the overview while part of the map is out of view", async () => {
    const told: InView[] = [];
    const mounted = await mount("svg", { minZoom: { readable: "name" }, controls: true, onInView: (shown) => void told.push(shown) });
    const last = () => told[told.length - 1];
    // Opened at 0.75 on the start, part of the whole log is out of view.
    expect(told.length).toBeGreaterThan(0);
    expect(last()).toMatchObject({ zoom: 0.75, minZoom: nameFloor, whole: false });
    expect(last().nodes).toBeGreaterThan(0);
    expect(last().nodes).toBeLessThan(last().ofNodes);
    expect(last().ofNodes).toBe(graph.nodes.filter((n) => n.kind === "activity").length);
    expect(last().edges).toBeLessThan(last().ofEdges);
    const said = `${last().nodes} of ${last().ofNodes} activities and ${last().edges} of ${last().ofEdges.toLocaleString("en")} paths in view`;
    expect(screen.getByTestId("wf-in-view").textContent).toBe(said);
    expect(within(overview()!).getByTestId("wf-overview-in-view").textContent).toBe(said);
    expect(overview()!.getAttribute("aria-describedby")).toContain(within(overview()!).getByTestId("wf-overview-in-view").id);
    // Brought to the end of the process, the view rests on another part: the host is told once, and the panel follows.
    const before = told.length;
    mounted.rerender(mounted.element({ bringIntoView: { element: { kind: "node", id: "__end" } } }));
    await settle();
    expect(told.length).toBe(before + 1);
    expect(last().nodes).toBeGreaterThan(0);
    expect(screen.getByTestId("wf-in-view").textContent).toContain(`${last().nodes} of ${last().ofNodes} activities`);
    // Fitted without a floor the whole map is in view, and the panel says nothing of it.
    mounted.rerender(mounted.element({ minZoom: undefined, bringIntoView: { element: { kind: "node", id: "__end" } } }));
    await settle(300);
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    await settle();
    expect(last().whole).toBe(true);
    expect(last().minZoom).toBe(0.05);
    expect(screen.queryByTestId("wf-in-view")).toBeNull();
  });

  it("opens the map again for a new openKey, and keeps the view for a replaced graph under the same key", async () => {
    const mounted = await mount("svg", { openKey: "first" });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await settle(400);
    const zoomed = mounted.view().zoom;
    expect(zoomed).toBeGreaterThan(0.75);
    // The same log as another object, the key unchanged: the view stays.
    mounted.rerender(mounted.element({ openKey: "first" }, structuredClone(graph)));
    await settle();
    expect(mounted.view().zoom).toBe(zoomed);
    // Another key: the map opens again on its start.
    mounted.rerender(mounted.element({ openKey: "second" }));
    await settle();
    expect(mounted.view().zoom).toBe(0.75);
    await waitFor(() => expect(overview()).not.toBeNull());
  });
});
