import { describe, expect, it } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, type Overlay, budgetEdges, buildScene, createPositions, toSVG } from "../../src/index";
import { CanvasRenderer, type DrawContext, type DrawState, type PreparedScene, drawScene, prepareScene } from "../../src/canvas/index";

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

  it("draws every protected edge with a budget of 0: overlay, selection and focus; a highlighted path only within the budget", () => {
    // An arc from b to d is on e4; the reverse arc of it joins d to b, where there is no edge.
    const arcs: Overlay[] = [
      { kind: "arc", target: "b->d", payload: { source: "b", target: "d", value: 0.2 } },
      { kind: "arc", target: "d->b", payload: { source: "d", target: "b", value: 0.1, reverse: true } },
    ];
    const marked = sceneOf(["a", "b", "c", "d"], scene.graph.edges, arcs);
    const protection = { selection: { edges: ["e0"] }, focused: "e6", highlighted: new Set(["e2", "x"]) };
    const cut = budgetEdges(marked, 0, protection);
    expect(ids(marked, cut?.drawn)).toEqual(["e0", "e4", "e6"]);
    // e2 is highlighted and not drawn; x is no edge in view.
    expect(cut).toMatchObject({ shown: 3, total: 7, kept: 3, highlightedNotShown: 1 });
    // Each rule on its own.
    expect(ids(marked, budgetEdges(marked, 0)?.drawn)).toEqual(["e4"]);
    // A mark that names the edge it stands for (as a loop's mark does) protects that edge.
    const named = sceneOf(["a", "b", "c", "d"], scene.graph.edges, [{ kind: "badge", target: "c", payload: { label: "loop", value: 0.3, edgeId: "e3" } }]);
    expect(ids(named, budgetEdges(named, 0)?.drawn)).toEqual(["e3"]);
    expect(ids(scene, budgetEdges(scene, 0, { selection: { edges: ["e0"] } })?.drawn)).toEqual(["e0"]);
    expect(ids(scene, budgetEdges(scene, 0, { focused: "e6" })?.drawn)).toEqual(["e6"]);
    expect(ids(scene, budgetEdges(scene, 0, { highlighted: new Set(["e2"]) })?.drawn)).toEqual([]);
    // Protected edges count against the budget: with 5, the three, then the highlighted e2, then the heaviest other one (e5).
    expect(ids(marked, budgetEdges(marked, 5, protection)?.drawn)).toEqual(["e0", "e2", "e4", "e5", "e6"]);
  });

  it("counts the paths among the edges in view it withholds: not a constraint edge, nor a path through activities not shown", () => {
    // a → b → c → d with 30, 20 and 10, a constraint edge a → c and an indirect path a → d, which weigh nothing and come last.
    const indirect: FlowEdge = { id: "via", kind: "follows", source: "a", target: "d", tags: ["indirect"], payload: { hiddenActivities: 1, via: ["x"] } };
    const mixed = sceneOf(["a", "b", "c", "d"], [follows("p1", "a", "b", 30), follows("p2", "b", "c", 20), follows("p3", "c", "d", 10), { id: "k", kind: "constraint", source: "a", target: "c" }, indirect]);
    // Two of five: p3, k and via are withheld, of which p3 is a path.
    expect(budgetEdges(mixed, 2)).toMatchObject({ shown: 2, total: 5, pathsNotShown: 1 });
    // Three of five: only k and via are withheld, and no path.
    expect(budgetEdges(mixed, 3)).toMatchObject({ shown: 3, total: 5, pathsNotShown: 0 });
    // Of those in view (p2, p3, k), one: p3 and k are withheld.
    expect(budgetEdges(mixed, 1, {}, [1, 2, 3])).toMatchObject({ shown: 1, total: 3, pathsNotShown: 1 });
    // A map's report: p1 and k drawn, p2, p3 and via not.
    expect(budgetEdges(mixed, { edges: ["p1", "k"], total: 5 })).toMatchObject({ shown: 2, total: 5, pathsNotShown: 2 });
  });

  it("counts a loop a map's report leaves out among the paths it withholds", () => {
    // a → b and b → c, and a path that loops on a; the map drew a → b alone.
    const looped = sceneOf(["a", "b", "c"], [follows("p1", "a", "b", 30), follows("p2", "b", "c", 20), follows("loop", "a", "a", 10)]);
    // Withheld: p2 and the loop, both paths, as total − shown says.
    expect(budgetEdges(looped, { edges: ["p1"], total: 3 })).toMatchObject({ shown: 1, total: 3, loops: [], pathsNotShown: 2 });
    // The loop drawn: only p2.
    expect(budgetEdges(looped, { edges: ["p1", "loop"], total: 3 })).toMatchObject({ shown: 2, total: 3, loops: ["loop"], pathsNotShown: 1 });
  });

  it("orders by the metric the edge width reads", () => {
    const byShare = buildScene(scene.graph, scene.positions, {
      selfLoops: false,
      style: { edgeWidth: { metric: "share" } },
    });
    // No edge has a share: every weight ties and the ids decide.
    expect(ids(byShare, budgetEdges(byShare, 2)?.drawn)).toEqual(["e0", "e1"]);
    // Cases, the default, where the paths give only transitions: the width reads those, and so does the order.
    const byCases = buildScene(scene.graph, scene.positions, { selfLoops: false, style: { edgeWidth: { metric: "cases" } } });
    expect(ids(byCases, budgetEdges(byCases, 2)?.drawn)).toEqual(["e1", "e5"]);
  });

  it("orders by cases where only a path that loops on one activity gives them, as the width does", () => {
    // b's loop gives cases, so the width reads cases: e1 and e2 have none, are drawn equally thin, and the ids decide.
    const loop = { ...follows("e3", "b", "b", 2), metrics: { count: 2, cases: 2 } };
    const scene = sceneOf(["a", "b", "c"], [follows("e1", "a", "b", 5), follows("e2", "b", "c", 9), loop]);
    expect(scene.scales.pathMetric).toBe("cases");
    expect(ids(scene, budgetEdges(scene, 1)?.drawn)).toEqual(["e1"]);
  });

  it("reads protection from the scene's marks and the weight from its style, also for edge marks it has seen", () => {
    // The scene's order is known already; a scene object that shares its edge marks but not its marks
    // or style is chosen from by its own: the arc of `marked` on e4, then the order by share, which no path has (ids decide).
    const arc: Overlay = { kind: "arc", target: "b->d", payload: { source: "b", target: "d", value: 0.2 } };
    const marked = sceneOf(["a", "b", "c", "d"], scene.graph.edges, [arc]);
    expect(ids(scene, budgetEdges(scene, 0)?.drawn)).toEqual([]);
    expect(ids(scene, budgetEdges({ ...scene, marks: marked.marks }, 0)?.drawn)).toEqual(["e4"]);
    expect(ids(marked, budgetEdges({ ...marked, marks: [] }, 0)?.drawn)).toEqual([]);
    expect(ids(scene, budgetEdges({ ...scene, style: { edgeWidth: { metric: "share" } } }, 2)?.drawn)).toEqual(["e0", "e1"]);
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

describe("the edge budget's first use", () => {
  /**
   * `retained` paths from one activity to as many others; `reads` counts the
   * paths the budget looks at (an index into the edge marks).
   */
  function counted(retained: number) {
    const graph: FlowGraph = {
      nodes: [{ id: "h", kind: "activity", label: "h" }, ...Array.from({ length: retained }, (_, i): FlowNode => ({ id: `t${i}`, kind: "activity", label: `t${i}` }))],
      edges: Array.from({ length: retained }, (_, i) => follows(`p${i}`, "h", `t${i}`, 1 + (i % 7))),
    };
    const built = buildScene(graph, createPositions({ nodes: boxes(graph.nodes.map((n) => n.id)), groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false });
    const reads = { count: 0 };
    const edgeMarks = new Proxy(built.edgeMarks, {
      get: (target, key) => {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.count++;
        return Reflect.get(target, key);
      },
    });
    return { scene: { ...built, edgeMarks }, reads };
  }

  it("ranks every retained path on its first use for a scene, and reads only the paths in view after that", () => {
    // 3,000 paths in view, a budget of 2,000: the same view of 6,000 and of 30,000 retained paths.
    const inView = Array.from({ length: 3000 }, (_, k) => k * 2);
    const per = (retained: number) => {
      const { scene, reads } = counted(retained);
      budgetEdges(scene, 2000, {}, inView);
      const first = reads.count;
      reads.count = 0;
      const drawn = budgetEdges(scene, 2000, {}, inView);
      return { first, then: reads.count, shown: drawn?.shown };
    };
    const [small, large] = [per(6000), per(30_000)];
    // The first use reads every retained path to rank them all (more than once each while it sorts them);
    // later ones read the 3,000 in view, whatever the scene retains.
    expect(small.first).toBeGreaterThan(6000 + 3000);
    expect(large.first).toBeGreaterThan(30_000 + 3000);
    expect([small.then, small.shown, large.then, large.shown]).toEqual([3000, 2000, 3000, 2000]);
  });
});

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

describe("highlighted paths and protected paths under the budget", () => {
  // A hub h with 30 paths to t0 … t29, counts 1 … 30; a budget of 10.
  const leaves = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const paths = leaves.map((t, i) => follows(`h->${t}`, "h", t, i + 1));
  const hub = (overlays: Overlay[] = []) => {
    const graph: FlowGraph = { nodes: ["h", ...leaves].map((id): FlowNode => ({ id, kind: "activity", label: id })), edges: paths, overlays };
    const placed = Object.fromEntries(["h", ...leaves].map((id, i) => [id, { x: i ? 300 : 0, y: i ? (i - 1) * 50 : 700, width: 60, height: 40 }]));
    return prepareScene(graph, createPositions({ nodes: placed, groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false, lodBySize: false });
  };
  const view = { x: 0, y: 0, zoom: 1, width: 400, height: 1600 };
  const draw = (scene: PreparedScene, state: Partial<DrawState> = {}) => drawScene(recorder().ctx, scene, view, { selection: { nodes: [], edges: [], groups: [] }, ...state }, { cull: false, edgeBudget: 10 });
  const drawnIds = (scene: PreparedScene, state: Partial<DrawState> = {}) => {
    const shown = budgetEdges(scene, 10, { ...state, selection: state.selection });
    return shown && [...shown.drawn].map((i) => scene.edgeMarks[i].id).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  };
  const ids = (from: number, to: number) => leaves.slice(from, to).map((t) => `h->${t}`);

  it("draws the heaviest highlighted paths of a hub within the budget, and says how many highlighted it does not show", () => {
    // All 30 highlighted: the 10 heaviest, t20 … t29, are drawn; the note reads 10 of 30, 20 highlighted not shown.
    const highlighted = new Set(paths.map((e) => e.id));
    const stats = draw(hub(), { highlighted });
    expect([stats.edges, stats.withheld?.shown, stats.withheld?.total, stats.withheld?.highlightedNotShown, stats.kept]).toEqual([10, 10, 30, 20, 0]);
    expect(drawnIds(hub(), { highlighted })).toEqual(ids(20, 30));
  });

  it("draws the highlighted paths before heavier ones that are not, and fills the rest of the budget by weight", () => {
    // t0 … t4 highlighted (counts 1 … 5): all five, then the five heaviest of the rest, t25 … t29; none highlighted is left out.
    const highlighted = new Set(ids(0, 5));
    expect(drawnIds(hub(), { highlighted })).toEqual([...ids(0, 5), ...ids(25, 30)]);
    expect(budgetEdges(hub(), 10, { highlighted })).toMatchObject({ shown: 10, total: 30, kept: 0, highlightedNotShown: 0 });
    // 25 of the 30 highlighted (t5 … t29): the 10 heaviest of them, none of the other 5; 15 highlighted not shown.
    const stats = draw(hub(), { highlighted: new Set(ids(5, 30)) });
    expect([stats.edges, stats.withheld?.shown, stats.withheld?.total, stats.withheld?.highlightedNotShown]).toEqual([10, 10, 30, 15]);
  });

  it("keeps the selection and the keyboard position beyond the budget, and the highlighted paths take what room is left", () => {
    // t0, t1 selected and the keyboard on t2, all 30 highlighted: those three are drawn whatever the budget, and the 7
    // heaviest highlighted paths fill the budget of 10; 20 highlighted are not shown.
    const state = { highlighted: new Set(paths.map((e) => e.id)), selection: { nodes: [], edges: ids(0, 2), groups: [] }, focused: "h->t2" };
    expect(drawnIds(hub(), state)).toEqual([...ids(0, 3), ...ids(23, 30)]);
    expect(budgetEdges(hub(), 10, state)).toMatchObject({ shown: 10, total: 30, kept: 3, highlightedNotShown: 20 });
    // A budget of 2 below the three: still all three, and no highlighted path.
    expect(budgetEdges(hub(), 2, state)).toMatchObject({ shown: 3, total: 30, kept: 3, highlightedNotShown: 27 });
  });

  it("draws every path and every mark when each path carries an overlay mark", () => {
    const arcs = leaves.map((t): Overlay => ({ kind: "arc", target: `h->${t}`, payload: { source: "h", target: t, value: 0.5 } }));
    const stats = draw(hub(arcs));
    expect([stats.edges, stats.shapes, stats.withheld]).toEqual([30, 30, undefined]);
  });
});

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
    // The labels written are the three counts and the cards' names, cases and shares (a dash for each: the graph has no cases).
    expect(calls.filter((c) => c.startsWith("fillText")).map((c) => c.slice(9, -1).split(",")[0]).sort()).toEqual(["40", "40", "50", "a", "b", "c", "d", "· –", "· –", "· –", "· –", "–", "–", "–", "–"]);
  });

  it("chooses among the edges in view when the view is culled", () => {
    // The view x 0..90 holds a's box and the edges leaving or entering it at its right side: e0, e1, e2, e6.
    const { scene, read } = watched(prepared);
    const stats = drawScene(recorder().ctx, scene, { x: 0, y: 0, zoom: 1, width: 90, height: 100 }, undefined, { cull: true, edgeBudget: 2, lodZoom: 0 });
    expect(read()).toEqual(["e1", "e2"]);
    expect(stats.withheld).toMatchObject({ shown: 2, total: 4 });
  });

  it("counts the paths that loop on one activity in view in both numbers, and never withholds them", () => {
    // The same row with a loop on a (a->a) and two on d (d->d, d->d2): seven lines and three loops.
    const looped = prepareScene({ ...graph, edges: [...graph.edges, follows("a->a", "a", "a", 5), follows("d->d", "d", "d", 7), follows("d->d2", "d", "d", 1)] }, createPositions({ nodes: boxes(["a", "b", "c", "d"]), groups: {}, edges: {} }, "given", "RIGHT"), { lodBySize: false });
    // Uncull: three heaviest lines, e5, e1, e3, and the three loops: 6 of 10.
    expect(drawScene(recorder().ctx, looped, view, undefined, { cull: false, edgeBudget: 3, lodZoom: 2 }).withheld).toMatchObject({ shown: 6, total: 10, loops: ["a->a", "d->d", "d->d2"] });
    expect(budgetEdges(looped, 3)).toMatchObject({ shown: 6, total: 10, kept: 0 });
    // Culled to a's box (x 0..90): the lines e0, e1, e2, e6 and the loop on a; a budget of 2 draws e1 and e2: 3 of 5.
    expect(drawScene(recorder().ctx, looped, { x: 0, y: 0, zoom: 1, width: 90, height: 100 }, undefined, { cull: true, edgeBudget: 2, lodZoom: 0 }).withheld).toMatchObject({ shown: 3, total: 5, loops: ["a->a"] });
    // A map's report names the loops it drew: an export counts those, against the map's total.
    expect(budgetEdges(looped, { edges: ["e1", "e2", "a->a"], total: 5 })).toMatchObject({ shown: 3, total: 5, loops: ["a->a"] });
  });

  it("draws every protected edge with a budget of 0, and a highlighted path only within the budget", () => {
    const { scene, read } = watched(prepared);
    const state = { selection: { nodes: [], edges: ["e0"], groups: [] }, focused: "e6", highlighted: new Set(["e2"]) };
    const stats = drawScene(recorder().ctx, scene, view, state, { cull: false, edgeBudget: 0, lodZoom: 0 });
    expect(read()).toEqual(["e0", "e6"]);
    expect(stats.withheld).toMatchObject({ shown: 2, total: 7, highlightedNotShown: 1 });
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
    // A number also says how many of the drawn edges every budget draws: none is protected here.
    expect(calls(7)).toEqual({ ...plain, stats: { ...plain.stats, kept: 0 } });
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
