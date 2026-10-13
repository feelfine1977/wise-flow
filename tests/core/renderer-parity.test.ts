import { describe, expect, it } from "vitest";
import { type FlowGraph, type Theme, buildScene, createPositions, defaultTheme, estimateTextWidth, toSVG } from "../../src/index";
import { type PreparedScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { readCanvasMap, readPng } from "../browser/parity/canvas";
import { type Listed, checkExpected, dash, differences, exportedMarks, kindsOf, paint, shadow } from "../browser/parity/drawn";
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
  meta: { cases: 20 },
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
const overlays = [
  { kind: "badge" as const, target: "a", payload: { glyph: "!", value: 0.5 } },
  { kind: "arc" as const, target: "a->b", payload: { constraintType: "lag", source: "a", target: "b", value: 0.35, evaluated: 820 } },
];
const scene = buildScene(graph, positions, { overlays });
const kinds = kindsOf(scene);
const measure = (text: string, font: string) => estimateTextWidth(text, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) });

const svg = () => readSvg(toSVG({ graph, positions, overlays }), exportedMarks(scene));
const canvas = (prepared: PreparedScene = prepareScene(graph, positions, { overlays })) => readCanvasMap(prepared, kinds, measure);
const png = () => readPng((createCanvas) => toPNGCanvas({ graph, positions, overlays }, { scale: 1, createCanvas }), prepareScene(graph, positions, { overlays, lodBySize: false }), kinds, measure);

describe("the parity readers", () => {
  it("read the SVG export's elements from their attributes", () => {
    const drawn = svg();
    expect([...drawn.keys()].sort()).toEqual(["edge:a->b", "edge:b->end", "edge:start->a", "group:g", "mark:arc:a->b:0", "mark:badge:a:1", "node:a", "node:b", "node:end", "node:start"]);
    // A card: on paper, outlined 1 in the neutral line colour, the band, and the cue: 10 of 20 cases, half of 171 (85.5) to the pixel.
    expect(drawn.get("node:a")).toMatchObject({ box: { x: 100, y: 0, width: 180, height: 48 }, props: { fill: "#ffffff", outline: "#8c94a1", outlineWidth: "1", dash: "none", radius: "4", band: expect.stringMatching(/^#[0-9a-f]{6} 8$/), cue: "#e6e8ec 86", cueFoot: "#5f6672 86" } });
    expect(drawn.get("node:a")!.texts.map((t) => [t.text, t.size, t.weight, t.paint])).toEqual([["Approve", 13, 500, "#1f1f1f"], ["10", 11, 600, "#1f1f1f"], ["· 50 %", 11, 400, "#5b6270"]]);
    // A quarter: 42.75.
    expect(drawn.get("node:b")!.props).toMatchObject({ cue: "#e6e8ec 43", cueFoot: "#5f6672 43" });
    // Start and end events: a circle of the box's half width, outlined 1 and 2 in the ink; no cue.
    expect(drawn.get("node:start")).toMatchObject({ box: { x: 0, y: 6, width: 36, height: 36 }, props: { outline: "#1f1f1f", outlineWidth: "1", radius: "18", cue: "none", cueFoot: "none" } });
    expect(drawn.get("node:end")!.props.outlineWidth).toBe("2");
    expect(drawn.get("group:g")).toMatchObject({ box: { x: 80, y: -40, width: 520, height: 120 }, props: { fill: "none", outline: "#cfd4dc", dash: "none", outlineWidth: "1", radius: "8" } });
    // An edge's box is its line's: from the right of `a` towards the left of `b` at their middle. The path is √(5 / 10) × 8 =
    // 5.66 wide, so its head is ⌈4 × 5.66⌉ = 23: 9 × 23 / 20 = 10.35 wide with its outline, and the line ends 3.75 × 23 / 20 =
    // 4.31 before the route inside it; rounded corners.
    expect(drawn.get("edge:a->b")).toMatchObject({ box: { x: 280, y: 24, width: 115.69, height: 0 }, props: { join: "round", arrow: "yes 10.35", dash: "none" } });
    // The arc from the top of `a` to the top of `b`, 300 apart, 66 high: its pill "late 35 % of 820" (16 characters of
    // 0.55 × 11 and 6 on either side, 108.8 wide, 18 tall) centred on its middle (340, -49.5), in the accent on paper.
    expect(drawn.get("mark:arc:a->b:0")).toMatchObject({ props: { outline: "#b84a00@0.9", outlineWidth: "1", dash: "none", arrow: "yes", pill: "285.6,-58.5,108.8,18 #ffffff #b84a00 1 r9" } });
    expect(drawn.get("mark:arc:a->b:0")!.texts).toEqual([{ text: "late 35 % of 820", size: 11, weight: 400, paint: "#b84a00" }]);
  });

  it("find the Canvas map and the PNG export drawing as the SVG export does", () => {
    expect(differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas(), png: png() } }])).toEqual([]);
  });

  it("read a band's fill, its outline between the bands and its rule alike from the three", () => {
    const given = { graph, positions, overlays, lanes: "stages" as const };
    const banded = buildScene(graph, positions, given);
    const bandKinds = kindsOf(banded);
    const read = {
      svg: readSvg(toSVG(given), exportedMarks(banded)),
      canvas: readCanvasMap(prepareScene(graph, positions, given), bandKinds, measure),
      png: readPng((createCanvas) => toPNGCanvas(given, { scale: 1, createCanvas }), prepareScene(graph, positions, { ...given, lodBySize: false }), bandKinds, measure),
    };
    const color = banded.scales.categorical("g").color.toLowerCase();
    // A stage band runs along the flow: outlined left and right in the line colour, its rule 2 wide along its top.
    expect(read.svg.get("group:g")!.props).toMatchObject({ fill: `${color}@0.06`, outline: "#cfd4dc", outlineWidth: "1", dash: "none", outlineSides: "right left", rule: `${color} 2`, radius: "0" });
    expect(differences([{ name: "bands", kinds: bandKinds, svg: read.svg, others: { canvas: read.canvas, png: read.png } }])).toEqual([]);
  });

  it("read the part of a frequency cue in the accent alike from the three", () => {
    // In the shortfall measure: of `a`'s 10 cases (half of all) 40 % are short, a fifth of all cases, 171 / 5 = 34.2 long.
    const short = { ...graph, nodes: graph.nodes.map((n) => (n.id === "a" ? { ...n, metrics: { ...n.metrics, violationShare: 0.4 } } : n)) };
    const given = { graph: short, positions, overlays, measure: "shortfall" as const };
    const measured = buildScene(short, positions, given);
    const measuredKinds = kindsOf(measured);
    const read = {
      svg: readSvg(toSVG(given), exportedMarks(measured)),
      canvas: readCanvasMap(prepareScene(short, positions, given), measuredKinds, measure),
      png: readPng((createCanvas) => toPNGCanvas(given, { scale: 1, createCanvas }), prepareScene(short, positions, { ...given, lodBySize: false }), measuredKinds, measure),
    };
    for (const drawn of Object.values(read)) expect(drawn.get("node:a")!.props).toMatchObject({ cue: "#e6e8ec 86", cueFoot: "#5f6672 86", cueAccent: "#f2ded1 34", cueFootAccent: "#b84a00 34" });
    expect(read.svg.get("node:b")!.props).toMatchObject({ cueAccent: "none", cueFootAccent: "none" });
    expect(differences([{ name: "shortfall", kinds: measuredKinds, svg: read.svg, others: { canvas: read.canvas, png: read.png } }])).toEqual([]);
  });

  it("read what a theme's rules set alike from the three, an element's opacity in each of its paints", () => {
    const theme = {
      ...defaultTheme,
      rules: [
        { match: { part: "node", kind: "activity" }, set: { fill: "#fef3c7", strokeWeight: "strong", radius: "full", opacity: 0.5, text: { name: { color: "#1d4ed8" } } } },
        { match: { part: "edge" }, set: { stroke: "#b42318", opacity: 0.4, dash: "unobserved" } },
        { match: { part: "group" }, set: { fill: "#e0f2fe", fillOpacity: 0.5, stroke: "#0369a1", radius: "s" } },
        { match: { part: "mark", kind: "badge" }, set: { fill: "#fff7ed", opacity: 0.8 } },
      ],
    } as Theme;
    const given = { graph, positions, overlays };
    const read = {
      svg: readSvg(toSVG(given, { theme }), exportedMarks(buildScene(graph, positions, { overlays, theme }))),
      canvas: readCanvasMap(prepareScene(graph, positions, { overlays, theme }), kinds, measure),
      png: readPng((createCanvas) => toPNGCanvas(given, { scale: 1, createCanvas, theme }), prepareScene(graph, positions, { overlays, lodBySize: false, theme }), kinds, measure),
    };
    // The card at half its opacity: its fill, outline (2 wide, corners of half its height), band and cue fade alike, and its name in the rule's colour.
    expect(read.svg.get("node:a")!.props).toMatchObject({ fill: "#fef3c7@0.5", outline: "#8c94a1@0.5", outlineWidth: "2", radius: "24", cue: "#e6e8ec@0.5 85", cueFoot: "#5f6672@0.5 85" });
    expect(read.svg.get("node:a")!.texts[0]).toEqual({ text: "Approve", size: 13, weight: 500, paint: "#1d4ed8@0.5" });
    expect(read.svg.get("edge:a->b")!.props).toMatchObject({ outline: "#b42318@0.4", dash: "6 5" });
    expect(read.svg.get("group:g")!.props).toMatchObject({ fill: "#e0f2fe@0.5", outline: "#0369a1", radius: "4" });
    expect(read.svg.get("mark:badge:a:1")!.props).toMatchObject({ fill: "#fff7ed@0.8", outline: "#b84a00@0.8" });
    expect(differences([{ name: "rules", kinds, svg: read.svg, others: { canvas: read.canvas, png: read.png } }])).toEqual([]);
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

  it("report a pill or a corner that one renderer draws otherwise", () => {
    const prepared = prepareScene(graph, positions, { overlays });
    // The Canvas map outlines the pill one unit wider than the scene says.
    const thicker: PreparedScene = { ...prepared, marks: prepared.marks.map((m) => (m.pill ? { ...m, pill: { ...m.pill, stroke: { ...m.pill.stroke, width: m.pill.stroke.width + 1 } } } : m)) };
    const found = differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas(thicker) } }]);
    expect(found.map((d) => [d.renderer, d.kind, d.property, d.svg, d.other, d.elements])).toEqual([
      ["canvas", "mark:arc", "pill", "285.6,-58.5,108.8,18 #ffffff #b84a00 1 r9", "285.6,-58.5,108.8,18 #ffffff #b84a00 2 r9", 1],
    ]);
    // An export whose paths have sharp corners and no arrowhead.
    const sharp = readSvg(toSVG({ graph, positions, overlays }).replace(/ stroke-linejoin="round" marker-end="url\(#wf-arrow(-\d+)?\)"/g, ""), exportedMarks(scene));
    expect(differences([{ name: "small", kinds, svg: sharp, others: { canvas: canvas() } }]).map((d) => [d.kind, d.property, d.svg, d.other, d.elements])).toEqual([
      // Two paths 5.66 wide end in heads 10.35 wide, the path 8 wide in one 14.4 wide.
      ["edge:follows", "arrow", "no", "yes 10.35", 2],
      ["edge:follows", "arrow", "no", "yes 14.4", 1],
      ["edge:follows", "join", "miter", "round", 3],
    ]);
  });

  it("report a frequency cue one renderer draws a pixel or more longer, and none within a pixel", () => {
    const prepared = prepareScene(graph, positions, { overlays });
    const longer = (by: number): PreparedScene => ({
      ...prepared,
      nodes: prepared.nodes.map((n) => {
        const c = n.mark.cue;
        return c?.stripe ? { ...n, mark: { ...n.mark, cue: { ...c, stripe: { ...c.stripe, box: { ...c.stripe.box, width: c.stripe.box.width + by } } } } } : n;
      }),
    });
    expect(differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas(longer(0.4)) } }])).toEqual([]);
    expect(differences([{ name: "small", kinds, svg: svg(), others: { canvas: canvas(longer(2)) } }]).map((d) => [d.kind, d.property, d.svg, d.other])).toEqual([
      ["node:activity", "cue", "#e6e8ec 43", "#e6e8ec 45"],
      ["node:activity", "cue", "#e6e8ec 86", "#e6e8ec 88"],
    ]);
  });

  it("report a shadow that one renderer casts and the SVG export does not", () => {
    // The PNG export draws into a context that casts a shadow under everything.
    const shaded = readPng(
      (createCanvas) =>
        toPNGCanvas(
          { graph, positions, overlays },
          {
            scale: 1,
            createCanvas: (width, height) => {
              const canvas = createCanvas(width, height);
              Object.assign(canvas.getContext() as object, { shadowColor: "rgba(0, 0, 0, 0.25)", shadowBlur: 4, shadowOffsetY: 2 });
              return canvas;
            },
          },
        ),
      prepareScene(graph, positions, { overlays, lodBySize: false }),
      kinds,
      measure,
    );
    const found = differences([{ name: "small", kinds, svg: svg(), others: { png: shaded } }]).filter((d) => d.property === "shadow");
    expect(found.map((d) => [d.kind, d.svg, d.other, d.elements])).toEqual([
      ["group:stage", "none", "#000000@0.25 0 2 4", 1],
      ["node:activity", "none", "#000000@0.25 0 2 4", 2],
      ["node:event", "none", "#000000@0.25 0 2 4", 2],
    ]);
    // In the SVG export a shadow is a filter on the shape; a drop shadow of standard deviation 2 blurs by 4, as `shadowBlur` 4 does.
    const filtered = readSvg(
      toSVG({ graph, positions, overlays })
        .replace(/(<svg[^>]*>)/, '$1<defs><filter id="shade"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.25"/></filter><filter id="blur"><feGaussianBlur stdDeviation="1"/></filter></defs>')
        .replace('<rect x="100" y="0"', '<rect filter="url(#shade)" x="100" y="0"')
        .replace('<rect x="400" y="0"', '<rect filter="url(#blur)" x="400" y="0"'),
      exportedMarks(scene),
    );
    expect(filtered.get("node:a")!.props.shadow).toBe("#000000@0.25 0 2 4");
    // A filter that is not a drop shadow keeps its reference, and differs from any shadow.
    expect(filtered.get("node:b")!.props.shadow).toBe("url(#blur)");
    expect(filtered.get("node:start")!.props.shadow).toBe("none");
  });

  it("fail the check for a listed difference that is gone or found on other elements", () => {
    const entry: Listed = { renderer: "dom", kind: "node:event", property: "outlineWidth", svg: "1.5", other: "2", fixtures: ["small"], elements: 2 };
    expect(checkExpected([], [entry])).toEqual({ added: [], gone: [entry], changed: [] });
    const fewer = { ...entry, elements: 1 };
    expect(checkExpected([fewer], [entry])).toEqual({ added: [], gone: [], changed: [{ expected: entry, found: fewer }] });
    const elsewhere = { ...entry, fixtures: ["global", "small"] };
    expect(checkExpected([elsewhere], [entry]).changed).toHaveLength(1);
    expect(checkExpected([entry], [entry])).toEqual({ added: [], gone: [], changed: [] });
    // A difference listed twice is listed once too often.
    expect(checkExpected([entry], [entry, entry])).toEqual({ added: [], gone: [entry], changed: [] });
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
    expect(shadow("rgba(0, 0, 0, 0.12) 0px 1px 2px 0px")).toBe("#000000@0.12 0 1 2");
    expect(shadow("rgb(0, 0, 0) 0px 0px 0px 3px, rgba(0, 0, 0, 0.12) 0px 1px 2px 0px")).toBe("#000000 0 0 0 3, #000000@0.12 0 1 2");
    expect(shadow("none")).toBe("none");
  });
});
