import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowGraph, abstract, layout, overlaysFor } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A 2D context that records the texts of the last frame with the font they were drawn in. */
function textRecorder() {
  let texts: { text: string; font: string }[] = [];
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
      texts.push({ text, font: ctx.font });
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
        <ProcessMap graph={graph} positions={positions} renderer="canvas" lod={{ badges: 0 }} controls={false} legend={false} />
      </div>,
    );
    // The bold 10 px centre text is what the drawing routines write into a badge.
    const badges = () => recorder.frame().filter((t) => t.font.startsWith("700 10px")).map((t) => t.text).sort();
    await waitFor(() => expect(badges().length).toBeGreaterThan(0));
    expect(badges()).toEqual(expected);
  });
});
