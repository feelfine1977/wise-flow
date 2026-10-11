import { describe, expect, it } from "vitest";
import { type Overlay, type TextMeasure, buildScene, toSVG } from "../../src/index";
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
/** What the cards of A, B and C write: their names, and a dash for their cases and share (the graph has no cases). */
const cards = ["A", "B", "C", "–", "· –"];

describe("Canvas overlay marks", () => {
  it("draws every overlay mark with its colours and coordinates", () => {
    const ops = draw();
    // Tint over stage s2 (190, −10), corner radius 8, at the tint opacity; hatching over
    // activity a in the out-of-scope colour (no pattern tiles in Node), radius 4.
    expect(ops.filter((o) => o.alpha === 0.18)).toEqual([{ op: "fill", path: expect.stringMatching(/^M198,-10 .*A502,-2,8/), color: "#fd8d3c", alpha: 0.18 }]);
    expect(ops.filter((o) => o.alpha === 0.55)).toEqual([{ op: "fill", path: expect.stringMatching(/^M4,0 .*A96,4,4/), color: "#b0b0b0", alpha: 0.55 }]);
    // Arc a → c: width 2 + 8 × 0.5, then the arrowhead pointing down to (450, 0), 12 long and
    // wide, its tip 1.2 beyond the end.
    expect(startingAt(ops, "M50,0")).toEqual([{ op: "stroke", path: "M50,0 C50,-88,450,-88,450,0", color: "#fdd0a2", alpha: 0.9, width: 6, dash: [] }]);
    expect(startingAt(ops, "M450,1.2")).toEqual([{ op: "fill", path: "M450,1.2 L444,-10.8 L456,-10.8 Z", color: "#fdd0a2", alpha: 0.9 }]);
    // Reverse arc c → a below the map, dashed, width 2; its arrowhead points up to (50, 40).
    expect(startingAt(ops, "M450,40")).toEqual([{ op: "stroke", path: "M450,40 C450,142,50,142,50,40", color: "#7f2704", alpha: 0.9, width: 2, dash: [6, 4] }]);
    expect(startingAt(ops, "M50,38.8")).toEqual([{ op: "fill", path: "M50,38.8 L56,50.8 L44,50.8 Z", color: "#7f2704", alpha: 0.9 }]);
    // Self-loop at c's top-right corner; the arrowhead points left to (500, 12).
    expect(startingAt(ops, "M482,0")).toEqual([{ op: "stroke", path: "M482,0 C482,-28,528,12,500,12", color: "#d94801", alpha: 1, width: 2, dash: [] }]);
    expect(startingAt(ops, "M498.8,12")).toEqual([{ op: "fill", path: "M498.8,12 L510.8,6 L510.8,18 Z", color: "#d94801", alpha: 1 }]);
    // Badges: pills of radius 11 wholly above their activity at (76, −24) and (274, −24) with a paper outline.
    expect(startingAt(ops, "M87,-24")).toEqual([
      { op: "fill", path: expect.stringContaining("A87,-13,11"), color: "#7f2704", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A87,-13,11"), color: "#ffffff", alpha: 1, width: 1, dash: [] },
    ]);
    expect(startingAt(ops, "M285,-24")).toEqual([
      { op: "fill", path: expect.stringContaining("A287,-13,11"), color: "#fdd0a2", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A287,-13,11"), color: "#ffffff", alpha: 1, width: 1, dash: [] },
    ]);
    // Chip in stage s2 at (442, −4): paper fill, outline in the (neutral) value colour.
    expect(startingAt(ops, "M454,-4")).toEqual([
      { op: "fill", path: expect.stringContaining("A490,8,12"), color: "#ffffff", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A490,8,12"), color: "#8c8c8c", alpha: 1, width: 1, dash: [] },
    ]);
    const texts = ops.filter((o) => o.op === "fillText" && !cards.includes(o.text ?? "") && !o.text?.startsWith("Stage"));
    expect(texts.map(({ text, at, color, font: f, align, baseline }) => ({ text, at, color, font: f, align, baseline }))).toEqual([
      { text: "⏱ 25 %", at: [250, -74], color: "#1f1f1f", font: font("11px"), align: "center", baseline: "alphabetic" },
      { text: "⇐ 100 %", at: [250, 130.5], color: "#1f1f1f", font: font("11px"), align: "center", baseline: "alphabetic" },
      { text: "↻ 75 %", at: [506, -6], color: "#1f1f1f", font: font("11px"), align: "left", baseline: "alphabetic" },
      // A badge without a glyph: a dot in contrasting ink and the share once, beside it.
      { text: "●", at: [87, -12.5], color: "#ffffff", font: font("600 11px"), align: "center", baseline: "middle" },
      { text: "100 %", at: [102, -12.5], color: "#1f1f1f", font: font("11px"), align: "left", baseline: "middle" },
      { text: "≥1", at: [286, -12.5], color: "#000000", font: font("600 11px"), align: "center", baseline: "middle" },
      { text: "25 %", at: [302, -12.5], color: "#1f1f1f", font: font("11px"), align: "left", baseline: "middle" },
      // The map-level chip ("Scope") is not drawn on the map.
      { text: "◔", at: [450, 8.5], color: "#1f1f1f", font: font("11px"), align: "left", baseline: "middle" },
      { text: "Late", at: [462.4, 8.5], color: "#1f1f1f", font: font("11px"), align: "left", baseline: "middle" },
    ]);
    // Labels beside lines and badges carry a paper halo.
    expect(ops.filter((o) => o.op === "strokeText").map((o) => [o.text, o.color, o.width])).toEqual([
      ["⏱ 25 %", "#ffffff", 2], ["⇐ 100 %", "#ffffff", 2], ["↻ 75 %", "#ffffff", 2], ["100 %", "#ffffff", 2], ["25 %", "#ffffff", 2],
    ]);
  });

  it("draws a chip's gauge and its label in bold before the text", () => {
    const chip: Overlay = { kind: "chip", target: "s2", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", value: 0.5, gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const scene = prepareScene(graph, positions, { overlays: [chip], selfLoops: false, lodBySize: false });
    const { ctx, ops } = drawingContext();
    drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    // The chip ends at 502 and is 159.1 wide: padding 16, glyph 12.4, gauge 46 and 14 characters of 6.05 by the estimate, so it starts at 342.9.
    // Track 40 × 6 at (363.3, 5) with radius 3 in the line colour, 0.7 of it filled, the tick at 2 / 3.
    expect(startingAt(ops, "M366.3,5")).toEqual([{ op: "fill", path: expect.stringContaining("A400.3,8,3"), color: defaultTokens.line, alpha: 1 }]);
    const track = ops.findIndex((o) => o.path?.startsWith("M366.3,5"));
    expect(ops.slice(track + 1).filter((o) => o.op === "fillRect")).toEqual([
      { op: "fillRect", path: "R363.3,5,28,6", color: "#fd8d3c", alpha: 1 },
      { op: "fillRect", path: "R388.97,4,2,8", color: "#1f1f1f", alpha: 1 },
    ]);
    // The lead in bold, the text after its measured width (9 characters × 6 in this context).
    const texts = ops.filter((o) => o.op === "fillText" && !cards.includes(o.text ?? "") && !o.text?.startsWith("Stage"));
    expect(texts.map(({ text, at, font: f }) => ({ text, at, font: f }))).toEqual([
      { text: "◔", at: [350.9, 8.5], font: font("11px") },
      { text: "Touches: ", at: [409.3, 8.5], font: font("600 11px") },
      { text: "2.1 ⌀", at: [463.3, 8.5], font: font("11px") },
    ]);
  });

  it("paints the arcs above the edges and below the nodes and their badges, on the map and in toPNG", () => {
    // What each call paints: the edges a → b and b → c, the two arcs, the three nodes' outlines and the two badges.
    const parts: [string, string][] = [
      ["edge", "M100,20 L200,20"], ["edge", "M300,20 L400,20"],
      ["arc", "M50,0 C50,-88,450,-88,450,0"], ["arc", "M450,40 C450,142,50,142,50,40"],
      ["node", "M4,0 L96,0"], ["node", "M204,0 L296,0"], ["node", "M404,0 L496,0"],
      ["badge", "M87,-24"], ["badge", "M285,-24"],
    ];
    const order = (ops: Op[]) => ops.flatMap((o) => (o.op === "stroke" ? parts.filter(([, at]) => o.path?.startsWith(at)).map(([part]) => part) : []));
    const painted = ["edge", "edge", "arc", "arc", "node", "node", "node", "badge", "badge"];
    expect(order(draw())).toEqual(painted);
    const scene = prepareScene(graph, positions, { overlays, selfLoops: false, lodBySize: false });
    const culled = drawingContext();
    // The view reaches 100 above the map, where the arcs and badges are.
    drawScene(culled.ctx, scene, { x: 0, y: 100, zoom: 1, width: 1000, height: 600 }, undefined, { cull: true });
    expect(order(culled.ops)).toEqual(painted);
    const png = drawingContext();
    toPNGCanvas({ graph, positions, overlays, selfLoops: false }, { legend: false, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
    expect(order(png.ops)).toEqual(painted);
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
    expect(startingAt(hovered, "M285,-24")[0].color).toBe(defaultTokens.focus);
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
  const drawElements = (state?: DrawState, zoom = 1, given = elements.graph, textMeasure?: TextMeasure) => {
    const scene = prepareScene(given, elements.positions, { style: elements.style, selfLoops: false, lodBySize: false, textMeasure });
    const { ctx, ops } = drawingContext();
    drawScene(ctx, scene, { x: 0, y: 0, zoom, width: 1000, height: 600 }, state, { cull: false });
    return ops;
  };
  const written = (ops: Op[]) => ops.filter((o) => o.op === "fillText").map(({ text, at, color, font: f, align, baseline }) => ({ text, at, color, font: f, align, baseline }));

  it("draws every node kind's outline, band and border from its mark", () => {
    const ops = drawElements();
    // The start event: a circle of radius 18 on paper in ink, 1 wide; the end event's border is 2 wide.
    expect(ops.filter((o) => o.path === "A18,20,18")).toEqual([
      { op: "fill", path: "A18,20,18", color: "#ffffff", alpha: 1 },
      { op: "stroke", path: "A18,20,18", color: "#1f1f1f", alpha: 1, width: 1, dash: [] },
    ]);
    expect(ops.find((o) => o.op === "stroke" && o.path === "A858,20,18")).toMatchObject({ width: 2 });
    // The gateway: a diamond in its box.
    expect(startingAt(ops, "M342,-2")).toEqual([
      { op: "fill", path: "M342,-2 L364,20 L342,42 L320,20 Z", color: "#ffffff", alpha: 1 },
      { op: "stroke", path: "M342,-2 L364,20 L342,42 L320,20 Z", color: "#1f1f1f", alpha: 1, width: 1, dash: [] },
    ]);
    // The note: on the surface colour, a dotted border in its colour, no band; corners of 4.
    expect(startingAt(ops, "M644,0")).toEqual([
      { op: "fill", path: expect.stringContaining("A796,4,4"), color: "#f6f7f9", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A796,4,4"), color: "#8c8c8c", alpha: 1, width: 1, dash: [2, 3] },
    ]);
    // Cards: on paper with a 1 wide neutral outline and a band 8 wide in their colour; the re-added activity is dashed.
    expect(ops.filter((o) => o.op === "fillRect" && o.color === "#8c8c8c").map((o) => o.path)).toEqual(["R100,0,8,40", "R400,0,8,56", "R400,100,8,40"]);
    expect(startingAt(ops, "M404,0")).toEqual([
      { op: "fill", path: expect.stringContaining("A596,4,4"), color: "#ffffff", alpha: 1 },
      { op: "stroke", path: expect.stringContaining("A596,4,4"), color: "#8c94a1", alpha: 1, width: 1, dash: [] },
    ]);
    expect(startingAt(ops, "M404,100").find((o) => o.op === "stroke")).toMatchObject({ color: "#8c94a1", width: 1, dash: [4, 3] });
  });

  it("draws a card's frequency cue inside its outline, under its band and texts", () => {
    const ops = drawElements(undefined, 1, { ...elements.graph, meta: { cases: 2468 } });
    // 1,234 of 2,468 cases: the stripe and the foot half of the inner width 180 − 8 − 1 from the band's end.
    const card = ops.findIndex((o) => o.op === "stroke" && o.path?.startsWith("M104,0"));
    expect(ops.slice(card + 1, card + 4)).toEqual([
      { op: "fillRect", path: "R108,1,85.5,38", color: "#e6e8ec", alpha: 1 },
      { op: "fillRect", path: "R108,36,85.5,3", color: "#5f6672", alpha: 1 },
      { op: "fillRect", path: "R100,0,8,40", color: "#8c8c8c", alpha: 1 },
    ]);
  });

  it("writes every node's and edge's texts where its mark puts them", () => {
    const text = (t: string, at: [number, number], f: string, align = "left", baseline = "middle", color = "#1f1f1f") => ({ text: t, at, color, font: font(f), align, baseline });
    const name = (t: string, at: [number, number], weight = "500") => text(t, at, `${weight} 13px`, "left", "alphabetic");
    const number = (count: string, share: string, x: number, y: number, after: number) => [text(count, [x, y], "600 11px", "left", "alphabetic"), text(share, [after, y], "11px", "left", "alphabetic", "#5b6270")];
    expect(written(drawElements())).toEqual([
      // The event's label below its circle.
      text("Start", [18, 53], "11px", "center", "alphabetic"),
      name("Check invoice", [116, 16.05]),
      ...number("1,234", "· –", 116, 30.35, 150.25),
      text("+", [342, 21], "600 15px", "center"),
      // The stage's card, its name semibold.
      name("Payment", [416, 24.05], "600"),
      ...number("1,500", "· –", 416, 38.35, 450.25),
      // The note's label at 11 px, as on the map.
      text("Ask the vendor twice", [656, 30], "11px"),
      text("End", [858, 53], "11px", "center", "alphabetic"),
      name("Re-added", [416, 116.05]),
      ...number("–", "· –", 416, 130.35, 426.05),
      // Edge counts with a halo, 4 above the middle of the route; the flow edge carries its count too.
      text("1.2k", [68, 16], "11px", "center", "alphabetic"),
      text("12", [300, 16], "11px", "center", "alphabetic"),
      text("3", [500, 74], "11px", "center", "alphabetic"),
    ]);
    // The constraint edge in mechanism blue, dotted.
    expect(startingAt(drawElements(), "M364,20")).toEqual([{ op: "stroke", path: "M364,20 L382,20 L382,28 L400,28", color: "#0072B2", alpha: 1, width: 1, dash: [2, 4] }]);
  });

  it("keeps the gateway's glyph and the note's label when zoomed out", () => {
    expect(written(drawElements(undefined, 0.1)).map((t) => t.text)).toEqual(["+", "Ask the vendor twice"]);
  });

  it("writes names as the scene's measure wrapped and cut them, whatever the context measures", () => {
    const long = { ...elements.graph, nodes: elements.graph.nodes.map((n) => (n.id === "a" ? { ...n, label: "Change Approval for Purchase Order Item of a Framework Contract" } : n)) };
    const names = (measure?: TextMeasure) => written(drawElements(undefined, 1, long, measure)).filter((t) => t.font === font("500 13px")).map((t) => t.text);
    // The context measures 6 per character. A 180 wide card leaves its name 154 inside the padding and the outline: by the
    // estimate (7.15 at 13 px) 21 characters a line, the second line 20 and the ellipsis.
    expect(names()).toEqual(["Change Approval for", "Purchase Order Item…", "Re-added"]);
    // A measure of 6 per character: 25 a line, the second line 24 and the ellipsis.
    expect(names((s) => Array.from(s).length * 6)).toEqual(["Change Approval for", "Purchase Order Item of a…", "Re-added"]);
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
    expect(startingAt(ops, "M280,30")).toEqual([{ op: "stroke", path: "M280,30 L320,30", color: "#123456", alpha: 1, width: 1, dash: [] }]);
  });

  it("outlines a hovered card in the ink and a selected or focused one in the focus colour, and keeps its fill", () => {
    const card = (state: Partial<DrawState>) => startingAt(drawElements({ selection: { nodes: [], edges: [], groups: [] }, ...state }), "M104,0").slice(0, 2).map((o) => o.color);
    expect(card({})).toEqual(["#ffffff", "#8c94a1"]);
    expect(card({ hovered: "a" })).toEqual(["#ffffff", "#1f1f1f"]);
    expect(card({ selection: { nodes: ["a"], edges: [], groups: [] } })).toEqual(["#ffffff", defaultTokens.focus]);
    expect(card({ focused: "a" })).toEqual(["#ffffff", defaultTokens.focus]);
  });
});

describe("Canvas arrowheads and pattern twins from the token table", () => {
  it("ends every edge in the map's arrowhead: 3 long, 4.8 wide, outlined by 0.6, its tip on the route's end", () => {
    const scene = prepareScene(elements.graph, elements.positions, { style: elements.style, selfLoops: false, lodBySize: false });
    const { ctx, ops } = drawingContext();
    drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    // start → a ends at (100, 20) heading right; s → r ends at (500, 100) heading down.
    const right = "M100,20 L97,22.4 L97,17.6 Z";
    const down = "M500,100 L497.6,97 L502.4,97 Z";
    expect(ops.filter((o) => o.path === right)).toEqual([
      { op: "fill", path: right, color: "#8c8c8c", alpha: 1 },
      { op: "stroke", path: right, color: "#8c8c8c", alpha: 1, width: 0.6, dash: [] },
    ]);
    expect(ops.filter((o) => o.path === down).map((o) => o.op)).toEqual(["fill", "stroke"]);
  });

  it("draws the 6-unit tiles of the pattern twins: lines at 0.6, a dot of radius 1 at 0.7, in the ink", () => {
    const tiles: { size: [number, number]; ops: Op[] }[] = [];
    const scene = prepareScene(elements.graph, elements.positions, { style: elements.style, selfLoops: false, lodBySize: false });
    const nodes = scene.nodes.map((n) => (n.node.id === "a" ? { ...n, mark: { ...n.mark, pattern: "dots" as const } } : n.node.id === "s" ? { ...n, mark: { ...n.mark, pattern: "diagonal" as const } } : n));
    const { ctx } = drawingContext();
    const createCanvas = (width: number, height: number) => {
      const tile = drawingContext();
      tiles.push({ size: [width, height], ops: tile.ops });
      return { width, height, getContext: () => tile.ctx };
    };
    drawScene(Object.assign(ctx, { createPattern: () => ({}) as CanvasPattern }), { ...scene, nodes }, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false, createCanvas: createCanvas as never });
    expect(tiles).toEqual([
      { size: [6, 6], ops: [{ op: "fill", path: "M4,3 A3,3,1", color: "#1f1f1f", alpha: 0.7 }] },
      { size: [6, 6], ops: [{ op: "stroke", path: "M0,6 L6,0", color: "#1f1f1f", alpha: 0.6, width: 1, dash: [] }] },
    ]);
  });
});
