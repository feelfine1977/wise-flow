import { describe, expect, it } from "vitest";
import { type Overlay, buildScene, toSVG } from "../../src/index";
import { type DrawContext, type DrawState, defaultTokens, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import * as elements from "./element-kinds";
import { graph, overlays, positions } from "./overlay-kinds";

interface Op {
  op: "fill" | "stroke" | "fillRect" | "fillText" | "strokeText";
  /** Path of fills and strokes, with numbers rounded to 0.01. */
  path?: string;
  /** Fill or stroke colour that applies to the operation. */
  color: string;
  alpha: number;
  width?: number;
  dash?: number[];
  text?: string;
  at?: [number, number];
  font?: string;
  align?: string;
  baseline?: string;
}

/** A 2D context that records what is filled, stroked and written, with the state that applies to it. */
function drawingContext() {
  const ops: Op[] = [];
  let path: string[] = [];
  let dash: number[] = [];
  const r = (n: number) => Math.round(n * 100) / 100;
  const ctx = {
    fillStyle: "" as DrawContext["fillStyle"],
    strokeStyle: "" as DrawContext["strokeStyle"],
    lineWidth: 1,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1,
    lineJoin: "miter" as CanvasLineJoin,
    lineCap: "butt" as CanvasLineCap,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath: () => { path = []; },
    closePath: () => { path.push("Z"); },
    moveTo: (x: number, y: number) => { path.push(`M${r(x)},${r(y)}`); },
    lineTo: (x: number, y: number) => { path.push(`L${r(x)},${r(y)}`); },
    bezierCurveTo: (...a: number[]) => { path.push(`C${a.map(r).join(",")}`); },
    arc: (...a: number[]) => { path.push(`A${a.slice(0, 3).map(r).join(",")}`); },
    rect: (...a: number[]) => { path.push(`R${a.map(r).join(",")}`); },
    fill: () => { ops.push({ op: "fill", path: path.join(" "), color: String(ctx.fillStyle), alpha: ctx.globalAlpha }); },
    stroke: () => { ops.push({ op: "stroke", path: path.join(" "), color: String(ctx.strokeStyle), alpha: ctx.globalAlpha, width: ctx.lineWidth, dash }); },
    fillRect: (x: number, y: number, w: number, h: number) => { ops.push({ op: "fillRect", path: `R${[x, y, w, h].map(r).join(",")}`, color: String(ctx.fillStyle), alpha: ctx.globalAlpha }); },
    clearRect() {},
    fillText: (text: string, x: number, y: number) => { ops.push({ op: "fillText", text, at: [r(x), r(y)], color: String(ctx.fillStyle), alpha: ctx.globalAlpha, font: ctx.font, align: ctx.textAlign, baseline: ctx.textBaseline }); },
    strokeText: (text: string, x: number, y: number) => { ops.push({ op: "strokeText", text, at: [r(x), r(y)], color: String(ctx.strokeStyle), alpha: ctx.globalAlpha, width: ctx.lineWidth, font: ctx.font, align: ctx.textAlign, baseline: ctx.textBaseline }); },
    measureText: (text: string) => ({ width: text.length * 6 }),
    setLineDash: (d: number[]) => { dash = [...d]; },
  } satisfies DrawContext;
  return { ctx, ops };
}

const font = (size: string) => `${size} ${defaultTokens.font}`;
const draw = (state?: DrawState, zoom = 1) => {
  const scene = prepareScene(graph, positions, { overlays, selfLoops: false, lodBySize: false });
  const { ctx, ops } = drawingContext();
  drawScene(ctx, scene, { x: 0, y: 0, zoom, width: 1000, height: 600 }, state, { cull: false });
  return ops;
};
const startingAt = (ops: Op[], point: string) => ops.filter((o) => o.path?.startsWith(point));

describe("Canvas overlay marks", () => {
  it("draws every overlay mark with its colours and coordinates", () => {
    const ops = draw();
    // Tint over stage s2 (190, −10), corner radius 10, at the tint opacity; hatching over
    // activity a in the out-of-scope colour (no pattern tiles in Node), radius 6.
    expect(ops.filter((o) => o.alpha === 0.18)).toEqual([{ op: "fill", path: expect.stringMatching(/^M200,-10 .*A500,0,10/), color: "#fd8d3c", alpha: 0.18 }]);
    expect(ops.filter((o) => o.alpha === 0.55)).toEqual([{ op: "fill", path: expect.stringMatching(/^M6,0 .*A94,6,6/), color: "#b0b0b0", alpha: 0.55 }]);
    // Arc a → c: width 2 + 8 × 0.5, then the arrowhead pointing down to (450, 0), 12 long and
    // wide, its tip 1.2 beyond the end.
    expect(startingAt(ops, "M50,0")).toEqual([{ op: "stroke", path: "M50,0 C50,-88,450,-88,450,0", color: "#fdd0a2", alpha: 0.9, width: 6, dash: [] }]);
    expect(startingAt(ops, "M450,1.2")).toEqual([{ op: "fill", path: "M450,1.2 L444,-10.8 L456,-10.8 Z", color: "#fdd0a2", alpha: 0.9 }]);
    // Reverse arc c → a below the map, dashed, width 2; its arrowhead points up to (50, 40).
    expect(startingAt(ops, "M450,40")).toEqual([{ op: "stroke", path: "M450,40 C450,142,50,142,50,40", color: "#7f2704", alpha: 0.9, width: 2, dash: [6, 4] }]);
    expect(startingAt(ops, "M50,38.8")).toEqual([{ op: "fill", path: "M50,38.8 L56,50.8 L44,50.8 Z", color: "#7f2704", alpha: 0.9 }]);
    // Self-loop at c's top-right corner; the arrowhead points left to (500, 12).
    expect(startingAt(ops, "M482,0")).toEqual([{ op: "stroke", path: "M482,0 C482,-28,528,12,500,12", color: "#d94801", alpha: 1, width: 2.5, dash: [] }]);
    expect(startingAt(ops, "M498.8,12")).toEqual([{ op: "fill", path: "M498.8,12 L510.8,6 L510.8,18 Z", color: "#d94801", alpha: 1 }]);
    // Badges: pills of radius 11 at (76, −11) and (274, −11) with a paper outline.
    expect(startingAt(ops, "M87,-11")).toEqual([
      { op: "fill", path: expect.stringContaining("A87,0,11"), color: "#7f2704", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A87,0,11"), color: "#ffffff", alpha: 1, width: 1.5, dash: [] },
    ]);
    expect(startingAt(ops, "M285,-11")).toEqual([
      { op: "fill", path: expect.stringContaining("A287,0,11"), color: "#fdd0a2", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A287,0,11"), color: "#ffffff", alpha: 1, width: 1.5, dash: [] },
    ]);
    // Chip in stage s2 at (442, −4): paper fill, outline in the (neutral) value colour.
    expect(startingAt(ops, "M454,-4")).toEqual([
      { op: "fill", path: expect.stringContaining("A490,8,12"), color: "#ffffff", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A490,8,12"), color: "#8c8c8c", alpha: 1, width: 2, dash: [] },
    ]);
    const texts = ops.filter((o) => o.op === "fillText" && o.text !== "A" && o.text !== "B" && o.text !== "C" && !o.text?.startsWith("Stage"));
    expect(texts.map(({ text, at, color, font: f, align, baseline }) => ({ text, at, color, font: f, align, baseline }))).toEqual([
      { text: "⏱ 25 %", at: [250, -74], color: "#1f1f1f", font: font("11px"), align: "center", baseline: "alphabetic" },
      { text: "⇐ 100 %", at: [250, 130.5], color: "#1f1f1f", font: font("11px"), align: "center", baseline: "alphabetic" },
      { text: "↻ 75 %", at: [506, -6], color: "#1f1f1f", font: font("10px"), align: "left", baseline: "alphabetic" },
      // A badge without a glyph: a dot in contrasting ink and the share once, beside it.
      { text: "●", at: [87, 0.5], color: "#ffffff", font: font("700 10px"), align: "center", baseline: "middle" },
      { text: "100 %", at: [102, 0.5], color: "#1f1f1f", font: font("10px"), align: "left", baseline: "middle" },
      { text: "≥1", at: [286, 0.5], color: "#000000", font: font("700 10px"), align: "center", baseline: "middle" },
      { text: "25 %", at: [302, 0.5], color: "#1f1f1f", font: font("10px"), align: "left", baseline: "middle" },
      // The map-level chip ("Scope") is not drawn on the map.
      { text: "◔", at: [450, 8.5], color: "#1f1f1f", font: font("10px"), align: "left", baseline: "middle" },
      { text: "Late", at: [462.4, 8.5], color: "#1f1f1f", font: font("10px"), align: "left", baseline: "middle" },
    ]);
    // Labels beside lines and badges carry a paper halo.
    expect(ops.filter((o) => o.op === "strokeText").map((o) => [o.text, o.color, o.width])).toEqual([
      ["⏱ 25 %", "#ffffff", 3], ["⇐ 100 %", "#ffffff", 3], ["↻ 75 %", "#ffffff", 3], ["100 %", "#ffffff", 3], ["25 %", "#ffffff", 3],
    ]);
  });

  it("draws a chip's gauge and its label in bold before the text", () => {
    const chip: Overlay = { kind: "chip", target: "s2", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", value: 0.5, gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const scene = prepareScene(graph, positions, { overlays: [chip], selfLoops: false, lodBySize: false });
    const { ctx, ops } = drawingContext();
    drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    // Track 40 × 6 at (361.2, 5) with radius 3 in the line colour, 0.7 of it filled, the tick at 2 / 3.
    expect(startingAt(ops, "M364.2,5")).toEqual([{ op: "fill", path: expect.stringContaining("A398.2,8,3"), color: defaultTokens.line, alpha: 1 }]);
    const track = ops.findIndex((o) => o.path?.startsWith("M364.2,5"));
    expect(ops.slice(track + 1).filter((o) => o.op === "fillRect")).toEqual([
      { op: "fillRect", path: "R361.2,5,28,6", color: "#fd8d3c", alpha: 1 },
      { op: "fillRect", path: "R386.87,4,2,8", color: "#1f1f1f", alpha: 1 },
    ]);
    // The lead in bold, the text after its measured width (9 characters × 6 in this context).
    const texts = ops.filter((o) => o.op === "fillText" && !["A", "B", "C"].includes(o.text ?? "") && !o.text?.startsWith("Stage"));
    expect(texts.map(({ text, at, font: f }) => ({ text, at, font: f }))).toEqual([
      { text: "◔", at: [348.8, 8.5], font: font("10px") },
      { text: "Touches: ", at: [407.2, 8.5], font: font("700 10px") },
      { text: "2.1 ⌀", at: [461.2, 8.5], font: font("10px") },
    ]);
  });

  it("takes the arrowhead from the mark", () => {
    const scene = prepareScene(graph, positions, { overlays, selfLoops: false, lodBySize: false });
    const marks = scene.marks.map((m) => (m.arrow ? { ...m, arrow: { size: 20, overhang: 0.5 } } : m));
    const { ctx, ops } = drawingContext();
    drawScene(ctx, { ...scene, marks }, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    // Arc a → c ends at (450, 0) pointing down: the tip 0.5 × 20 below it, the base 20 above the tip.
    expect(startingAt(ops, "M450,10")).toEqual([{ op: "fill", path: "M450,10 L440,-10 L460,-10 Z", color: "#fdd0a2", alpha: 0.9 }]);
  });

  it("shows a hovered mark in the focus colour and hides marks below their zoom", () => {
    const hovered = draw({ selection: { nodes: [], edges: [], groups: [] }, hovered: "badge:b:6" });
    expect(startingAt(hovered, "M285,-11")[0].color).toBe(defaultTokens.focus);
    expect(hovered.find((o) => o.text === "≥1")?.color).toBe("#ffffff");
    // At zoom 0.18 only the tint (every zoom) and the hatching (from 0.15) remain.
    const far = draw(undefined, 0.18);
    expect(far.filter((o) => o.alpha === 0.18 || o.alpha === 0.55).map((o) => o.color)).toEqual(["#fd8d3c", "#b0b0b0"]);
    expect(far.filter((o) => o.op === "stroke" && o.alpha === 0.9)).toEqual([]);
    expect(far.filter((o) => o.op === "fillText").map((o) => o.text)).toEqual(["Stage 1", "Stage 2"]);
  });

  it("fills a group tint once, with and without stage bands", () => {
    const tint: Overlay[] = [{ kind: "tint", target: "s2", payload: { value: 0.5 } }];
    for (const lanes of ["none", "stages"] as const) {
      const scene = prepareScene(graph, positions, { overlays: tint, lanes, selfLoops: false });
      const { ctx, ops } = drawingContext();
      drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
      const tinted = ops.filter((o) => (o.op === "fill" || o.op === "fillRect") && /#fd8d3c|253, 141, 60/.test(o.color));
      expect(tinted, lanes).toEqual([expect.objectContaining({ op: "fill", color: "#fd8d3c", alpha: 0.18 })]);
    }
  });

  it("leaves map-level chips out of the bounds and the hit index of Canvas, PNG and SVG", () => {
    const chip: Overlay[] = [{ kind: "chip", target: "__map", payload: { text: "Scope" } }];
    const scene = prepareScene(graph, positions, { overlays: chip, selfLoops: false });
    expect(scene.shapes).toHaveLength(1);
    const [shape] = scene.shapes;
    expect(shape.y).toBe(-170);
    expect(scene.bounds).toEqual(positions.bounds);
    expect(buildScene(graph, positions, { overlays: chip }).bounds).toEqual(positions.bounds);
    expect(scene.hit.at(shape.x + 20, shape.y + 12)).toEqual([]);
    expect(scene.hit.within(shape).filter((h) => h.kind === "overlay")).toEqual([]);
    // The figures are as tall as without the chip.
    const size = (o: Overlay[]) => {
      const png = toPNGCanvas({ graph, positions, overlays: o }, { legend: false, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => drawingContext().ctx }) });
      const svg = /viewBox="([^"]+)"/.exec(toSVG({ graph, positions, overlays: o }, { legend: false }))![1];
      return { png: [png.cssWidth, png.cssHeight], svg };
    };
    expect(size(chip)).toEqual(size([]));
    expect(size([]).svg).toBe("0 0 568 108");
  });
});

describe("Canvas node and edge marks", () => {
  const drawElements = (state?: DrawState, zoom = 1, given = elements.graph) => {
    const scene = prepareScene(given, elements.positions, { style: elements.style, selfLoops: false, lodBySize: false });
    const { ctx, ops } = drawingContext();
    drawScene(ctx, scene, { x: 0, y: 0, zoom, width: 1000, height: 600 }, state, { cull: false });
    return ops;
  };
  const written = (ops: Op[]) => ops.filter((o) => o.op === "fillText").map(({ text, at, color, font: f, align, baseline }) => ({ text, at, color, font: f, align, baseline }));

  it("draws every node kind's outline, band and border from its mark", () => {
    const ops = drawElements();
    // The start event: a circle of radius 18 on paper in ink; the end event's border is 3 wide.
    expect(ops.filter((o) => o.path === "A18,20,18")).toEqual([
      { op: "fill", path: "A18,20,18", color: "#ffffff", alpha: 1 },
      { op: "stroke", path: "A18,20,18", color: "#1f1f1f", alpha: 1, width: 1.5, dash: [] },
    ]);
    expect(ops.find((o) => o.op === "stroke" && o.path === "A858,20,18")).toMatchObject({ width: 3 });
    // The gateway: a diamond in its box.
    expect(startingAt(ops, "M342,-2")).toEqual([
      { op: "fill", path: "M342,-2 L364,20 L342,42 L320,20 Z", color: "#ffffff", alpha: 1 },
      { op: "stroke", path: "M342,-2 L364,20 L342,42 L320,20 Z", color: "#1f1f1f", alpha: 1, width: 1.5, dash: [] },
    ]);
    // The note: on the surface colour, a dotted border in its colour, no band.
    expect(startingAt(ops, "M646,0")).toEqual([
      { op: "fill", path: expect.stringContaining("A794,6,6"), color: "#f6f7f9", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A794,6,6"), color: "#8c8c8c", alpha: 1, width: 2, dash: [2, 3] },
    ]);
    // Activities and stages: a band 8 wide in their colour; the stage's border is 3 wide; the re-added activity is dashed.
    expect(ops.filter((o) => o.op === "fillRect" && o.color === "#8c8c8c").map((o) => o.path)).toEqual(["R100,0,8,40", "R400,0,8,56", "R400,100,8,40"]);
    expect(startingAt(ops, "M406,0").find((o) => o.op === "stroke")).toMatchObject({ width: 3, dash: [] });
    expect(startingAt(ops, "M406,100").find((o) => o.op === "stroke")).toMatchObject({ width: 2, dash: [4, 3] });
  });

  it("writes every node's and edge's texts where its mark puts them", () => {
    const text = (t: string, at: [number, number], f: string, align = "left", baseline = "middle", color = "#1f1f1f") => ({ text: t, at, color, font: font(f), align, baseline });
    expect(written(drawElements())).toEqual([
      // The event's label inside its circle.
      text("Start", [18, 20], "9px", "center"),
      text("Check invoice", [116, 20], "12px"),
      text("1.2k", [274, 35], "9px", "right", "alphabetic", "#5b6270"),
      text("+", [342, 21], "700 14px", "center"),
      // The stage's members line.
      text("Payment", [416, 28], "600 12px"),
      text("4 · 1.5k", [594, 51], "9px", "right", "alphabetic", "#5b6270"),
      // The note's label at 11 px, as on the map.
      text("Ask the vendor twice", [656, 30], "11px"),
      text("End", [858, 20], "9px", "center"),
      text("Re-added", [416, 120], "12px"),
      // Edge counts with a halo, 4 above the middle of the route; the flow edge carries its count too.
      text("1.2k", [68, 16], "10px", "center", "alphabetic"),
      text("12", [300, 16], "10px", "center", "alphabetic"),
      text("3", [500, 74], "10px", "center", "alphabetic"),
    ]);
    // The constraint edge in mechanism blue, dotted.
    expect(startingAt(drawElements(), "M364,20")).toEqual([{ op: "stroke", path: "M364,20 L382,20 L382,28 L400,28", color: "#0072B2", alpha: 1, width: 1.5, dash: [2, 4] }]);
  });

  it("keeps the gateway's glyph and the note's label when zoomed out", () => {
    expect(written(drawElements(undefined, 0.1)).map((t) => t.text)).toEqual(["+", "Ask the vendor twice"]);
  });

  it("cuts labels by the core rule with the context's measure, without room for the count below them", () => {
    const long = { ...elements.graph, nodes: elements.graph.nodes.map((n) => (n.id === "a" ? { ...n, label: "Change Approval for Purchase Order" } : n)) };
    // 6 per character: 25 and the ellipsis fit the 156 of a 180 wide node.
    expect(written(drawElements(undefined, 1, long)).find((t) => t.at?.[0] === 116)?.text).toBe("Change Approval for Purch…");
  });

  it("draws the marks it is given rather than the other node and edge fields", () => {
    const scene = prepareScene(elements.graph, elements.positions, { style: elements.style, selfLoops: false, lodBySize: false });
    const nodes = scene.nodes.map((n) => (n.node.id === "a" ? { ...n, mark: { ...n.mark, texts: [{ ...n.mark.texts[0], text: "From the mark" }] } } : n));
    const edges = scene.edges.map((e) => (e.edge.id === "a->g" ? { ...e, mark: { ...e.mark, color: "#123456", points: [{ x: 280, y: 30 }, { x: 320, y: 30 }], texts: [{ ...e.mark.texts[0], text: "99" }] } } : e));
    const { ctx, ops } = drawingContext();
    drawScene(ctx, { ...scene, nodes, edges }, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    const texts = written(ops).map((t) => t.text);
    expect(texts).toContain("From the mark");
    expect(texts).not.toContain("Check invoice");
    expect(texts).toContain("99");
    expect(startingAt(ops, "M280,30")).toEqual([{ op: "stroke", path: "M280,30 L320,30", color: "#123456", alpha: 1, width: 1.5, dash: [] }]);
  });

  it("fills a hovered node with the surface colour", () => {
    const ops = drawElements({ selection: { nodes: [], edges: [], groups: [] }, hovered: "a" });
    expect(startingAt(ops, "M106,0").find((o) => o.op === "fill")).toMatchObject({ color: "#f6f7f9" });
  });
});
