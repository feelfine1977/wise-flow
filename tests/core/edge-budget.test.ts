import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, type Overlay, budgetEdges, buildScene, createPositions, toSVG } from "../../src/index";
import { CanvasRenderer, type DrawContext, type PreparedScene, drawScene, prepareScene } from "../../src/canvas/index";

/** Activities in a row, 100 apart, each 60 × 40. */
function boxes(ids: string[]) {
  return Object.fromEntries(ids.map((id, i) => [id, { x: i * 100, y: 0, width: 60, height: 40 }]));
}

function sceneOf(nodes: string[], edges: FlowEdge[], overlays: Overlay[] = []) {
  const graph: FlowGraph = { nodes: nodes.map((id): FlowNode => ({ id, kind: "activity", label: id })), edges };
  return buildScene(graph, createPositions({ nodes: boxes(nodes), groups: {}, edges: {} }, "given", "RIGHT"), { overlays, selfLoops: false });
}

const follows = (id: string, source: string, target: string, count?: number): FlowEdge => ({ id, kind: "follows", source, target, metrics: count === undefined ? {} : { count } });
const ids = (scene: ReturnType<typeof sceneOf>, drawn: Set<number> | undefined) => (drawn ? [...drawn].map((i) => scene.edgeMarks[i].id).sort() : undefined);

describe("edge budget", () => {
  // Counts 50, 40, 40, 30, 30, 10 and one edge without a count. Hand-ordered: e5 (50), then the
  // two 40s by id (e1 before e3), the two 30s by id (e2 before e6), e4 (10), e0 (no count).
  const scene = sceneOf(["a", "b", "c", "d"], [
    follows("e0", "a", "b"),
    follows("e1", "a", "c", 40),
    follows("e2", "a", "d", 30),
    follows("e3", "b", "c", 40),
    follows("e4", "b", "d", 10),
    follows("e5", "c", "d", 50),
    follows("e6", "d", "a", 30),
  ]);

  it("draws the n heaviest edges, ties by id, and counts shown and total", () => {
    expect(ids(scene, budgetEdges(scene, 1)?.drawn)).toEqual(["e5"]);
    expect(ids(scene, budgetEdges(scene, 2)?.drawn)).toEqual(["e1", "e5"]);
    expect(ids(scene, budgetEdges(scene, 4)?.drawn)).toEqual(["e1", "e2", "e3", "e5"]);
    expect(ids(scene, budgetEdges(scene, 6)?.drawn)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(budgetEdges(scene, 4)).toMatchObject({ shown: 4, total: 7 });
    expect(budgetEdges(scene, 0)).toMatchObject({ shown: 0, total: 7 });
  });

  it("withholds nothing with all, with a budget of at least the edges in view, or with no edge in view", () => {
    expect(budgetEdges(scene, "all")).toBeUndefined();
    expect(budgetEdges(scene, undefined)).toBeUndefined();
    expect(budgetEdges(scene, 7)).toBeUndefined();
    expect(budgetEdges(scene, Number.NaN)).toBeUndefined();
    expect(budgetEdges(scene, 3, {}, [0, 2, 6])).toBeUndefined();
    expect(budgetEdges(scene, 0, {}, [])).toBeUndefined();
    // A host that keeps "no value" as null, as JavaScript state often does, gets every edge too.
    const none = null as unknown as undefined;
    expect(budgetEdges(scene, none)).toBeUndefined();
    const svg = toSVG({ graph: scene.graph, positions: scene.positions, selfLoops: false }, { edgeBudget: none });
    expect(svg.match(/<g class="wf-edge"/g)).toHaveLength(7);
    expect(svg).not.toContain("wf-edge-note");
  });

  it("chooses among the edges in view only", () => {
    // In view: e0, e2, e4, e6 (positions 0, 2, 4, 6); the heaviest two are e2 and e6 (30 each).
    expect(budgetEdges(scene, 2, {}, [6, 4, 2, 0])).toMatchObject({ shown: 2, total: 4 });
    expect(ids(scene, budgetEdges(scene, 2, {}, [6, 4, 2, 0])?.drawn)).toEqual(["e2", "e6"]);
  });

  it("draws every protected edge with a budget of 0: overlay, selection, focus and highlighted path", () => {
    // An arc from b to d is on e4; the reverse arc of it joins d to b, where there is no edge.
    const arcs: Overlay[] = [
      { kind: "arc", target: "b->d", payload: { source: "b", target: "d", value: 0.2 } },
      { kind: "arc", target: "d->b", payload: { source: "d", target: "b", value: 0.1, reverse: true } },
    ];
    const marked = sceneOf(["a", "b", "c", "d"], scene.graph.edges, arcs);
    const protection = { selection: { edges: ["e0"] }, focused: "e6", highlighted: new Set(["e2", "x"]) };
    const cut = budgetEdges(marked, 0, protection);
    expect(ids(marked, cut?.drawn)).toEqual(["e0", "e2", "e4", "e6"]);
    expect(cut).toMatchObject({ shown: 4, total: 7 });
    // Each rule on its own.
    expect(ids(marked, budgetEdges(marked, 0)?.drawn)).toEqual(["e4"]);
    // A mark that names the edge it stands for (as a loop's mark does) protects that edge.
    const named = sceneOf(["a", "b", "c", "d"], scene.graph.edges, [{ kind: "badge", target: "c", payload: { label: "loop", value: 0.3, edgeId: "e3" } }]);
    expect(ids(named, budgetEdges(named, 0)?.drawn)).toEqual(["e3"]);
    expect(ids(scene, budgetEdges(scene, 0, { selection: { edges: ["e0"] } })?.drawn)).toEqual(["e0"]);
    expect(ids(scene, budgetEdges(scene, 0, { focused: "e6" })?.drawn)).toEqual(["e6"]);
    expect(ids(scene, budgetEdges(scene, 0, { highlighted: new Set(["e2"]) })?.drawn)).toEqual(["e2"]);
    // Protected edges count against the budget: with 5, the four plus the heaviest other one (e5).
    expect(ids(marked, budgetEdges(marked, 5, protection)?.drawn)).toEqual(["e0", "e2", "e4", "e5", "e6"]);
  });

  it("orders by the metric the edge width reads", () => {
    const byCases = buildScene(scene.graph, scene.positions, {
      selfLoops: false,
      style: { edgeWidth: { metric: "cases" } },
    });
    // No edge has cases: every weight ties and the ids decide.
    expect(ids(byCases, budgetEdges(byCases, 2)?.drawn)).toEqual(["e0", "e1"]);
  });

  it("reads protection from the scene's marks and the weight from its style, also for edge marks it has seen", () => {
    // The scene's order is known already; a scene object that shares its edge marks but not its marks
    // or style is chosen from by its own: the arc of `marked` on e4, then the order by cases.
    const arc: Overlay = { kind: "arc", target: "b->d", payload: { source: "b", target: "d", value: 0.2 } };
    const marked = sceneOf(["a", "b", "c", "d"], scene.graph.edges, [arc]);
    expect(ids(scene, budgetEdges(scene, 0)?.drawn)).toEqual([]);
    expect(ids(scene, budgetEdges({ ...scene, marks: marked.marks }, 0)?.drawn)).toEqual(["e4"]);
    expect(ids(marked, budgetEdges({ ...marked, marks: [] }, 0)?.drawn)).toEqual([]);
    expect(ids(scene, budgetEdges({ ...scene, style: { edgeWidth: { metric: "cases" } } }, 2)?.drawn)).toEqual(["e0", "e1"]);
    // And the scene itself is still chosen from by its own marks and style.
    expect(ids(scene, budgetEdges(scene, 2)?.drawn)).toEqual(["e1", "e5"]);
    expect(ids(marked, budgetEdges(marked, 0)?.drawn)).toEqual(["e4"]);
  });
});

/** A seeded graph of n activities and 3n edges with counts in 1..20 (many ties), in shuffled id order. */
function seededGraph(seed: number, n: number): { nodes: string[]; edges: FlowEdge[] } {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const nodes = Array.from({ length: n }, (_, i) => `n${i}`);
  const edges: FlowEdge[] = [];
  for (let i = 0; i < 3 * n; i++) {
    const source = Math.floor(next() * n);
    const target = (source + 1 + Math.floor(next() * (n - 1))) % n;
    edges.push(follows(`e${Math.floor(next() * 1e6)}-${i}`, `n${source}`, `n${target}`, 1 + Math.floor(next() * 20)));
  }
  return { nodes, edges };
}

describe("edge budget over seeded graphs", () => {
  it("only removes edges from the end of the order when the budget is lowered", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { nodes, edges } = seededGraph(seed, 25);
      const scene = sceneOf(nodes, edges);
      let s = seed;
      const pick = () => ((s = (s * 48271) % 2147483647) % 100) / 100;
      const marks = scene.edgeMarks;
      const inView = seed % 2 ? marks.map((_, i) => i).filter(() => pick() < 0.6) : undefined;
      const view = inView ?? marks.map((_, i) => i);
      const protection = { selection: { edges: view.filter(() => pick() < 0.05).map((i) => marks[i].id) }, focused: marks[view[0]].id };
      const isProtected = (i: number) => protection.selection.edges.includes(marks[i].id) || protection.focused === marks[i].id;
      // The reference order of the edges in view: count descending, then id.
      const order = view.filter((i) => !isProtected(i)).sort((a, b) => (marks[b].edge.metrics!.count as number) - (marks[a].edge.metrics!.count as number) || (marks[a].id < marks[b].id ? -1 : 1));
      const kept = view.filter(isProtected);
      let previous: Set<number> | undefined;
      for (let budget = view.length; budget >= 0; budget--) {
        const drawn = budgetEdges(scene, budget, protection, inView)?.drawn ?? new Set(view);
        // Protected first, then a prefix of the order.
        const prefix = order.slice(0, Math.max(0, budget - kept.length));
        expect([...drawn].sort((a, b) => a - b)).toEqual([...kept, ...prefix].sort((a, b) => a - b));
        if (previous) {
          for (const i of drawn) expect(previous.has(i)).toBe(true);
          const removed = [...previous].filter((i) => !drawn.has(i));
          expect(removed.length).toBeLessThanOrEqual(1);
          if (removed.length) expect(removed[0]).toBe(order[prefix.length]);
        }
        previous = drawn;
      }
    }
  });
});

/** The ids of the edges whose mark the drawing reads, once each, in the order it first reads them. */
function watched(scene: PreparedScene) {
  const read = new Set<string>();
  const edges = scene.edges.map((e) => new Proxy(e, { get: (target, key, receiver) => (key === "mark" && read.add(target.edge.id), Reflect.get(target, key, receiver)) }));
  return { scene: { ...scene, edges }, read: () => [...read] };
}

const recorder = () => {
  const calls: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (...a: unknown[]) => calls.push(`${key}(${a.join(",")})`)),
    set: (target, key: string, value) => ((target[key] = value), true),
  }) as unknown as DrawContext;
  return { ctx, calls };
};

describe("edge budget in the Canvas drawing", () => {
  const graph = sceneOf(["a", "b", "c", "d"], [
    follows("e0", "a", "b"),
    follows("e1", "a", "c", 40),
    follows("e2", "a", "d", 30),
    follows("e3", "b", "c", 40),
    follows("e4", "b", "d", 10),
    follows("e5", "c", "d", 50),
    follows("e6", "d", "a", 30),
  ]).graph;
  const prepared = prepareScene(graph, createPositions({ nodes: boxes(["a", "b", "c", "d"]), groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false, lodBySize: false });
  const view = { x: 0, y: 0, zoom: 1, width: 400, height: 100 };

  it("draws the n heaviest edges and their labels, and reports shown and total", () => {
    const { scene, read } = watched(prepared);
    const { ctx, calls } = recorder();
    const stats = drawScene(ctx, scene, view, undefined, { cull: false, edgeBudget: 3, lodZoom: 2 });
    // The drawn edges in list order: e1, e3 (40 each), e5 (50).
    expect(read()).toEqual(["e1", "e3", "e5"]);
    expect(stats).toMatchObject({ edges: 3, withheld: { shown: 3, total: 7 } });
    // The labels written are the three counts.
    expect(calls.filter((c) => c.startsWith("fillText")).map((c) => c.slice(9, -1).split(",")[0]).sort()).toEqual(["40", "40", "50", "a", "b", "c", "d"]);
  });

  it("chooses among the edges in view when the view is culled", () => {
    // The view x 0..90 holds a's box and the edges leaving or entering it at its right side: e0, e1, e2, e6.
    const { scene, read } = watched(prepared);
    const stats = drawScene(recorder().ctx, scene, { x: 0, y: 0, zoom: 1, width: 90, height: 100 }, undefined, { cull: true, edgeBudget: 2, lodZoom: 0 });
    expect(read()).toEqual(["e1", "e2"]);
    expect(stats.withheld).toMatchObject({ shown: 2, total: 4 });
  });

  it("draws every protected edge with a budget of 0", () => {
    const { scene, read } = watched(prepared);
    const state = { selection: { nodes: [], edges: ["e0"], groups: [] }, focused: "e6", highlighted: new Set(["e2"]) };
    drawScene(recorder().ctx, scene, view, state, { cull: false, edgeBudget: 0, lodZoom: 0 });
    expect(read()).toEqual(["e0", "e2", "e6"]);
  });

  it("draws as before and reports nothing withheld with all or a budget above the edges", () => {
    const calls = (edgeBudget?: number | "all") => {
      const { ctx, calls } = recorder();
      const stats = drawScene(ctx, prepared, view, undefined, { cull: false, edgeBudget, lodZoom: 2 });
      return { calls, stats };
    };
    const plain = calls();
    expect(plain.stats.withheld).toBeUndefined();
    expect(calls("all")).toEqual(plain);
    expect(calls(7)).toEqual(plain);
  });

  it("does not hit an edge the last draw withheld", () => {
    const { ctx } = recorder();
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { cull: false, edgeBudget: 1 } });
    const seen: unknown[] = [];
    renderer.onDraw = (stats) => seen.push(stats.withheld && { shown: stats.withheld.shown, total: stats.withheld.total });
    renderer.setScene(prepared);
    renderer.resize(400, 100);
    renderer.setViewport({ x: 0, y: 0, zoom: 1 });
    renderer.draw();
    expect(seen).toEqual([{ shown: 1, total: 7 }]);
    // Between a and b (x 60..100, y 20) run e0, e1 and e2; only e5 (c to d) is drawn.
    expect(renderer.hitAt(80, 20)).toBeUndefined();
    expect(renderer.hitAt(280, 20)).toMatchObject({ kind: "edge", id: "e5" });
    renderer.drawOptions = { cull: false };
    renderer.draw();
    expect(renderer.hitAt(80, 20)?.kind).toBe("edge");
  });

  it("does not hit an edge the last draw withheld while a new scene waits for its first draw", () => {
    // h on the left, t1 up and t2 down on the right; with a budget of 1 only the heavier path, h->t1, is drawn.
    const boxes = { h: { x: 0, y: 100, width: 100, height: 40 }, t1: { x: 400, y: 0, width: 100, height: 40 }, t2: { x: 400, y: 200, width: 100, height: 40 } };
    const positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT");
    const nodes = ["h", "t1", "t2"].map((id): FlowNode => ({ id, kind: "activity", label: id }));
    const heavy = follows("h->t1", "h", "t1", 100);
    const light = follows("h->t2", "h", "t2", 1);
    const { ctx } = recorder();
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { cull: false, edgeBudget: 1 } });
    renderer.resize(600, 300);
    renderer.setViewport({ x: 0, y: 0, zoom: 1 });
    renderer.setScene(prepareScene({ nodes, edges: [heavy, light] }, positions, { lodBySize: false }));
    renderer.draw();
    // On the light path's line (100,120 to 400,220) and on the heavy one's (100,120 to 400,20).
    const onLight = () => renderer.hitAt(250, 170)?.id;
    const onHeavy = () => renderer.hitAt(250, 70)?.id;
    expect([onLight(), onHeavy()]).toEqual([undefined, "h->t1"]);
    // The same map with its paths in the other order, not drawn yet: still the light one is not hit.
    renderer.setScene(prepareScene({ nodes, edges: [light, heavy] }, positions, { lodBySize: false }));
    expect([onLight(), onHeavy()]).toEqual([undefined, "h->t1"]);
    renderer.draw();
    expect([onLight(), onHeavy()]).toEqual([undefined, "h->t1"]);
  });
});
