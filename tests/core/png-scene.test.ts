import { describe, expect, it } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowGraph, type Positions, abstract, createPositions, layout, overlaysFor, toSVG } from "../../src/index";
import { type DrawContext, prepareScene, toPNGCanvas } from "../../src/canvas/index";

/** A 2D context that records every text with the font it was drawn in. */
function textRecorder() {
  const texts: { text: string; font: string; align: CanvasTextAlign }[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: "" as string, strokeStyle: "" as string, lineWidth: 1, font: "", globalAlpha: 1,
    textAlign: "left" as CanvasTextAlign, textBaseline: "alphabetic" as CanvasTextBaseline,
    lineJoin: "miter" as CanvasLineJoin, lineCap: "butt" as CanvasLineCap,
    save: noop, restore: noop, translate: noop, scale: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, fillRect: noop, clearRect: noop, strokeText: noop, setLineDash: noop,
    fillText(text: string) {
      texts.push({ text, font: ctx.font, align: ctx.textAlign });
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
  } satisfies DrawContext;
  return { ctx, texts, createCanvas: (width: number, height: number) => ({ width, height, getContext: () => ctx }) };
}

/** The bold 10 px centred text is what the drawing routines write into a badge (a chip's bold label starts left). */
const badgeTexts = (texts: { text: string; font: string; align: CanvasTextAlign }[]) => texts.filter((t) => t.font.startsWith("700 10px") && t.align === "center").map((t) => t.text);

const vendor = abstract(vendorScene, { minEdgeShare: 0.02 });
const constraints = overlaysFor(constraintItems(vendorSceneKey), { graph: vendor });
const withOverlays: FlowGraph = { ...vendor, overlays: constraints };

describe("toPNG reads the scene", () => {
  it("draws every graph overlay once", async () => {
    const positions = await layout(vendor, { engine: "dagre" });
    const nodes = new Set(vendor.nodes.map((n) => n.id));
    const badges = constraints.filter((o) => o.kind === "badge" && nodes.has(o.target));
    expect(badges.length).toBeGreaterThan(0);
    // Each badge writes its glyph and its share in its pill: the vendor's three constraints fall short for 6, 7 and 20 % of its cases.
    const expected = ["∅ · 6 %", "≤1 · 7 %", "≥1 · 20 %"];
    expect(badges.map((o) => String(o.payload?.glyph)).sort()).toEqual(["∅", "≤1", "≥1"]);
    const fromGraph = textRecorder();
    toPNGCanvas({ graph: withOverlays, positions }, { legend: false, scale: 1, createCanvas: fromGraph.createCanvas });
    expect(badgeTexts(fromGraph.texts).sort()).toEqual(expected);
    const given = textRecorder();
    toPNGCanvas({ graph: withOverlays, positions, overlays: constraints }, { legend: false, scale: 1, createCanvas: given.createCanvas });
    expect(badgeTexts(given.texts).sort()).toEqual(expected);
  });

  it("agrees with the SVG export on node and edge labels for a 70-node chain", () => {
    const ids = Array.from({ length: 70 }, (_, i) => `s${i}`);
    const chain: FlowGraph = {
      nodes: ids.map((id, i) => ({ id, kind: "activity", label: `S${i}` })),
      edges: ids.slice(1).map((id, i) => ({ id: `e${i}`, kind: "follows", source: ids[i], target: id, metrics: { count: 5 } })),
    };
    const positions: Positions = createPositions({
      nodes: Object.fromEntries(ids.map((id, i) => [id, { x: i * 200, y: 0, width: 160, height: 48 }])),
      groups: {},
      edges: {},
    }, "dagre", "RIGHT");
    // At zoom 1 every node label and every transition count once; at 0.21 node
    // labels (from 0.2, not tightened to 0.23 for 70 nodes) but no counts (from 0.6).
    const labels = ids.map((_, i) => `S${i}`);
    const all = [...labels, ...ids.slice(1).map(() => "5")].sort();
    const svgTexts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).sort();
    for (const [options, expected] of [[{}, all], [{ preset: "single-column" as const }, all], [{ lodZoom: 0.21 }, [...labels].sort()]] as const) {
      const png = textRecorder();
      toPNGCanvas({ graph: chain, positions }, { ...options, legend: false, scale: 1, createCanvas: png.createCanvas });
      expect(png.texts.map((t) => t.text).sort(), JSON.stringify(options)).toEqual(expected);
      expect(svgTexts(toSVG({ graph: chain, positions }, { ...options, legend: false })), JSON.stringify(options)).toEqual(expected);
    }
  });

  it("keeps the size-dependent level of detail for the live Canvas map only", () => {
    const many: FlowGraph = { nodes: Array.from({ length: 70 }, (_, i) => ({ id: `n${i}`, kind: "activity", label: `N${i}` })), edges: [] };
    const positions = createPositions({ nodes: Object.fromEntries(many.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 160, height: 48 }])), groups: {}, edges: {} }, "dagre", "RIGHT");
    // 61 to 150 nodes tighten every threshold by 1.15.
    expect(prepareScene(many, positions).lod.labels).toBeCloseTo(0.23);
    expect(prepareScene(many, positions, { lodBySize: false }).lod.labels).toBe(0.2);
  });

  it("draws follows self-loops as the SVG export does", () => {
    const loop: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", metrics: { cases: 4 } }, { id: "b", kind: "activity", label: "B" }],
      edges: [
        { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 4 } },
        { id: "aa", kind: "follows", source: "a", target: "a", metrics: { count: 3, cases: 2 } },
      ],
    };
    const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 160, height: 48 }, b: { x: 300, y: 0, width: 160, height: 48 } }, groups: {}, edges: {} }, "dagre", "RIGHT");
    // Two of the four cases at A repeat it.
    expect(toSVG({ graph: loop, positions }, { legend: false })).toContain(">↻ 50 %<");
    const shown = textRecorder();
    toPNGCanvas({ graph: loop, positions }, { legend: false, scale: 1, createCanvas: shown.createCanvas });
    expect(shown.texts.map((t) => t.text)).toContain("↻ 50 %");
    expect(toSVG({ graph: loop, positions, selfLoops: false }, { legend: false })).not.toContain("↻");
    const hidden = textRecorder();
    toPNGCanvas({ graph: loop, positions, selfLoops: false }, { legend: false, scale: 1, createCanvas: hidden.createCanvas });
    expect(hidden.texts.some((t) => t.text.includes("↻"))).toBe(false);
  });
});
