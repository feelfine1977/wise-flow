import { describe, expect, it } from "vitest";
import { type ElementText, type MarkText, buildScene, edgeLabelPoint, estimateTextWidth, fitText, routeMidpoint, truncateText } from "../../src/index";
import { graph, positions, style } from "./element-kinds";

const neutral = "#8c8c8c";
const text = (t: Partial<ElementText> & Pick<ElementText, "text" | "x" | "y" | "size" | "role">): ElementText => ({ anchor: "start", baseline: "middle", paint: "ink", halo: false, ...t });
const strip = <T extends { node?: unknown; edge?: unknown }>(m: T) => {
  const { node, edge, ...rest } = m;
  expect(node ?? edge).toBeDefined();
  return rest;
};

describe("node marks", () => {
  const scene = buildScene(graph, positions, { style });

  it("resolves one mark per placed node with shape, colours, band, border and texts", () => {
    const base = { color: neutral, pattern: "solid", fill: "paper", reconnected: false };
    expect(scene.nodeMarks.map(strip)).toEqual([
      // A start event: a circle in its box, its label inside at 9 px, cut to the circle's width less 4.
      {
        ...base, id: "start", kind: "event", box: positions.nodes.start, shape: "circle", radius: 18, stroke: { paint: "ink", width: 1.5 },
        texts: [text({ role: "label", text: "Start", x: 18, y: 20, size: 9, anchor: "middle", maxWidth: 32, lod: "labels" })],
      },
      // An activity: border in its colour, an 8 wide band, the label 16 in and centred, the cases in the lower right corner.
      {
        ...base, id: "a", kind: "activity", box: positions.nodes.a, shape: "box", radius: 6, stroke: { paint: "value", width: 2 }, band: 8,
        texts: [
          text({ role: "label", text: "Check invoice", x: 116, y: 20, size: 12, maxWidth: 156, lod: "labels" }),
          text({ role: "count", text: "1.2k", x: 274, y: 35, size: 9, anchor: "end", baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
      // An AND gateway: a diamond with the glyph + at every zoom, not its label.
      {
        ...base, id: "g", kind: "gateway", box: positions.nodes.g, shape: "diamond", radius: 0, stroke: { paint: "ink", width: 1.5 },
        texts: [text({ role: "glyph", text: "+", x: 342, y: 21, size: 14, weight: 700, anchor: "middle" })],
      },
      // A stage: a 3 wide border, a semibold label and its members before the cases.
      {
        ...base, id: "s", kind: "stage", box: positions.nodes.s, shape: "box", radius: 6, stroke: { paint: "value", width: 3 }, band: 8,
        texts: [
          text({ role: "label", text: "Payment", x: 416, y: 28, size: 12, weight: 600, maxWidth: 176, lod: "labels" }),
          text({ role: "count", text: "4 · 1.5k", x: 594, y: 51, size: 9, anchor: "end", baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
      // A note: on the surface colour with a dotted border, no band, its 11 px label at every zoom.
      {
        ...base, id: "n", kind: "note", box: positions.nodes.n, shape: "box", radius: 6, fill: "surface", stroke: { paint: "value", width: 2, dash: [2, 3] },
        texts: [text({ role: "label", text: "Ask the vendor twice", x: 656, y: 30, size: 11, maxWidth: 136 })],
      },
      // An end event has a 3 wide border.
      {
        ...base, id: "end", kind: "event", box: positions.nodes.end, shape: "circle", radius: 18, stroke: { paint: "ink", width: 3 },
        texts: [text({ role: "label", text: "End", x: 858, y: 20, size: 9, anchor: "middle", maxWidth: 32, lod: "labels" })],
      },
      // A re-added activity is dashed; without cases it shows no count.
      {
        ...base, id: "r", kind: "activity", box: positions.nodes.r, shape: "box", radius: 6, stroke: { paint: "value", width: 2, dash: [4, 3] }, band: 8, reconnected: true,
        texts: [text({ role: "label", text: "Re-added", x: 416, y: 120, size: 12, maxWidth: 156, lod: "labels" })],
      },
    ]);
  });

  it("writes an activity's name and count lines when activity labels are set", () => {
    const labelled = buildScene(graph, positions, { style, activityLabels: { mode: "ids", references: {}, caseLabel: "items" } });
    const a = labelled.nodeMarks.find((m) => m.id === "a")!;
    // References are given in id order: a → A01, r → A02.
    expect(a.title).toBe("A01 — Check invoice. 1,234 items · events unavailable.");
    expect(a.texts).toEqual([
      text({ role: "nameLine", text: "A01", x: 116, y: 24, size: 14, baseline: "alphabetic" }),
      text({ role: "countLine", text: "1.2k items", x: 116, y: 42, size: 12, baseline: "alphabetic" }),
    ]);
    const hidden = buildScene(graph, positions, { style, activityLabels: { mode: "ids", references: {}, showCounts: false } });
    expect(hidden.nodeMarks.find((m) => m.id === "a")!.texts.map((t) => t.role)).toEqual(["nameLine"]);
    // Other kinds keep their own texts.
    expect(labelled.nodeMarks.find((m) => m.id === "s")!.texts.map((t) => t.role)).toEqual(["label", "count"]);
  });

  it("places a gateway's glyph by its tag and formats counts in the locale", () => {
    const or = { ...graph, nodes: graph.nodes.map((n) => (n.id === "g" ? { ...n, tags: ["or"] } : n)) };
    const xor = { ...graph, nodes: graph.nodes.map((n) => (n.id === "g" ? { ...n, tags: ["xor"] } : n)) };
    expect(buildScene(or, positions, { style }).nodeMarks.find((m) => m.id === "g")!.texts[0].text).toBe("○");
    expect(buildScene(xor, positions, { style }).nodeMarks.find((m) => m.id === "g")!.texts[0].text).toBe("×");
    const german = buildScene(graph, positions, { style, locale: "de" });
    expect(german.nodeMarks.find((m) => m.id === "s")!.texts[1].text).toBe("4 · 1,5k");
  });
});

describe("edge marks", () => {
  const scene = buildScene(graph, positions, { style });

  it("resolves one mark per edge between placed nodes with route, colour, dash and count label", () => {
    const count = (t: string, x: number, y: number) => text({ role: "count", text: t, x, y, size: 10, anchor: "middle", baseline: "alphabetic", halo: true, lod: "edgeLabels" });
    expect(scene.edgeMarks.map(strip)).toEqual([
      // The label sits 4 above the middle of the route.
      { id: "start->a", kind: "follows", points: positions.edges["start->a"].points, color: neutral, width: 1.5, reconnected: false, texts: [count("1.2k", 68, 16)] },
      // Without a route: a straight line between the two boxes; flow edges carry their count too.
      { id: "a->g", kind: "flow", points: [{ x: 280, y: 20 }, { x: 320, y: 20 }], color: neutral, width: 1.5, reconnected: false, texts: [count("12", 300, 16)] },
      // Constraint edges: mechanism blue, dotted; without a count no label.
      { id: "g->s", kind: "constraint", points: positions.edges["g->s"].points, color: "#0072B2", width: 1.5, dash: [2, 4], reconnected: false, texts: [] },
      { id: "s->r", kind: "follows", points: positions.edges["s->r"].points, color: neutral, width: 1.5, dash: [6, 5], reconnected: true, texts: [count("3", 500, 74)] },
    ]);
  });

  it("finds the label point at half the route's length", () => {
    // Segments 18, 8 and 18 long: half of 44 lies 4 into the second.
    expect(routeMidpoint(positions.edges["g->s"].points)).toEqual({ x: 382, y: 24 });
    expect(edgeLabelPoint(positions.edges["g->s"].points)).toEqual({ x: 382, y: 20 });
    expect(routeMidpoint([])).toEqual({ x: 0, y: 0 });
    expect(routeMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
    expect(routeMidpoint([{ x: 3, y: 4 }, { x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });
});

describe("label truncation", () => {
  it("keeps the longest start that fits with an ellipsis, by the given measure", () => {
    const tens = (s: string) => Array.from(s).length * 10;
    expect(truncateText("abcdefg", 70, { size: 10 }, tens)).toBe("abcdefg");
    // "abc…" is 40 wide, "abcd…" 50.
    expect(truncateText("abcdefg", 45, { size: 10 }, tens)).toBe("abc…");
    // At least one character.
    expect(truncateText("abcdefg", 5, { size: 10 }, tens)).toBe("a…");
    // Characters outside the basic plane are not split.
    expect(truncateText("😀😀😀😀", 30, { size: 10 }, tens)).toBe("😀😀…");
  });

  it("estimates 0.55 em per character without font metrics", () => {
    expect(estimateTextWidth("abcd", { size: 10 })).toBeCloseTo(22);
    // 156 wide at 12 px holds 23 characters of 6.6, so 22 and the ellipsis.
    const long = "Change Approval for Purchase Order";
    expect(truncateText(long, 156, { size: 12 })).toBe("Change Approval for Pu…");
    expect(truncateText("Record Invoice Receipt", 156, { size: 12 })).toBe("Record Invoice Receipt");
  });

  it("fits a mark text to its width with the renderer's measure", () => {
    const t: MarkText = { text: "Ask the vendor twice", x: 0, y: 0, size: 11, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: 60 };
    // 6.05 per character at 11 px: eight and the ellipsis fit 60.
    expect(fitText(t)).toBe("Ask the …");
    const sizes: number[] = [];
    expect(fitText(t, (s, font) => (sizes.push(font.size), s.length))).toBe("Ask the vendor twice");
    expect(sizes).toEqual([11]);
    expect(fitText({ ...t, maxWidth: undefined }, () => Infinity)).toBe("Ask the vendor twice");
  });
});
