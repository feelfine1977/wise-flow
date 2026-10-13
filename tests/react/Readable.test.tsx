/**
 * Readable at every zoom in the DOM map and the Canvas map of the BPIC
 * fixture: no text under the floor at any zoom from 0.1 to 2 (the DOM read as
 * the stylesheet draws it, `map-reading.ts`), one write of the map's root per
 * zoom change and no card's box moved, a card without text labelled on hover
 * and to assistive technology, and the DOM map and the Canvas map at the same
 * level at the same zoom.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useReactFlow } from "@xyflow/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import type { DrawContext, DrawOptions, PreparedScene, View } from "../../src/canvas/index";
import { type FlowGraph, type Positions, type Readable, abstract, buildScene, layout, overlaysFor, readableAt } from "../../src/index";
import { CanvasMap, type CanvasMapHandle, ProcessMap } from "../../src/react/index";
import { MIN_TEXT_PX } from "../support/reading";
import { readReactMap } from "./map-reading";

/** The frames the Canvas map draws: the view and the readable state each was drawn in. */
const frames = vi.hoisted(() => [] as { view: View; readable: Readable }[]);
vi.mock(import("../../src/canvas/draw"), async (original) => {
  const module = await original();
  return {
    ...module,
    drawScene: (ctx: DrawContext, scene: PreparedScene, view: View, state?: Parameters<typeof module.drawScene>[3], options?: DrawOptions) => {
      const out = module.drawScene(ctx, scene, view, state, options);
      frames.push({ view, readable: out.readable });
      return out;
    },
  };
});

afterEach(() => {
  cleanup();
  frames.length = 0;
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

/** A 2D context that draws nothing. */
const nothing = () => new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createLinearGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => undefined), set: (t, k: string, v) => ((t[k] = v), true) });

let graph: FlowGraph;
let positions: Positions;
beforeAll(async () => {
  const shown = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
  graph = { ...shown, overlays: overlaysFor(constraintItems(), { graph: shown }) };
  positions = await layout(graph, { engine: "dagre" });
});

/** The zooms 2, 1.95, … 0.1 and back up. */
const ZOOMS = Array.from({ length: 39 }, (_, i) => Number((2 - i * 0.05).toFixed(2)));
const SWEEP = [...ZOOMS, ...ZOOMS.slice(0, -1).reverse()];

let setZoom: (zoom: number) => void = () => {};
/** Sets the DOM map's zoom from inside React Flow. */
function Zoom() {
  const rf = useReactFlow();
  setZoom = (zoom) => void rf.setViewport({ x: 0, y: 0, zoom });
  return null;
}

async function domMap() {
  const view = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} controls={false} legend={false} contextMenu={false} pathList={false}>
        <Zoom />
      </ProcessMap>
    </div>,
  );
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node").length).toBe(graph.nodes.length + (graph.groups?.length ?? 0)));
  const root = view.container.querySelector<HTMLElement>(".wf-process-map")!;
  const zoomTo = (zoom: number) => act(() => setZoom(zoom));
  return { ...view, root, zoomTo };
}

/** The level the root's classes say ("plain": the full level unboosted), and its rung. */
const rootLevel = (root: Element) => {
  const classes = [...root.classList];
  const level = classes.find((c) => c.startsWith("wf-text--"))!.slice(9);
  return { level: level === "plain" ? "full" : level, step: Number(classes.find((c) => /^wf-text-f\d+$/.test(c))?.slice(9)) };
};

describe("the DOM map of the BPIC fixture", () => {
  it("draws no text smaller than 9 px on the screen at any zoom from 0.1 to 2 in steps of 0.05, zooming out and in, at the level and boost the core decides", async () => {
    const { container, root, zoomTo } = await domMap();
    // The same decision, from the same sequence of zooms, with the rules of the map's scene: the classes the root carries.
    const { readable: rules } = buildScene(graph, positions, {});
    let expected: Readable | undefined;
    for (const zoom of SWEEP) {
      zoomTo(zoom);
      expected = readableAt(rules, zoom, 9, expected);
      expect(rootLevel(root), `zoom ${zoom}`).toEqual({ level: expected.level, step: expected.step });
      const { fitted } = readReactMap(container);
      expect(fitted.zoom).toBeCloseTo(zoom, 9);
      const small = fitted.texts.filter((t) => t.size * zoom < MIN_TEXT_PX - 1e-9).map((t) => `${t.role} "${t.text}" ${(t.size * zoom).toFixed(2)} px`);
      expect(small, `zoom ${zoom}`).toEqual([]);
    }
  }, 60_000);

  it("writes one style per zoom change, its root's classes, and none of a card: no box or position changes", async () => {
    const { container, root, zoomTo } = await domMap();
    zoomTo(2);
    const boxes = () => [...container.querySelectorAll<HTMLElement>(".react-flow__node")].map((n) => [n.getAttribute("data-id"), n.style.transform, n.style.width, n.style.height, n.querySelector<HTMLElement>(".wf-node")?.style.width, n.querySelector<HTMLElement>(".wf-node")?.style.height].join(" "));
    const before = boxes();
    const seen: MutationRecord[] = [];
    const observer = new MutationObserver((records) => void seen.push(...records));
    observer.observe(container, { attributes: true, childList: true, subtree: true, characterData: true });
    let changes = 0;
    for (const zoom of SWEEP.slice(1)) {
      const was = root.className;
      zoomTo(zoom);
      await act(async () => void (await new Promise((done) => setTimeout(done, 0))));
      // What is written to elements' styles and classes. React Flow moves its viewport (that is the zoom) and the zoom
      // control shows the zoom; marks still come and go at their own zoom (`minZoom`), as elements, not as styles.
      const records = [...seen.splice(0), ...observer.takeRecords()].filter((r) => r.type === "attributes" && (r.attributeName === "style" || r.attributeName === "class"));
      const ours = records.filter((r) => !(r.target as Element).classList.contains("react-flow__viewport") && !(r.target as Element).closest(".wf-zoom"));
      expect(ours.map((r) => `${r.type} ${r.attributeName} ${(r.target as Element).className}`), `zoom ${zoom}`).toEqual(root.className === was ? [] : [`attributes class ${root.className}`]);
      if (root.className !== was) changes++;
      expect(boxes(), `zoom ${zoom}`).toEqual(before);
    }
    observer.disconnect();
    // The rung moves every few steps: the root was written, once each time, on many of the 76 changes.
    expect(changes).toBeGreaterThan(20);
  }, 60_000);

  it("gives a card without text its name as its hover title and its accessible name", async () => {
    const { container, root, zoomTo } = await domMap();
    zoomTo(0.2);
    expect(rootLevel(root).level).toBe("box");
    const wrapper = container.querySelector<HTMLElement>('.react-flow__node[data-id="record_goods_receipt"]')!;
    const card = wrapper.querySelector(".wf-node")!;
    // The stylesheet shows no block of texts at the box level; the card keeps its title and the node its label.
    expect(card.getAttribute("title")).toContain("Record Goods Receipt");
    expect(wrapper.getAttribute("aria-label")).toContain("Record Goods Receipt");
    expect(readReactMap(container).fitted.texts.filter((t) => t.owner === "record_goods_receipt")).toEqual([]);
  });
});

describe("the Canvas map of the BPIC fixture", () => {
  it("shows a card without text its name in the tooltip on hover and lists it for assistive technology", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => nothing() as unknown as CanvasRenderingContext2D);
    const { container, getByRole } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={graph} positions={positions} renderer="canvas" edgeBudget="all" controls={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    // Out to the box level with the zoom control.
    const out = getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 12 && frames.at(-1)!.readable.level !== "box"; i++) {
      fireEvent.click(out);
      await waitFor(() => expect(frames.at(-1)!.view.zoom).toBeLessThan(frames.at(-2)?.view.zoom ?? Infinity));
    }
    const { view, readable } = frames.at(-1)!;
    expect(readable.level).toBe("box");
    // The middle of Record Goods Receipt's card on the screen.
    const box = positions.nodes.record_goods_receipt;
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerMove(canvas, { clientX: view.x + (box.x + box.width / 2) * view.zoom, clientY: view.y + (box.y + box.height / 2) * view.zoom, pointerId: 1 });
    await waitFor(() => expect(container.querySelector(".wf-canvas-map__tooltip")?.textContent).toContain("Record Goods Receipt"));
    expect([...container.querySelectorAll("[aria-label]")].some((el) => el.getAttribute("aria-label")!.startsWith("Record Goods Receipt"))).toBe(true);
  });
});

describe("the DOM map and the Canvas map", () => {
  it("choose the same level at the same zoom", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => nothing() as unknown as CanvasRenderingContext2D);
    const { root, zoomTo } = await domMap();
    const { prepareScene } = await import("../../src/canvas/index");
    let handle: CanvasMapHandle | null = null;
    render(
      <div style={{ width: 1200, height: 800 }}>
        <CanvasMap ref={(h) => void (handle = h)} scene={prepareScene(graph, positions, {})} state={{ selection: { nodes: [], edges: [], groups: [] } }} fitView={false} edgeBudget="all" />
      </div>,
    );
    await waitFor(() => expect(handle?.renderer()).toBeTruthy());
    const renderer = handle!.renderer()!;
    const found: string[] = [];
    // Three zooms on the way out, one at each level below the full one: the name (0.5), its one line (0.35), the box (0.2).
    for (const zoom of [0.5, 0.35, 0.2]) {
      zoomTo(zoom);
      act(() => renderer.setViewport({ x: 0, y: 0, zoom }));
      renderer.draw();
      const canvas = renderer.lastDraw!.readable;
      expect(rootLevel(root), `zoom ${zoom}`).toEqual({ level: canvas.level, step: canvas.step });
      found.push(canvas.level);
    }
    expect(found).toEqual(["name", "line", "box"]);
  });
});
