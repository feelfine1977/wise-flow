import { describe, expect, it } from "vitest";
import { type ElementText, type FlowGraph, buildScene, createPositions, edgeLabelPoint, routeMidpoint } from "../../src/index";
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

  // A card's texts as one block in the middle above its 3 high foot: a 16 high name line per line of the name and the
  // 14 high number line; a baseline centres the capitals (0.7 em) in its line.
  const name = (top: number) => top + (16 + 0.7 * 13) / 2;
  const number = (top: number, lines = 1) => top + lines * 16 + (14 + 0.7 * 11) / 2;

  it("resolves one mark per placed node with shape, colours, band, border and texts", () => {
    const base = { color: neutral, pattern: "solid", fill: "paper", reconnected: false, outOfScope: false };
    expect(scene.nodeMarks.map(strip)).toEqual([
      // A start event: a circle in its box outlined 1 wide, its label below it at 11 px, 4 below the box, cut to 96.
      {
        ...base, id: "start", kind: "event", box: positions.nodes.start, shape: "circle", radius: 18, stroke: { paint: "ink", width: 1 },
        texts: [text({ role: "label", text: "Start", x: 18, y: 2 + 36 + 4 + 11, size: 11, anchor: "middle", baseline: "alphabetic", maxWidth: 96, lod: "labels" })],
      },
      // An activity's card: a 1 wide neutral outline, corners of 4, an 8 wide band, the name 16 in at 13 px medium and the
      // number line: the cases in ink and semibold, then their share, muted, 4 after them (the estimate: 5 × 0.55 × 11).
      // The graph has no cases of its log, so no share and no cue. The block of 30 lies in the 40 − 2 − 3 high middle: 2.5 below the outline.
      {
        ...base, id: "a", kind: "activity", box: positions.nodes.a, shape: "box", radius: 4, stroke: { paint: "lineStrong", width: 1 }, band: 8,
        texts: [
          text({ role: "nameLine", text: "Check invoice", x: 116, y: name(3.5), size: 13, weight: 500, baseline: "alphabetic", lod: "labels" }),
          text({ role: "countLine", text: "1,234", x: 116, y: number(3.5), size: 11, weight: 600, baseline: "alphabetic", lod: "labels" }),
          text({ role: "share", text: "· –", x: 116 + 5 * 0.55 * 11 + 4, y: number(3.5), size: 11, baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
      // An AND gateway: a diamond outlined 1 wide with the glyph + at 15 px semibold at every zoom, not its label.
      {
        ...base, id: "g", kind: "gateway", box: positions.nodes.g, shape: "diamond", radius: 0, stroke: { paint: "ink", width: 1 },
        texts: [text({ role: "glyph", text: "+", x: 342, y: 21, size: 15, weight: 600, anchor: "middle" })],
      },
      // A stage: the same card with a semibold name; its block lies (56 − 2 − 3 − 30) / 2 below the outline.
      {
        ...base, id: "s", kind: "stage", box: positions.nodes.s, shape: "box", radius: 4, stroke: { paint: "lineStrong", width: 1 }, band: 8,
        texts: [
          text({ role: "nameLine", text: "Payment", x: 416, y: name(11.5), size: 13, weight: 600, baseline: "alphabetic", lod: "labels" }),
          text({ role: "countLine", text: "1,500", x: 416, y: number(11.5), size: 11, weight: 600, baseline: "alphabetic", lod: "labels" }),
          text({ role: "share", text: "· –", x: 416 + 5 * 0.55 * 11 + 4, y: number(11.5), size: 11, baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
      // A note: on the surface colour with a dotted border, no band, its 11 px label at every zoom.
      {
        ...base, id: "n", kind: "note", box: positions.nodes.n, shape: "box", radius: 4, fill: "surface", stroke: { paint: "value", width: 1, dash: [2, 3] },
        texts: [text({ role: "label", text: "Ask the vendor twice", x: 656, y: 30, size: 11, maxWidth: 136 })],
      },
      // An end event has a 2 wide border.
      {
        ...base, id: "end", kind: "event", box: positions.nodes.end, shape: "circle", radius: 18, stroke: { paint: "ink", width: 2 },
        texts: [text({ role: "label", text: "End", x: 858, y: 2 + 36 + 4 + 11, size: 11, anchor: "middle", baseline: "alphabetic", maxWidth: 96, lod: "labels" })],
      },
      // A re-added activity is dashed; without cases its number line shows a dash for both.
      {
        ...base, id: "r", kind: "activity", box: positions.nodes.r, shape: "box", radius: 4, stroke: { paint: "lineStrong", width: 1, dash: [4, 3] }, band: 8, reconnected: true,
        texts: [
          text({ role: "nameLine", text: "Re-added", x: 416, y: name(103.5), size: 13, weight: 500, baseline: "alphabetic", lod: "labels" }),
          text({ role: "countLine", text: "–", x: 416, y: number(103.5), size: 11, weight: 600, baseline: "alphabetic", lod: "labels" }),
          text({ role: "share", text: "· –", x: 416 + 0.55 * 11 + 4, y: number(103.5), size: 11, baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
    ]);
  });

  it("writes the same card when activity labels are set, with the name or reference at every zoom", () => {
    const labelled = buildScene(graph, positions, { style, activityLabels: { mode: "ids", references: {}, caseLabel: "items" } });
    const a = labelled.nodeMarks.find((m) => m.id === "a")!;
    // References are given in id order: a → A01, r → A02.
    expect(a.title).toBe("A01 — Check invoice. 1,234 items · events unavailable.");
    expect(a.texts).toEqual([
      text({ role: "nameLine", text: "A01", x: 116, y: name(3.5), size: 13, weight: 500, baseline: "alphabetic" }),
      text({ role: "countLine", text: "1,234", x: 116, y: number(3.5), size: 11, weight: 600, baseline: "alphabetic" }),
      text({ role: "share", text: "· –", x: 116 + 5 * 0.55 * 11 + 4, y: number(3.5), size: 11, baseline: "alphabetic", paint: "inkMuted" }),
    ]);
    // Without the number line the name lies alone in the middle: (40 − 2 − 3 − 16) / 2 below the outline.
    const hidden = buildScene(graph, positions, { style, activityLabels: { mode: "ids", references: {}, showCounts: false } });
    expect(hidden.nodeMarks.find((m) => m.id === "a")!.texts).toEqual([text({ role: "nameLine", text: "A01", x: 116, y: name(1 + 9.5), size: 13, weight: 500, baseline: "alphabetic" })]);
    // A stage's card keeps its levels of detail.
    expect(labelled.nodeMarks.find((m) => m.id === "s")!.texts.map((t) => [t.role, t.lod])).toEqual([["nameLine", "labels"], ["countLine", "labels"], ["share", "labels"]]);
  });

  it("places a gateway's glyph by its tag and formats counts in the locale", () => {
    const or = { ...graph, nodes: graph.nodes.map((n) => (n.id === "g" ? { ...n, tags: ["or"] } : n)) };
    const xor = { ...graph, nodes: graph.nodes.map((n) => (n.id === "g" ? { ...n, tags: ["xor"] } : n)) };
    expect(buildScene(or, positions, { style }).nodeMarks.find((m) => m.id === "g")!.texts[0].text).toBe("○");
    expect(buildScene(xor, positions, { style }).nodeMarks.find((m) => m.id === "g")!.texts[0].text).toBe("×");
    const german = buildScene({ ...graph, meta: { cases: 2000 } }, positions, { style, locale: "de" });
    expect(german.nodeMarks.find((m) => m.id === "s")!.texts.slice(1).map((t) => t.text)).toEqual(["1.500", "· 75 %"]);
  });
});

describe("edge marks", () => {
  const scene = buildScene(graph, positions, { style });

  it("resolves one mark per edge between placed nodes with route, colour, dash and count label", () => {
    const count = (t: string, x: number, y: number) => text({ role: "count", text: t, x, y, size: 11, anchor: "middle", baseline: "alphabetic", halo: true, lod: "edgeLabels" });
    expect(scene.edgeMarks.map(strip)).toEqual([
      // The label sits 4 above the middle of the route.
      { id: "start->a", kind: "follows", points: positions.edges["start->a"].points, color: neutral, width: 1, reconnected: false, texts: [count("1.2k", 68, 16)] },
      // Without a route: a straight line between the two boxes; flow edges carry their count too.
      { id: "a->g", kind: "flow", points: [{ x: 280, y: 20 }, { x: 320, y: 20 }], color: neutral, width: 1, reconnected: false, texts: [count("12", 300, 16)] },
      // Constraint edges: mechanism blue, dotted; without a count no label.
      { id: "g->s", kind: "constraint", points: positions.edges["g->s"].points, color: "#0072B2", width: 1, dash: [2, 4], reconnected: false, texts: [] },
      { id: "s->r", kind: "follows", points: positions.edges["s->r"].points, color: neutral, width: 1, dash: [6, 5], reconnected: true, texts: [count("3", 500, 74)] },
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

describe("group marks", () => {
  const grouped: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: "A", group: "order" },
      { id: "b", kind: "activity", label: "B", group: "pay" },
    ],
    edges: [],
    groups: [
      { id: "pay", kind: "stage", label: "Payment" },
      { id: "order", kind: "stage", label: "Order" },
    ],
  };
  const boxes = createPositions(
    {
      nodes: { a: { x: 20, y: 40, width: 100, height: 40 }, b: { x: 220, y: 40, width: 100, height: 40 } },
      groups: { order: { x: 0, y: 0, width: 140, height: 100 }, pay: { x: 200, y: 0, width: 140, height: 100 } },
      edges: {},
    },
    "given",
    "RIGHT",
  );
  const strip = <T extends { group: unknown }>({ group, ...rest }: T) => (expect(group).toBeDefined(), rest);

  it("resolves a stage group's solid hairline without a tint, its muted title and its chip anchor, in the graph's order", () => {
    const scene = buildScene(grouped, boxes);
    const [pay] = scene.groupMarks.map(strip);
    expect(scene.groupMarks.map((m) => m.id)).toEqual(["pay", "order"]);
    expect(pay).toEqual({
      id: "pay",
      kind: "stage",
      box: boxes.groups.pay,
      color: scene.scales.categorical("pay").color,
      pattern: scene.scales.categorical("pay").pattern,
      band: undefined,
      radius: 8,
      // No tint (its colour at 0), a solid hairline in the line colour, 1 wide.
      fill: { paint: "value", opacity: 0 },
      stroke: { paint: "line", width: 1 },
      rule: undefined,
      // The title 12 in from the left, on a baseline 22 below the top, at 13 px semibold in the muted ink.
      texts: [text({ role: "label", text: "Payment", x: 212, y: 22, size: 13, weight: 600, baseline: "alphabetic", paint: "inkMuted" })],
      // Chips end 8 in from the right edge, the first 6 below the top.
      chipAnchor: { x: 332, y: 6 },
    });
  });

  it("places a group's chips from its chip anchor: the first ends there, the next 28 below", () => {
    const chip = { kind: "chip" as const, target: "pay", payload: { glyph: "⚖", label: "Four eyes", text: "met" } };
    const scene = buildScene({ ...grouped, overlays: [chip, chip] }, boxes);
    const chips = scene.marks.filter((m) => m.kind === "chip").map((m) => m.box);
    // The anchor of `pay` (200, 0, 140 wide) is (332, 6); chips are 24 high with 4 between them.
    expect(chips.map((b) => [b.x + b.width, b.y])).toEqual([
      [332, 6],
      [332, 34],
    ]);
  });

  it("outlines bands between each other in the line colour and rules them along the side they start at", () => {
    const along = buildScene(grouped, boxes, { lanes: "stages" });
    const [first, second] = [...along.groupMarks].sort((a, b) => a.band!.index - b.band!.index);
    // Stage bands run along the flow: outlined left and right, their rule 2 wide along the top; every other band at 0.02.
    expect([first.radius, first.fill, first.stroke, first.rule]).toEqual([0, { paint: "value", opacity: 0.06 }, { paint: "line", width: 1, sides: ["left", "right"] }, { paint: "value", width: 2, side: "top" }]);
    expect(second.fill).toEqual({ paint: "value", opacity: 0.02 });
    const lanes: FlowGraph = { ...grouped, groups: grouped.groups!.map((g) => ({ ...g, kind: "lane" as const })) };
    const across = buildScene(lanes, boxes, { lanes: "roles" });
    // Lanes run across the flow: outlined above and below, their rule along the left.
    expect(across.groupMarks.map((m) => [m.stroke.sides, m.rule?.side])).toEqual([
      [["top", "bottom"], "left"],
      [["top", "bottom"], "left"],
    ]);
  });
});
