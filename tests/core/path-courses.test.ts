import { beforeAll, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { backAcrossStages, oppositePaths } from "../../fixtures/path-direction";
import { type AbstractOptions, type Box, type EdgeMark, type FlowGraph, type FlowScene, type Positions, type XY, abstract, buildScene, createPositions, layout, toSVG } from "../../src/index";

/** The distance from a point to a polyline. */
function distance(p: XY, points: readonly XY[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  }
  return best;
}

/** Points along the segments of a course but its first and last, ten per segment. */
const inner = (points: readonly XY[]) => points.slice(1, -2).flatMap((a, i) => Array.from({ length: 11 }, (_, k) => ({ x: a.x + ((points[i + 2].x - a.x) * k) / 10, y: a.y + ((points[i + 2].y - a.y) * k) / 10 })));

/** Whether a segment crosses the open inside of a box. */
function crosses(a: XY, b: XY, box: Box): boolean {
  for (let k = 0; k <= 50; k++) {
    const p = { x: a.x + ((b.x - a.x) * k) / 50, y: a.y + ((b.y - a.y) * k) / 50 };
    if (p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height) return true;
  }
  return false;
}

/** The groups a course crosses, by id. */
const crossed = (points: readonly XY[], groups: Record<string, Box>) => Object.entries(groups).filter(([, box]) => points.slice(1).some((p, i) => crosses(points[i], p, box))).map(([id]) => id);

/** A path's label point, where its count is written. */
const labelOf = (m: EdgeMark) => ({ x: m.texts[0].x, y: m.texts[0].y });

describe("a path against the reading direction", () => {
  let scene: FlowScene;
  let laid: Positions;
  beforeAll(async () => {
    laid = await layout(backAcrossStages, { engine: "elk" });
    scene = buildScene(backAcrossStages, laid, { selfLoops: false });
  });

  it("is drawn below the flow it returns over, crossing no group but at its two ends, where the layout framed the groups", () => {
    const back = scene.edgeMarks.find((m) => m.id === "check->create")!;
    const [source, target] = [laid.nodes.check, laid.nodes.create];
    // The layout's own route leaves Check's stage, runs around both stages and enters Create from before it: a frame.
    const framed = laid.edges["check->create"].points;
    expect(framed.some((p) => p.x > laid.groups.get.x + laid.groups.get.width || p.x < laid.groups.buy.x)).toBe(true);
    // The scene's course leaves Check from its bottom and enters Create from its bottom, every point between them below every box of the stretch.
    const course = back.points;
    expect(course[0]).toEqual({ x: source.x + source.width / 2, y: source.y + source.height });
    expect(course.at(-1)).toEqual({ x: target.x + target.width / 2, y: target.y + target.height });
    const lowest = Math.max(...Object.values(laid.groups).map((g) => g.y + g.height), ...Object.values(laid.nodes).map((n) => n.y + n.height));
    expect(course.slice(1, -1).every((p) => p.y > lowest)).toBe(true);
    // Along the flow it stays between its two ends: it never runs around a group's side.
    expect(course.every((p) => p.x >= target.x && p.x <= source.x + source.width)).toBe(true);
    // It crosses the box of the stage it leaves and of the stage it enters, at its two ends only.
    expect(crossed(course, laid.groups).sort()).toEqual(["buy", "get"]);
    expect(crossed(course.slice(1, -1), laid.groups)).toEqual([]);
  });

  it("can be told from a forward path by its course: it is marked backward and its head points up, against the flow, into its target", () => {
    const back = scene.edgeMarks.find((m) => m.id === "check->create")!;
    expect(back.backward).toBe(true);
    const [a, b] = back.points.slice(-2);
    expect(b.x - a.x).toBe(0);
    expect(b.y - a.y).toBeLessThan(0);
    for (const m of scene.edgeMarks.filter((m) => m.id !== "check->create")) {
      expect(m.backward, m.id).toBeUndefined();
      const [c, d] = m.points.slice(-2);
      // Forward paths end heading along the flow, to the right.
      expect(d.x - c.x, m.id).toBeGreaterThan(0);
    }
  });

  it("steps aside beyond a stage that lies below its source, not through it", () => {
    // B returns to A within the stage S1; the stage S2 lies below B with C in it.
    const activity = (id: string, group: string) => ({ id, kind: "activity" as const, label: id.toUpperCase(), group, metrics: { cases: 10 } });
    const graph: FlowGraph = {
      nodes: [activity("a", "s1"), activity("b", "s1"), activity("c", "s2")],
      edges: [
        { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { cases: 10 } },
        { id: "b->a", kind: "follows", source: "b", target: "a", metrics: { cases: 3 } },
        { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { cases: 7 } },
      ],
      groups: [
        { id: "s1", kind: "stage", label: "S1" },
        { id: "s2", kind: "stage", label: "S2" },
      ],
    };
    const box = (x: number, y: number) => ({ x, y, width: 100, height: 40 });
    const groups = { s1: { x: 0, y: 0, width: 320, height: 90 }, s2: { x: 180, y: 110, width: 140, height: 90 } };
    const scene = buildScene(graph, createPositions({ nodes: { a: box(20, 30), b: box(200, 30), c: box(200, 140) }, groups, edges: {} }, "given", "RIGHT"), { selfLoops: false });
    const back = scene.edgeMarks.find((m) => m.id === "b->a")!;
    // From B's bottom (250, 70) it steps 12 down, into the gap above S2 (at 110), then aside 12 before S2 (180), the
    // leftmost box of B's column, so to 168; it runs 20 below S2 (200) besides its half width, √(3 / 10) × 8 / 2 = 2.19,
    // and enters A from its bottom middle (70, 70).
    expect(back.points).toEqual([{ x: 250, y: 70 }, { x: 250, y: 82 }, { x: 168, y: 82 }, { x: 168, y: 222.19 }, { x: 70, y: 222.19 }, { x: 70, y: 70 }]);
    expect(crossed(back.points, groups)).toEqual(["s1"]);
  });

  it("runs below the graph's own activities only, not below positions given for nodes and groups the graph does not have", () => {
    // B returns to A; the positions also hold a node and a group of a larger graph, far below the stretch it returns over.
    const activity = (id: string) => ({ id, kind: "activity" as const, label: id.toUpperCase(), metrics: { cases: 10 } });
    const graph: FlowGraph = {
      nodes: [activity("a"), activity("b")],
      edges: [
        { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { cases: 10 } },
        { id: "b->a", kind: "follows", source: "b", target: "a", metrics: { cases: 3 } },
      ],
    };
    const box = (x: number, y: number) => ({ x, y, width: 100, height: 40 });
    const positions = createPositions({ nodes: { a: box(0, 0), b: box(200, 0), gone: box(100, 200) }, groups: { old: { x: 80, y: 300, width: 140, height: 100 } }, edges: {} }, "given", "RIGHT");
    // From B's bottom middle (250, 40) 20 below the two activities (40) besides its half width, √(3 / 10) × 8 / 2 = 2.19,
    // to A's bottom middle (50, 40); neither the node at 200 to 240 nor the group at 300 to 400 holds it down.
    const course = [{ x: 250, y: 40 }, { x: 250, y: 62.19 }, { x: 50, y: 62.19 }, { x: 50, y: 40 }];
    expect(buildScene(graph, positions, { selfLoops: false }).edgeMarks.find((m) => m.id === "b->a")!.points).toEqual(course);
    // The exports place the graph on its own positions as well.
    const d = /<g class="wf-edge" data-id="b-&gt;a"><path d="([^"]+)"/.exec(toSVG({ graph, positions, selfLoops: false }))?.[1];
    expect(d?.split(/[ML]/).filter(Boolean).slice(0, 3)).toEqual(["250 40", "250 62.19", "50 62.19"]);
  });

  it("is drawn so by the SVG export too, with its own head", () => {
    const svg = toSVG({ graph: backAcrossStages, positions: laid, selfLoops: false });
    const d = /<g class="wf-edge" data-id="check-&gt;create"><path d="([^"]+)"[^>]*marker-end="url\(#wf-arrow(-\d+)?\)"/.exec(svg)?.[1];
    const back = scene.edgeMarks.find((m) => m.id === "check->create")!;
    // The path is √(200 / 1,200) × 8 = 3.27 wide, so its head is ⌈4 × 3.27⌉ = 14 and the line ends 3.75 × 14 / 20 = 2.625 below
    // Create, inside its head, along the course of the mark (written to two decimals).
    expect(back.width).toBe(3.27);
    const num = (n: number) => Number(n.toFixed(2));
    expect(d).toBe(back.points.map((p, i) => `${i ? "L" : "M"}${num(p.x)} ${num(i === back.points.length - 1 ? p.y + 2.625 : p.y)}`).join(""));
  });
});

describe("two paths in opposite directions between the same activities", () => {
  /** That neither course runs along the other beyond their end segments, and each label is nearer its own course. */
  const apart = (scene: FlowScene) => {
    const there = scene.edgeMarks.find((m) => m.id === "approve->order")!;
    const back = scene.edgeMarks.find((m) => m.id === "order->approve")!;
    for (const [one, other] of [[there, back], [back, there]]) {
      for (const p of inner(one.points)) expect(distance(p, other.points)).toBeGreaterThan((one.width + other.width) / 2);
      expect(distance(labelOf(one), one.points)).toBeLessThan(distance(labelOf(one), other.points));
      expect(one.texts[0].text).toBe(one === there ? "800" : "300");
    }
    return { there, back };
  };

  it("are drawn apart by a layout in layers: the path back runs below the flow with its own head and label", async () => {
    const scene = buildScene(oppositePaths, await layout(oppositePaths, { engine: "elk" }), { selfLoops: false });
    const { there, back } = apart(scene);
    expect([there.backward, back.backward]).toEqual([undefined, true]);
  });

  it("are drawn side by side where they lie across the flow, each to its own right with its own head and label", () => {
    // Approve above Order in one layer, the layout giving no routes: both run straight between the boxes.
    const box = (x: number, y: number) => ({ x, y, width: 180, height: 64 });
    const positions = createPositions({ nodes: { request: box(0, 0), approve: box(260, 0), order: box(260, 140), pay: box(520, 140) }, groups: {}, edges: {} }, "given", "RIGHT");
    const scene = buildScene(oppositePaths, positions, { selfLoops: false });
    const { there, back } = apart(scene);
    // Widths √(800 / 1,000) × 8 = 7.16 and √(300 / 1,000) × 8 = 4.38; each moves half its width and 2 to its right: down the
    // flow (Approve → Order) is to the left, x = 350 − 5.58; up it (Order → Approve) to the right, x = 350 + 4.19.
    expect([there.width, back.width]).toEqual([7.16, 4.38]);
    expect(there.points.map((p) => p.x)).toEqual([344.42, 344.42]);
    expect(back.points.map((p) => p.x)).toEqual([354.19, 354.19]);
    // Each label beside its own line, on its own side: before the left line, after the right one.
    expect([there.texts[0].anchor, back.texts[0].anchor]).toEqual(["end", "start"]);
    expect([there.arrow.size, back.arrow.size]).toEqual([29, 18]);
  });
});

describe("the committed scene of the whole log", () => {
  const SETTINGS: AbstractOptions[] = [0, 0.05, 0.1, 0.25, 0.5].map((s) => ({ minNodeShare: s, minEdgeShare: s }));
  SETTINGS.splice(1, 0, { minNodeShare: 0.01, minEdgeShare: 0.03 });
  const scenes: FlowScene[] = [];
  beforeAll(async () => {
    for (const setting of SETTINGS) {
      const graph: FlowGraph = abstract(globalScene, { ...setting, keepConnected: true });
      // The whole log at 0 % takes ELK about 10 s alone, more under coverage.
      scenes.push(buildScene(graph, await layout(graph, { engine: "elk", timeoutMs: 240_000 }), { selfLoops: false }));
    }
  }, 300_000);

  it("draws every backward path below the flow, crossing no group but the stages of its two ends, at every setting", () => {
    let backward = 0;
    for (const scene of scenes) {
      const groupOf = new Map(scene.graph.nodes.map((n) => [n.id, n.group]));
      for (const m of scene.edgeMarks.filter((m) => m.backward)) {
        backward++;
        const ends = new Set([groupOf.get(m.edge.source), groupOf.get(m.edge.target)]);
        expect(crossed(m.points, scene.positions.groups).filter((id) => !ends.has(id)), m.id).toEqual([]);
        const [source, target] = [scene.positions.nodes[m.edge.source], scene.positions.nodes[m.edge.target]];
        expect(m.points.slice(1, -1).every((p) => p.y >= Math.min(source.y + source.height, target.y + target.height)), m.id).toBe(true);
      }
    }
    // 267 backward paths at 0 %, 4 at the stories' default, 2, 1, 1, 1 at the others.
    expect(backward).toBeGreaterThan(270);
  });
});
