import { describe, expect, it } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { byId } from "../../src/core/model";
import { COLLAPSED_TAG, DIFF_TAGS, RECONNECTED_TAG, type FlowEdge, type FlowGraph, type FlowNode, abstract, collapseGroups, diff, hasTag, isConnected, validateGraph } from "../../src/index";
import { tiedGraph } from "./abstract-cases";

/** Deterministic pseudo-random graph generator (LCG). */
function randomGraph(seed: number, n: number): FlowGraph {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    kind: "activity" as const,
    label: `Activity ${i}`,
    group: `g${i % 3}`,
    metrics: { cases: Math.round(1 + rnd() * 1000) },
  }));
  const edges: FlowGraph["edges"] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    const id = `a${a}->a${b}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind: "follows", source: `a${a}`, target: `a${b}`, metrics: { count: Math.round(1 + rnd() * 1000) } });
  };
  for (let i = 1; i < n; i++) add(Math.floor(rnd() * i), i); // spanning tree: connected
  for (let k = 0; k < n * 2; k++) add(Math.floor(rnd() * n), Math.floor(rnd() * n));
  return {
    nodes: [{ id: "__start", kind: "event", label: "Start", tags: ["start"] }, ...nodes, { id: "__end", kind: "event", label: "End", tags: ["end"] }],
    edges: [
      { id: "__start->a0", kind: "follows", source: "__start", target: "a0", metrics: { count: 500 } },
      ...edges,
      { id: `a${n - 1}->__end`, kind: "follows", source: `a${n - 1}`, target: "__end", metrics: { count: 500 } },
    ],
    groups: [
      { id: "g0", kind: "stage", label: "G0" },
      { id: "g1", kind: "stage", label: "G1" },
      { id: "g2", kind: "stage", label: "G2" },
    ],
  };
}

const thresholds = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8];

/** The same elements in an order drawn by a seeded generator. */
function shuffled<T>(items: T[], seed: number): T[] {
  let s = seed >>> 0;
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((s / 2 ** 32) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Nodes and edges in id order, so that two results compare regardless of their input order. */
const inIdOrder = (g: FlowGraph) => JSON.stringify({ nodes: [...g.nodes].sort(byId), edges: [...g.edges].sort(byId) });

/** Follows edges of the given counts between activities; ids are `source->target`. */
function follows(pairs: [string, string, number][]): FlowEdge[] {
  return pairs.map(([source, target, count]) => ({ id: `${source}->${target}`, kind: "follows", source, target, metrics: { count } }));
}

const activities = (cases: Record<string, number>): FlowNode[] => Object.entries(cases).map(([id, c]) => ({ id, kind: "activity", label: id, metrics: { cases: c } }));

/** The ids of the re-added nodes and edges, sorted. */
const readded = (g: FlowGraph) => [...g.nodes, ...g.edges].filter((el) => hasTag(el, RECONNECTED_TAG)).map((el) => el.id).sort();

describe("abstract", () => {
  const parallel: FlowGraph = {
    nodes: [{ id: "a", kind: "activity", label: "A", group: "stage" }, { id: "b", kind: "activity", label: "B", group: "stage" }, { id: "c", kind: "activity", label: "C" }],
    edges: [{ id: "ac", source: "a", target: "c", kind: "follows", metrics: { count: 1 } }, { id: "bc", source: "b", target: "c", kind: "follows", metrics: { count: 2 } }, { id: "ab", source: "a", target: "b", kind: "follows", metrics: { count: 3 } }],
    groups: [{ id: "stage", kind: "stage", label: "Stage" }],
    overlays: [{ kind: "badge", target: "ac", payload: { text: "A evidence", value: 0.2 } }, { kind: "badge", target: "bc", payload: { text: "B evidence", value: 0.8 } }, { kind: "badge", target: "ab", payload: { text: "Internal evidence" } }],
  };

  it("remaps every edge overlay without combining independent evidence values", () => {
    const before = structuredClone(parallel);
    for (const shown of [collapseGroups(parallel, ["stage"]), abstract(parallel, { collapse: ["stage"] })]) {
      expect(validateGraph(shown)).toEqual([]);
      expect(shown.overlays).toEqual([
        { ...parallel.overlays![0], target: "stage->c" },
        { ...parallel.overlays![1], target: "stage->c" },
        { ...parallel.overlays![2], target: "stage" },
      ]);
      expect(shown.meta?.collapsedEdgeTargets).toMatchObject({ ac: "stage->c", bc: "stage->c", ab: "stage" });
    }
    expect(parallel).toEqual(before);
  });

  it("keeps merged IDs unique across edge kinds and existing opaque IDs", () => {
    const graph: FlowGraph = { ...parallel, edges: [...parallel.edges, ...parallel.edges.slice(0, 2).map((e) => ({ ...e, id: `flow-${e.id}`, kind: "flow" as const })), { id: "stage->c", source: "c", target: "a", kind: "follows" }], overlays: [...parallel.overlays!, { kind: "badge", target: "flow-ac", payload: { text: "Flow evidence" } }] };
    const shown = collapseGroups(graph, ["stage"]);
    expect(validateGraph(shown)).toEqual([]);
    expect(new Set(shown.edges.map((e) => e.id)).size).toBe(shown.edges.length);
    const follows = shown.edges.find((e) => e.source === "stage" && e.kind === "follows")!;
    const flow = shown.edges.find((e) => e.source === "stage" && e.kind === "flow")!;
    expect(shown.overlays?.[0].target).toBe(follows.id);
    expect(shown.overlays?.[3].target).toBe(flow.id);
  });

  it("discloses arcs folded inside a stage as a chip instead of losing the evidence", () => {
    const graph: FlowGraph = { ...parallel, overlays: [{ kind: "arc", target: "ab", payload: { source: "a", target: "b", label: "Response", value: 0.4 } }] };
    const shown = abstract(graph, { collapse: ["stage"] });
    expect(validateGraph(shown)).toEqual([]);
    expect(shown.overlays).toHaveLength(1);
    expect(shown.overlays?.[0]).toMatchObject({ kind: "chip", target: "stage", payload: { value: 0.4, text: "Response (inside collapsed stage)" } });
  });

  it("composes original edge targets across nested collapse", () => {
    const graph: FlowGraph = { ...parallel, nodes: parallel.nodes.map((n) => n.id === "b" ? { ...n, group: "child" } : n), groups: [...parallel.groups!, { id: "child", kind: "stage", label: "Child", parent: "stage" }] };
    const shown = collapseGroups(collapseGroups(graph, ["child"]), ["stage"]);
    expect(validateGraph(shown)).toEqual([]);
    expect(shown.meta?.collapsedEdgeTargets).toMatchObject({ ac: "stage->c", bc: "stage->c", ab: "stage" });
    expect(shown.overlays?.map((o) => o.target)).toEqual(["stage->c", "stage->c", "stage"]);
  });
  it("keeps the fixture connected at every threshold and never adds dangling edges", () => {
    for (const tt of thresholds) {
      const g = abstract(globalScene, { minEdgeShare: tt, minNodeShare: tt / 2 });
      expect(isConnected(g), `threshold ${tt}`).toBe(true);
      expect(validateGraph(g).filter((i) => i.level === "error")).toEqual([]);
      expect(g.nodes.some((n) => n.id === "__start")).toBe(true);
      expect(g.nodes.some((n) => n.id === "__end")).toBe(true);
    }
  });

  it("is monotone in the thresholds on the fixture", () => {
    let prevNodes = Infinity;
    let prevEdges = Infinity;
    let prevKept: Set<string> | undefined;
    for (const tt of thresholds) {
      const g = abstract(globalScene, { minEdgeShare: tt, minNodeShare: tt / 2 });
      expect(g.nodes.length).toBeLessThanOrEqual(prevNodes);
      expect(g.edges.length).toBeLessThanOrEqual(prevEdges);
      const kept = new Set(g.edges.filter((e) => !hasTag(e, RECONNECTED_TAG)).map((e) => e.id));
      if (prevKept) for (const id of kept) expect(prevKept.has(id), `edge ${id} kept at ${tt} but not at the lower threshold`).toBe(true);
      prevNodes = g.nodes.length;
      prevEdges = g.edges.length;
      prevKept = kept;
    }
    const loose = abstract(globalScene, { minEdgeShare: 0 });
    const tight = abstract(globalScene, { minEdgeShare: 0.5, minNodeShare: 0.25 });
    expect(tight.edges.length).toBeLessThan(loose.edges.length);
    expect(tight.nodes.length).toBeLessThan(loose.nodes.length);
  });

  it("keeps random connected graphs connected and monotone", () => {
    // The thresholded part is monotone (a subset at every higher threshold); the
    // reconnection re-adds the strongest paths and one edge per open need, which is
    // bounded but not a global optimum, so the total may differ by one re-added edge.
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGraph(seed, 8 + (seed % 30));
      expect(isConnected(g)).toBe(true);
      let prevTotal = Infinity;
      let prevKept: Set<string> | undefined;
      for (const tt of thresholds) {
        const r = abstract(g, { minEdgeShare: tt, minNodeShare: tt / 2 });
        expect(isConnected(r), `seed ${seed} threshold ${tt}`).toBe(true);
        expect(validateGraph(r).filter((i) => i.level === "error")).toEqual([]);
        const kept = new Set([...r.nodes, ...r.edges].filter((el) => !hasTag(el, RECONNECTED_TAG)).map((el) => el.id));
        if (prevKept) for (const id of kept) expect(prevKept.has(id), `seed ${seed}: ${id} kept at ${tt} only`).toBe(true);
        const reconnected = r.edges.filter((e) => hasTag(e, RECONNECTED_TAG)).length;
        expect(reconnected).toBeLessThanOrEqual(2 * r.nodes.length);
        expect(r.nodes.length + r.edges.length).toBeLessThanOrEqual(prevTotal + 1);
        prevTotal = r.nodes.length + r.edges.length;
        prevKept = kept;
      }
    }
  });

  it("gives every kept activity an incoming and an outgoing path where the original had one", () => {
    const g = abstract(globalScene, { minEdgeShare: 0.3 });
    for (const n of g.nodes) {
      if (n.kind !== "activity") continue;
      const hasIn = g.edges.some((e) => e.target === n.id && e.source !== n.id);
      const hasOut = g.edges.some((e) => e.source === n.id && e.target !== n.id);
      const originalIn = globalScene.edges.some((e) => e.target === n.id && e.source !== n.id);
      const originalOut = globalScene.edges.some((e) => e.source === n.id && e.target !== n.id);
      if (originalIn) expect(hasIn, `${n.id} lost its incoming paths`).toBe(true);
      if (originalOut) expect(hasOut, `${n.id} lost its outgoing paths`).toBe(true);
    }
  });

  it("re-adds the edge that closes the most needs, then the strongest, judging needs as they stand", () => {
    // p→q, r→p and u→p are kept; q needs an outgoing edge, r and u an incoming one.
    const g: FlowGraph = {
      nodes: ["p", "q", "r", "u"].map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase() })),
      edges: [
        { id: "pq", source: "p", target: "q", kind: "follows", metrics: { count: 100 } },
        { id: "rp", source: "r", target: "p", kind: "follows", metrics: { count: 100 } },
        { id: "up", source: "u", target: "p", kind: "follows", metrics: { count: 100 } },
        { id: "qr", source: "q", target: "r", kind: "follows", metrics: { count: 30 } },
        { id: "qu", source: "q", target: "u", kind: "follows", metrics: { count: 20 } },
        { id: "pu", source: "p", target: "u", kind: "follows", metrics: { count: 25 } },
        { id: "qp", source: "q", target: "p", kind: "follows", metrics: { count: 40 } },
        { id: "pr", source: "p", target: "r", kind: "follows", metrics: { count: 35 } },
      ],
    };
    const added = abstract(g, { minEdgeShare: 0.5 })
      .edges.filter((e) => hasTag(e, RECONNECTED_TAG))
      .map((e) => e.id)
      .sort();
    // qr and qu close two needs each, qr is stronger; qp and pr are stronger still but
    // close one each. Then q has its outgoing edge and r its incoming one, so qp and pr
    // close nothing and qu closes only u's need, which pu does with more strength.
    expect(added).toEqual(["pu", "qr"]);
  });

  it("joins a component through the path whose edges cost least, one plus the edge's weakness each", () => {
    // m and x are kept, the r nodes removed (1 case of 100). Each edge costs 1 + (1 - count / 100):
    // through r1 alone 1.9 + 1.9 = 3.8, through r2 and r3 1 + 1 + 1 = 3, through r4 1.6 + 1.6 = 3.2.
    const graph = (r4: number): FlowGraph => ({
      nodes: activities({ m: 100, x: 100, r1: 1, r2: 1, r3: 1, r4: 1 }),
      edges: follows([["m", "r1", 10], ["r1", "x", 10], ["m", "r2", 100], ["r2", "r3", 100], ["r3", "x", 100], ["m", "r4", r4], ["r4", "x", r4]]),
    });
    expect(readded(abstract(graph(40), { minNodeShare: 0.5 }))).toEqual(["m->r2", "r2", "r2->r3", "r3", "r3->x"]);
    // At 60 the path through r4 costs 1.4 + 1.4 = 2.8, less than the one through two removed nodes.
    expect(readded(abstract(graph(60), { minNodeShare: 0.5 }))).toEqual(["m->r4", "r4", "r4->x"]);
  });

  it("enters each node of equally cheap paths by the edge with the smallest id, whatever the input order", () => {
    // a, b and c are kept and joined; x is kept alone. b and c each reach x through a removed
    // node at cost 2, so x is entered by rb->x, which sorts before rc->x.
    const nodes = activities({ a: 100, b: 100, c: 100, x: 100, rb: 1, rc: 1 });
    const kept = follows([["a", "b", 100], ["a", "c", 100]]);
    const paths = follows([["b", "rb", 100], ["rb", "x", 100], ["c", "rc", 100], ["rc", "x", 100]]);
    for (const edges of [[...kept, ...paths], [...kept].reverse().concat(paths), [...paths].reverse().concat(kept)]) {
      expect(readded(abstract({ nodes, edges }, { minNodeShare: 0.5 }))).toEqual(["b->rb", "rb", "rb->x"]);
    }
  });

  it("joins equally near components in the order of their smallest node id", () => {
    // y and z are both 2 from m. y comes first and is reached through r1; r1 then touches z,
    // which joins by its direct edge. Taking z first would enter it by q2->z (before r1->z)
    // and need a second path for y: four edges instead of three.
    const graph: FlowGraph = {
      nodes: activities({ m: 100, y: 50, z: 50, q2: 1, r1: 1 }),
      edges: follows([["m", "q2", 100], ["q2", "z", 100], ["m", "r1", 100], ["r1", "y", 100], ["r1", "z", 100]]),
    };
    expect(readded(abstract(graph, { minNodeShare: 0.3 }))).toEqual(["m->r1", "r1", "r1->y", "r1->z"]);
  });

  it("joins a component a re-added node touches by the smallest id among its cheapest direct edges", () => {
    // b, p and q are all 2 from m through r1; b joins first and re-adds r1. r1 touches the
    // component of p and q by r1->p and q->r1, equally cheap, so q->r1, the smaller id, joins
    // it, although p is the smaller node id and a search from r1 would enter it by r1->p.
    const graph: FlowGraph = {
      nodes: activities({ m: 100, b: 40, p: 40, q: 40, r1: 1 }),
      edges: follows([["m", "r1", 100], ["r1", "b", 100], ["q", "r1", 100], ["r1", "p", 100], ["q", "p", 100]]),
    };
    expect(readded(abstract(graph, { minNodeShare: 0.3 }))).toEqual(["m->r1", "q->r1", "r1", "r1->b"]);
  });

  it("reconnects equally cheap alternatives the same way whatever the input order", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = tiedGraph(seed, 12 + (seed % 30));
      for (const relativeTo of ["max", "total"] as const) {
        for (const [minEdgeShare, minNodeShare] of [[0.5, 0.5], [0.75, 0.5], [0.3, 0.75], [1, 0.25]]) {
          const options = { relativeTo, minEdgeShare, minNodeShare };
          const expected = inIdOrder(abstract(g, options));
          for (let k = 1; k <= 3; k++) {
            const permuted = { nodes: shuffled(g.nodes, seed * 31 + k), edges: shuffled(g.edges, seed * 17 + k) };
            expect(inIdOrder(abstract(permuted, options)), `seed ${seed}, ${relativeTo} ${minEdgeShare}/${minNodeShare}, order ${k}`).toBe(expected);
          }
        }
      }
    }
  });

  it("tags re-added elements and can be switched off", () => {
    const connected = abstract(globalScene, { minEdgeShare: 0.3 });
    expect(connected.edges.some((e) => hasTag(e, RECONNECTED_TAG))).toBe(true);
    const raw = abstract(globalScene, { minEdgeShare: 0.3, keepConnected: false });
    expect(raw.edges.every((e) => !hasTag(e, RECONNECTED_TAG))).toBe(true);
    expect(raw.edges.length).toBeLessThanOrEqual(connected.edges.length);
  });

  it("measures self-loops against the maximum or the raw total of the other follows edges", () => {
    const loops: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }, { id: "c", kind: "activity", label: "C" }],
      edges: [
        { id: "ab", source: "a", target: "b", kind: "follows", metrics: { count: 60 } },
        { id: "ba", source: "b", target: "a", kind: "follows", metrics: { count: -20 } },
        { id: "aa", source: "a", target: "a", kind: "follows", metrics: { count: 15 } },
        { id: "bb", source: "b", target: "b", kind: "follows", metrics: { count: 80 } },
        { id: "cc", source: "c", target: "c", kind: "follows" },
      ],
    };
    const loopsKept = (relativeTo: "max" | "total", minEdgeShare: number) =>
      abstract(loops, { relativeTo, minEdgeShare, keepConnected: false })
        .edges.filter((e) => e.source === e.target)
        .map((e) => e.id);
    // max: 15 / 60 = 0.25; 80 / 60 is capped at 1; a loop without a metric counts 1.
    expect(loopsKept("max", 0.25)).toEqual(["aa", "bb", "cc"]);
    expect(loopsKept("max", 0.26)).toEqual(["bb", "cc"]);
    // total: the negative count is summed as it is, 15 / (60 - 20) = 0.375.
    expect(loopsKept("total", 0.375)).toEqual(["aa", "bb", "cc"]);
    expect(loopsKept("total", 0.38)).toEqual(["bb", "cc"]);
  });

  it("removes weak activities but never events, gateways or kept ids", () => {
    const g = abstract(globalScene, { minNodeShare: 0.5, keep: ["change_currency"] });
    expect(g.nodes.find((n) => n.id === "change_currency")).toBeDefined();
    expect(g.nodes.find((n) => n.id === "__start")).toBeDefined();
    expect(g.nodes.find((n) => n.id === "srm_held")).toBeUndefined();
    expect(g.nodes.length).toBeLessThan(globalScene.nodes.length);
  });

  it("collapses stage groups into stage nodes with summed counts", () => {
    const g = collapseGroups(globalScene, "all");
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const grp of globalScene.groups ?? []) expect(ids.has(grp.id)).toBe(true);
    const order = g.nodes.find((n) => n.id === "order")!;
    expect(order.kind).toBe("stage");
    expect(hasTag(order, COLLAPSED_TAG)).toBe(true);
    const memberEvents = globalScene.nodes.filter((n) => n.group === "order").reduce((s, n) => s + (n.metrics?.events ?? 0), 0);
    expect(order.metrics?.events).toBe(memberEvents);
    expect(order.metrics?.members).toBe(globalScene.nodes.filter((n) => n.group === "order").length);
    expect(order.metrics?.internalCount).toBeGreaterThan(0);
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
    expect(g.groups).toEqual([]);
    const viaAbstract = abstract(globalScene, { collapse: ["receipt"] });
    expect(viaAbstract.nodes.find((n) => n.id === "receipt")?.kind).toBe("stage");
    expect(viaAbstract.nodes.find((n) => n.id === "record_goods_receipt")).toBeUndefined();
    expect(viaAbstract.groups?.map((x) => x.id)).not.toContain("receipt");
  });

  it("keeps overlays whose targets survive and moves them on collapse", () => {
    const withOverlays: FlowGraph = {
      ...globalScene,
      overlays: [
        { kind: "badge", target: "record_goods_receipt", payload: { value: 0.2 } },
        { kind: "badge", target: "srm_held", payload: { value: 0.9 } },
        { kind: "arc", target: "x", payload: { source: "record_goods_receipt", target: "record_invoice_receipt" } },
      ],
    };
    const filtered = abstract(withOverlays, { minNodeShare: 0.5 });
    expect(filtered.overlays?.map((o) => o.target)).toEqual(["record_goods_receipt", "x"]);
    const collapsed = collapseGroups(withOverlays, ["receipt"]);
    expect(collapsed.overlays?.[0].target).toBe("receipt");
    expect(collapsed.overlays?.[2].payload?.source).toBe("receipt");
  });
});

describe("diff", () => {
  it("carries slice metrics, baseline metrics and deltas and tags one-sided elements", () => {
    const d = diff(globalScene, vendorScene);
    expect(d.nodes.length).toBe(globalScene.nodes.length);
    const clear = d.nodes.find((n) => n.id === "clear_invoice")!;
    expect(clear.metrics?.cases).toBe(vendorScene.nodes.find((n) => n.id === "clear_invoice")!.metrics!.cases);
    expect(clear.metrics?.a_cases).toBe(globalScene.nodes.find((n) => n.id === "clear_invoice")!.metrics!.cases);
    expect(clear.metrics?.delta_cases).toBe(clear.metrics!.cases - clear.metrics!.a_cases);
    expect(clear.tags).toContain(DIFF_TAGS.both);
    const onlyA = d.nodes.find((n) => n.id === "srm_held")!;
    expect(onlyA.tags).toContain(DIFF_TAGS.onlyA);
    expect(onlyA.metrics?.delta_cases).toBe(-(onlyA.metrics?.a_cases ?? 0));
    expect(validateGraph(d).filter((i) => i.level === "error")).toEqual([]);
  });
});
