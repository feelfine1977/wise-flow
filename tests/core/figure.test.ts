import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type LegendItem, type Overlay, type Positions, type SceneLegend, type TextMeasure, MAP_TARGET, estimateTextWidth, abstract, buildScene, collapseGroups, figureCaption, figureFrame, layout, legendLayout, legendOfScene, sceneLegend, toSVG } from "../../src/index";
import { type DrawContext, drawLegend, prepareScene, toPNGCanvas } from "../../src/canvas/index";

const width: LegendItem = { kind: "width", title: "legend.edgeWidth", metric: "count", domain: [1, 9], range: [1, 8] };
const sequential: LegendItem = { kind: "sequential", title: "legend.edgeColor", metric: "violationShare", domain: [0, 1], stops: ["#fff", "#000"] };
const categorical: LegendItem = {
  kind: "categorical",
  title: "legend.nodeColor",
  entries: [
    { key: "invoice", color: "#0072B2", pattern: "solid", index: 0 },
    { key: "payment", color: "#E69F00", pattern: "diagonal", index: 1 },
  ],
};
const chip: Overlay = { kind: "chip", target: MAP_TARGET, payload: { glyph: "⊂", label: "Scope", text: "All cases" } };

describe("sceneLegend", () => {
  it("lists the keys of the overlay kinds given, then re-added paths, as rows after the scales", () => {
    const overlays: Overlay[] = [
      { kind: "hatch", target: "a" },
      { kind: "arc", target: "a->b", payload: { source: "a", target: "b", reverse: true } },
      { kind: "tint", target: "s1" },
      { kind: "chip", target: "a", payload: { text: "On a node" } },
      chip,
    ];
    const legend = sceneLegend([width], overlays);
    expect(legend.items).toEqual([width]);
    expect(legend.keys.map((k) => [k.kind, k.glyph, k.title])).toEqual([
      ["arc", "⌒", "legend.arc"],
      ["reverse", "⇐", "legend.reverse"],
      ["outOfScope", "▨", "legend.outOfScope"],
      ["reconnected", "┄", "legend.reconnected"],
    ]);
    // Only map-level chips are listed; a chip on a node is drawn on the node.
    expect(legend.chips).toEqual([chip]);
    expect(legend.title).toBe("Legend");
    expect(legend.rows).toEqual([
      // No colour scale: the measure is frequency, in the unit the width reads.
      { kind: "measure", text: "Frequency · transitions" },
      { kind: "width", title: "Path width: transitions (count)", samples: [{ width: 1, text: "1" }, { width: 8, text: "9" }] },
      { kind: "key", key: "arc", glyph: "⌒", text: "Lag or precedence arc; label = share short of the cases evaluated" },
      { kind: "key", key: "reverse", glyph: "⇐", text: "Reverse-order arc (precedence violated), below the flow" },
      { kind: "key", key: "outOfScope", glyph: "▨", text: "Outside scope" },
      { kind: "key", key: "reconnected", glyph: "┄", text: "Not directly observed (re-added)" },
      { kind: "chip", chip, label: "⊂ Scope", text: "All cases" },
    ]);
  });

  it("writes the scales' titles and values in the locale", () => {
    const legend = sceneLegend([sequential, categorical, { ...sequential, kind: "diverging", metric: "delta", domain: [-1.5, 0, 2500.25] }], [], "de");
    expect(legend.title).toBe("Legende");
    expect(legend.rows.slice(0, 4)).toEqual([
      { kind: "measure", text: "Erwartungslücke · Fälle" },
      { kind: "ramp", title: "Pfadfarbe: Erwartungslücke (% der Fälle)", id: "legendedgeColor-violationShare", stops: ["#fff", "#000"], values: ["0 %", "100 %"] },
      { kind: "swatches", title: "Aktivitätsfarbe", entries: [{ text: "invoice", color: "#0072B2", pattern: "solid" }, { text: "payment", color: "#E69F00", pattern: "diagonal" }] },
      // A metric the registry does not hold: its name, no unit, integers in full and other numbers with one decimal.
      { kind: "ramp", title: "Pfadfarbe: delta", id: "legendedgeColor-delta", stops: ["#fff", "#000"], values: ["-1,5", "0", "2.500,3"] },
    ]);
    expect(sceneLegend([], []).rows.map((r) => r.kind)).toEqual(["key"]);
  });
});

describe("legendOfScene", () => {
  // Two activities a → b and a group; each case adds the overlays or tags that make one kind of mark drawn.
  const graph: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: "A", metrics: { cases: 10 } },
      { id: "b", kind: "activity", label: "B", metrics: { cases: 5 } },
    ],
    edges: [{ id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 5 } }],
    groups: [{ id: "g", kind: "stage", label: "G" }],
  };
  const box = (x: number) => ({ x, y: 0, width: 100, height: 40 });
  const at: Positions = { nodes: { a: box(0), b: box(200), s: { x: -60, y: 0, width: 36, height: 36 }, e: { x: 340, y: 0, width: 36, height: 36 } }, groups: { g: { x: -10, y: -40, width: 320, height: 90 } }, edges: {}, bounds: { x: -10, y: -40, width: 320, height: 90 }, engine: "given", direction: "RIGHT" };
  const keysOf = (g: FlowGraph, overlays: Overlay[] = []) => buildScene(g, at, { overlays, selfLoops: false }).legend.rows.filter((r) => r.kind === "key").map((r) => (r.kind === "key" ? r.key : ""));
  const cases: [string, FlowGraph, Overlay[], string[]][] = [
    ["nothing", graph, [], []],
    ["a badge", graph, [{ kind: "badge", target: "a", payload: { value: 0.2 } }], ["badge"]],
    ["an arc", graph, [{ kind: "arc", target: "a", payload: { source: "a", target: "b", value: 0.1 } }], ["arc"]],
    ["a reverse arc", graph, [{ kind: "arc", target: "a", payload: { source: "b", target: "a", reverse: true } }], ["arc", "reverse"]],
    ["a self-loop", graph, [{ kind: "selfLoop", target: "a", payload: { value: 0.3 } }], ["selfLoop"]],
    ["hatching", graph, [{ kind: "hatch", target: "b" }], ["outOfScope"]],
    ["a re-added path", { ...graph, edges: [{ ...graph.edges[0], tags: ["reconnected"] }] }, [], ["reconnected"]],
    ["a re-added activity", { ...graph, nodes: [graph.nodes[0], { ...graph.nodes[1], tags: ["reconnected"] }] }, [], ["reconnected"]],
    ["a path without a value", { ...graph, edges: [{ ...graph.edges[0], metrics: {} }] }, [], ["notEvaluated"]],
    ["a start and an end", { ...graph, nodes: [...graph.nodes, { id: "s", kind: "event", label: "Start", tags: ["start"] }, { id: "e", kind: "event", label: "End", tags: ["end"] }] }, [], ["start", "end"]],
    ["only a start", { ...graph, nodes: [...graph.nodes, { id: "s", kind: "event", label: "Start", tags: ["start"] }] }, [], ["start"]],
    // Tints and chips in a group are drawn without a key.
    ["a tint and a chip in a group", graph, [{ kind: "tint", target: "g", payload: { value: 0.5 } }, { kind: "chip", target: "g", payload: { text: "x" } }], []],
  ];

  it.each(cases)("lists a key for each kind of mark drawn and none for a kind not drawn: %s", (_name, g, overlays, keys) => {
    expect(keysOf(g, overlays)).toEqual(keys);
  });

  it("lists one key per kind however many marks of it are drawn", () => {
    const badges: Overlay[] = ["a", "b"].map((target) => ({ kind: "badge", target, payload: { value: 0.2 } }));
    expect(keysOf(graph, [...badges, ...badges.map((o) => ({ ...o, kind: "hatch" as const }))])).toEqual(["badge", "outOfScope"]);
  });

  it("lists one key per badge glyph, worded by the constraint it shows", () => {
    const badge = (target: string, glyph: string, constraintType?: string): Overlay => ({ kind: "badge", target, payload: { glyph, constraintType, value: 0.1 } });
    const scene = buildScene(graph, at, { overlays: [badge("a", "≥1", "presence"), badge("b", "≥1", "presence"), badge("b", "≤1", "singularity"), badge("a", "∅", "exclusion"), badge("b", "◆")], selfLoops: false });
    // Badges are drawn in their canonical order (by target, then constraint id, here none, then as given): a's ≥1 and ∅,
    // then b's ≥1, ≤1 and ◆; each glyph once.
    expect(scene.legend.rows.filter((r) => r.kind === "key").map((r) => (r.kind === "key" ? [r.glyph, r.text] : []))).toEqual([
      ["≥1", "Required: share of cases missing it"],
      ["∅", "Excluded: share of cases where it occurs"],
      ["≤1", "Limited: share of cases repeating it"],
      ["◆", "Constraint badge with shortfall share"],
    ]);
    const german = buildScene(graph, at, { overlays: [badge("a", "≤1", "singularity")], selfLoops: false, locale: "de" });
    expect(german.legend.rows.find((r) => r.kind === "key")).toEqual({ kind: "key", key: "badge", glyph: "≤1", text: "Begrenzt: Anteil der Fälle, die es wiederholen" });
  });

  it("names the measure, the metric and the unit of every scale, and says when paths count transitions", () => {
    const titles = (g: FlowGraph, locale: "en" | "de" = "en") => buildScene(g, at, { selfLoops: false, locale }).legend.rows.map((r) => (r.kind === "measure" ? r.text : "title" in r ? r.title : r.kind));
    // The paths give only transitions: the width reads them and its row says so, after naming the scale the graph's.
    expect(titles(graph)).toEqual(["Frequency · transitions", "Path width: transitions (count) · whole graph · paths count transitions; no case counts given", "Path colour: transitions (count)"]);
    // With cases on the paths and the cases of the log, as the activities count them.
    const cased: FlowGraph = { ...graph, edges: [{ ...graph.edges[0], metrics: { count: 6, cases: 5 } }], meta: { cases: 1000 } };
    expect(titles(cased)).toEqual(["Frequency · cases · share of 1,000 cases", "Path width: cases (count) · whole graph", "Path colour: cases (count)"]);
    expect(titles(cased, "de")).toEqual(["Häufigkeit · Fälle · Anteil an 1.000 Fällen", "Pfadbreite: Fälle (Anzahl) · ganzer Graph", "Pfadfarbe: Fälle (Anzahl)"]);
    // Colour by the median lag, in minutes, hours and days.
    const lag = buildScene(cased, at, { selfLoops: false, style: { edgeWidth: { metric: "cases" }, edgeColor: { metric: "medianLagHours", palette: "sequentialBlue", domain: [0.5, 72] } } }).legend.rows;
    expect(lag[0]).toEqual({ kind: "measure", text: "Performance · cases · share of 1,000 cases" });
    expect(lag[2]).toMatchObject({ kind: "ramp", title: "Path colour: median lag (min, h, d)", values: ["30 min", "3.0 d"] });
    // Stages: their labels, in stage order.
    const staged: FlowGraph = { ...cased, nodes: cased.nodes.map((n) => ({ ...n, group: "g" })) };
    expect(buildScene(staged, at, { selfLoops: false }).legend.rows.find((r) => r.kind === "swatches")).toMatchObject({ title: "Activity colour: stage", entries: [{ text: "G" }] });
  });

  it("writes three width samples: the thinnest line with the counts it stands for, a count near the middle width and the strongest path", () => {
    const wide: FlowGraph = { ...graph, edges: [
      { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { cases: 38 } },
      { id: "b->a", kind: "follows", source: "b", target: "a", metrics: { cases: 113_000 } },
    ] };
    const scene = buildScene(wide, at, { selfLoops: false });
    // From 0 to 113,000 onto 0 to 8 by the square root: the thinnest line 1 stands for counts up to 113,000 / 64 = 1,765.6, the
    // middle width 4.5 for 113,000 × (4.5 / 8)² = 35,754, so 36,000, drawn at √(36,000 / 113,000) × 8 = 4.52.
    // Paths are written in full up to 99,999, then in thousands.
    expect(scene.legend.rows.find((r) => r.kind === "width")).toEqual({ kind: "width", title: "Path width: cases (count) · whole graph", samples: [{ width: 1, text: "≤ 1,765" }, { width: 4.52, text: "36,000" }, { width: 8, text: "113k" }] });
    // 38 cases would be √(38 / 113,000) × 8 = 0.15 wide: drawn at the thinnest line.
    expect(scene.edgeMarks.map((m) => m.width)).toEqual([1, 8]);
  });

  it("lists no key for an overlay that is not drawn", () => {
    expect(keysOf(graph, [{ kind: "badge", target: "missing" }, { kind: "arc", target: "a", payload: { source: "a", target: "missing" } }])).toEqual([]);
  });

  it("lists the path scales only where paths are drawn and the map-level chips last", () => {
    const scene = buildScene(graph, at, { overlays: [chip], selfLoops: false });
    expect(scene.legend.rows.map((r) => r.kind)).toEqual(["measure", "width", "ramp", "chip"]);
    expect(buildScene({ ...graph, edges: [] }, at, { overlays: [chip] }).legend.rows.map((r) => r.kind)).toEqual(["chip"]);
  });
});

describe("legendLayout", () => {
  it("places the rows from their heights and fits their texts to the legend's width", () => {
    const legend = sceneLegend([width, sequential, categorical], [{ kind: "badge", target: "a" }, chip]);
    const layout = legendLayout(legend);
    // By the estimate a title line holds 31 characters at 11 px (6.05 each in 188), a key line 31 at 9.5 px (5.225 each in 164).
    // Heading 26; the measure 16 + 6; width 16 + 2 × 16 + 4; the colour's title in two lines 32 + 30; two entries 16 + 2 × 16 + 4;
    // two keys of two lines, 2 × 14 each; 6 before the chips; a chip 13 + 15.
    expect(layout.rows.map((r) => [r.row.kind, r.y])).toEqual([
      ["measure", 26],
      ["width", 48],
      ["ramp", 100],
      ["swatches", 162],
      ["key", 214],
      ["key", 242],
      ["chip", 276],
    ]);
    expect(layout.items.map((i) => i.y)).toEqual([48, 100, 162]);
    expect(layout.keys.map((k) => [k.key.kind, k.y])).toEqual([
      ["badge", 214],
      ["reconnected", 242],
    ]);
    expect(layout.chips.map((c) => c.y)).toEqual([276]);
    expect(layout.height).toBe(304);
    expect(layout.rows.map((r) => r.lines)).toEqual([["Shortfall · transitions"], ["Path width: transitions (count)"], ["Path colour: expectation", "shortfall (% of cases)"], ["Activity colour"], [], [], []]);
    expect(layout.rows.map((r) => r.texts)).toEqual([[], [], [], ["invoice", "payment"], ["Constraint badge with", "shortfall share"], ["Not directly observed", "(re-added)"], ["⊂ Scope", "All cases"]]);
    // Narrower, by another measure of 10 per character: 150 − 24 holds twelve characters a line.
    const tens = legendLayout(legend, { measure: (t) => Array.from(t).length * 10, width: 150 });
    expect(tens.rows[5].texts).toEqual(["Not directly", "observed", "(re-added)"]);
  });
});

describe("figureFrame", () => {
  const graph: FlowGraph = { nodes: [], edges: [] };
  const legend: SceneLegend = sceneLegend([width, sequential, categorical], [{ kind: "badge", target: "a" }, chip]);
  const framed = { graph, locale: "en" as const, bounds: { x: 10, y: 20, width: 100, height: 50 }, legend };

  it("measures header, map, legend column and output size", () => {
    const frame = figureFrame(framed, { title: true, preset: "single-column" });
    // Title 40 + context 18; the map 100 + 2 × 24 by 50 + 2 × 24.
    expect(frame.header).toBe(58);
    expect(frame.map).toEqual({ width: 148, height: 98, offset: { x: 14, y: 62 }, scale: 1 });
    // The legend (304) is taller than the map: 58 + 304 + 2 × 24.
    expect(frame.height).toBe(410);
    expect(frame.width).toBe(148 + 220);
    expect(frame.legend).toMatchObject({ x: 164, y: 82, width: 188, rule: { x: 148, top: 82, bottom: 386 } });
    // The graph has no meta: no caption.
    expect(frame.caption).toBeUndefined();
    expect(frame.key).toEqual({ lines: [], y: 434 });
    expect(frame.outWidth).toBe(1000);
    expect(frame.outHeight).toBeCloseTo((410 / 368) * 1000, 9);
  });

  it("leaves out the legend column and the header when asked", () => {
    const frame = figureFrame(framed, { legend: false, padding: 10 });
    expect(frame.legend).toBeUndefined();
    expect([frame.width, frame.height, frame.header, frame.outWidth]).toEqual([120, 70, 0, 120]);
  });

  it("keeps the figure's height when it is not scaled", () => {
    // 2864 + 2 × 24 + 220 by 856 + 2 × 24; 904 / 3132 × 3132 is not exactly 904 in floating point.
    const frame = figureFrame({ ...framed, bounds: { x: 0, y: 0, width: 2864, height: 856 } });
    expect([frame.width, frame.height, frame.outWidth, frame.outHeight]).toEqual([3132, 904, 3132, 904]);
  });

  it("measures an empty figure without padding or legend as empty", () => {
    const frame = figureFrame({ ...framed, bounds: { x: 0, y: 0, width: 0, height: 0 } }, { legend: false, padding: 0 });
    expect([frame.width, frame.height, frame.outWidth, frame.outHeight]).toEqual([0, 0, 0, 0]);
  });

  it("writes the caption under the map and the legend, from the graph's meta, and leaves out what is unknown", () => {
    const g: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }, { id: "s", kind: "event", label: "Start" }],
      edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }, { id: "aa", kind: "follows", source: "a", target: "a" }, { id: "c", kind: "constraint", source: "a", target: "b" }],
      meta: { label: "Purchase-to-pay", cases: 1000, period: ["2018-01-01", "2018-06-30"], filters: [], model: { activities: 12, paths: 31 } },
    };
    const frame = figureFrame({ ...framed, graph: g }, { legend: false, padding: 10 });
    // The map 120 wide holds 100 at 11 px, 16 characters a line by the estimate.
    expect(frame.caption?.lines.join(" ")).toBe("Purchase-to-pay · 1,000 cases · 2018-01-01 – 2018-06-30 · filter: none · 2 of 12 activities, 1 of 31 paths shown");
    // Under the map (50 + 2 × 10), its first baseline 12 below, its lines 16 apart, then the padding.
    expect(frame.caption).toMatchObject({ x: 10, y: 70 + 12 });
    expect(frame.height).toBe(70 + frame.caption!.lines.length * 16 + 10);
    expect(figureCaption({ ...g, meta: { ...g.meta, filters: [{ kind: "activity", op: "contains", activity: "a" }] } }, "de", (id) => id.toUpperCase())).toBe("Purchase-to-pay · 1.000 Fälle · 2018-01-01 – 2018-06-30 · Filter: Fälle mit A · 2 von 12 Aktivitäten, 1 von 31 Pfaden gezeigt");
    // Only what the meta holds; nothing at all without it.
    expect(figureCaption({ ...g, meta: { cases: 7, model: { paths: 31 } } })).toBe("7 cases · 1 of 31 paths shown");
    expect(figureCaption({ ...g, meta: undefined })).toBeUndefined();
    expect(figureFrame({ ...framed, graph: { ...g, meta: {} } }, { legend: false, padding: 10 }).caption).toBeUndefined();
    expect(figureFrame({ ...framed, graph: g }, { legend: false, padding: 10, caption: false }).caption).toBeUndefined();
  });

  it("adds the activity key under the map and the legend", () => {
    const g: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }], edges: [] };
    const frame = figureFrame({ ...framed, graph: g, activityLabels: { mode: "ids", references: {} } }, { legend: false });
    expect(frame.key.lines.length).toBeGreaterThan(1);
    expect(frame.key.y).toBe(98 + 24);
    expect(frame.height).toBe(98 + frame.key.lines.length * 16 + 48);
  });

  it("wraps the activity key of a map as wide as a long name with a few measures of each line, not one per word", () => {
    for (const words of [250, 1000]) {
      let measured = 0;
      const counting: TextMeasure = (s, font) => {
        measured += s.length;
        return estimateTextWidth(s, font);
      };
      const label = Array.from({ length: words }, () => "invoice").join(" ");
      // Two activities 10⁷ apart: the key's width holds the whole description of the first on one line.
      const far: Positions = { nodes: { a: { x: 0, y: 0, width: 280, height: 64 }, b: { x: 1e7, y: 0, width: 280, height: 64 } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 1e7 + 280, height: 64 }, engine: "given", direction: "RIGHT" };
      const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label }, { id: "b", kind: "activity", label: "B" }], edges: [] };
      expect(toSVG({ graph, positions: far, activityLabels: { mode: "names", references: { a: "A01", b: "A02" } } }, { textMeasure: counting })).toContain(`A01 — ${label}.`);
      // Doubling and halving over the words measure the line about 2 log₂(words) times; adding one word at a time
      // measured it once per word, 800 and 3,000 times the name's length.
      expect(measured, `${words} words`).toBeLessThanOrEqual(4 * Math.log2(words) * label.length);
    }
  });
});

// One 10 × 10 activity without metrics: the legend is taller than the map.
const tiny: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }], edges: [] };
const tinyAt: Positions = { nodes: { a: { x: 0, y: 0, width: 10, height: 10 } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 10, height: 10 }, engine: "dagre", direction: "RIGHT" };

describe("the legend in the scene and the exports", () => {
  it("is part of the scene, built from what it draws", () => {
    const scene = buildScene(tiny, tinyAt, { overlays: [{ kind: "badge", target: "a" }] });
    expect(scene.legend).toEqual(legendOfScene(scene));
    // Nothing is re-added: no key for re-added paths.
    expect(scene.legend.keys.map((k) => k.kind)).toEqual(["badge"]);
  });

  it("lists in SVG only the kinds of marks drawn", () => {
    const svg = toSVG({ graph: tiny, positions: tinyAt, overlays: [{ kind: "badge", target: "a" }] });
    const legend = /<g class="wf-legend"[^]*?<\/g><\/g>/.exec(svg)![0];
    expect(legend).toContain("Constraint badge");
    for (const absent of ["Lag or precedence", "Reverse-order", "Repeated execution", "Outside scope", "Not directly observed", "not evaluated", "Start of the process"]) expect(legend).not.toContain(absent);
  });

  it("gives PNG and SVG the height of the legend it draws", () => {
    // Without scales or keys, the heading 26 and the padding: 26 + 2 × 24 is taller than the map, 10 + 2 × 24.
    const svg = toSVG({ graph: tiny, positions: tinyAt, style: {} });
    expect(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number)).toEqual([58 + 220, 74]);
    const png = toPNGCanvas({ graph: tiny, positions: tinyAt, style: {} }, { scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => new Proxy({}, { get: (_t, key) => (key === "measureText" ? () => ({ width: 0 }) : () => undefined), set: () => true }) }) });
    expect([png.cssWidth, png.cssHeight]).toEqual([278, 74]);
  });

  it("gives PNG and SVG of an empty graph without padding or legend a size", () => {
    const empty = { graph: { nodes: [], edges: [] }, positions: { ...tinyAt, nodes: {}, bounds: { x: 0, y: 0, width: 0, height: 0 } } };
    expect(/<svg [^>]*>/.exec(toSVG(empty, { padding: 0, legend: false }))![0]).toContain('width="0" height="0" viewBox="0 0 0 0"');
    const png = toPNGCanvas(empty, { padding: 0, legend: false, scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }) }) });
    expect([png.cssWidth, png.cssHeight, png.width, png.height]).toEqual([0, 0, 1, 1]);
  });

  it("draws the pattern twins of the categories in the Canvas legend", () => {
    const g: FlowGraph = { nodes: ["a", "b"].map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase(), group: id === "a" ? "invoice" : "payment" })), edges: [] };
    const at: Positions = { ...tinyAt, nodes: { a: tinyAt.nodes.a, b: { x: 40, y: 0, width: 10, height: 10 } } };
    const scene = prepareScene(g, at, { style: { nodeColor: { by: "group", palette: "categorical" } } });
    const cat = scene.legend.items.find((i) => i.kind === "categorical");
    expect(cat?.kind === "categorical" && cat.entries.map((e) => e.pattern).some((p) => p !== "solid")).toBe(true);
    const fills: string[] = [];
    let fill: unknown;
    const tile = { getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }) };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, key: string) => {
        if (key === "createPattern") return () => "pattern-twin";
        if (key === "measureText") return (s: string) => ({ width: s.length * 6 });
        if (key === "fillRect") return (...a: number[]) => fills.push(`${String(fill)} ${a.join(" ")}`);
        return () => undefined;
      },
      set: (_t, key: string, value) => {
        if (key === "fillStyle") fill = value;
        return true;
      },
    }) as unknown as DrawContext;
    drawLegend(ctx, scene, 0, 0, 188, undefined, { createCanvas: () => tile });
    const entries = cat?.kind === "categorical" ? cat.entries : [];
    const top = legendLayout(scene.legend).items.find((i) => i.item === cat)!.y + 16;
    entries.forEach((e, i) => {
      // The colour, then its pattern twin over the same 14 × 12 swatch.
      expect(fills).toContain(`${e.color} 0 ${top + 16 * i} 14 12`);
      if (e.pattern !== "solid") expect(fills).toContain(`pattern-twin 0 ${top + 16 * i} 14 12`);
    });
  });
});

describe("the caption of an export", () => {
  it("states label, cases, period and how much of the model is shown for the whole-log fixture, in SVG and PNG", async () => {
    const shown = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
    const positions = await layout(shown, { engine: "dagre" });
    // Counted here from the fixture: its activities and its paths between two different nodes, and those the abstraction keeps.
    const activities = (g: FlowGraph) => g.nodes.filter((n) => n.kind === "activity").length;
    const paths = (g: FlowGraph) => g.edges.filter((e) => e.kind === "follows" && e.source !== e.target).length;
    expect([activities(globalScene), activities(shown), paths(shown)]).toEqual([42, 16, 35]);
    // The map draws the paths from Start and to End: the caption says what they count (WF-12).
    const caption = `All purchase order items · 251,734 cases · 1948-01-26 – 2020-04-09 · 16 of 42 activities, 35 of ${paths(globalScene)} paths shown · Start and End paths count cases by their first and last activity (Σ = 251,734)`;
    const svg = toSVG({ graph: shown, positions });
    const written = [.../<g class="wf-caption">(.*?)<\/g>/.exec(svg)![1].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(written.join(" ")).toBe(caption);
    const texts: string[] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (key === "fillText" ? (s: string) => texts.push(s) : key === "createLinearGradient" || key === "createPattern" ? undefined : () => ({ width: 0 })), set: () => true });
    toPNGCanvas({ graph: shown, positions }, { scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => ctx }) });
    expect(texts.join(" ")).toContain(written.join(" "));
  });

  it("counts the activities inside collapsed stages as shown and leaves out the paths, which merged paths cannot be counted against", () => {
    // Every activity of the fixture sits in one of its five stages: collapsed, all 42 are on the map.
    const staged = abstract(globalScene, { collapse: "all" });
    expect(staged.nodes.filter((n) => n.kind === "activity")).toEqual([]);
    expect(figureCaption(staged)).toBe("All purchase order items · 251,734 cases · 1948-01-26 – 2020-04-09 · 42 of 42 activities shown");
    // One stage collapsed: its 3 activities and the 3 that stay.
    const g: FlowGraph = {
      nodes: ["a", "b", "c", "x", "y", "z"].map((id) => ({ id, kind: "activity", label: id, group: "abc".includes(id) ? "s" : undefined })),
      edges: [{ id: "ax", kind: "follows", source: "a", target: "x" }, { id: "bx", kind: "follows", source: "b", target: "x" }],
      groups: [{ id: "s", kind: "stage", label: "S" }],
      meta: { model: { activities: 9, paths: 20 } },
    };
    expect(figureCaption(collapseGroups(g, ["s"]))).toBe("6 of 9 activities shown");
    // Collapsed before the abstraction: the model is the 42 activities in the stages; its paths are not known.
    const collapsedFirst = abstract(collapseGroups(globalScene, "all"));
    expect(collapsedFirst.meta?.model).toEqual({ activities: 42, groups: [], pathMax: expect.any(Object) });
    expect(figureCaption(collapsedFirst)).toBe("All purchase order items · 251,734 cases · 1948-01-26 – 2020-04-09 · 42 of 42 activities shown");
  });

  it("invents nothing for a graph without meta", () => {
    const svg = toSVG({ graph: tiny, positions: tinyAt, title: "Tiny" });
    expect(svg).not.toContain("wf-caption");
    // The context line under the title keeps its form; the caption adds nothing to it.
    expect(svg).not.toContain("activities,");
  });
});
