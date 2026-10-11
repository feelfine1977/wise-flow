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

  it("resolves one mark per placed node with shape, colours, band, border and texts", () => {
    const base = { color: neutral, pattern: "solid", fill: "paper", reconnected: false };
    expect(scene.nodeMarks.map(strip)).toEqual([
      // A start event: a circle in its box outlined 2 wide, as the interactive map draws it, its label inside at 9 px, cut to the circle's width less 4.
      {
        ...base, id: "start", kind: "event", box: positions.nodes.start, shape: "circle", radius: 18, stroke: { paint: "ink", width: 2 },
        texts: [text({ role: "label", text: "Start", x: 18, y: 20, size: 9, anchor: "middle", maxWidth: 32, lod: "labels" })],
      },
      // An activity: border in its colour, an 8 wide band, the label 16 in and centred, the cases in the lower right corner.
      // The label has the room the interactive map gives it before the cases: 180 − 24 − 2 × 2 − 6 − 4 × 4.95 (the estimate at 9 px).
      {
        ...base, id: "a", kind: "activity", box: positions.nodes.a, shape: "box", radius: 6, stroke: { paint: "value", width: 2 }, band: 8,
        texts: [
          text({ role: "label", text: "Check invoice", x: 116, y: 20, size: 12, maxWidth: 126.2, lod: "labels" }),
          text({ role: "count", text: "1.2k", x: 274, y: 35, size: 9, anchor: "end", baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
      // An AND gateway: a diamond with the glyph + at every zoom, not its label.
      {
        ...base, id: "g", kind: "gateway", box: positions.nodes.g, shape: "diamond", radius: 0, stroke: { paint: "ink", width: 1.5 },
        texts: [text({ role: "glyph", text: "+", x: 342, y: 21, size: 14, weight: 700, anchor: "middle" })],
      },
      // A stage: a 3 wide border, a semibold label and its members before the cases; the label's room 200 − 24 − 2 × 3 − 6 − 8 × 4.95.
      {
        ...base, id: "s", kind: "stage", box: positions.nodes.s, shape: "box", radius: 6, stroke: { paint: "value", width: 3 }, band: 8,
        texts: [
          text({ role: "label", text: "Payment", x: 416, y: 28, size: 12, weight: 600, maxWidth: 124.4, lod: "labels" }),
          text({ role: "count", text: "4 · 1.5k", x: 594, y: 51, size: 9, anchor: "end", baseline: "alphabetic", paint: "inkMuted", lod: "labels" }),
        ],
      },
      // A note: on the surface colour with a solid border (a dash means "not directly observed"), no band, its 11 px label at every zoom.
      {
        ...base, id: "n", kind: "note", box: positions.nodes.n, shape: "box", radius: 6, fill: "surface", stroke: { paint: "value", width: 2 },
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
      // Constraint edges: in the accent, solid; without a count no label.
      { id: "g->s", kind: "constraint", points: positions.edges["g->s"].points, color: "#b84a00", width: 1.5, reconnected: false, texts: [] },
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

  it("resolves a stage group's tint, solid outline, title and chip anchor, in the graph's order", () => {
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
      radius: 10,
      // Its colour at 0.06, outlined in it 1.5 wide, solid.
      fill: { paint: "value", opacity: 0.06 },
      stroke: { paint: "value", width: 1.5 },
      rule: undefined,
      // The title 12 in from the left, on a baseline 22 below the top, at 14 px semibold.
      texts: [text({ role: "label", text: "Payment", x: 212, y: 22, size: 14, weight: 600, baseline: "alphabetic" })],
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
    // Stage bands run along the flow: outlined left and right, their rule 3 wide along the top; every other band at 0.02.
    expect([first.radius, first.fill, first.stroke, first.rule]).toEqual([0, { paint: "value", opacity: 0.06 }, { paint: "line", width: 1, sides: ["left", "right"] }, { paint: "value", width: 3, side: "top" }]);
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
