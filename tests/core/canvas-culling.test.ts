import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Overlay, HitIndex, createPositions } from "../../src/index";
import { CanvasRenderer, type DrawContext, type PreparedScene, drawScene, prepareScene } from "../../src/canvas/index";

/**
 * A grid of 100 columns of activities, 160 × 60 at 240 × 120 apart, each
 * joined to its left and upper neighbour, filled row by row until nodes and
 * edges number exactly `size`. Every row is a stage group, every third with a tint; every
 * seventh activity has a badge and every eleventh is hatched. Metrics repeat,
 * so the scales do not depend on the size.
 */
function grid(size: number): PreparedScene {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const overlays: Overlay[] = [];
  const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {};
  const groupBoxes: typeof boxes = {};
  const edge = (source: number, target: number) => edges.push({ id: `e${source}-${target}`, kind: "follows", source: `n${source}`, target: `n${target}`, metrics: { count: 10 + (target % 89) } });
  for (let i = 0; nodes.length + edges.length < size; i++) {
    const [row, col] = [Math.floor(i / 100), i % 100];
    const id = `n${i}`;
    if (col === 0) {
      groups.push({ id: `r${row}`, kind: "stage", label: `Row ${row}` });
      if (row % 3 === 0) overlays.push({ kind: "tint", target: `r${row}`, payload: { constraintId: "balance", value: 0.5 } });
    }
    nodes.push({ id, kind: "activity", label: `Activity ${i}`, group: `r${row}`, metrics: { cases: 1000 + (i % 97) } });
    boxes[id] = { x: col * 240, y: row * 120, width: 160, height: 60 };
    groupBoxes[`r${row}`] = { x: -20, y: row * 120 - 20, width: col * 240 + 200, height: 100 };
    if (i % 7 === 0) overlays.push({ kind: "badge", target: id, payload: { constraintId: "presence", glyph: "≥1", value: 0.25 } });
    if (i % 11 === 0) overlays.push({ kind: "hatch", target: id, payload: { constraintId: "scope" } });
    if (col > 0 && nodes.length + edges.length < size) edge(i - 1, i);
    if (row > 0 && nodes.length + edges.length < size) edge(i - 100, i);
  }
  const graph: FlowGraph = { nodes, edges, groups };
  const positions = createPositions({ nodes: boxes, groups: groupBoxes, edges: {} }, "given", "RIGHT");
  return prepareScene(graph, positions, { overlays, lodBySize: false, selfLoops: false });
}

/** A 2D context that hashes every call and assignment with its arguments. */
function loggingContext() {
  const log: string[] = [];
  const own: Record<string, unknown> = { measureText: (s: string) => ({ width: s.length * 6 }) };
  const ctx = new Proxy(own, {
    get: (target, key: string) => (key in target ? target[key] : (...a: unknown[]) => log.push(`${key}(${JSON.stringify(a)})`)),
    set: (target, key: string, value) => {
      log.push(`${key}=${JSON.stringify(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as DrawContext;
  return { ctx, log, digest: () => createHash("sha256").update(log.join("\n")).digest("hex") };
}

/**
 * The scene with its element lists and lookups counting every element read:
 * an index of a list, an entry of a lookup, or an element an iteration passes.
 */
function counted(scene: PreparedScene) {
  const visits = { count: 0 };
  const list = <T extends object>(items: T[]): T[] =>
    new Proxy(items, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) visits.count++;
        return Reflect.get(target, key, receiver);
      },
    });
  const lookup = <K, V>(map: Map<K, V>): Map<K, V> => {
    const out = new Map(map);
    const walk = <T>(it: IterableIterator<T>): IterableIterator<T> => {
      const items = [...it];
      visits.count += items.length;
      return items[Symbol.iterator]() as IterableIterator<T>;
    };
    return Object.assign(out, {
      get: (k: K) => (visits.count++, map.get(k)),
      has: (k: K) => (visits.count++, map.has(k)),
      forEach: (f: (v: V, k: K, m: Map<K, V>) => void) => map.forEach((v, k) => (visits.count++, f(v, k, out))),
      keys: () => walk(map.keys()),
      values: () => walk(map.values()),
      entries: () => walk(map.entries()),
      [Symbol.iterator]: () => walk(map.entries()),
    });
  };
  return {
    visits,
    scene: {
      ...scene,
      nodes: list(scene.nodes),
      edges: list(scene.edges),
      groups: list(scene.groups),
      marks: list(scene.marks),
      shapes: list(scene.shapes),
      nodeMarks: list(scene.nodeMarks),
      edgeMarks: list(scene.edgeMarks),
      nodeById: lookup(scene.nodeById),
      edgeById: lookup(scene.edgeById),
      groupById: lookup(scene.groupById),
      shapeById: lookup(scene.shapeById),
    } satisfies PreparedScene,
  };
}

// About four columns and three rows of the grid, away from its edges.
const view = { x: -1000, y: -500, zoom: 1, width: 900, height: 330 };
const box = { x: 1000, y: 500, width: 900, height: 330 };
const state = {
  selection: { nodes: ["n405"], edges: ["e405-406"], groups: ["r4"] },
  hovered: "e406-506",
  focused: "n506",
  bright: { nodes: new Set(["n405", "n406"]), edges: new Set(["e405-406"]) },
};

describe("drawing a culled view of a large scene", () => {
  const small = grid(20_000);
  const large = grid(200_000);

  it("reads a bounded number of elements per candidate, whatever the size of the scene", () => {
    expect([small.size, large.size]).toEqual([20_000, 200_000]);
    const drawn = [small, large].map((scene) => {
      // Candidates are what the R-tree returns for the view: groups, nodes, edge segments and overlay shapes.
      const candidates = scene.hit.within(box).length;
      const { scene: watched, visits } = counted(scene);
      const { ctx, log, digest } = loggingContext();
      const stats = drawScene(ctx, watched, view, state, { cull: true });
      const groups = log.filter((l) => l.startsWith('fillText(["Row ')).map((l) => JSON.parse(l.slice(9, -1))[0]);
      return { candidates, visits: visits.count, stats, groups, digest: digest() };
    });
    const [a, b] = drawn;
    expect(a.stats).toMatchObject({ culled: true, nodes: 12, edges: 24 });
    expect(a.stats.shapes).toBeGreaterThan(0);
    // Groups are culled like the rest: rows 4 to 6, and row 7, whose box begins 20 above its nodes at 820.
    expect(a.groups).toEqual(["Row 4", "Row 5", "Row 6", "Row 7"]);
    expect(b.candidates).toBe(a.candidates);
    expect(b.stats).toEqual(a.stats);
    // The same elements are drawn with the same calls from both scenes.
    expect(b.digest).toBe(a.digest);
    // Each candidate is read at most twice (edges and overlay marks: once for the shape or line, once for the label or layer); nothing else is.
    for (const d of drawn) expect(d.visits).toBeLessThanOrEqual(2 * d.candidates);
    expect(b.visits).toBe(a.visits);
  });

  it("draws every element in list order from a hit index built without positions", () => {
    // The items of the scene's own index, without the positions a host's index would not have.
    const items = small.hit.within({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 }).map(({ index: _, ...it }) => it);
    const plain = { ...small, hit: new HitIndex().load(items) };
    const [culled, full] = [true, false].map((cull) => {
      const { ctx, digest } = loggingContext();
      return { stats: drawScene(ctx, plain, view, state, { cull }), digest: digest() };
    });
    // Row 0 holds 199 elements and each further row 299: 66 more rows reach 19,933, and row 67 adds
    // column 0 with its upper edge, 21 columns of three and the node and left edge of column 22.
    expect(culled.stats).toEqual({ culled: true, nodes: 6_723, edges: 13_277, shapes: full.stats.shapes, readable: full.stats.readable });
    expect(culled.digest).toBe(full.digest);
  });

  it("answers hit tests through the R-tree without reading the scene's elements", () => {
    const { scene: watched, visits } = counted(large);
    const { ctx } = loggingContext();
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
    renderer.setScene(watched);
    renderer.resize(view.width, view.height);
    renderer.setViewport({ x: view.x, y: view.y, zoom: 1 });
    renderer.draw();
    expect(renderer.lastDraw).toMatchObject({ culled: true, nodes: 12, edges: 24 });
    visits.count = 0;
    // n405 at (1200, 480), its badge on its top edge, the edge to n406 between them, the row's group below.
    const at = (x: number, y: number) => renderer.hitAt(x + view.x, y + view.y);
    expect(at(1280, 520)).toMatchObject({ kind: "node", id: "n405" });
    expect(at(1400, 510)).toMatchObject({ kind: "edge", id: "e405-406" });
    expect(at(1380, 470)).toMatchObject({ kind: "group", id: "r4" });
    expect(visits.count).toBe(0);
  });
});
