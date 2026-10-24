import { beforeAll, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type FlowScene, type Positions, type XY, abstract, arrowheadExtent, buildScene, layout, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";

/** A 2D context that keeps the lines it strokes and the triangles it fills, each with its width. */
function recording() {
  const lines: { width: number; points: XY[] }[] = [];
  const heads: { tip: XY; width: number; line?: { width: number; points: XY[] } }[] = [];
  let path: XY[] = [];
  let closed = false;
  let lineWidth = 1;
  let triangle: (typeof heads)[number] | undefined;
  const own: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 6 }),
    createPattern: () => null,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => ((path = []), (closed = false), (triangle = undefined)),
    moveTo: (x: number, y: number) => path.push({ x, y }),
    lineTo: (x: number, y: number) => path.push({ x, y }),
    closePath: () => (closed = true),
    fill: () => {
      if (!closed || path.length !== 3) return;
      // The base of the triangle lies between its second and third point.
      triangle = { tip: path[0], width: Math.hypot(path[1].x - path[2].x, path[1].y - path[2].y), line: lines.at(-1) };
      heads.push(triangle);
    },
    stroke: () => {
      // The outline of the triangle just filled widens it by its width; otherwise a line was drawn.
      if (triangle && closed) triangle.width += lineWidth;
      else if (!closed && path.length >= 2) lines.push({ width: lineWidth, points: path });
    },
  };
  const ctx = new Proxy(own, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => {
      if (k === "lineWidth") lineWidth = v;
      t[k] = v;
      return true;
    },
  }) as unknown as DrawContext;
  return { ctx, heads };
}

let graph: FlowGraph;
let positions: Positions;
let scene: FlowScene;
beforeAll(async () => {
  graph = abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03 });
  positions = await layout(graph, { engine: "dagre" });
  scene = buildScene(graph, positions, { selfLoops: false });
});

/** The thinnest and the widest path drawn. */
const extremes = () => {
  const paths = [...scene.edgeMarks].sort((a, b) => a.width - b.width);
  return [paths[0], paths.at(-1)!];
};

describe("the arrowhead of a path", () => {
  it("grows with the line: at least as wide as the thinnest and the widest path, its tip where the path ends", () => {
    const [thin, wide] = extremes();
    expect([thin.width, wide.width]).toEqual([1, 8]);
    // At 1 the head keeps its size of 12 in a view box of 20: 4.8 wide and outlined by 0.6, 5.4 in all; at 8 it is 4 × 8 = 32,
    // so 12.8 wide and outlined by 1.6, 14.4 in all, 8 long.
    const width = (m: typeof thin) => {
      const e = arrowheadExtent(m.arrow!);
      return 2 * e.half + e.outline;
    };
    expect(width(thin)).toBeCloseTo(5.4, 6);
    expect(width(wide)).toBeCloseTo(14.4, 6);
    expect(arrowheadExtent(wide.arrow!).length).toBeCloseTo(8, 6);
    for (const m of scene.edgeMarks) expect(width(m)).toBeGreaterThan(m.width);
  });

  it("is written by the SVG export as a marker as wide as the head, the line ending inside the head and the tip on the route's end", () => {
    const svg = toSVG({ graph, positions, selfLoops: false });
    const markers = new Map([...svg.matchAll(/<marker id="([^"]+)" viewBox="([^"]+)"[^>]*markerHeight="([^"]+)"/g)].map((m) => [m[1], { viewBox: m[2].split(" ").map(Number), height: Number(m[3]) }]));
    for (const m of extremes()) {
      const id = m.id.replace(/>/g, "&gt;");
      const edge = new RegExp(`<g class="wf-edge" data-id="${id}"><path d="([^"]+)"[^>]*stroke-width="([^"]+)"[^>]*marker-end="url\\(#([^)]+)\\)"`).exec(svg);
      expect(edge, m.id).not.toBeNull();
      const marker = markers.get(edge![3])!;
      expect(marker.height).toBeGreaterThanOrEqual(Number(edge![2]));
      // The drawn line stops short of the route's end by the tip's overhang: the view box reaches that far beyond it.
      const d = edge![1].match(/-?[\d.]+/g)!.map(Number);
      const end = { x: d.at(-2)!, y: d.at(-1)! };
      const route = m.points.at(-1)!;
      const tip = marker.viewBox[0] + marker.viewBox[2] - arrowheadExtent(m.arrow!).outline / 2;
      expect(Math.hypot(route.x - end.x, route.y - end.y)).toBeCloseTo(tip, 1);
    }
  });

  it("is drawn by the Canvas map and the PNG export at least as wide as its line, its tip on the route's end", () => {
    const prepared = prepareScene(graph, positions, { selfLoops: false });
    const map = recording();
    drawScene(map.ctx, { ...prepared, nodes: [], groups: [], marks: [] }, { x: 0, y: 0, zoom: 1, width: 5000, height: 3000 }, undefined, { cull: false });
    const png = recording();
    toPNGCanvas({ graph, positions, selfLoops: false }, { scale: 1, legend: false, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
    for (const drawn of [map, png]) {
      const [thin, wide] = extremes();
      for (const m of [thin, wide]) {
        const end = m.points.at(-1)!;
        // In the PNG export the map is drawn translated: match the head by the line drawn before it.
        const head = drawn.heads.find((h) => h.line?.width === m.width && Math.abs(Math.hypot(h.tip.x - h.line.points.at(-1)!.x, h.tip.y - h.line.points.at(-1)!.y) - arrowheadExtent(m.arrow!).tip) < 0.01 && (drawn === png || (Math.abs(h.tip.x - end.x) < 0.01 && Math.abs(h.tip.y - end.y) < 0.01)));
        expect(head, `${drawn === map ? "map" : "png"} ${m.id}`).toBeDefined();
        expect(head!.width).toBeGreaterThanOrEqual(m.width);
        expect(head!.width).toBeCloseTo(m.width === 1 ? 5.4 : 14.4, 6);
      }
    }
  });
});
