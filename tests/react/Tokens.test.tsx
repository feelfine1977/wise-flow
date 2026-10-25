import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type PatternId, PATTERNS, patternDefs, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";
import { PatternSwatch, ProcessMap } from "../../src/react/index";
import { graph, positions, style } from "../core/element-kinds";

afterEach(cleanup);

type Segment = string;
const r = (n: number) => Math.round(n * 100) / 100 + 0;

/** Lines and dots of an SVG pattern tile, with its size, stroke and fill. */
function svgTile(pattern: Element) {
  const lines: Segment[] = [];
  for (const p of pattern.querySelectorAll("path")) {
    for (const m of p.getAttribute("d")!.matchAll(/M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)/g)) lines.push(m.slice(1, 5).map(Number).map(r).join(","));
  }
  const dots = [...pattern.querySelectorAll("circle")].map((c) => ["cx", "cy", "r"].map((a) => c.getAttribute(a)).join(","));
  const path = pattern.querySelector("path");
  const circle = pattern.querySelector("circle");
  return {
    size: [pattern.getAttribute("width"), pattern.getAttribute("height")].map(Number),
    lines,
    dots,
    stroke: path ? [path.getAttribute("stroke-width"), path.getAttribute("stroke-opacity")].map(Number) : undefined,
    fill: circle ? Number(circle.getAttribute("fill-opacity")) : undefined,
  };
}

/** The same description of the tile the Canvas drawing makes for a node's band. */
function canvasTile(pattern: PatternId) {
  let tile: ReturnType<typeof svgTile> = { size: [], lines: [], dots: [], stroke: undefined, fill: undefined };
  const noop = () => {};
  const recorder = (size: number[]) => {
    let path: { lines: Segment[]; dots: string[] } = { lines: [], dots: [] };
    let from: number[] = [];
    const ctx = {
      globalAlpha: 1, lineWidth: 1, strokeStyle: "", fillStyle: "",
      beginPath: () => { path = { lines: [], dots: [] }; },
      moveTo: (x: number, y: number) => { from = [x, y]; },
      lineTo: (x: number, y: number) => { path.lines.push([...from, x, y].map(r).join(",")); },
      arc: (x: number, y: number, rad: number) => { path.dots.push([x, y, rad].join(",")); },
      stroke: () => { tile = { ...tile, size, lines: path.lines, stroke: [ctx.lineWidth, ctx.globalAlpha] }; },
      fill: () => { tile = { ...tile, size, dots: path.dots, fill: ctx.globalAlpha }; },
    };
    return ctx;
  };
  const scene = prepareScene(graph, positions, { style, selfLoops: false, lodBySize: false });
  // The card is given a band (it has no stage of its own) in the pattern compared.
  const nodes = scene.nodes.map((n) => (n.node.id === "a" ? { ...n, mark: { ...n.mark, band: 8, pattern } } : n));
  const ctx = new Proxy({ createPattern: () => ({}), measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : noop),
    set: (t, k: string, v) => { t[k] = v; return true; },
  }) as unknown as DrawContext;
  drawScene(ctx, { ...scene, nodes }, { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, {
    cull: false,
    createCanvas: ((w: number, h: number) => ({ width: w, height: h, getContext: () => recorder([w, h]) })) as never,
  });
  return tile;
}

describe("design tokens across the renderers", () => {
  it("draws one pattern twin per pattern in SVG, Canvas and React", () => {
    const defs = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${patternDefs()}</svg>`, "image/svg+xml");
    let compared = 0;
    for (const p of PATTERNS.filter((x) => x !== "solid")) {
      const exported = svgTile(defs.getElementById(`wf-pattern-${p}`)!);
      const { container } = render(<PatternSwatch pattern={p} ink="#1f1f1f" />);
      const swatch = svgTile(container.querySelector("pattern")!);
      cleanup();
      expect(exported.size, p).toEqual([6, 6]);
      expect(swatch, p).toEqual(exported);
      expect(canvasTile(p), p).toEqual(exported);
      compared++;
    }
    expect(compared).toBe(7);
  });

  it("ends edges in the same arrowhead on the map, in SVG and in Canvas", async () => {
    const { container } = render(
      <div style={{ width: 1000, height: 400 }}>
        <ProcessMap graph={graph} positions={positions} style={style} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector("marker#wf-edge-arrow-12")).not.toBeNull());
    // The map's marker, in user units with its reference at the end of the line: the triangle relative to it.
    const triangle = (marker: Element) => {
      const path = marker.querySelector("path")!;
      return { points: [...path.getAttribute("d")!.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [r(Number(m[1])), r(Number(m[2]))]), outline: r(Number(path.getAttribute("stroke-width"))) };
    };
    const marker = container.querySelector("marker#wf-edge-arrow-12")!;
    expect([marker.getAttribute("refX"), marker.getAttribute("refY"), marker.getAttribute("markerUnits")]).toEqual(["0", "0", "userSpaceOnUse"]);
    const map = triangle(marker);
    // Hand-derived: (−5, ±4) and the tip at 0 at 12 / 20, outlined by 1 × 12 / 20, the tip 2.25 beyond the line's end.
    expect(map).toEqual({ points: [[2.25, 0], [-0.75, 2.4], [-0.75, -2.4]], outline: 0.6 });

    const sorted = (t: { points: number[][]; outline: number }) => ({ ...t, points: [...t.points].sort((a, b) => a[0] - b[0] || a[1] - b[1]) });

    const svg = toSVG({ graph, positions, style }, { legend: false });
    const exported = new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("marker#wf-arrow")!;
    expect(sorted(triangle(exported))).toEqual(sorted(map));

    // Canvas: the triangle at the end of start → a, whose route ends at (100, 20) heading right, the tip there: 2.25 beyond the line's end.
    const fills: { path: number[][]; outline?: number }[] = [];
    let path: number[][] = [];
    const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 6 }) } as Record<string, unknown>, {
      get: (t, k: string) => k in t ? t[k] : k === "beginPath" ? () => { path = []; } : k === "moveTo" || k === "lineTo" ? (x: number, y: number) => path.push([x, y]) : k === "fill" ? () => fills.push({ path }) : k === "stroke" ? () => { if (fills.at(-1)?.path === path) fills.at(-1)!.outline = t.lineWidth as number; } : () => {},
      set: (t, k: string, v) => { t[k] = v; return true; },
    }) as unknown as DrawContext;
    drawScene(ctx, prepareScene(graph, positions, { style, selfLoops: false, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 1000, height: 600 }, undefined, { cull: false });
    const arrow = fills.find((f) => f.path.length === 3 && f.path[0][0] === 100 && f.path[0][1] === 20)!;
    expect(sorted({ points: arrow.path.map(([x, y]) => [r(x - 100 + 2.25), r(y - 20)]), outline: arrow.outline! })).toEqual(sorted(map));
  });
});
