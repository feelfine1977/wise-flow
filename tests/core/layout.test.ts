import { describe, expect, it } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { type Box, type FlowGraph, abstract, coversGraph, filterPositions, layout, layoutUnion, unionGraph } from "../../src/index";
import { provisionalLayout } from "../../src/core/provisional";

function contains(outer: Box, inner: Box, slack = 0.5): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

const small = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });

describe("layout", () => {
  it("lays out with ELK in-process and places members inside their stage groups", async () => {
    const p = await layout(small, { engine: "elk" });
    expect(p.engine).toBe("elk");
    expect(coversGraph(p, small)).toBe(true);
    for (const n of small.nodes) {
      const box = p.nodes[n.id];
      expect(box.width).toBeGreaterThan(0);
      if (n.group && p.groups[n.group]) expect(contains(p.groups[n.group], box), `${n.id} outside ${n.group}`).toBe(true);
    }
    expect(Object.keys(p.edges).length).toBeGreaterThan(0);
    expect(p.bounds.width).toBeGreaterThan(0);
  });

  it("is deterministic for the same input regardless of element order", async () => {
    const a = await layout(small, { engine: "elk" });
    const shuffled = { ...small, nodes: [...small.nodes].reverse(), edges: [...small.edges].reverse() };
    const b = await layout(shuffled, { engine: "elk" });
    expect(b.nodes).toEqual(a.nodes);
    expect(b.groups).toEqual(a.groups);
  });

  it("falls back to Dagre on request, on timeout and keeps groups", async () => {
    const d = await layout(small, { engine: "dagre" });
    expect(d.engine).toBe("dagre");
    expect(coversGraph(d, small)).toBe(true);
    for (const n of small.nodes) {
      if (n.group && d.groups[n.group]) expect(contains(d.groups[n.group], d.nodes[n.id], 2), `${n.id} outside ${n.group}`).toBe(true);
    }
    const timedOut = await layout(small, { timeoutMs: 0 });
    expect(timedOut.engine).toBe("dagre");
  });
});

describe("layout of empty ids", () => {
  // The node "" and the edge "" from it; "\u0000" is the name graphlib gives its root.
  const graph: FlowGraph = {
    nodes: [
      { id: "", kind: "activity", label: "Nameless" },
      { id: "\u0000", kind: "activity", label: "Zero" },
      { id: "b", kind: "activity", label: "B" },
    ],
    edges: [
      { id: "", kind: "follows", source: "", target: "b" },
      { id: "\u0000", kind: "follows", source: "\u0000", target: "b" },
      { id: "b->", kind: "follows", source: "b", target: "" },
    ],
  };

  it.each(["dagre", "elk"] as const)("places every node and routes every edge with %s", async (engine) => {
    const p = await layout(graph, { engine });
    for (const id of ["", "\u0000", "b"]) expect(Object.values(p.nodes[id]).every(Number.isFinite), JSON.stringify(id)).toBe(true);
    expect(new Set([p.nodes[""].x, p.nodes["\u0000"].x, p.nodes.b.x]).size + new Set([p.nodes[""].y, p.nodes["\u0000"].y, p.nodes.b.y]).size).toBeGreaterThan(3);
    for (const id of ["", "\u0000", "b->"]) expect(p.edges[id]?.points.length, JSON.stringify(id)).toBeGreaterThanOrEqual(2);
  });
});

describe("layout of ids named like members of Object.prototype", () => {
  // Dagre keeps its graph in plain objects: such a name read or wrote the prototype every object shares.
  const members = () => Object.getOwnPropertyNames(Object.prototype).map((k) => [k, Object.getOwnPropertyDescriptor(Object.prototype, k)?.value]);

  it.each(["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"])("places a node called %s with Dagre and leaves Object.prototype as it was", async (id) => {
    const before = members();
    const graph: FlowGraph = {
      nodes: [{ id, kind: "activity", label: "Odd" }, { id: "b", kind: "activity", label: "B" }],
      edges: [{ id: `${id}->b`, kind: "follows", source: id, target: "b" }],
    };
    const p = await layout(graph, { engine: "dagre" });
    expect(members()).toEqual(before);
    // A record cannot hold the key __proto__ as its own; how positions should keep such an id is not decided.
    if (id !== "__proto__") expect(Object.getOwnPropertyDescriptor(p.nodes, id)?.value).toMatchObject({ width: 180, height: 48 });
    expect(Object.getOwnPropertyDescriptor(p.edges, `${id}->b`)?.value.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe("layout of an edge to a node that is not there", () => {
  it("leaves the edge out with Dagre, and routes the others along finite points", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }],
      edges: [{ id: "a->b", kind: "follows", source: "a", target: "b" }, { id: "a->gone", kind: "follows", source: "a", target: "gone" }, { id: "gone->b", kind: "follows", source: "gone", target: "b" }],
    };
    const p = await layout(graph, { engine: "dagre" });
    expect(Object.keys(p.nodes)).toEqual(["a", "b"]);
    expect(Object.keys(p.edges)).toEqual(["a->b"]);
    expect(Object.values(p.edges).flatMap((r) => r.points).every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
    expect(Object.values(p.bounds).every(Number.isFinite)).toBe(true);
  });
});

describe("layout options that are not finite numbers", () => {
  // A size callback may compute from data; a spacing from a host's settings.
  const graph = { nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity" as const, label: id, group: "s" })), edges: [{ id: "a->b", kind: "follows" as const, source: "a", target: "b" }, { id: "a->c", kind: "follows" as const, source: "a", target: "c" }], groups: [{ id: "s", kind: "stage" as const, label: "S" }] };

  it.each(["dagre", "elk"] as const)("count as not given with %s: the default spacing and node size apply", async (engine) => {
    const plain = await layout(graph, { engine });
    for (const v of [NaN, Infinity, -Infinity]) {
      for (const options of [{ spacing: { node: v } }, { spacing: { layer: v } }, { spacing: { group: v } }, { nodeSize: { width: v, height: 48 } }, { nodeSize: () => ({ width: 180, height: v }) }]) {
        expect(await layout(graph, { engine, ...options }), `${JSON.stringify(options)} with ${v}`).toEqual(plain);
        if (engine === "dagre") expect(provisionalLayout(graph, options), `provisional ${JSON.stringify(options)} with ${v}`).toEqual(provisionalLayout(graph));
      }
    }
  });
});

describe("layoutUnion", () => {
  // ELK runs on the calling thread here and needs seconds for the dense global scene
  // (44 nodes, 656 follows edges between them), so the union for ELK takes its frequent edges.
  // All nodes stay; the vendor scene adds edges the abstraction left out.
  const frequent = abstract(globalScene, { minEdgeShare: 0.03 });
  let elkUnion: ReturnType<typeof layoutUnion> | undefined;
  const unionWithElk = () => (elkUnion ??= layoutUnion([frequent, vendorScene], { engine: "elk" }));

  it("yields identical positions for shared nodes across filtered scenes", async () => {
    const union = await unionWithElk();
    const a = filterPositions(union, frequent);
    const b = filterPositions(union, vendorScene);
    expect(coversGraph(a, frequent)).toBe(true);
    expect(coversGraph(b, vendorScene)).toBe(true);
    const shared = vendorScene.nodes.map((n) => n.id).filter((id) => a.nodes[id]);
    expect(shared.length).toBe(vendorScene.nodes.length);
    for (const id of shared) expect(b.nodes[id]).toEqual(a.nodes[id]);
    const own = vendorScene.edges.filter((e) => e.source !== e.target && !a.edges[e.id]);
    expect(own.length).toBeGreaterThan(0);
    for (const e of own) expect(b.edges[e.id]?.points.length, `${e.id} has no route`).toBeGreaterThan(1);
    for (const e of vendorScene.edges) if (a.edges[e.id]) expect(b.edges[e.id]).toEqual(a.edges[e.id]);
    expect(b.bounds.width).toBeLessThanOrEqual(a.bounds.width + 1e-6);
  });

  it("also holds for abstracted scenes of the same union", async () => {
    const union = await layoutUnion([globalScene, vendorScene], { engine: "dagre" });
    const coarse = abstract(globalScene, { minEdgeShare: 0.2 });
    const fine = abstract(globalScene, { minEdgeShare: 0.02 });
    const pc = filterPositions(union, coarse);
    const pf = filterPositions(union, fine);
    for (const n of coarse.nodes) expect(pc.nodes[n.id]).toEqual(pf.nodes[n.id]);
  });

  it("differs from independent layouts, which is why the union exists", async () => {
    const union = await unionWithElk();
    const alone = await layout(vendorScene, { engine: "elk" });
    const moved = vendorScene.nodes.filter((n) => alone.nodes[n.id].x !== union.nodes[n.id].x || alone.nodes[n.id].y !== union.nodes[n.id].y);
    expect(moved.length).toBeGreaterThan(0);
  });

  it("builds the union by id with the first definition winning", () => {
    const u = unionGraph([vendorScene, globalScene]);
    expect(u.nodes.length).toBe(globalScene.nodes.length);
    expect(u.edges.length).toBe(globalScene.edges.length);
    expect(u.nodes.find((n) => n.id === "clear_invoice")?.metrics).toBe(vendorScene.nodes.find((n) => n.id === "clear_invoice")?.metrics);
  });
});
