/**
 * Rounded bends (WF-17): with `Theme.radius.bend` every bend of a route is
 * rounded, no more than half of either segment it joins, as a cubic curve
 * close to a circular arc, in the SVG export and the Canvas map alike; with 0
 * (the default) the routes are the polylines they were.
 */
import { describe, expect, it } from "vitest";
import { type FlowGraph, buildScene, createPositions, defaultTheme, instrumentTheme, roundedRoute, segmentsPath, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";

const graph: FlowGraph = {
  nodes: [{ id: "a", kind: "activity", label: "A", metrics: { cases: 10 } }, { id: "b", kind: "activity", label: "B", metrics: { cases: 10 } }],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 10 } }],
};
// An S-route: right, down, right.
const positions = createPositions({
  nodes: { a: { x: 0, y: 0, width: 100, height: 40 }, b: { x: 300, y: 200, width: 100, height: 40 } },
  groups: {},
  edges: { ab: { points: [{ x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 220 }, { x: 300, y: 220 }] } },
}, "given", "RIGHT");

describe("rounded bends", () => {
  it("round each bend as a curve between the points the radius cuts off its two segments", () => {
    const s = roundedRoute([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 8);
    expect(s[0]).toEqual({ kind: "line", to: { x: 92, y: 0 } });
    expect(s[1]).toMatchObject({ kind: "curve", to: { x: 100, y: 8 } });
    expect(s[2]).toEqual({ kind: "line", to: { x: 100, y: 100 } });
    // A short segment takes at most half of itself; a straight point has no curve.
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 100 }], 8)[0]).toEqual({ kind: "line", to: { x: 3, y: 0 } });
    expect(roundedRoute([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], 8).map((x) => x.kind)).toEqual(["line", "line"]);
    expect(segmentsPath({ x: 0, y: 0 }, s)).toMatch(/^M0 0L92 0C[\d. ]+ 100 8L100 100$/);
  });

  it("are drawn by the instrument theme in the SVG export and on the Canvas, and not by the default", () => {
    const m = buildScene(graph, positions, { theme: instrumentTheme }).edgeMarks[0];
    expect(m.path?.filter((x) => x.kind === "curve")).toHaveLength(2);
    expect(buildScene(graph, positions, { theme: defaultTheme }).edgeMarks[0].path).toBeUndefined();
    expect(toSVG({ graph, positions }, { theme: "instrument", legend: false })).toMatch(/data-id="ab"><path d="M100 20L192 20C[^"]*C[^"]*L[^"]*"/);
    expect(toSVG({ graph, positions }, { theme: "default", legend: false })).toMatch(/data-id="ab"><path d="M100 20L200 20L200 220L/);
    let curves = 0;
    const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 6 }) } as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : k === "bezierCurveTo" ? () => void curves++ : () => undefined),
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as DrawContext;
    drawScene(ctx, prepareScene(graph, positions, { theme: instrumentTheme, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 500, height: 300 }, undefined, { cull: false });
    expect(curves).toBe(2);
  });
});
