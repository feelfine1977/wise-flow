import { describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay, type OverlayMark, MAP_TARGET, arcWidth, buildScene, defaultLod, fitLead, overlayArrow, overlayColor, tintColor, truncateText } from "../../src/index";
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
    const base = { inMap: true, layer: "above", title: "", radius: 0, texts: [], color: "#b84a00", onColor: "#ffffff" };
    const r = (n: number) => Math.round(n * 1000) / 1000;
    const rounded = <T,>(o: T): T => JSON.parse(JSON.stringify(o), (_, v) => (typeof v === "number" ? r(v) : v));
    // Every deviation in the accent #b84a00 (white text on it reaches 5.23 : 1, black 4.02 : 1).
    expect(rounded(scene.marks.map(data))).toEqual([
      // Over the box of stage s2, below the edges, from every zoom, with the group's corners (10).
      { ...base, id: "tint:s2:0", kind: "tint", layer: "below", box: { x: 190, y: -10, width: 320, height: 60 }, minZoom: 0, title: "Balance — 50 % above", radius: 10, fill: { paint: "value", opacity: 0.18 } },
      // The hatching is 0.55 opaque in the out-of-scope colour, as on the map, with the activity's corners (6).
      { ...base, id: "hatch:a:1", kind: "hatch", box: { x: 0, y: 0, width: 100, height: 40 }, minZoom: defaultLod.hatch, title: "Scope — Out of scope", radius: 6, fill: { paint: "outOfScope", pattern: "outOfScope", opacity: 0.55 } },
      // One width, 1.5, whatever the coverage. Its pill on the apex (250, 0.75 × −88): "late 25 %", 9 characters of
      // 0.55 × 11 and 6 on either side, 66.45 wide and 18 tall; the box reaches its top.
      {
        ...base, id: "arc:a->c:2", kind: "arc", layer: "between", box: { x: 50, y: -75, width: 400, height: 75 }, minZoom: defaultLod.arcs,
        path: "M50 0 C50 -88 450 -88 450 0", stroke: { paint: "value", width: 1.5, opacity: 0.9 }, arrow: { size: 12, overhang: 0.1 },
        pill: { box: { x: 216.775, y: -75, width: 66.45, height: 18 }, radius: 9, fill: { paint: "paper" }, stroke: { paint: "value", width: 1.5 } },
        texts: [{ text: "late 25 %", x: 250, y: -65.5, size: 11, anchor: "middle", baseline: "middle", paint: "value", halo: false }],
      },
      // The reverse arc runs below the boxes, second on the pair (height 88 + 14), solid; its pill "⇐ 100 %" (54.35 wide)
      // on its middle (250, 40 + 0.75 × 102).
      {
        ...base, id: "arc:c->a:3", kind: "arc", layer: "between", box: { x: 50, y: 40, width: 400, height: 85.5 }, minZoom: defaultLod.arcs,
        path: "M450 40 C450 142 50 142 50 40", stroke: { paint: "value", width: 1.5, opacity: 0.9 }, arrow: { size: 12, overhang: 0.1 },
        pill: { box: { x: 222.825, y: 107.5, width: 54.35, height: 18 }, radius: 9, fill: { paint: "paper" }, stroke: { paint: "value", width: 1.5 } },
        texts: [{ text: "⇐ 100 %", x: 250, y: 117, size: 11, anchor: "middle", baseline: "middle", paint: "value", halo: false }],
      },
      // The label right of the corner, clear of the chip in s2 (442–502); the box reaches its end (506 + 6 × 5.5).
      {
        ...base, id: "selfLoop:c:4", kind: "selfLoop", box: { x: 480, y: -23, width: 59, height: 37 }, minZoom: defaultLod.selfLoops,
        path: "M482 0 C482 -28 528 12 500 12", stroke: { paint: "value", width: 2.5 }, arrow: { size: 12, overhang: 0.1 },
        texts: [{ ...ink, text: "↻ 75 %", x: 506, y: -6, size: 10, anchor: "start", baseline: "alphabetic", paint: "value" }],
      },
      // Badges are pills of paper wholly above the box, 2 clear of it, ending at its right edge: the glyph (a dot
      // without one) and the share, 9 characters of 5.5 and 6 on either side, 61.5 wide.
      {
        ...base, id: "badge:a:5", kind: "badge", box: { x: 38.5, y: -20, width: 61.5, height: 18 }, minZoom: defaultLod.badges,
        radius: 9, fill: { paint: "paper" }, stroke: { paint: "value", width: 1.5 },
        texts: [{ text: "● · 100 %", x: 69.25, y: -10.5, size: 10, weight: 700, anchor: "middle", baseline: "middle", paint: "value", halo: false }],
      },
      {
        ...base, id: "badge:b:6", kind: "badge", box: { x: 238.5, y: -20, width: 61.5, height: 18 }, minZoom: defaultLod.badges,
        radius: 9, fill: { paint: "paper" }, stroke: { paint: "value", width: 1.5 },
        texts: [{ text: "≥1 · 25 %", x: 269.25, y: -10.5, size: 10, weight: 700, anchor: "middle", baseline: "middle", paint: "value", halo: false }],
      },
      // Map-level chips are listed with the legend, not drawn on the map.
      {
        ...base, id: `chip:${MAP_TARGET}:7`, kind: "chip", inMap: false, box: { x: -10, y: -170, width: 60, height: 24 }, minZoom: defaultLod.chips, title: "Scope",
        radius: 12, fill: { paint: "paper" }, stroke: { paint: "value", width: 2 },
        texts: [{ text: "Scope", x: -2, y: -157.5, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: 44 }],
      },
      {
        ...base, id: "chip:s2:8", kind: "chip", box: { x: 442, y: -4, width: 60, height: 24 }, minZoom: defaultLod.chips, title: "Late",
        radius: 12, fill: { paint: "paper" }, stroke: { paint: "value", width: 2 },
        // The glyph, then the text 2 characters (12.4 px) further.
        texts: [
          { text: "◔", x: 450, y: 8.5, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false },
          { text: "Late", x: 462.4, y: 8.5, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: 31.6 },
        ],
      },
    ]);
  });

  it("lays a chip out as the map does: glyph, gauge, the label in bold and the text", () => {
    const chips: Overlay[] = [
      { kind: "chip", target: "s2", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", value: 0.5, gauge: { value: 2.1, threshold: 2, width: 1 } } },
      { kind: "chip", target: "s1", payload: { label: "Late", value: 0.25 } },
    ];
    const marks = ["s2", "s1"].map((target) => buildScene(graph, positions, { overlays: chips, selfLoops: false, locale: "de" }).marks.find((m) => m.overlay.target === target)!);
    const r = (n: number) => Math.round(n * 100) / 100;
    const rounded = <T,>(o: T): T => JSON.parse(JSON.stringify(o), (_, v) => (typeof v === "number" ? r(v) : v));
    // 16 px padding, 12.4 px glyph, 46 px gauge and "Touches: 2.1 ⌀" (14 characters of 5.5 by the estimate at 10 px): 151.4 wide,
    // right-aligned 8 px inside s2 (190 + 320 − 8 − 151.4) and 6 px below its top.
    expect(rounded(marks[0])).toMatchObject({
      box: { x: 350.6, y: -4, width: 151.4, height: 24 },
      color: "#b84a00",
      title: "Touches — 2.1 ⌀",
      texts: [
        { text: "◔", x: 358.6, y: 8.5 },
        { lead: "Touches: ", text: "2.1 ⌀", x: 417, y: 8.5, maxWidth: 77 },
      ],
      // The scale runs to threshold + width (3): the mean fills 2.1 / 3, the tick sits at 2 / 3.
      gauge: { x: 371, y: 5, width: 40, height: 6, value: 0.7, threshold: 0.67 },
    });
    // Without a text the chip shows its share after the label, in the scene's locale: 16 + 10 × 5.5 = 71 wide,
    // right-aligned in s1 (−10 + 120 − 8 − 71).
    expect(rounded(marks[1])).toMatchObject({ box: { x: 31, y: -4, width: 71, height: 24 }, texts: [{ lead: "Late: ", text: "25 %", x: 39 }] });
    expect(marks[1].gauge).toBeUndefined();
  });

  it("fits a lead and its text into their width together", () => {
    const text = (maxWidth: number) => fitLead({ lead: "Manual touches: ", text: "2.1", x: 0, y: 0, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth }, (s) => truncateText(s, maxWidth, { size: 10 }));
    // 5.5 per character by the estimate: all 19 fit 110; 17 and the ellipsis fit 100, 15 and it 90, 6 and it 40.
    expect(text(110)).toEqual({ lead: "Manual touches: ", text: "2.1" });
    expect(text(100)).toEqual({ lead: "Manual touches: ", text: "2…" });
    expect(text(90)).toEqual({ lead: "Manual touches:…", text: "" });
    expect(text(40)).toEqual({ lead: "Manual…", text: "" });
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
    // It stands for the path cc, the only one with a count, so the strongest: the dark end of the path ramp; its label in the ink.
    expect(observed.marks[0]).toMatchObject({ kind: "selfLoop", minZoom: 0, edgeId: "cc", color: "#141414", texts: [{ text: "↻ 6 transitions", paint: "ink" }] });
  });

  it("states the value colour, the arc width, the tint and the arrowhead once", () => {
    const at = (value: unknown, coverage?: unknown) => ({ kind: "arc" as const, target: "x", payload: { value, coverage } as never });
    // The accent whatever the value; one width whatever the coverage.
    expect([0, 0.25, 1, undefined, Number.NaN].map((v) => overlayColor(at(v)))).toEqual(Array(5).fill("#b84a00"));
    expect([undefined, 0, 0.5, 2, -1].map((c) => arcWidth(at(0, c)))).toEqual(Array(5).fill(1.5));
    // #b84a00 is 184, 74, 0.
    expect(tintColor(at(0.5))).toBe("rgba(184, 74, 0, 0.18)");
    expect(tintColor(at(undefined))).toBeUndefined();
    expect(overlayArrow).toEqual({ size: 12, overhang: 0.1 });
  });
});
