/**
 * The arrowhead rule in the theme and the order paths are painted in (WF-07):
 * in `instrument` a head's base is twice its path's width and a path thinner
 * than 2 has none, its line reaching the route's end; in the default theme
 * every path ends in a head as before. Every renderer paints the widest path
 * first and the thinnest on top, equal widths by id.
 */
import { describe, expect, it } from "vitest";
import { type FlowGraph, arrowheadExtent, buildScene, createPositions, defaultTheme, instrumentTheme, lineEnd, paintOrder, pathArrowhead, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";

// Four parallel paths from a to b, c, d and e: 1, 50, 400 and 1,000 cases, widths 1 (the floor), 1.79, 5.06, 8.
const graph: FlowGraph = {
  nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase(), metrics: { cases: 1000 } })),
  edges: [
    { id: "a-b", kind: "follows", source: "a", target: "b", metrics: { cases: 1 } },
    { id: "a-c", kind: "follows", source: "a", target: "c", metrics: { cases: 50 } },
    { id: "a-d", kind: "follows", source: "a", target: "d", metrics: { cases: 400 } },
    { id: "a-e", kind: "follows", source: "a", target: "e", metrics: { cases: 1000 } },
  ],
};
const positions = createPositions({
  nodes: { a: { x: 0, y: 150, width: 180, height: 64 }, b: { x: 400, y: 0, width: 180, height: 64 }, c: { x: 400, y: 100, width: 180, height: 64 }, d: { x: 400, y: 200, width: 180, height: 64 }, e: { x: 400, y: 300, width: 180, height: 64 } },
  groups: {}, edges: {},
}, "given", "RIGHT");

/** The ids of the edges a Canvas drawing strokes, in order, by the colour each was given; and whether each ends in a filled head. */
function canvasOrder(draw: (ctx: DrawContext) => void, ids: Map<string, string>): string[] {
  const out: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), strokeStyle: "", lineWidth: 1 } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k === "stroke" ? () => { const id = ids.get(`${t.strokeStyle} ${t.lineWidth}`); if (id && out.at(-1) !== id) out.push(id); } : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as DrawContext;
  draw(ctx);
  return out;
}

describe("the arrowhead rule of a theme", () => {
  it("leaves the default theme's heads as they were: every path, at least 12, 4 per unit of width", () => {
    expect([0.5, 1, 3, 3.01, 8].map((w) => pathArrowhead(w, defaultTheme.arrowhead.edge)?.size)).toEqual([12, 12, 12, 13, 32]);
    expect(buildScene(graph, positions).edgeMarks.every((m) => m.arrow)).toBe(true);
  });

  it("draws no head on an instrument path thinner than 2, and a head whose base is twice its line's width on a wider one", () => {
    const rule = instrumentTheme.arrowhead.edge;
    expect([pathArrowhead(1, rule), pathArrowhead(1.99, rule)]).toEqual([undefined, undefined]);
    // At least the rule's 12 (4.8 wide); from 2.4 wide on 5 per unit, so the base is twice the width.
    expect(arrowheadExtent(pathArrowhead(2, rule)!).half * 2).toBeCloseTo(4.8, 6);
    expect(arrowheadExtent(pathArrowhead(4, rule)!).half * 2).toBeCloseTo(8, 6);
    expect(arrowheadExtent(pathArrowhead(8, rule)!).half * 2).toBeCloseTo(16, 6);
    const scene = buildScene(graph, positions, { theme: instrumentTheme });
    const ab = scene.edgeMarks.find((m) => m.id === "a-b")!;
    expect([ab.width, ab.arrow]).toEqual([1, undefined]);
    // Without a head the line ends on the route's end.
    expect(lineEnd(ab.points, ab.arrow)).toEqual(ab.points.at(-1));
    // a → c is 1.79 wide: no head either; a → d and a → e end in theirs.
    expect(scene.edgeMarks.map((m) => [m.id, !!m.arrow])).toEqual([["a-b", false], ["a-c", false], ["a-d", true], ["a-e", true]]);
  });

  it("leaves the head out in the SVG export, the Canvas map and the PNG export alike", () => {
    const svg = toSVG({ graph, positions }, { theme: "instrument", legend: false });
    expect(svg).toMatch(/data-id="a-b"><path d="[^"]*" fill="none" stroke="#[0-9a-f]{6}" stroke-width="1" stroke-linejoin="round"\/>/);
    expect(svg).toMatch(/data-id="a-e"><path [^>]*marker-end="url\(#wf-arrow-40\)"\/>/);
    const heads = (draw: (ctx: DrawContext) => void) => {
      let fills = 0;
      const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
        get: (t, k: string) => (k in t ? t[k] : k === "fill" ? () => void fills++ : () => undefined),
        set: (t, k: string, v) => ((t[k] = v), true),
      }) as unknown as DrawContext;
      draw(ctx);
      return fills;
    };
    const prepared = prepareScene(graph, positions, { theme: instrumentTheme, lodBySize: false });
    const view = { x: 0, y: 0, zoom: 1, width: 800, height: 500 };
    const withHeads = prepareScene(graph, positions, { theme: defaultTheme, lodBySize: false });
    // The default draws two more heads than the instrument theme: those of the paths 1 and 1.79 wide.
    expect(heads((ctx) => drawScene(ctx, withHeads, view, undefined, { cull: false })) - heads((ctx) => drawScene(ctx, prepared, view, undefined, { cull: false }))).toBe(2);
    const png = (theme: "default" | "instrument") => heads((ctx) => void toPNGCanvas({ graph, positions }, { theme, legend: false, createCanvas: (width, height) => ({ width, height, getContext: () => ctx }) }));
    expect(png("default") - png("instrument")).toBe(2);
  });
});

describe("the paint order of paths", () => {
  it("is the widest first, equal widths by id, whatever the order of the input", () => {
    expect(paintOrder([{ id: "b", width: 2 }, { id: "a", width: 2 }, { id: "c", width: 8 }, { id: "d", width: 1 }])).toEqual([2, 1, 0, 3]);
    const scene = buildScene(graph, positions);
    expect(paintOrder(scene.edgeMarks).map((i) => scene.edgeMarks[i].id)).toEqual(["a-e", "a-d", "a-c", "a-b"]);
  });

  it("is what the SVG export and the Canvas map paint", () => {
    const svg = toSVG({ graph, positions }, { theme: "default", legend: false });
    expect([...svg.matchAll(/<g class="wf-edge" data-id="([^"]+)"/g)].map((m) => m[1])).toEqual(["a-e", "a-d", "a-c", "a-b"]);
    const prepared = prepareScene({ ...graph, edges: [...graph.edges].reverse() }, positions, { lodBySize: false });
    const ids = new Map(prepared.edges.map((e) => [`${e.mark.color} ${e.mark.width}`, e.edge.id]));
    expect(canvasOrder((ctx) => drawScene(ctx, prepared, { x: 0, y: 0, zoom: 1, width: 800, height: 500 }, undefined, { cull: false }), ids)).toEqual(["a-e", "a-d", "a-c", "a-b"]);
    expect(canvasOrder((ctx) => drawScene(ctx, prepared, { x: 0, y: 0, zoom: 1, width: 800, height: 500 }, undefined, { cull: true }), ids)).toEqual(["a-e", "a-d", "a-c", "a-b"]);
  });
});
