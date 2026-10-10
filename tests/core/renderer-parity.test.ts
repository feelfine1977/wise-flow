import { describe, expect, it } from "vitest";
import { type FlowGraph, buildScene, createPositions, estimateTextWidth, toSVG } from "../../src/index";
import { type PreparedScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { readCanvasMap, readPng } from "../browser/parity/canvas";
import { type Listed, checkExpected, dash, differences, exportedMarks, kindsOf, paint } from "../browser/parity/drawn";
import { readSvg } from "../browser/parity/svg";

/**
 * The readers and the check of the parity test (`tests/browser/parity.spec.ts`)
 * on a small scene in Node: the SVG export, the Canvas map and the PNG export
 * read alike, a stroke width changed in one renderer is a new difference, and
 * a listed difference that is gone or changed in extent fails the check.
 */

const graph: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "Approve", group: "g", metrics: { cases: 10 } },
    { id: "b", kind: "activity", label: "Book", group: "g", metrics: { cases: 5 } },
    { id: "end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    { id: "start->a", kind: "follows", source: "start", target: "a", metrics: { count: 10 } },
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 5 } },
    { id: "b->end", kind: "follows", source: "b", target: "end", metrics: { count: 5 } },
  ],
  groups: [{ id: "g", kind: "stage", label: "Stage" }],
};
const positions = createPositions(
  {
    nodes: { start: { x: 0, y: 6, width: 36, height: 36 }, a: { x: 100, y: 0, width: 180, height: 48 }, b: { x: 400, y: 0, width: 180, height: 48 }, end: { x: 700, y: 6, width: 36, height: 36 } },
    groups: { g: { x: 80, y: -40, width: 520, height: 120 } },
    edges: {},
  },
  "dagre",
  "RIGHT",
);
const overlays = [{ kind: "badge" as const, target: "a", payload: { glyph: "!", value: 0.5 } }];
const scene = buildScene(graph, positions, { overlays });
const kinds = kindsOf(scene);
const measure = (text: string, font: string) => estimateTextWidth(text, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) });

const svg = () => readSvg(toSVG({ graph, positions, overlays }), exportedMarks(scene));
const canvas = (prepared: PreparedScene = prepareScene(graph, positions, { overlays })) => readCanvasMap(prepared, kinds, measure);
const png = () => readPng((createCanvas) => toPNGCanvas({ graph, positions, overlays }, { scale: 1, createCanvas }), prepareScene(graph, positions, { overlays, lodBySize: false }), kinds, measure);

describe("the parity readers", () => {
  it("read the SVG export's elements from their attributes", () => {
    const drawn = svg();
    expect([...drawn.keys()].sort()).toEqual(["edge:a->b", "edge:b->end", "edge:start->a", "group:g", "mark:badge:a:0", "node:a", "node:b", "node:end", "node:start"]);
    expect(drawn.get("node:a")).toMatchObject({ box: { x: 100, y: 0, width: 180, height: 48 }, props: { fill: "#ffffff", outlineWidth: "2", dash: "none", radius: "6", band: expect.stringMatching(/^#[0-9a-f]{6} 8$/) } });
    expect(drawn.get("node:a")!.texts.map((t) => [t.text, t.size])).toEqual([["Approve", 12], ["10", 9]]);
    // Start and end events: a circle of the box's half width, outlined 1.5 and 3 in the ink.
    expect(drawn.get("node:start")).toMatchObject({ box: { x: 0, y: 6, width: 36, height: 36 }, props: { outline: "#1f1f1f", outlineWidth: "1.5", radius: "18" } });
    expect(drawn.get("node:end")!.props.outlineWidth).toBe("3");
    expect(drawn.get("group:g")).toMatchObject({ box: { x: 80, y: -40, width: 520, height: 120 }, props: { dash: "6 4", outlineWidth: "1.5", radius: "10" } });
    // An edge's box is its route's: from the right of `a` to the left of `b` at their middle.
    expect(drawn.get("edge:a->b")!.box).toEqual({ x: 280, y: 24, width: 120, height: 0 });
  });

  it("find the Canvas map and the PNG export drawing as the SVG export does, but for the group's outline", () => {
    const color = scene.scales.categorical("g").color.toLowerCase();
    const found = differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas(), png: png() } }]);
    expect(found).toEqual(
      (["canvas", "png"] as const).map((renderer) => ({ renderer, kind: "group:stage", property: "outline", svg: `${color}@0.5`, other: color, fixtures: ["small"], elements: 1 })),
    );
  });

  it("report a stroke width changed in one renderer as a difference the list lacks", () => {
    const listed = differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas() } }]);
    const prepared = prepareScene(graph, positions, { overlays });
    // The Canvas map draws every edge one unit wider than the scene says.
    const wider: PreparedScene = { ...prepared, edges: prepared.edges.map((e) => ({ ...e, mark: { ...e.mark, width: e.mark.width + 1 } })) };
    const found = differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas(wider) } }]);
    const { added, gone, changed } = checkExpected(found, listed);
    expect(gone).toEqual([]);
    expect(changed).toEqual([]);
    // One entry per width the scene gives its edges, which together hold all three edges.
    expect(new Set(added.map((d) => [d.renderer, d.kind, d.property, Number(d.other) - Number(d.svg)].join(" ")))).toEqual(new Set(["canvas edge:follows outlineWidth 1"]));
    expect(added.reduce((n, d) => n + d.elements, 0)).toBe(3);
  });

  it("fail the check for a listed difference that is gone or found on other elements", () => {
    const entry: Listed = { renderer: "dom", kind: "node:event", property: "outlineWidth", svg: "1.5", other: "2", fixtures: ["small"], elements: 2 };
    expect(checkExpected([], [entry])).toEqual({ added: [], gone: [entry], changed: [] });
    const fewer = { ...entry, elements: 1 };
    expect(checkExpected([fewer], [entry])).toEqual({ added: [], gone: [], changed: [{ expected: entry, found: fewer }] });
    const elsewhere = { ...entry, fixtures: ["global", "small"] };
    expect(checkExpected([elsewhere], [entry]).changed).toHaveLength(1);
    expect(checkExpected([entry], [entry])).toEqual({ added: [], gone: [], changed: [] });
  });

  it("write paints and dashes alike from every renderer's notation", () => {
    expect(paint("#1F1F1F")).toBe("#1f1f1f");
    expect(paint("#abc")).toBe("#aabbcc");
    // 0x0f of 255 is 0.0588; the SVG export writes the same fill as 0.06.
    expect(paint("#0072b20f")).toBe("#0072b2@0.06");
    expect(paint("#0072b2", 0.06)).toBe("#0072b2@0.06");
    expect(paint("rgb(0, 114, 178)")).toBe("#0072b2");
    expect(paint("rgba(0, 0, 0, 0.12)")).toBe("#000000@0.12");
    expect(paint("color(srgb 0 0.447059 0.698039 / 0.06)")).toBe("#0072b2@0.06");
    expect(paint("rgba(0, 0, 0, 0)")).toBe("none");
    expect(paint('url("#wf-mark-outofscope")', 0.55)).toBe("pattern@0.55");
    expect(paint("none")).toBe("none");
    expect(dash([4, 3])).toBe("4 3");
    expect(dash("6px, 4px")).toBe("6 4");
    expect(dash([])).toBe("none");
    expect(dash("none")).toBe("none");
  });
});
