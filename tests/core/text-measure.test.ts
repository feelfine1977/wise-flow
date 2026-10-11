import { describe, expect, it } from "vitest";
import { type ActivityLabelOptions, type FlowGraph, type Overlay, type Positions, type TextMeasure, activityNodeSize, buildScene, estimateTextWidth, figureFrame, fitText, legendLayout, toSVG, truncateText, wrapActivityText, wrapText } from "../../src/index";
import { type DrawContext, canvasTextMeasure, drawLegend, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { leadMeasure } from "../../src/core/text";
import * as elements from "./element-kinds";

/** A full em per character: wider than the estimate, so that what it shortens shows which measure was used. */
const em: TextMeasure = (s, font) => Array.from(s).length * font.size;
const tens: TextMeasure = (s) => Array.from(s).length * 10;

/** A context that records the texts written and measures every text as 0 wide, so it never shortens one itself. */
function recording() {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => (key === "measureText" ? () => ({ width: 0 }) : key === "fillText" ? (s: string) => texts.push(s) : key === "createLinearGradient" || key === "createPattern" ? undefined : () => undefined),
    set: () => true,
  }) as unknown as DrawContext;
  return { ctx, texts };
}

describe("the text measure", () => {
  it("estimates 0.55 em per character and a full em for a character of a wide script", () => {
    expect(estimateTextWidth("abcd", { size: 10 })).toBeCloseTo(22);
    // Greek, punctuation, the ellipsis and the legend's glyphs are narrow; CJK and emoji wide.
    expect(estimateTextWidth("Ελλάδα…⌒", { size: 10 })).toBeCloseTo(44);
    expect(estimateTextWidth("漢字", { size: 10 })).toBe(20);
    expect(estimateTextWidth("a😀", { size: 10 })).toBeCloseTo(15.5);
    // 156 wide at 12 px holds 23 characters of 6.6, so 22 and the ellipsis.
    expect(truncateText("Change Approval for Purchase Order", 156, { size: 12 })).toBe("Change Approval for Pu…");
    expect(truncateText("Record Invoice Receipt", 156, { size: 12 })).toBe("Record Invoice Receipt");
  });

  it("keeps the longest start that fits with an ellipsis, by the given measure", () => {
    expect(truncateText("abcdefg", 70, { size: 10 }, tens)).toBe("abcdefg");
    // "abc…" is 40 wide, "abcd…" 50.
    expect(truncateText("abcdefg", 45, { size: 10 }, tens)).toBe("abc…");
    // At least one character.
    expect(truncateText("abcdefg", 5, { size: 10 }, tens)).toBe("a…");
    // Characters outside the basic plane are not split.
    expect(truncateText("😀😀😀😀", 30, { size: 10 }, tens)).toBe("😀😀…");
    // A width over the limit by rounding alone fits.
    expect(truncateText("abc", 30 - 1e-9, { size: 10 }, tens)).toBe("abc");
  });

  it("fits a mark text to its width with a measure", () => {
    const sizes: number[] = [];
    const t = { text: "Ask the vendor twice", x: 0, y: 0, size: 11, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: 60 } as const;
    // 6.05 per character at 11 px: eight and the ellipsis fit 60.
    expect(fitText(t)).toBe("Ask the …");
    expect(fitText(t, (s, font) => (sizes.push(font.size), s.length))).toBe("Ask the vendor twice");
    expect(sizes).toEqual([11]);
    expect(fitText({ ...t, maxWidth: undefined }, () => Infinity)).toBe("Ask the vendor twice");
  });

  it("wraps words into lines by the measure and breaks a word wider than a line", () => {
    expect(wrapText("Ask the vendor twice", 80, { size: 10 }, tens)).toEqual(["Ask the", "vendor", "twice"]);
    expect(wrapText("Abcdefghij", 40, { size: 10 }, tens)).toEqual(["Abcd", "efgh", "ij"]);
    // A line is at least the font's size wide.
    expect(wrapText("ab", 0, { size: 10 }, tens)).toEqual(["a", "b"]);
    expect(wrapText("  ", 40, { size: 10 }, tens)).toEqual([""]);
    const one = "Ask";
    expect(wrapText(one, 80, { size: 10 }, tens)[0]).toBe(one);
    // The estimate at 14 px is 7.7 per character: 32 fit the 248 of a named activity.
    expect(wrapActivityText("Change Approval for Purchase Order", 248)).toEqual(["Change Approval for Purchase", "Order"]);
    expect(wrapActivityText("漢字漢字漢字", 28).join("")).toBe("漢字漢字漢字");
  });

  it("measures a lead in its own weight before the rest", () => {
    const bold: TextMeasure = (s, font) => Array.from(s).length * (font.weight ? 7 : 5);
    expect(leadMeasure(bold, "Ab", 700)("Abc", { size: 10 })).toBe(19);
    expect(leadMeasure(bold, "", 700)).toBe(bold);
  });
});

describe("the text measure of a browser", () => {
  it("measures with a Canvas context in the font a text is drawn in, once per font and text", () => {
    const fonts: string[] = [];
    const context = { font: "", measureText: (s: string) => (fonts.push(context.font), { width: s.length * (context.font.startsWith("700") ? 7 : 5) }) };
    const measure = canvasTextMeasure("Inter", context);
    expect(measure("abc", { size: 10, weight: 700 })).toBe(21);
    expect(measure("abc", { size: 10 })).toBe(15);
    expect(measure("abc", { size: 10, weight: 700 })).toBe(21);
    expect(fonts).toEqual(["700 10px Inter", "10px Inter"]);
  });

  it("is the estimate where there is no Canvas", () => {
    // Node has no document.
    expect(canvasTextMeasure()).toBe(estimateTextWidth);
    expect(canvasTextMeasure("Inter", null)).toBe(estimateTextWidth);
  });
});

describe("a scene built with a text measure", () => {
  const options = { style: elements.style, selfLoops: false, textMeasure: em } as const;

  it("shortens node labels by it, so that the SVG export, the Canvas map and the PNG export write the same", () => {
    const scene = buildScene(elements.graph, elements.positions, options);
    const label = (id: string) => scene.nodeMarks.find((m) => m.id === id)!.texts[0].text;
    // A start event leaves 32 at 9 px: two characters and the ellipsis. The note leaves 136 at 11 px: eleven and the ellipsis.
    expect(label("start")).toBe("St…");
    expect(label("n")).toBe("Ask the ven…");
    // The activity leaves 110 at 12 px (180 less padding 24, outline 2 × 2, gap 6 and "1.2k" 4 × 9): eight and the ellipsis.
    expect(label("a")).toBe("Check in…");
    expect(scene.textMeasure).toBe(em);
    // Without one the scene takes the estimate.
    expect(buildScene(elements.graph, elements.positions, { style: elements.style }).nodeMarks.find((m) => m.id === "n")!.texts[0].text).toBe("Ask the vendor twice");

    const svg = toSVG({ graph: elements.graph, positions: elements.positions, style: elements.style, selfLoops: false }, { textMeasure: em, legend: false });
    expect(svg).toContain(">St…</text>");
    expect(svg).toContain(">Ask the ven…</text>");
    const canvas = recording();
    drawScene(canvas.ctx, prepareScene(elements.graph, elements.positions, { ...options, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    expect(canvas.texts).toEqual(expect.arrayContaining(["St…", "Ask the ven…", "Check in…"]));
    expect(canvas.texts).not.toContain("Ask the vendor twice");
    const png = recording();
    toPNGCanvas({ graph: elements.graph, positions: elements.positions, style: elements.style, selfLoops: false }, { textMeasure: em, legend: false, scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => png.ctx }) });
    expect(png.texts).toEqual(expect.arrayContaining(["St…", "Ask the ven…"]));
  });

  it("gives a label the room the interactive map gives it: inside a solid outline and before the count on its line", () => {
    const scene = buildScene(elements.graph, elements.positions, { ...options, textMeasure: tens });
    const room = (id: string) => scene.nodeMarks.find((m) => m.id === id)!.texts.find((t) => t.role === "label")!.maxWidth;
    // 180 less the padding 16 + 8, the outline 2 on both sides, the gap 6 and "1.2k" at 10 per character.
    expect(room("a")).toBe(106);
    // A stage: outlined 3 wide, "4 · 1.5k" after it.
    expect(room("s")).toBe(200 - 24 - 6 - 6 - 80);
    // A re-added activity is outlined dashed over its box and has no count; a note has no count either.
    expect(room("r")).toBe(156);
    expect(room("n")).toBe(136);
  });

  it("wraps activity names by it and sizes their boxes with the same measure", () => {
    const graph: FlowGraph = { nodes: [{ id: "cap", kind: "activity", label: "Change Approval for Purchase Order", metrics: { cases: 4400 } }], edges: [] };
    const names: ActivityLabelOptions = { mode: "names", references: {} };
    // 248 at 14 px holds 17 characters of a full em; the estimate holds 32.
    const box = activityNodeSize(graph.nodes[0], names, em);
    expect(box).toEqual({ width: 280, height: 20 + 3 * 18 + 16 });
    expect(activityNodeSize(graph.nodes[0], names)).toEqual({ width: 280, height: 20 + 2 * 18 + 16 });
    const positions: Positions = { nodes: { cap: { x: 0, y: 0, ...box } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, ...box }, engine: "given", direction: "RIGHT" } as Positions;
    const lines = (measure?: TextMeasure) => buildScene(graph, positions, { activityLabels: names, textMeasure: measure }).nodeMarks[0].texts.map((t) => t.text);
    expect(lines(em)).toEqual(["Change Approval", "for Purchase", "Order", "4.4k cases"]);
    expect(lines()).toEqual(["Change Approval for Purchase", "Order", "4.4k cases"]);
    const canvas = recording();
    drawScene(canvas.ctx, prepareScene(graph, positions, { activityLabels: names, textMeasure: em, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 400, height: 200 }, undefined, { cull: false });
    expect(canvas.texts).toEqual(["Change Approval", "for Purchase", "Order", "4.4k cases"]);
    expect(prepareScene(graph, positions, { activityLabels: names, textMeasure: em }).nodes[0].activityLines).toEqual({ name: ["Change Approval", "for Purchase", "Order"], counts: ["4.4k cases"] });
  });

  it("sizes a chip by it, its bold label measured in bold", () => {
    const bold: TextMeasure = (s, font) => Array.from(s).length * (font.weight ? 7 : 5);
    const chip: Overlay = { kind: "chip", target: "s", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const mark = buildScene(elements.graph, elements.positions, { ...options, overlays: [chip], textMeasure: bold }).marks.find((m) => m.kind === "chip")!;
    // Padding 16, glyph 12.4, gauge 46, "Touches: " 9 × 7 in bold and "2.1 ⌀" 5 × 5.
    expect(mark.box.width).toBeCloseTo(162.4);
    expect(mark.texts[1]).toMatchObject({ lead: "Touches: ", text: "2.1 ⌀" });
  });

  it("shortens the legend's texts and widens the figure for its note by it", () => {
    const badge: Overlay = { kind: "badge", target: "a", payload: { glyph: "●", value: 0.2 } };
    const scene = buildScene(elements.graph, elements.positions, { ...options, overlays: [badge] });
    // 164 at 9.5 px: sixteen characters and the ellipsis; by the estimate (5.225 each) thirty and the ellipsis.
    const key = legendLayout(scene.legend, { measure: scene.textMeasure }).rows.find((r) => r.row.kind === "key" && r.row.key === "badge")!;
    expect(key.texts).toEqual(["Constraint badge…"]);
    expect(legendLayout(scene.legend).rows.find((r) => r.row.kind === "key" && r.row.key === "badge")!.texts).toEqual(["Constraint badge with shortfal…"]);
    expect(toSVG({ graph: elements.graph, positions: elements.positions, overlays: [badge], style: elements.style, selfLoops: false }, { textMeasure: em })).toContain(">Constraint badge…</text>");
    const canvas = recording();
    drawLegend(canvas.ctx, prepareScene(elements.graph, elements.positions, { ...options, overlays: [badge] }), 0, 0, 188);
    expect(canvas.texts).toContain("Constraint badge…");
    // "Showing 1 of 6 flows" at 11 px is 20 × 11 wide, wider than a map of one 50 wide node.
    const one: FlowGraph = { nodes: [{ id: "x", kind: "activity", label: "X" }], edges: [] };
    const box = { x: 0, y: 0, width: 50, height: 40 };
    const small = buildScene(one, { nodes: { x: box }, groups: {}, edges: {}, bounds: box, engine: "given", direction: "RIGHT" } as Positions, { textMeasure: em });
    const frame = figureFrame(small, { legend: false, withheld: { shown: 1, total: 6 }, padding: 0 });
    expect(frame.note?.text).toBe("Showing 1 of 6 flows");
    expect(frame.width).toBe(220);
  });
});
