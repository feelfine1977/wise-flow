import { describe, expect, it } from "vitest";
import { type FlowGraph, type LegendItem, type Overlay, type Positions, type SceneLegend, MAP_TARGET, buildScene, figureFrame, legendLayout, sceneLegend, toSVG } from "../../src/index";
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
  it("lists the keys of the overlay kinds present, then re-added paths", () => {
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
      ["reverse", "⌒┄", "legend.reverse"],
      ["outOfScope", "▨", "legend.outOfScope"],
      ["reconnected", "┄", "legend.reconnected"],
    ]);
    // Only map-level chips are listed; a chip on a node is drawn on the node.
    expect(legend.chips).toEqual([chip]);
  });

  it("lists only re-added paths without overlays", () => {
    expect(sceneLegend([], []).keys.map((k) => k.kind)).toEqual(["reconnected"]);
  });
});

describe("legendLayout", () => {
  it("places the rows from the heights of the items", () => {
    const legend: SceneLegend = { items: [width, sequential, categorical], keys: sceneLegend([], [{ kind: "badge", target: "a" }]).keys, chips: [chip] };
    const layout = legendLayout(legend);
    // Heading 26; width 16 + 20; gradient 16 + 30; two entries 16 + 2 × 16 + 4.
    expect(layout.items.map((i) => i.y)).toEqual([26, 62, 108]);
    // Keys 14 apart from 108 + 52.
    expect(layout.keys.map((k) => [k.key.kind, k.y])).toEqual([
      ["badge", 160],
      ["reconnected", 174],
    ]);
    // 6 before the chips; a chip takes 13 for its label and 15 for its text.
    expect(layout.chips.map((c) => c.y)).toEqual([194]);
    expect(layout.height).toBe(222);
  });
});

describe("figureFrame", () => {
  const graph: FlowGraph = { nodes: [], edges: [] };
  const legend: SceneLegend = { items: [width, sequential, categorical], keys: sceneLegend([], [{ kind: "badge", target: "a" }]).keys, chips: [chip] };
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
  it("is part of the scene", () => {
    const scene = buildScene(tiny, tinyAt, { overlays: [{ kind: "badge", target: "a" }] });
    expect(scene.legend).toEqual(sceneLegend(scene.scales.legend, scene.overlays));
    expect(scene.legend.keys.map((k) => k.kind)).toEqual(["badge", "reconnected"]);
  });

  it("lists in SVG only the overlay kinds present", () => {
    const svg = toSVG({ graph: tiny, positions: tinyAt, overlays: [{ kind: "badge", target: "a" }] });
    const legend = /<g class="wf-legend"[^]*?<\/g><\/g>/.exec(svg)![0];
    expect(legend).toContain("Constraint badge");
    expect(legend).toContain("Re-added path");
    for (const absent of ["Lag or precedence", "Reverse-order", "Repeated execution", "Outside scope"]) expect(legend).not.toContain(absent);
  });

  it("gives PNG and SVG the height of the legend it draws", () => {
    // Without scales, the heading 26 and one key 14: 40 + 2 × 24 is taller than the map, 10 + 2 × 24.
    const svg = toSVG({ graph: tiny, positions: tinyAt, style: {} });
    expect(/viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number)).toEqual([58 + 220, 88]);
    const png = toPNGCanvas({ graph: tiny, positions: tinyAt, style: {} }, { scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => new Proxy({}, { get: (_t, key) => (key === "measureText" ? () => ({ width: 0 }) : () => undefined), set: () => true }) }) });
    expect([png.cssWidth, png.cssHeight]).toEqual([278, 88]);
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
