// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type FlowGraph, createPositions, readableAt, toSVG } from "../../src/index";
import { drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { recordingContext } from "../browser/parity/canvas";

const graph: FlowGraph = {
  nodes: [{ id: "a", kind: "activity", label: "Record Goods Receipt" }, { id: "b", kind: "activity", label: "Record Service Entry Sheet" }],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 100 } }, { id: "ba", kind: "follows", source: "b", target: "a", metrics: { cases: 1 } }],
};
const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 600, y: 0, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");
const measure = (text: string, font: string) => text.length * 0.55 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);

describe("numbered shown figures", () => {
  it("uses the supplied screen zoom for a reported selection without changing ordinary figure numbering", () => {
    const given = { graph, positions };
    const options = { theme: "default" as const, lodZoom: 0.05, edgeBudget: { edges: ["ab"], total: 2 } };
    const doc = new DOMParser().parseFromString(toSVG(given, options), "image/svg+xml");
    expect(doc.querySelectorAll(".wf-numbers text")).toHaveLength(2);
    const png = recordingContext(measure);
    toPNGCanvas(given, { ...options, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
    expect(png.ops.filter((o) => o.op === "text").filter((o) => !o.halo && o.scales === 2).map((o) => o.text)).toEqual(["1", "2"]);
    expect(toSVG(given, { theme: "default", lodZoom: 0.05 })).not.toContain('class="wf-numbers"');
  });
  it("replays the screen's text state, numbers, full-name key and withheld note in SVG and PNG, leaving default figures whole", () => {
    const given = { graph, positions, activityLabels: { mode: "ids" as const, references: { a: "A23", b: "A46" } } };
    const scene = prepareScene(graph, positions, given);
    let readable;
    for (const zoom of [0.2, 0.1, 0.05, 0.21, 1]) {
      readable = readableAt(scene.readable, zoom, 9, readable);
      const live = recordingContext(measure);
      drawScene(live.ctx, scene, { x: 0, y: 100, zoom, width: 1400, height: 900 }, undefined, { pathRule: { minPx: 0.5 }, readable, cull: false, background: false });
      // A host reports its drawn path ids independently of the camera; replay that set and this frame's text state.
      const options = { theme: "default" as const, lodZoom: zoom, readable, edgeBudget: { edges: ["ab"], total: 2 }, legend: false, caption: false };
      const svg = new DOMParser().parseFromString(toSVG(given, options), "image/svg+xml");
      const png = recordingContext(measure);
      toPNGCanvas(given, { ...options, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
      expect(svg.querySelectorAll(".wf-edge")).toHaveLength(1);
      expect(svg.documentElement.textContent).toContain("Showing 1 of 2 flows");
      const pngTexts = png.ops.filter((o) => o.op === "text").filter((o) => !o.halo);
      expect(pngTexts.some((o) => o.text === "Showing 1 of 2 flows")).toBe(true);
      const liveNumbers = live.ops.filter((o) => o.op === "text").filter((o) => !o.halo && /^\d+$/.test(o.text));
      const svgNumbers = [...svg.querySelectorAll(".wf-numbers text")];
      expect(svgNumbers.map((n) => n.textContent), `zoom ${zoom}`).toEqual(readable.level === "box" ? ["1", "2"] : []);
      if (readable.level === "box") {
        expect(liveNumbers.map((o) => [o.text, o.x, o.y, o.size])).toEqual([["1", 90, 32, readable.floor], ["2", 690, 32, readable.floor]]);
        const pngNumbers = pngTexts.filter((o) => o.scales === 2 && /^\d+$/.test(o.text));
        expect(pngNumbers.map((o) => [o.text, o.x, o.y, o.size])).toEqual(liveNumbers.map((o) => [o.text, o.x, o.y, o.size]));
        expect(svgNumbers.map((n) => Number(n.getAttribute("font-size")))).toEqual([readable.floor, readable.floor]);
        for (const name of ["1 Record Goods Receipt", "2 Record Service Entry Sheet"]) {
          expect(svg.querySelector(".wf-number-key")?.textContent).toContain(name);
          expect(pngTexts.some((o) => o.text === name)).toBe(true);
        }
      }
      expect(new DOMParser().parseFromString(toSVG(given, { theme: "default" }), "image/svg+xml").querySelectorAll(".wf-edge")).toHaveLength(2);
    }
  });
});
