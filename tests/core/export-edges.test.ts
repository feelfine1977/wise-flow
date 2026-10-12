import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, type Positions, type SceneLegend, budgetEdges, buildScene, createPositions, figureFrame, toSVG } from "../../src/index";
import { type DrawContext, toPNGCanvas } from "../../src/canvas/index";
import { svgNote } from "../support/svg";

/** A hub `h` with a path `h-t1` … to each activity, with these counts, and the activities in a column. */
function hub(counts: number[]): { graph: FlowGraph; positions: Positions } {
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "Hub" }, ...counts.map((_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `T${k + 1}` }))];
  const edges: FlowEdge[] = counts.map((count, k) => ({ id: `h-t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count } }));
  const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, i === 0 ? { x: 0, y: 0, width: 100, height: 40 } : { x: 300, y: 80 * (i - 1), width: 100, height: 40 }]));
  return { graph: { nodes, edges }, positions: createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT") };
}

// Hand-ordered by count: h-t5 (70), h-t7 (60), h-t2 (50), h-t8 (40), h-t3 and h-t4 (30 each, by id), h-t6 (20), h-t1 (10).
const small = hub([10, 50, 30, 30, 70, 20, 60, 40]);
const all = ["h-t1", "h-t2", "h-t3", "h-t4", "h-t5", "h-t6", "h-t7", "h-t8"];

const svgEdges = (svg: string) => [...svg.matchAll(/<g class="wf-edge" data-id="([^"]*)"/g)].map((m) => m[1]).sort();
const viewBox = (svg: string) => /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);

/** A 2D context that records every text with the position and font it was drawn at. */
function recorder() {
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: "" as string, strokeStyle: "" as string, lineWidth: 1, font: "", globalAlpha: 1,
    textAlign: "left" as CanvasTextAlign, textBaseline: "alphabetic" as CanvasTextBaseline,
    lineJoin: "miter" as CanvasLineJoin, lineCap: "butt" as CanvasLineCap,
    save: noop, restore: noop, translate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, fillRect: noop, clearRect: noop, strokeText: noop, setLineDash: noop,
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, font: ctx.font });
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
  } satisfies DrawContext;
  return { texts, createCanvas: (width: number, height: number) => ({ width, height, getContext: () => ctx }) };
}

/** The count labels a PNG export without its legend wrote: one per drawn edge, each count distinct. */
const pngCounts = (texts: { text: string }[]) => texts.map((t) => t.text).filter((s) => /^\d+$/.test(s)).sort();
const countOf = Object.fromEntries(small.graph.edges.map((e) => [e.id, String(e.metrics!.count)]));

function png(options: Parameters<typeof toPNGCanvas>[1] = {}, scene: Parameters<typeof toPNGCanvas>[0] = small) {
  const rec = recorder();
  const out = toPNGCanvas(scene, { scale: 1, legend: false, createCanvas: rec.createCanvas, ...options });
  return { ...out, texts: rec.texts };
}

describe("exporting the edges a map shows", () => {
  // What a map reports while it draws three of its eight edges.
  const shown = { edges: ["h-t1", "h-t5", "h-t7"], total: 8 };

  it("draws exactly those edges in SVG, with the note stating both numbers", () => {
    const svg = toSVG(small, { edgeBudget: shown });
    expect(svgEdges(svg)).toEqual(["h-t1", "h-t5", "h-t7"]);
    expect(svgNote(svg)).toBe("Showing 3 of 8 flows");
  });

  it("draws exactly those edges in PNG, with the note stating both numbers", () => {
    const { texts } = png({ edgeBudget: shown });
    expect(pngCounts(texts)).toEqual(["10", "60", "70"]);
    expect(texts.filter((t) => t.text.startsWith("Showing"))).toMatchObject([{ text: "Showing 3 of 8 flows", font: expect.stringMatching(/^11px /) }]);
  });

  it("states the numbers of the map's note, also when the map counted only the edges in its view", () => {
    // A culled map counts the edges in its view; the figure says what the map said.
    expect(svgNote(toSVG(small, { edgeBudget: { edges: ["h-t5"], total: 4 } }))).toBe("Showing 1 of 4 flows");
  });

  it("names the note in the figure's accessible label, after the title or the map's description", () => {
    const label = (svg: string) => /^<svg [^>]*aria-label="([^"]*)"/.exec(svg)![1];
    expect(label(toSVG(small, { edgeBudget: shown }))).toBe("Process map with 9 nodes and 8 connections in 0 groups. Showing 3 of 8 flows.");
    expect(label(toSVG({ ...small, title: "Purchase to pay" }, { edgeBudget: shown }))).toBe("Purchase to pay. Showing 3 of 8 flows.");
    expect(label(toSVG({ ...small, locale: "de" }, { edgeBudget: shown }))).toBe("Prozesslandkarte mit 9 Knoten und 8 Verbindungen in 0 Gruppen. 3 von 8 Flüssen gezeigt.");
    // Without withheld edges the label is the title or the description alone, as before.
    expect(label(toSVG(small))).toBe("Process map with 9 nodes and 8 connections in 0 groups.");
    expect(label(toSVG({ ...small, title: "Purchase to pay" }, { edgeBudget: "all" }))).toBe("Purchase to pay");
  });

  it("writes the note in German with separators", () => {
    const large = hub(Array.from({ length: 1200 }, (_, k) => k + 1));
    const edges = large.graph.edges.slice(0, 1000).map((e) => e.id);
    const svg = toSVG({ ...large, locale: "de" }, { edgeBudget: { edges, total: 1200 } });
    expect(svgNote(svg)).toBe("1.000 von 1.200 Flüssen gezeigt");
    expect(png({ edgeBudget: { edges, total: 1200 } }, { ...large, locale: "de" }).texts.map((t) => t.text)).toContain("1.000 von 1.200 Flüssen gezeigt");
  });
});

describe("exporting with a budget", () => {
  it("draws every edge and no note with all, as without a budget", () => {
    const svg = toSVG(small, { edgeBudget: "all" });
    expect(svg).toBe(toSVG(small));
    expect(svgEdges(svg)).toEqual(all);
    expect(svgNote(svg)).toBeUndefined();
    const { texts } = png({ edgeBudget: "all" });
    expect(texts).toEqual(png().texts);
    expect(pngCounts(texts)).toEqual(all.map((id) => countOf[id]).sort());
  });

  it("draws by the map's order with a number: the n heaviest, ties by id", () => {
    // Four: h-t5, h-t7, h-t2, h-t8. Five adds h-t3 before h-t4 (both 30, by id).
    expect(svgEdges(toSVG(small, { edgeBudget: 4 }))).toEqual(["h-t2", "h-t5", "h-t7", "h-t8"]);
    expect(svgEdges(toSVG(small, { edgeBudget: 5 }))).toEqual(["h-t2", "h-t3", "h-t5", "h-t7", "h-t8"]);
    expect(svgNote(toSVG(small, { edgeBudget: 5 }))).toBe("Showing 5 of 8 flows");
    expect(pngCounts(png({ edgeBudget: 4 }).texts)).toEqual(["40", "50", "60", "70"]);
    // The map's own selection for the same budget names the same edges.
    const scene = buildScene(small.graph, small.positions);
    expect([...budgetEdges(scene, 4)!.drawn].map((i) => scene.edgeMarks[i].id).sort()).toEqual(["h-t2", "h-t5", "h-t7", "h-t8"]);
  });

  it("draws no note when the number is at least the edges", () => {
    expect(toSVG(small, { edgeBudget: 8 })).toBe(toSVG(small));
    expect(png({ edgeBudget: 8 }).texts).toEqual(png().texts);
  });
});

describe("the note in the figure frame", () => {
  const legend: SceneLegend = { title: "Legend", rows: [], items: [], keys: [], chips: [] };
  const framed = { graph: { nodes: [], edges: [] }, locale: "en" as const, bounds: { x: 0, y: 0, width: 400, height: 50 }, legend };

  it("adds a row under the map and the legend", () => {
    const plain = figureFrame(framed, { legend: false });
    const frame = figureFrame(framed, { legend: false, withheld: { shown: 3, total: 8 } });
    // The map 400 + 2 × 24 by 50 + 2 × 24; the note's baseline 12 below it, its row 16 high and the padding 24.
    expect([plain.width, plain.height]).toEqual([448, 98]);
    expect(frame.note).toEqual({ text: "Showing 3 of 8 flows", x: 24, y: 110 });
    expect([frame.width, frame.height]).toEqual([448, 138]);
  });

  it("widens a narrow figure so that the note fits", () => {
    // "Showing 2,000 of 49,999 flows" has 29 characters: 29 × 0.55 × 11 = 175.45 wide, and the padding on both sides.
    const frame = figureFrame({ ...framed, bounds: { x: 0, y: 0, width: 10, height: 10 } }, { legend: false, withheld: { shown: 2000, total: 49999 } });
    expect(frame.note!.text).toBe("Showing 2,000 of 49,999 flows");
    expect(frame.width).toBeCloseTo(175.45 + 48, 9);
    expect(frame.note!.x + 175.45).toBeLessThanOrEqual(frame.width - 24);
  });

  it("puts the activity key under the note and keeps the legend's rule beside the map", () => {
    const g: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }], edges: [] };
    const frame = figureFrame({ ...framed, graph: g, activityLabels: { mode: "ids", references: {} } }, { withheld: { shown: 3, total: 8 } });
    expect(frame.key.lines.length).toBeGreaterThan(0);
    // The legend's heading alone (26 + 2 × 24) is lower than the map (98).
    expect(frame.note!.y).toBe(110);
    expect(frame.key.y).toBe(98 + 16 + 24);
    expect(frame.height).toBe(98 + 16 + frame.key.lines.length * 16 + 48);
    expect(frame.legend!.rule.bottom).toBe(98 - 24);
  });

  it("is inside the exported figure in SVG and PNG", () => {
    // Two 10 × 10 activities one above the other with an edge each way: a figure narrower than its note.
    const narrow = {
      graph: { nodes: ["a", "b"].map((id): FlowNode => ({ id, kind: "activity", label: id })), edges: [{ id: "a-b", kind: "follows", source: "a", target: "b", metrics: { count: 5 } }, { id: "b-a", kind: "follows", source: "b", target: "a", metrics: { count: 9 } }] } satisfies FlowGraph,
      positions: createPositions({ nodes: { a: { x: 0, y: 0, width: 10, height: 10 }, b: { x: 0, y: 40, width: 10, height: 10 } }, groups: {}, edges: {} }, "given", "DOWN"),
    };
    const svg = toSVG(narrow, { legend: false, padding: 0, edgeBudget: 1 });
    const [w, h] = viewBox(svg);
    const at = /<text x="([\d.]+)" y="([\d.]+)"[^>]*class="wf-edge-note"/.exec(svg)!.slice(1).map(Number);
    // "Showing 1 of 2 flows": 20 × 0.55 × 11 = 121 wide, and the figure is exactly as wide.
    expect(w).toBeCloseTo(121, 9);
    expect(at[0]).toBeGreaterThanOrEqual(0);
    expect(at[0] + 121).toBeLessThanOrEqual(w);
    expect(at[1] + 4).toBeLessThanOrEqual(h);
    const out = png({ legend: false, padding: 0, edgeBudget: 1 }, narrow);
    expect([out.cssWidth, out.cssHeight]).toEqual([w, h]);
    const note = out.texts.find((t) => t.text === "Showing 1 of 2 flows")!;
    expect([note.x, note.y]).toEqual(at);
  });
});
