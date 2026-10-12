import { readFileSync } from "node:fs";
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
    // bounded but not a global optimum. On these graphs the total grows by at most one
    // between neighbouring thresholds; on others it can grow by more (pinned below).
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

  it("can re-add more at a higher threshold than it removes, as the architecture says", () => {
    // Counts relative to 720 and cases relative to 800. At 0.75 / 0.375 r is removed and s kept;
    // {m, n} and {s, p, q} join by the direct edge s->n: 5 nodes and 4 edges. At 1 / 0.5 s goes
    // too and no edge is kept; m->n (cost 1.19) joins m and n, then p is nearest through r
    // (m->r 1.44 + p->r 1.03 = 2.47, before q at 2.49 through s from n), and q next through s
    // from p (s->p 1.11 + q->s 1): 6 nodes and 5 edges, two more than below.
    const graph: FlowGraph = {
      nodes: activities({ m: 600, n: 400, p: 500, q: 800, s: 350, r: 200 }),
      edges: follows([["m", "n", 580], ["m", "r", 400], ["s", "n", 370], ["s", "p", 640], ["p", "r", 700], ["q", "s", 720]]),
    };
    const lower = abstract(graph, { minEdgeShare: 0.75, minNodeShare: 0.375 });
    const higher = abstract(graph, { minEdgeShare: 1, minNodeShare: 0.5 });
    expect(readded(lower)).toEqual(["s->n"]);
    expect(readded(higher)).toEqual(["m->n", "m->r", "p->r", "q->s", "r", "s", "s->p"]);
    expect(lower.nodes.length + lower.edges.length).toBe(9);
    expect(higher.nodes.length + higher.edges.length).toBe(11);
    const architecture = readFileSync(new URL("../../docs/ARCHITECTURE.md", import.meta.url), "utf8").replace(/\s+/g, " ");
    expect(architecture).toContain("so the total element count is not monotone: a higher threshold can re-add more than it removes");
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
    // it, although p is the smaller node id and a search from r1 would enter it by r1->p. In the
    // reversed order r1->p comes first among r1's edges.
    const graph: FlowGraph = {
      nodes: activities({ m: 100, b: 40, p: 40, q: 40, r1: 1 }),
      edges: follows([["m", "r1", 100], ["r1", "b", 100], ["q", "r1", 100], ["r1", "p", 100], ["q", "p", 100]]),
    };
    for (const edges of [graph.edges, [...graph.edges].reverse()]) {
      expect(readded(abstract({ ...graph, edges }, { minNodeShare: 0.3 }))).toEqual(["m->r1", "q->r1", "r1", "r1->b"]);
    }
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

  it("removes a constraint or flow edge only with an element at one of its ends, and counts it in meta", () => {
    // s → A → B → e with a weak detour A → R → B; R is related to A by a constraint and to B by a flow.
    const node = (id: string, cases: number): FlowNode => ({ id, kind: "activity", label: id, metrics: { cases } });
    const follows = (source: string, target: string, count: number): FlowEdge => ({ id: `${source}${target}`, kind: "follows", source, target, metrics: { count } });
    const g: FlowGraph = {
      nodes: [{ id: "s", kind: "event", label: "Start", tags: ["start"] }, node("A", 100), node("R", 5), node("B", 100), node("C", 90), { id: "e", kind: "event", label: "End", tags: ["end"] }],
      edges: [
        follows("s", "A", 100), follows("A", "B", 95), follows("A", "R", 5), follows("R", "B", 5), follows("B", "C", 90), follows("C", "e", 90), follows("B", "e", 10),
        { id: "cAR", kind: "constraint", source: "A", target: "R" },
        { id: "fRB", kind: "flow", source: "R", target: "B" },
        { id: "cAC", kind: "constraint", source: "A", target: "C" },
      ],
    };
    // R (5 of 100 cases) is below 50 %: its constraint and flow edge cannot be drawn without it; A–C stays.
    for (const keepConnected of [true, false]) {
      const shown = abstract(g, { minNodeShare: 0.5, keepConnected });
      expect(shown.nodes.map((n) => n.id), `keepConnected ${keepConnected}`).toEqual(["s", "A", "B", "C", "e"]);
      expect(shown.edges.filter((e) => e.kind !== "follows").map((e) => e.id)).toEqual(["cAC"]);
      expect(shown.meta?.abstraction).toEqual({ minEdgeShare: 0, minNodeShare: 0.5, keepConnected, collapse: undefined, removedEdges: { constraint: 1, flow: 1 } });
    }
    // Nothing goes: no count.
    expect(abstract(g).meta?.abstraction).toEqual({ minEdgeShare: 0, minNodeShare: 0, keepConnected: true, collapse: undefined });
  });

  it("brings back the constraint and flow edges of an activity it re-adds to keep the map connected", () => {
    // n1 (34 of 82 cases) is below 50 % but lies on the only way from n0 to n2, so it is re-added with
    // follows edges that reconnect the map; its flow edge from n0 comes back too, both ends being on the map,
    // and like everything the abstraction re-adds it is tagged.
    const g: FlowGraph = {
      nodes: [
        { id: "n0", kind: "activity", label: "n0", metrics: { cases: 54 } },
        { id: "n1", kind: "activity", label: "n1", metrics: { cases: 34 } },
        { id: "n2", kind: "activity", label: "n2", metrics: { cases: 82 } },
      ],
      edges: [
        { id: "e0", kind: "follows", source: "n0", target: "n1", metrics: { count: 93 } },
        { id: "e2", kind: "follows", source: "n1", target: "n2", metrics: { count: 48 } },
        { id: "e3", kind: "follows", source: "n1", target: "n0", metrics: { count: 44 } },
        { id: "e4", kind: "flow", source: "n0", target: "n1" },
      ],
    };
    const shown = abstract(g, { minNodeShare: 0.5 });
    expect(shown.nodes.map((n) => [n.id, hasTag(n, RECONNECTED_TAG)])).toEqual([["n0", false], ["n1", true], ["n2", false]]);
    expect(shown.edges.map((e) => [e.id, hasTag(e, RECONNECTED_TAG)])).toEqual([["e0", true], ["e2", true], ["e3", true], ["e4", true]]);
    expect(shown.meta?.abstraction).not.toHaveProperty("removedEdges");
    // Without keepConnected n1 goes, and with it its flow edge.
    expect(abstract(g, { minNodeShare: 0.5, keepConnected: false }).meta?.abstraction).toMatchObject({ removedEdges: { flow: 1 } });
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

/** Every order of the items. */
function orders<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => orders([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe("abstract: input order", () => {
  it("measures strength relative to a total that does not depend on the input order", () => {
    // Shares of 1/10, 2/10 and 3/10 sum to 6/10, so c, c->d and the loop d->d have strength
    // exactly 1/2 relative to the total; in floating point the sum depends on the order of adding.
    const nodes: FlowNode[] = [
      { id: "a", kind: "activity", label: "A", metrics: { share: 0.1 } },
      { id: "b", kind: "activity", label: "B", metrics: { share: 0.2 } },
      { id: "c", kind: "activity", label: "C", metrics: { share: 0.3 } },
      { id: "d", kind: "activity", label: "D" },
    ];
    const edges: FlowEdge[] = [
      { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { share: 0.1 } },
      { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { share: 0.2 } },
      { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { share: 0.3 } },
      { id: "d->d", kind: "follows", source: "d", target: "d", metrics: { share: 0.3 } },
    ];
    const results = new Set<string>();
    for (const nodeOrder of orders(nodes)) {
      for (const edgeOrder of orders(edges)) {
        const g = abstract({ nodes: nodeOrder, edges: edgeOrder }, { relativeTo: "total", minEdgeShare: 0.5, minNodeShare: 0.5, keepConnected: false });
        results.add(JSON.stringify([g.nodes.map((n) => n.id).sort(), g.edges.map((e) => e.id).sort()]));
      }
    }
    expect([...results]).toHaveLength(1);
  });

  it("names the merged edges of two kinds between the same nodes the same way whatever the input order", () => {
    // Collapsing s makes a->c and b->c parallel follows edges and fa and fb parallel flows, both
    // from s to c. The one whose smallest original id comes first, a->c before fa, keeps the
    // plain id; the other takes the kind and a number.
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", group: "s" }, { id: "b", kind: "activity", label: "B", group: "s" }, { id: "c", kind: "activity", label: "C" }],
      edges: [
        { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { count: 1 } },
        { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 2 } },
        { id: "fa", kind: "flow", source: "a", target: "c" },
        { id: "fb", kind: "flow", source: "b", target: "c" },
      ],
      groups: [{ id: "s", kind: "stage", label: "S" }],
    };
    for (const edges of orders(graph.edges)) {
      const shown = collapseGroups({ ...graph, edges }, ["s"]);
      expect(Object.fromEntries(shown.edges.map((e) => [e.kind, e.id])), edges.map((e) => e.id).join(" ")).toEqual({ follows: "s->c", flow: "s->c:flow:1" });
    }
  });

  it("sums and averages the metrics of a collapsed stage and its merged edges the same way whatever the input order", () => {
    // 0.1 + 0.2 + 0.3 depends on the order of adding in floating point; each mean below is theirs.
    const member = (id: string, v: number): FlowNode => ({ id, kind: "activity", label: id, group: "s", metrics: { cases: 1, violationShare: v } });
    const nodes = [member("a", 0.1), member("b", 0.2), member("d", 0.3), { id: "c", kind: "activity" as const, label: "C" }];
    const edges: FlowEdge[] = ["a", "b", "d"].map((id, i) => ({ id: `${id}->c`, kind: "follows", source: id, target: "c", metrics: { count: 1, violationShare: (i + 1) / 10 } }));
    const shown = new Set<string>();
    for (const nodeOrder of orders(nodes)) {
      for (const edgeOrder of orders(edges)) {
        const g = collapseGroups({ nodes: nodeOrder, edges: edgeOrder, groups: [{ id: "s", kind: "stage", label: "S" }] }, ["s"]);
        shown.add(JSON.stringify([g.nodes.find((n) => n.id === "s")!.metrics, g.edges[0].metrics]));
      }
    }
    expect([...shown]).toHaveLength(1);
  });

  it("counts the transitions inside a collapsed stage the same way whatever the input order", () => {
    // Counts of 1/10, 2/10 and 3/10 inside s: 0.1 + 0.2 + 0.3 and 0.3 + 0.2 + 0.1 differ in floating point.
    const nodes: FlowNode[] = ["a", "b", "d"].map((id) => ({ id, kind: "activity", label: id, group: "s" }));
    const edges: FlowEdge[] = [["a", "b"], ["b", "d"], ["d", "a"]].map(([source, target], i) => ({ id: `${source}->${target}`, kind: "follows", source, target, metrics: { count: (i + 1) / 10 } }));
    const counted = new Set<number>();
    for (const edgeOrder of orders(edges)) counted.add(collapseGroups({ nodes, edges: edgeOrder, groups: [{ id: "s", kind: "stage", label: "S" }] }, ["s"]).nodes[0].metrics!.internalCount);
    expect([...counted]).toHaveLength(1);
    expect([...counted][0]).toBeCloseTo(0.6, 12);
  });
});

describe("abstract: collapsed metrics", () => {
  it("averages a metric over the members that carry it when no member has a weight", () => {
    // Neither member has a case, so the mean is not weighted; only a carries medianNextHours,
    // so the stage's value is a's 10, and the mean of 4 and 8 is 6.
    const graph: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "s", metrics: { cases: 0, medianNextHours: 10, violationShare: 4 } },
        { id: "b", kind: "activity", label: "B", group: "s", metrics: { cases: 0, violationShare: 8 } },
      ],
      edges: [],
      groups: [{ id: "s", kind: "stage", label: "S" }],
    };
    expect(collapseGroups(graph, ["s"]).nodes[0].metrics).toEqual({ cases: 0, medianNextHours: 10, violationShare: 6, members: 2 });
  });
});

describe("abstract: small and degenerate graphs", () => {
  it("leaves an empty graph empty at every option", () => {
    const empty: FlowGraph = { nodes: [], edges: [] };
    for (const options of [{}, { minEdgeShare: 1, minNodeShare: 1 }, { relativeTo: "total" as const, minNodeShare: 0.5 }, { keepConnected: false }, { collapse: "all" as const }]) {
      const g = abstract(empty, options);
      expect([g.nodes, g.edges, g.groups]).toEqual([[], [], []]);
      expect(isConnected(g)).toBe(true);
    }
    expect(collapseGroups(empty, "all")).toBe(empty);
  });

  it("keeps a single activity and its self-loop at every threshold", () => {
    // The activity is the strongest of its kind, and a loop with no other follows edge to be
    // measured against has strength 1, relative to the maximum and to the total alike.
    const graph: FlowGraph = { nodes: activities({ a: 7 }), edges: follows([["a", "a", 3]]) };
    for (const relativeTo of ["max", "total"] as const) {
      const g = abstract(graph, { relativeTo, minEdgeShare: 1, minNodeShare: 1 });
      expect([g.nodes.map((n) => n.id), g.edges.map((e) => e.id), readded(g)]).toEqual([["a"], ["a->a"], []]);
    }
  });

  it("re-adds the weak direction of a loop of two, which gives both activities their missing path", () => {
    // b->a (10 of 100) is removed; a then lacks an incoming and b an outgoing path, and b->a closes both.
    const graph: FlowGraph = { nodes: activities({ a: 10, b: 10 }), edges: follows([["a", "b", 100], ["b", "a", 10]]) };
    expect(abstract(graph, { minEdgeShare: 0.5, keepConnected: false }).edges.map((e) => e.id)).toEqual(["a->b"]);
    const g = abstract(graph, { minEdgeShare: 0.5 });
    expect([g.edges.map((e) => e.id), readded(g)]).toEqual([["a->b", "b->a"], ["b->a"]]);
  });

  it("thresholds parallel edges one by one and re-adds none once their activities have their paths", () => {
    const graph: FlowGraph = {
      nodes: activities({ a: 10, b: 10 }),
      edges: [...follows([["a", "b", 100]]), { id: "a->b#2", kind: "follows", source: "a", target: "b", metrics: { count: 10 } }, { id: "a->b~c", kind: "constraint", source: "a", target: "b" }],
    };
    const g = abstract(graph, { minEdgeShare: 0.5 });
    expect([g.edges.map((e) => e.id), readded(g)]).toEqual([["a->b", "a->b~c"], []]);
  });

  it("keeps an activity without edges alone, and drops it with its self-loop below the threshold", () => {
    const graph: FlowGraph = { nodes: activities({ a: 100, b: 100, x: 50 }), edges: follows([["a", "b", 100], ["x", "x", 5]]) };
    const strong = abstract(graph, { minNodeShare: 0.4 });
    expect([strong.nodes.map((n) => n.id), strong.edges.map((e) => e.id), readded(strong)]).toEqual([["a", "b", "x"], ["a->b", "x->x"], []]);
    expect(isConnected(strong)).toBe(false);
    const weak = abstract(graph, { minNodeShare: 0.6 });
    expect([weak.nodes.map((n) => n.id), weak.edges.map((e) => e.id)]).toEqual([["a", "b"], ["a->b"]]);
  });

  it("breaks a tie by id even where the other choice would re-add less, since the objective holds per join", () => {
    // y and z are both 2 from m. y comes first by id and is entered by r1->y, which sorts before
    // r2->y; r1 touches nothing else, so z needs a path of its own through r2: four edges. Entering
    // y by r2->y would have re-added r2, which touches z, in three.
    const graph: FlowGraph = {
      nodes: activities({ m: 100, y: 50, z: 50, r1: 1, r2: 1 }),
      edges: follows([["m", "r1", 100], ["r1", "y", 100], ["m", "r2", 100], ["r2", "z", 100], ["r2", "y", 100]]),
    };
    expect(readded(abstract(graph, { minNodeShare: 0.3 }))).toEqual(["m->r1", "m->r2", "r1", "r1->y", "r2", "r2->z"]);
  });
});

describe("abstract: findings", () => {
  it("finding: counts a constraint edge, a flow edge and a follows edge without a count inside a collapsed stage as one transition each", () => {
    // Only a->b's 5 are observed transitions; the constraint, the flow and the uncounted self-loop add 1 each.
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", group: "s" }, { id: "b", kind: "activity", label: "B", group: "s" }],
      edges: [
        { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 5 } },
        { id: "k", kind: "constraint", source: "a", target: "b" },
        { id: "f", kind: "flow", source: "b", target: "a" },
        { id: "b->b", kind: "follows", source: "b", target: "b", metrics: { cases: 4 } },
      ],
      groups: [{ id: "s", kind: "stage", label: "S" }],
    };
    expect(collapseGroups(graph, ["s"]).nodes[0].metrics?.internalCount).toBe(8);
  });

  it("finding: a collapsed group without members can be where the joining starts, and then nothing is joined", () => {
    // The empty group becomes a stage node without metrics, so of strength 1: heavier than m (100 of
    // 151 cases) and n (50 of 151). The joining starts there, reaches nothing, and m and n, joined
    // through r in the input, stay apart.
    const graph: FlowGraph = {
      nodes: activities({ m: 100, n: 50, r: 1 }),
      edges: follows([["m", "r", 10], ["r", "n", 10]]),
      groups: [{ id: "empty", kind: "stage", label: "Empty" }],
    };
    expect(isConnected(graph)).toBe(true);
    const g = abstract(graph, { relativeTo: "total", minNodeShare: 0.1, collapse: ["empty"] });
    expect([g.nodes.map((n) => n.id).sort(), g.edges, readded(g)]).toEqual([["empty", "m", "n"], [], []]);
  });

  it("finding: the kept activities of a second input component are not joined through its removed ones", () => {
    const graph: FlowGraph = {
      nodes: activities({ m: 100, n: 100, x: 50, y: 50, r: 1 }),
      edges: follows([["m", "n", 100], ["x", "r", 100], ["r", "y", 100]]),
    };
    const g = abstract(graph, { minNodeShare: 0.3 });
    expect([g.nodes.map((n) => n.id), g.edges.map((e) => e.id), readded(g)]).toEqual([["m", "n", "x", "y"], ["m->n"], []]);
  });

  it("finding: collapsing a stage merges parallel edges between nodes outside it and keeps no payload", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", group: "s" }, ...activities({ b: 1, c: 1 })],
      edges: [
        ...follows([["a", "b", 3]]),
        { id: "k1", kind: "constraint", source: "b", target: "c", payload: { constraintId: "first" } },
        { id: "k2", kind: "constraint", source: "b", target: "c", payload: { constraintId: "second" } },
      ],
      groups: [{ id: "s", kind: "stage", label: "S" }],
    };
    const shown = collapseGroups(graph, ["s"]);
    expect(shown.edges).toEqual([
      { id: "a->b", kind: "follows", source: "s", target: "b", metrics: { count: 3 } },
      { id: "b->c", kind: "constraint", source: "b", target: "c", metrics: {}, tags: [] },
    ]);
    expect(shown.meta?.collapsedEdgeTargets).toMatchObject({ k1: "b->c", k2: "b->c" });
  });
});
