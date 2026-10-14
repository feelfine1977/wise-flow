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
  it("serializes reference sizes identically when a power differs in its last binary digit", () => {
    const scene = prepareScene(graph, positions);
    const state = readableAt(scene.readable, 0.18, 9);
    // Rung 46 is 2^(46/8). Node 22 x64 and Node 24 differ by one ULP.
    const given = { graph, positions, overlays: [{ kind: "badge" as const, target: "a", payload: { glyph: "!", value: 0.5 } }] };
    const sizes = [53.81737057623773, 53.817370576237735];
    const svgs = sizes.map((floor) => toSVG(given, { theme: "default", readable: { ...state, level: "box", floor }, legend: false, caption: false }));
    expect(svgs[0]).toBe(svgs[1]);
    for (const svg of svgs) {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      expect(doc.querySelector(".wf-badge text")?.getAttribute("font-size")).toBe("53.817370576238");
      expect([...doc.querySelectorAll(".wf-numbers text")].map((n) => n.getAttribute("font-size"))).toEqual(["53.817370576238", "53.817370576238"]);
    }
  });

  it("replays cleared reference boxes and card links in both shown formats, including their figure bounds", () => {
    const close = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 0, y: 84, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");
    const given = { graph: { ...graph, edges: [] }, positions: close };
    const scene = prepareScene(given.graph, close);
    const zoom = 0.05, readable = readableAt(scene.readable, zoom, 9);
    const options = { readable, lodZoom: zoom, theme: "default" as const, legend: false, caption: false };
    const svg = new DOMParser().parseFromString(toSVG(given, options), "image/svg+xml");
    const markers = [...svg.querySelectorAll(".wf-numbers text")];
    // 1.5-floor padded glyphs: the first clears the neighbouring card's right edge;
    // the second clears the first. The original centres stay at (90,32), (90,116).
    const xs = [180 + 0.75 * readable.floor, 180 + 2.25 * readable.floor];
    expect(markers.map((n) => Number(n.getAttribute("x")))).toEqual(xs.map((x) => Number(x.toFixed(2))));
    const png = recordingContext(measure);
    toPNGCanvas(given, { ...options, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
    const numbers = png.ops.filter((o) => o.op === "text").filter((o) => !o.halo && o.scales === 2);
    expect(numbers.map((n) => [n.text, n.x, n.y])).toEqual([["1", xs[0], 32], ["2", xs[1], 116]]);
    expect(svg.querySelectorAll(".wf-numbers rect")).toHaveLength(2);
    expect(svg.querySelectorAll(".wf-numbers path")).toHaveLength(2);
    for (const [i, y] of [32, 116].entries()) expect(png.ops.filter((o) => o.op === "stroke").map((o) => o.op === "stroke" && o.shape.lines)).toContainEqual([[90, y, xs[i], y]]);
    const live = recordingContext(measure);
    drawScene(live.ctx, scene, { x: 20, y: 100, zoom, width: 1400, height: 900 }, undefined, { pathRule: { minPx: 0.5 }, cull: false });
    expect(live.ops.filter((o) => o.op === "text").filter((o) => !o.halo).map((o) => [o.text, o.x, o.y])).toEqual(numbers.map((o) => [o.text, o.x, o.y]));
    const backing = [...svg.querySelectorAll(".wf-numbers rect")].map((r) => ({ x: Number(r.getAttribute("x")), y: Number(r.getAttribute("y")), w: Number(r.getAttribute("width")), h: Number(r.getAttribute("height")) }));
    expect(backing[0].x + backing[0].w).toBeCloseTo(backing[1].x, 1);
    for (const r of backing) expect(r.x).toBeGreaterThanOrEqual(180);
  });
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
        expect(svgNumbers.map((n) => Number(n.getAttribute("font-size")))).toEqual([Number(readable.floor.toFixed(12)), Number(readable.floor.toFixed(12))]);
        for (const name of ["1 Record Goods Receipt", "2 Record Service Entry Sheet"]) {
          expect(svg.querySelector(".wf-number-key")?.textContent).toContain(name);
          expect(pngTexts.some((o) => o.text === name)).toBe(true);
        }
      }
      expect(new DOMParser().parseFromString(toSVG(given, { theme: "default" }), "image/svg+xml").querySelectorAll(".wf-edge")).toHaveLength(2);
    }
  });
});
