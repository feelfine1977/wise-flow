import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowGraph, abstract, createPositions, layout, overlaysFor } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A 2D context that records the texts of the last frame with the font they were drawn in. */
function textRecorder() {
  let texts: { text: string; font: string; align: string; fill: string }[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", lineJoin: "miter", lineCap: "butt",
    save: noop, restore: noop, translate: noop, scale: noop, setTransform: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, fillRect: noop, strokeText: noop, setLineDash: noop,
    createPattern: () => null,
    // Every frame starts by clearing the canvas.
    clearRect() {
      texts = [];
    },
    fillText(text: string) {
      texts.push({ text, font: ctx.font, align: ctx.textAlign, fill: ctx.fillStyle });
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  return { ctx, frame: () => texts };
}

const vendor = abstract(vendorScene, { minEdgeShare: 0.02 });
const constraints = overlaysFor(constraintItems(vendorSceneKey), { graph: vendor });

describe("ProcessMap with the Canvas renderer", () => {
  it("draws every graph overlay once", async () => {
    const positions = await layout(vendor, { engine: "dagre" });
    const graph: FlowGraph = { ...vendor, overlays: constraints };
    const nodes = new Set(vendor.nodes.map((n) => n.id));
    const expected = constraints.filter((o) => o.kind === "badge" && nodes.has(o.target)).map((o) => String(o.payload?.glyph)).sort();
    expect(expected.length).toBeGreaterThan(0);
    const recorder = textRecorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recorder.ctx as unknown as CanvasRenderingContext2D);
    render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={positions} renderer="canvas" edgeBudget="all" lod={{ badges: 0 }} controls={false} legend={false} />
      </div>,
    );
    // The bold 10 px centred text is what the drawing routines write into a badge (a chip's bold label starts left).
    const badges = () => recorder.frame().filter((t) => t.font.startsWith("700 10px") && t.align === "center").map((t) => t.text).sort();
    await waitFor(() => expect(badges().length).toBeGreaterThan(0));
    expect(badges()).toEqual(expected);
  });
});

describe("the live Canvas map and the theme", () => {
  // jsdom resolves custom properties only on the element a rule matches, so the theme rules name the map's host.
  const theme = document.createElement("style");
  theme.textContent = [
    '.wf-canvas-map { --wf-ink: #1f1f1f; --wf-paper: #ffffff; }',
    ':root[data-theme="dark"] .wf-canvas-map { --wf-ink: #ececec; --wf-paper: #16181d; }',
  ].join("\n");

  afterEach(() => {
    theme.remove();
    delete document.documentElement.dataset.theme;
  });

  async function mount() {
    document.head.appendChild(theme);
    const positions = await layout(vendor, { engine: "dagre" });
    const recorder = textRecorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recorder.ctx as unknown as CanvasRenderingContext2D);
    const view = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={vendor} positions={positions} renderer="canvas" edgeBudget="all" controls={false} legend={false} />
      </div>,
    );
    const host = () => view.container.querySelector(".wf-canvas-map") as HTMLElement;
    // Node labels are drawn in the ink paint.
    const labels = () => recorder.frame().filter((t) => t.text === "Record Goods Receipt").map((t) => t.fill);
    await waitFor(() => expect(labels()).toEqual(["#1f1f1f"]));
    return { host, labels, view };
  }

  it("redraws in the new ink when the document switches its theme attribute", async () => {
    const { labels } = await mount();
    document.documentElement.dataset.theme = "dark";
    await waitFor(() => expect(labels()).toEqual(["#ececec"]));
    delete document.documentElement.dataset.theme;
    await waitFor(() => expect(labels()).toEqual(["#1f1f1f"]));
  });

  it("redraws when the colour scheme of the system changes", async () => {
    const listeners: (() => void)[] = [];
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: (_: string, l: () => void) => query.includes("color-scheme") && listeners.push(l),
      removeEventListener: (_: string, l: () => void) => listeners.includes(l) && listeners.splice(listeners.indexOf(l), 1),
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    }) as unknown as MediaQueryList);
    const { labels, view } = await mount();
    expect(listeners.length).toBe(1);
    // A scheme change shows in the computed variables only; jsdom does not evaluate the media query, so a rule
    // added to the theme stands in for it. No attribute changes, so only the media query's listener can redraw.
    theme.textContent += "\n.wf-canvas-map { --wf-ink: #dddddd; }";
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(labels()).toEqual(["#1f1f1f"]);
    listeners.forEach((l) => l());
    await waitFor(() => expect(labels()).toEqual(["#dddddd"]));
    view.unmount();
    expect(listeners.length).toBe(0);
  });
});

describe("pointer hits on the Canvas map", () => {
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

  it("selects the activity under the pointer inside a tinted stage, not the stage", async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "g", metrics: { cases: 4 } },
        { id: "b", kind: "activity", label: "B", group: "g", metrics: { cases: 4 } },
      ],
      edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 4 } }],
      groups: [{ id: "g", kind: "stage", label: "G" }],
      overlays: [{ kind: "tint", target: "g", payload: { constraintId: "balance", constraintType: "balance", value: 0.5 } }],
    };
    const positions = createPositions({ nodes: { a: { x: 100, y: 76, width: 180, height: 48 }, b: { x: 400, y: 76, width: 180, height: 48 } }, groups: { g: { x: 0, y: 0, width: 700, height: 200 } }, edges: {} }, "given", "RIGHT");
    // Hit-testing needs no drawing.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const onSelect = vi.fn();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={positions} renderer="canvas" edgeBudget="all" fitView={false} controls={false} legend={false} onSelect={onSelect} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector(".wf-canvas-map")).toBeTruthy());
    const host = container.querySelector(".wf-canvas-map")!;
    // Without fitting, the viewport is the identity: a screen point is a point of the layout. A's centre lies inside the tinted stage.
    fireEvent.pointerDown(host, { clientX: 190, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(host, { clientX: 190, clientY: 100, button: 0, pointerId: 1 });
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["a"], edges: [], groups: [] });
  });
});
