import { describe, expect, it } from "vitest";
import { type FlowGraph, type OverlayMark, MAP_TARGET, arcWidth, buildScene, defaultLod, overlayArrow, overlayColor, tintColor } from "../../src/index";
import { graph, overlays, positions } from "./overlay-kinds";

const ink = { paint: "ink", halo: true } as const;
const data = (m: OverlayMark) => {
  const { overlay, ...rest } = m;
  expect(overlay.kind).toBe(m.kind);
  return rest;
};

describe("overlay marks", () => {
  it("resolves one mark per shape with everything needed to draw it", () => {
    const scene = buildScene(graph, positions, { overlays, selfLoops: false });
    expect(scene.marks.map((m) => m.id)).toEqual(scene.geometry.shapes.map((s) => s.id));
    const base = { inMap: true, layer: "above", title: "", radius: 0, texts: [] };
    expect(scene.marks.map(data)).toEqual([
      // Over the box of stage s2, below the edges, from every zoom.
      { ...base, id: "tint:s2:0", kind: "tint", layer: "below", box: { x: 190, y: -10, width: 320, height: 60 }, minZoom: 0, color: "#fd8d3c", onColor: "#000000", title: "Balance — 50 % above", radius: 10, fill: { paint: "value", opacity: 0.18 } },
      // Without a value the colour is neutral; the hatching is 0.55 opaque, as on the map.
      { ...base, id: "hatch:a:1", kind: "hatch", box: { x: 0, y: 0, width: 100, height: 40 }, minZoom: defaultLod.hatch, color: "#8c8c8c", onColor: "#000000", title: "Scope — Out of scope", radius: 6, fill: { paint: "outOfScope", pattern: "outOfScope", opacity: 0.55 } },
      // Width 2 + 8 × coverage 0.5; label at the apex (250, 0.75 × −88 − 8).
      {
        ...base, id: "arc:a->c:2", kind: "arc", box: { x: 50, y: -88, width: 400, height: 88 }, minZoom: defaultLod.arcs, color: "#fdd0a2", onColor: "#000000",
        path: "M50 0 C50 -88 450 -88 450 0", stroke: { paint: "value", width: 6, opacity: 0.9 }, arrow: { size: 12 },
        texts: [{ ...ink, text: "⏱ 25 %", x: 250, y: -74, size: 11, anchor: "middle", baseline: "alphabetic" }],
      },
      // The reverse arc runs below the boxes, second on the pair (height 88 + 14), dashed, width 2 at coverage 0.
      {
        ...base, id: "arc:c->a:3", kind: "arc", box: { x: 50, y: 40, width: 400, height: 94.5 }, minZoom: defaultLod.arcs, color: "#7f2704", onColor: "#ffffff",
        path: "M450 40 C450 142 50 142 50 40", stroke: { paint: "value", width: 2, opacity: 0.9, dash: [6, 4] }, arrow: { size: 12 },
        texts: [{ ...ink, text: "⇐ 100 %", x: 250, y: 130.5, size: 11, anchor: "middle", baseline: "alphabetic" }],
      },
      {
        ...base, id: "selfLoop:c:4", kind: "selfLoop", box: { x: 480, y: -23, width: 45, height: 37 }, minZoom: defaultLod.selfLoops, color: "#d94801", onColor: "#000000",
        path: "M482 0 C482 -28 528 12 500 12", stroke: { paint: "value", width: 2.5 }, arrow: { size: 12 },
        texts: [{ ...ink, text: "↻ 75 %", x: 506, y: -6, size: 10, anchor: "start", baseline: "alphabetic" }],
      },
      // A badge without a glyph shows a dot and its share once, beside it.
      {
        ...base, id: "badge:a:5", kind: "badge", box: { x: 76, y: -11, width: 22, height: 22 }, minZoom: defaultLod.badges, color: "#7f2704", onColor: "#ffffff",
        radius: 11, fill: { paint: "value" }, stroke: { paint: "paper", width: 1.5 },
        texts: [
          { text: "●", x: 87, y: 0.5, size: 10, weight: 700, anchor: "middle", baseline: "middle", paint: "onValue", halo: false },
          { ...ink, text: "100 %", x: 102, y: 0.5, size: 10, anchor: "start", baseline: "middle" },
        ],
      },
      {
        ...base, id: "badge:b:6", kind: "badge", box: { x: 274, y: -11, width: 24, height: 22 }, minZoom: defaultLod.badges, color: "#fdd0a2", onColor: "#000000",
        radius: 11, fill: { paint: "value" }, stroke: { paint: "paper", width: 1.5 },
        texts: [
          { text: "≥1", x: 286, y: 0.5, size: 10, weight: 700, anchor: "middle", baseline: "middle", paint: "onValue", halo: false },
          { ...ink, text: "25 %", x: 302, y: 0.5, size: 10, anchor: "start", baseline: "middle" },
        ],
      },
      // Map-level chips are listed with the legend, not drawn on the map.
      {
        ...base, id: `chip:${MAP_TARGET}:7`, kind: "chip", inMap: false, box: { x: -10, y: -170, width: 60, height: 24 }, minZoom: defaultLod.chips, color: "#8c8c8c", onColor: "#000000", title: "Scope",
        radius: 12, fill: { paint: "paper" }, stroke: { paint: "value", width: 2 },
        texts: [{ text: "Scope", x: -2, y: -157.5, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: 44 }],
      },
      {
        ...base, id: "chip:s2:8", kind: "chip", box: { x: 442, y: -4, width: 60, height: 24 }, minZoom: defaultLod.chips, color: "#8c8c8c", onColor: "#000000", title: "Late",
        radius: 12, fill: { paint: "paper" }, stroke: { paint: "value", width: 2 },
        texts: [{ text: "◔ Late", x: 450, y: 8.5, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: 44 }],
      },
    ]);
  });

  it("follows the scene's level of detail and draws observed self-loops at every zoom", () => {
    const loop: FlowGraph = { ...graph, edges: [...graph.edges, { id: "cc", kind: "follows", source: "c", target: "c", metrics: { count: 6, cases: 2 } }] };
    const tightened = buildScene(loop, positions, { overlays, lod: { arcs: 0.5, selfLoops: 0.6 } });
    const minZoom = (scene: typeof tightened, id: string) => scene.marks.find((m) => m.id.startsWith(id))?.minZoom;
    expect(minZoom(tightened, "arc:a->c")).toBe(0.5);
    expect(minZoom(tightened, "selfLoop:c")).toBe(0.6);
    expect(minZoom(tightened, "tint:s2")).toBe(0);
    const observed = buildScene(loop, positions, { overlays: [], activityLabels: { mode: "ids", references: {} } });
    expect(observed.marks).toHaveLength(1);
    expect(observed.marks[0]).toMatchObject({ kind: "selfLoop", minZoom: 0, edgeId: "cc", color: "#8c8c8c", texts: [{ text: "↻ 6 transitions" }] });
  });

  it("states the value colour, the arc width, the tint and the arrowhead once", () => {
    const at = (value: unknown, coverage?: unknown) => ({ kind: "arc" as const, target: "x", payload: { value, coverage } as never });
    expect([0, 0.25, 0.5, 0.75, 1].map((v) => overlayColor(at(v)))).toEqual(["#fff5eb", "#fdd0a2", "#fd8d3c", "#d94801", "#7f2704"]);
    expect(overlayColor(at(undefined))).toBe("#8c8c8c");
    expect(overlayColor(at(Number.NaN))).toBe("#8c8c8c");
    expect([undefined, 0, 0.5, 2, -1].map((c) => arcWidth(at(0, c)))).toEqual([10, 2, 6, 10, 2]);
    expect(tintColor(at(0.5))).toBe("rgba(253, 141, 60, 0.18)");
    expect(tintColor(at(undefined))).toBeUndefined();
    expect(overlayArrow).toEqual({ size: 12 });
  });
});
