import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Overlay, type Positions, type XY, createPositions, layout, overlaysFor } from "../../src/index";
import { type PreparedScene, prepareScene } from "../../src/canvas/index";

/** Distance from a point to a segment. */
function toSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** A cubic path "M x0 y0 C x1 y1 x2 y2 x3 y3" sampled finely: 400 segments. */
function curve(path: string): XY[] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = path.match(/-?[\d.]+/g)!.map(Number);
  return Array.from({ length: 401 }, (_, k) => {
    const t = k / 400;
    const u = 1 - t;
    return { x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 };
  });
}
const toCurve = (p: XY, c: XY[]) => Math.min(...c.slice(1).map((q, k) => toSegment(p, c[k], q)));

const top = (scene: PreparedScene, x: number, y: number) => {
  const hit = scene.hit.at(x, y)[0];
  return hit && (hit.kind === "overlay" ? `${scene.shapeById.get(hit.shapeId!)!.kind}:${hit.id}` : `${hit.kind}:${hit.id}`);
};

const activity = (id: string) => ({ id, kind: "activity" as const, label: id.toUpperCase() });

describe("hits on arcs, self-loops and gateways, where they are drawn", () => {
  it("returns an activity, not its self-loop, inside the activity away from the loop's stroke", () => {
    // One activity of 180 × 48 at the origin with a loop: it starts on the top edge at x 162 and ends on the right edge at y 12.
    const graph: FlowGraph = { nodes: [activity("a")], edges: [{ id: "a->a", kind: "follows", source: "a", target: "a", metrics: { count: 7 } }] };
    const scene = prepareScene(graph, createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 48 } }, groups: {}, edges: {} }, "given", "RIGHT"));
    const loop = curve(scene.marks.find((m) => m.kind === "selfLoop")!.path!);
    // 10 from the loop's start (162, 0), its nearest point.
    expect(toCurve({ x: 170, y: 6 }, loop)).toBeCloseTo(10, 6);
    expect(top(scene, 170, 6)).toBe("node:a");
    // On the loop's stroke, at its highest point, and on its label: the loop.
    const apex = loop.reduce((a, b) => (b.y < a.y ? b : a));
    expect(top(scene, apex.x, apex.y + 1)).toBe("selfLoop:a");
    const label = scene.marks.find((m) => m.kind === "selfLoop")!.texts[0];
    expect(top(scene, label.x + 3, label.y - 3)).toBe("selfLoop:a");
  });

  it("returns a path under an arc's box, and the arc on its stroke and on its label", () => {
    // a and b 600 apart with an arc over the top; a path from c to d runs below the arc's course, inside its box.
    const graph: FlowGraph = {
      nodes: ["a", "b", "c", "d"].map(activity),
      edges: [{ id: "c->d", kind: "follows", source: "c", target: "d", metrics: { count: 3 } }],
    };
    const box = (x: number, y: number) => ({ x, y, width: 100, height: 40 });
    const positions = createPositions({ nodes: { a: box(0, 200), b: box(600, 200), c: box(150, 160), d: box(450, 160) }, groups: {}, edges: {} }, "given", "RIGHT");
    const overlays: Overlay[] = [{ kind: "arc", target: "a->b", payload: { constraintId: "order", source: "a", target: "b", value: 0.4, coverage: 0.5 } }];
    const scene = prepareScene(graph, positions, { overlays });
    const arc = scene.marks.find((m) => m.kind === "arc")!;
    const course = curve(arc.path!);
    // The path's line at y 180 between c's right side (250) and d's left side (450), inside the arc's box.
    expect(arc.box.y).toBeLessThan(180);
    expect(toCurve({ x: 300, y: 180 }, course)).toBeGreaterThan(8);
    expect(top(scene, 300, 180)).toBe("edge:c->d");
    // On the arc's stroke (6 wide here) at its apex, within the tolerance of 4 below it, and on its label above it.
    const on = course[200];
    expect(top(scene, on.x, on.y)).toBe("arc:a->b");
    expect(top(scene, on.x, on.y + 3 + 3.9)).toBe("arc:a->b");
    expect(top(scene, on.x, on.y + 3 + 4.1)).toBeUndefined();
    const label = arc.texts[0];
    expect(top(scene, label.x, label.y - 4)).toBe("arc:a->b");
  });

  it("returns a gateway inside its diamond, also where the diamond reaches beyond its box, and not in the box's corners", () => {
    // A gateway 60 wide and 30 tall: its diamond's points are 30 from its centre (30, 15), above and below the box too.
    const graph: FlowGraph = { nodes: [{ id: "g", kind: "gateway", label: "G", tags: ["xor"] }], edges: [] };
    const scene = prepareScene(graph, createPositions({ nodes: { g: { x: 0, y: 0, width: 60, height: 30 } }, groups: {}, edges: {} }, "given", "RIGHT"));
    expect(top(scene, 30, 15)).toBe("node:g");
    expect(top(scene, 30, -10)).toBe("node:g");
    expect(top(scene, 30, 40)).toBe("node:g");
    // The box's corner (1, 1) is 43 from the centre along the diamond's axes: outside it by more than the tolerance.
    expect(top(scene, 1, 1)).toBeUndefined();
  });
});

describe("hits on the BPIC global scene with stage lanes and its constraint arcs", () => {
  let scene: PreparedScene;
  beforeAll(async () => {
    const positions: Positions = await layout(globalScene, { engine: "dagre" });
    scene = prepareScene(globalScene, positions, { overlays: overlaysFor(constraintItems(), { graph: globalScene }), lanes: "stages" });
  });

  it("returns no arc at a point near a path and more than 8 from every arc's curve, on a grid of 40,000 points", () => {
    // Every segment of a path and of an arc's curve, with its box grown by the distance that matters, to skip most of them at once.
    const segments = (lines: XY[][], by: number) => lines.flatMap((pts) => pts.slice(1).map((q, k) => ({ a: pts[k], b: q, x0: Math.min(pts[k].x, q.x) - by, x1: Math.max(pts[k].x, q.x) + by, y0: Math.min(pts[k].y, q.y) - by, y1: Math.max(pts[k].y, q.y) + by })));
    const within = (p: XY, list: ReturnType<typeof segments>, d: number) => list.some((s) => p.x >= s.x0 && p.x <= s.x1 && p.y >= s.y0 && p.y <= s.y1 && toSegment(p, s.a, s.b) <= d);
    const arcs = scene.marks.filter((m) => m.kind === "arc" && m.inMap).map((m) => curve(m.path!));
    expect(arcs).toHaveLength(12);
    const paths = segments(scene.edges.map((e) => e.points), 4);
    const curves = segments(arcs, 8);
    const b = scene.bounds;
    let near = 0;
    const wrong: string[] = [];
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 200; j++) {
        const p = { x: b.x + ((i + 0.5) * b.width) / 200, y: b.y + ((j + 0.5) * b.height) / 200 };
        if (!within(p, paths, 4) || within(p, curves, 8)) continue;
        near++;
        if (top(scene, p.x, p.y)?.startsWith("arc:")) wrong.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
      }
    }
    expect(near).toBeGreaterThan(1000);
    expect(wrong).toEqual([]);
  }, 60_000);
});
