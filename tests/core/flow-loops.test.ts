// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type EdgeProtection, createPositions, toSVG, validateGraph } from "../../src/index";
import { drawScene, prepareScene } from "../../src/canvas/index";
import { inkContext } from "../support/ink";
import { flowLoop, flowLoopPositions } from "../support/flow-loop";

describe("model flow self-loops", () => {
  it("draws all three selected flows, without describing the model loop as an observed repeat", () => {
    expect(validateGraph(flowLoop)).toEqual([]);
    const scene = prepareScene(flowLoop, flowLoopPositions);
    const frame = drawScene(inkContext().ctx, scene, { x: 0, y: 100, zoom: 1, width: 1400, height: 900 }, { selection: { nodes: [], edges: ["aa"], groups: [] } }, { pathRule: { minPx: 0.5 } });
    expect(frame.edges).toBe(3);
    expect(frame.withheld).toBeUndefined();
    expect(scene.overlays).toEqual([]);
    const svg = new DOMParser().parseFromString(toSVG({ graph: flowLoop, positions: flowLoopPositions }, { theme: "default" }), "image/svg+xml");
    expect(svg.querySelector('g[data-id="aa"] path')).toBeTruthy();
    expect(svg.documentElement.textContent).not.toMatch(/observed|directly-follows/i);
  });

  it.each([
    { selection: { edges: ["aa"] } }, { focused: "aa" }, { highlighted: new Set(["aa"]) },
  ] satisfies EdgeProtection[])("keeps a protected loop through a zero budget and counts it once: %s", (protection) => {
    const scene = prepareScene(flowLoop, flowLoopPositions);
    for (const zoom of [0.05, 0.1, 0.5, 1]) {
      const frame = drawScene(inkContext().ctx, scene, { x: 0, y: 100, zoom, width: 1400, height: 900 }, { ...protection, selection: { nodes: [], edges: protection.selection?.edges ?? [], groups: [] } }, { pathRule: { minPx: 0.5 }, edgeBudget: 0, cull: true });
      expect(frame.edges, `zoom ${zoom}`).toBe(3);
      expect(frame.withheld, `zoom ${zoom}`).toBeUndefined();
    }
  });

  it("uses a supplied loop course, or attaches a fallback to a course outside its activity, with matching bounds and culling", () => {
    const scene = prepareScene(flowLoop, flowLoopPositions);
    const loop = scene.edgeById.get("aa")!;
    expect(loop).toBeTruthy();
    const points = loop.points;
    const box = flowLoopPositions.nodes.a;
    const boundary = (p: { x: number; y: number }) => ((p.x === box.x || p.x === box.x + box.width) && p.y >= box.y && p.y <= box.y + box.height) || ((p.y === box.y || p.y === box.y + box.height) && p.x >= box.x && p.x <= box.x + box.width);
    expect(boundary(points[0])).toBe(true);
    expect(boundary(points.at(-1)!)).toBe(true);
    expect(points.length).toBeGreaterThan(3);
    expect(points.some((p) => p.x !== points[0].x || p.y !== points[0].y)).toBe(true);
    for (const p of points.slice(1, -1)) {
      expect(p.x < box.x || p.x > box.x + box.width || p.y < box.y || p.y > box.y + box.height).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(scene.bounds.x);
      expect(p.x).toBeLessThanOrEqual(scene.bounds.x + scene.bounds.width);
      expect(p.y).toBeGreaterThanOrEqual(scene.bounds.y);
      expect(p.y).toBeLessThanOrEqual(scene.bounds.y + scene.bounds.height);
    }
    expect(scene.hit.at(points[1].x, points[1].y, 0).some((h) => h.id === "aa")).toBe(true);
    const supplied = [{ x: 260, y: 0 }, { x: 260, y: -60 }, { x: 320, y: -60 }, { x: 320, y: 0 }];
    const placed = prepareScene(flowLoop, createPositions({ ...flowLoopPositions, edges: { aa: { points: supplied } } }, "given", "RIGHT"));
    expect(placed.edgeById.get("aa")!.points).toEqual(supplied);
    const state = { selection: { nodes: [], edges: ["aa"], groups: [] } };
    // The loop is visible above the box; moving that strip far away culls it without changing the whole-map selection.
    const frame = (x: number) => drawScene(inkContext().ctx, placed, { x, y: 60, zoom: 1, width: 100, height: 10 }, state, { cull: true, edgeBudget: 0, pathRule: { minPx: 0.5 } });
    expect(frame(-250).edges).toBe(1);
    expect(frame(-1000).edges).toBe(0);
    expect(frame(-250).withheld).toEqual(frame(-1000).withheld);
  });
});
