import { describe, expect, it } from "vitest";
import { type FlowGraph, type LegendItem, type Overlay, type Positions, type SceneLegend, MAP_TARGET, buildScene, figureFrame, legendLayout, legendOfScene, sceneLegend, toSVG } from "../../src/index";
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
      { kind: "width", title: "Path width", samples: [{ width: 1, text: "1" }, { width: 8, text: "9" }] },
      { kind: "key", key: "arc", glyph: "⌒", text: "Lag or precedence arc; label = share short of the cases evaluated" },
      { kind: "key", key: "reverse", glyph: "⇐", text: "Reverse-order arc (precedence violated), below the flow" },
      { kind: "key", key: "outOfScope", glyph: "▨", text: "Outside scope" },
      { kind: "key", key: "reconnected", glyph: "┄", text: "Re-added path" },
      { kind: "chip", chip, label: "⊂ Scope", text: "All cases" },
    ]);
  });

  it("writes the scales' titles and values in the locale", () => {
    const legend = sceneLegend([sequential, categorical, { ...sequential, kind: "diverging", metric: "delta", domain: [-1.5, 0, 2500.25] }], [], "de");
    expect(legend.title).toBe("Legende");
    expect(legend.rows.slice(0, 3)).toEqual([
      { kind: "ramp", title: "Pfadfarbe", id: "legendedgeColor-violationShare", stops: ["#fff", "#000"], values: ["0 %", "100 %"] },
      { kind: "swatches", title: "Aktivitätsfarbe", entries: [{ text: "invoice", color: "#0072B2", pattern: "solid" }, { text: "payment", color: "#E69F00", pattern: "diagonal" }] },
      { kind: "ramp", title: "Pfadfarbe", id: "legendedgeColor-delta", stops: ["#fff", "#000"], values: ["-1,5", "0,0", "2.500,3"] },
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
  const at: Positions = { nodes: { a: box(0), b: box(200) }, groups: { g: { x: -10, y: -40, width: 320, height: 90 } }, edges: {}, bounds: { x: -10, y: -40, width: 320, height: 90 }, engine: "given", direction: "RIGHT" };
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

  it("lists no key for an overlay that is not drawn", () => {
    expect(keysOf(graph, [{ kind: "badge", target: "missing" }, { kind: "arc", target: "a", payload: { source: "a", target: "missing" } }])).toEqual([]);
  });

  it("lists the path scales only where paths are drawn and the map-level chips last", () => {
    const scene = buildScene(graph, at, { overlays: [chip], selfLoops: false });
    expect(scene.legend.rows.map((r) => r.kind)).toEqual(["width", "ramp", "chip"]);
    expect(buildScene({ ...graph, edges: [] }, at, { overlays: [chip] }).legend.rows.map((r) => r.kind)).toEqual(["chip"]);
  });
});

describe("legendLayout", () => {
  it("places the rows from their heights and shortens their texts to the legend's width", () => {
    const legend = sceneLegend([width, sequential, categorical], [{ kind: "badge", target: "a" }, chip]);
    const layout = legendLayout(legend);
    // Heading 26; width 16 + 20; gradient 16 + 30; two entries 16 + 2 × 16 + 4; keys 14 apart; 6 before the chips; a chip 13 + 15.
    expect(layout.rows.map((r) => [r.row.kind, r.y])).toEqual([
      ["width", 26],
      ["ramp", 62],
      ["swatches", 108],
      ["key", 160],
      ["key", 174],
      ["chip", 194],
    ]);
    expect(layout.items.map((i) => i.y)).toEqual([26, 62, 108]);
    expect(layout.keys.map((k) => [k.key.kind, k.y])).toEqual([
      ["badge", 160],
      ["reconnected", 174],
    ]);
    expect(layout.chips.map((c) => c.y)).toEqual([194]);
    expect(layout.height).toBe(222);
    // The estimate at 9.5 px is 5.225 per character: thirty and the ellipsis fit 188 − 24.
    expect(layout.rows.map((r) => r.texts)).toEqual([[], [], ["invoice", "payment"], ["Constraint badge with shortfal…"], ["Re-added path"], ["⊂ Scope", "All cases"]]);
    // Narrower, by another measure of 10 per character: 150 − 24 holds eleven characters and the ellipsis.
    const tens = legendLayout(legend, { measure: (t) => Array.from(t).length * 10, width: 150 });
    expect(tens.rows[4].texts).toEqual(["Re-added pa…"]);
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
    expect(frame.map).toEqual({ width: 148, height: 98, offset: { x: 14, y: 62 } });
    // The legend (222) is taller than the map: 58 + 222 + 2 × 24.
    expect(frame.height).toBe(328);
    expect(frame.width).toBe(148 + 220);
    expect(frame.legend).toMatchObject({ x: 164, y: 82, width: 188, rule: { x: 148, top: 82, bottom: 304 } });
    expect(frame.key).toEqual({ lines: [], y: 352 });
    expect(frame.outWidth).toBe(1000);
    expect(frame.outHeight).toBeCloseTo((328 / 368) * 1000, 9);
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

  it("adds the activity key under the map and the legend", () => {
    const g: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }], edges: [] };
    const frame = figureFrame({ ...framed, graph: g, activityLabels: { mode: "ids", references: {} } }, { legend: false });
    expect(frame.key.lines.length).toBeGreaterThan(1);
    expect(frame.key.y).toBe(98 + 24);
    expect(frame.height).toBe(98 + frame.key.lines.length * 16 + 48);
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
    for (const absent of ["Lag or precedence", "Reverse-order", "Repeated execution", "Outside scope", "Re-added path"]) expect(legend).not.toContain(absent);
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
