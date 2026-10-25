import { describe, expect, it } from "vitest";
import { type ActivityLabelOptions, type FlowGraph, type Overlay, type Positions, type TextMeasure, activityNodeSize, buildScene, defaultTheme, estimateTextWidth, figureFrame, fitText, legendLayout, toSVG, truncateText, wrapActivityText, wrapText } from "../../src/index";
import { type DrawContext, canvasTextMeasure, drawLegend, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { leadMeasure } from "../../src/core/text";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
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
    // The estimate at 13 px is 7.15 per character: 29 fit 210.
    expect(wrapActivityText("Change Approval for Purchase Order", 210)).toEqual(["Change Approval for Purchase", "Order"]);
    expect(wrapActivityText("漢字漢字漢字", 28).join("")).toBe("漢字漢字漢字");
  });

  it("measures a text of many words on one line about as often as the logarithm of their number, not once per word", () => {
    let measures = 0;
    let measured = 0;
    const counting: TextMeasure = (s) => {
      measures++;
      measured += s.length;
      return s.length * 10;
    };
    for (const words of [1000, 4000]) {
      measures = 0;
      measured = 0;
      const text = Array.from({ length: words }, (_, i) => `w${i % 10}`).join(" ");
      expect(wrapText(text, 1e9, { size: 10 }, counting)).toEqual([text]);
      // Doubling finds the 4,096 or 1,024 words beyond the first in 12 or 10 steps and halving in as many: each measure
      // holds at most the whole text, so the characters measured are a few times its length, not a thousand times.
      expect(measures, `${words} words`).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(words)) + 2);
      expect(measured, `${words} words`).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(words)) * text.length);
    }
  });

  it("wraps as a reference that adds a word, and where a word is wider than a line a character, at a time", () => {
    /** Obviously greedy: the line takes the next word while it fits, a word breaks before the first character that does not. */
    function reference(text: string, width: number, font: { size: number }, measure: TextMeasure): string[] {
      const fits = (s: string) => measure(s, font) <= Math.max(font.size, width);
      const lines: string[] = [];
      let line = "";
      for (const word of text.trim().split(/\s+/u)) {
        if (line && fits(`${line} ${word}`)) {
          line = `${line} ${word}`;
          continue;
        }
        if (line) lines.push(line);
        line = "";
        for (const char of Array.from(word)) {
          if (line && !fits(line + char)) {
            lines.push(line);
            line = "";
          }
          line += char;
        }
      }
      if (line) lines.push(line);
      return lines.length ? lines : [""];
    }
    const alphabet = ["a", "b", "W", "i", "ü", "漢", "😀", "-", "."];
    for (const seed of seeds(caseCount(200))) {
      const rng = createRandom(seed);
      const words = Array.from({ length: rng.int(0, 40) }, () => Array.from({ length: rng.int(1, rng.chance(0.1) ? 60 : 12) }, () => rng.pick(alphabet)).join(""));
      const text = words.join(rng.pick([" ", "  ", "\t", " \n "]));
      const width = rng.pick([0, 5, 10, 40, 80, 150, 400, 1e6]);
      const measure = rng.pick([estimateTextWidth, em, tens]);
      expect(wrapText(text, width, { size: 10 }, measure), caseLabel(seed, `${words.length} words at ${width}`)).toEqual(reference(text, width, { size: 10 }, measure));
    }
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

  it("shortens and wraps node labels by it, so that the SVG export, the Canvas map and the PNG export write the same", () => {
    const scene = buildScene(elements.graph, elements.positions, options);
    const texts = (id: string) => scene.nodeMarks.find((m) => m.id === id)!.texts.map((t) => t.text);
    // A start event's ▶, then its label below it with 96 at 11 px: "Start" fits. The note leaves 136 at 11 px: eleven and the ellipsis.
    expect(texts("start")).toEqual(["▶", "Start"]);
    expect(texts("n")).toEqual(["Ask the ven…"]);
    // The activity's name has 154 at 13 px (180 less the padding 24 and the outline 2 × 1): "Check invoice" is 169, so it wraps.
    expect(texts("a")).toEqual(["Check", "invoice", "1,234", "· –"]);
    expect(scene.textMeasure).toBe(em);
    // Without one the scene takes the estimate.
    expect(buildScene(elements.graph, elements.positions, { style: elements.style }).nodeMarks.find((m) => m.id === "n")!.texts[0].text).toBe("Ask the vendor twice");

    const svg = toSVG({ graph: elements.graph, positions: elements.positions, style: elements.style, selfLoops: false }, { textMeasure: em, legend: false });
    expect(svg).toContain(">Ask the ven…</text>");
    expect(svg).toContain(">Check</text>");
    const canvas = recording();
    drawScene(canvas.ctx, prepareScene(elements.graph, elements.positions, { ...options, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    expect(canvas.texts).toEqual(expect.arrayContaining(["Ask the ven…", "Check", "invoice"]));
    expect(canvas.texts).not.toContain("Ask the vendor twice");
    const png = recording();
    toPNGCanvas({ graph: elements.graph, positions: elements.positions, style: elements.style, selfLoops: false }, { textMeasure: em, legend: false, scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => png.ctx }) });
    expect(png.texts).toEqual(expect.arrayContaining(["Ask the ven…", "Check", "invoice"]));
  });

  it("gives a card's name the room the interactive map gives it: inside the padding and a solid outline", () => {
    // One unit per character: a word one unit wider than the room breaks before its last character.
    const ones: TextMeasure = (s) => Array.from(s).length;
    const long = (n: number) => "a".repeat(n);
    const graph: FlowGraph = { ...elements.graph, nodes: elements.graph.nodes.map((n) => (n.id === "a" ? { ...n, label: long(155) } : n.id === "r" ? { ...n, label: long(157) } : n.id === "s" ? { ...n, label: long(175) } : n)) };
    const scene = buildScene(graph, elements.positions, { ...options, textMeasure: ones });
    const name = (id: string) => scene.nodeMarks.find((m) => m.id === id)!.texts.filter((t) => t.role === "nameLine").map((t) => t.text.length);
    // 180 less the padding 16 + 8 and the outline 1 on both sides.
    expect(name("a")).toEqual([154, 1]);
    // A stage: 200 less the same.
    expect(name("s")).toEqual([174, 1]);
    // A re-added activity is outlined dashed over its box: 156.
    expect(name("r")).toEqual([156, 1]);
    // An event's label has 96 below it, a note's 136.
    const room = (id: string) => scene.nodeMarks.find((m) => m.id === id)!.texts.find((t) => t.role === "label")!.maxWidth;
    expect([room("start"), room("n")]).toEqual([96, 136]);
  });

  it("wraps activity names by it and sizes their boxes once, whatever the measure", () => {
    const graph: FlowGraph = { nodes: [{ id: "cap", kind: "activity", label: "Change Approval for Purchase Order", metrics: { cases: 4400 } }], edges: [] };
    const names: ActivityLabelOptions = { mode: "names", references: {} };
    // The room of 280 less 26 holds 19 characters of a full em at 13 px; the estimate holds 35.
    const box = activityNodeSize(graph.nodes[0], names, em);
    expect(box).toEqual({ width: 280, height: 64 });
    expect(activityNodeSize(graph.nodes[0], names)).toEqual(box);
    const positions: Positions = { nodes: { cap: { x: 0, y: 0, ...box } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, ...box }, engine: "given", direction: "RIGHT" } as Positions;
    const lines = (measure?: TextMeasure) => buildScene(graph, positions, { activityLabels: names, textMeasure: measure }).nodeMarks[0].texts.map((t) => t.text);
    expect(lines(em)).toEqual(["Change Approval for", "Purchase Order", "4,400", "· –"]);
    expect(lines()).toEqual(["Change Approval for Purchase Order", "4,400", "· –"]);
    const canvas = recording();
    drawScene(canvas.ctx, prepareScene(graph, positions, { activityLabels: names, textMeasure: em, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 400, height: 200 }, undefined, { cull: false });
    expect(canvas.texts).toEqual(["Change Approval for", "Purchase Order", "4,400", "· –"]);
    expect(prepareScene(graph, positions, { activityLabels: names, textMeasure: em }).nodes[0].activityLines).toEqual({ name: ["Change Approval for", "Purchase Order"], counts: ["4,400 · –"] });
  });

  it("sizes a chip by it, its bold label measured in bold", () => {
    const bold: TextMeasure = (s, font) => Array.from(s).length * (font.weight ? 7 : 5);
    const chip: Overlay = { kind: "chip", target: "s", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const mark = buildScene(elements.graph, elements.positions, { ...options, overlays: [chip], textMeasure: bold }).marks.find((m) => m.kind === "chip")!;
    // Padding 16, glyph 12.4, gauge 46, "Touches: " 9 × 7 in bold and "2.1 ⌀" 5 × 5.
    expect(mark.box.width).toBeCloseTo(162.4);
    expect(mark.texts[1]).toMatchObject({ lead: "Touches: ", text: "2.1 ⌀" });
  });

  it("sizes a chip at the theme's chip text, so that its text fits the box it gets", () => {
    const share: Overlay = { kind: "chip", target: "s", payload: { glyph: "◔", value: 0.125, gauge: { value: 0.125, threshold: 0.1 } } };
    const large = { ...defaultTheme, text: { ...defaultTheme.text, chip: { ...defaultTheme.text.chip, size: 20 } } };
    const mark = buildScene(elements.graph, elements.positions, { ...options, overlays: [share], theme: large, textMeasure: tens }).marks.find((m) => m.kind === "chip")!;
    // Padding 16, glyph 12.4, gauge 46 and "13 %" at 10 per character, whatever the size.
    expect(mark.box.width).toBeCloseTo(114.4);
    expect(mark.texts[1].text).toBe("13 %");
    // At 20 px by the estimate: 4 × 11 = 44 for the text.
    const estimated = buildScene(elements.graph, elements.positions, { ...options, overlays: [share], theme: large, textMeasure: undefined }).marks.find((m) => m.kind === "chip")!;
    expect(estimated.box.width).toBeCloseTo(118.4);
    expect(estimated.texts[1].text).toBe("13 %");
  });

  it("wraps the legend's keys and widens the figure for its note by it", () => {
    const badge: Overlay = { kind: "badge", target: "a", payload: { glyph: "●", value: 0.2 } };
    const scene = buildScene(elements.graph, elements.positions, { ...options, overlays: [badge] });
    // 164 at 11 px: thirteen characters a line, so four lines; by the estimate (6.05 each) twenty-seven, so two.
    const key = legendLayout(scene.legend, { measure: scene.textMeasure }).rows.find((r) => r.row.kind === "key" && r.row.key === "badge")!;
    expect(key.texts).toEqual(["Constraint", "badge with", "shortfall", "share"]);
    expect(legendLayout(scene.legend).rows.find((r) => r.row.kind === "key" && r.row.key === "badge")!.texts).toEqual(["Constraint badge with", "shortfall share"]);
    const svg = toSVG({ graph: elements.graph, positions: elements.positions, overlays: [badge], style: elements.style, selfLoops: false }, { textMeasure: em });
    expect(svg).toContain(">Constraint</text>");
    expect(svg).toContain(">badge with</text>");
    const canvas = recording();
    drawLegend(canvas.ctx, prepareScene(elements.graph, elements.positions, { ...options, overlays: [badge] }), 0, 0, 188);
    expect(canvas.texts).toEqual(expect.arrayContaining(["Constraint", "badge with", "shortfall", "share"]));
    // "Showing 1 of 6 flows" at 11 px is 20 × 11 wide, wider than a map of one 50 wide node.
    const one: FlowGraph = { nodes: [{ id: "x", kind: "activity", label: "X" }], edges: [] };
    const box = { x: 0, y: 0, width: 50, height: 40 };
    const small = buildScene(one, { nodes: { x: box }, groups: {}, edges: {}, bounds: box, engine: "given", direction: "RIGHT" } as Positions, { textMeasure: em });
    const frame = figureFrame(small, { legend: false, withheld: { shown: 1, total: 6 }, padding: 0 });
    expect(frame.note?.text).toBe("Showing 1 of 6 flows");
    expect(frame.width).toBe(220);
  });
});
