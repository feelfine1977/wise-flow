import { describe, expect, it } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { type Box, abstract, clearLayoutCache, coversGraph, filterPositions, layout, layoutUnion, unionGraph } from "../../src/index";

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

  it("caches by key", async () => {
    clearLayoutCache();
    const a = await layout(small, { engine: "dagre", cacheKey: "k" });
    const b = await layout({ nodes: [], edges: [] }, { engine: "dagre", cacheKey: "k" });
    expect(b).toBe(a);
    clearLayoutCache("k");
    const c = await layout({ nodes: [], edges: [] }, { engine: "dagre", cacheKey: "k" });
    expect(Object.keys(c.nodes)).toEqual([]);
  });
});

describe("layoutUnion", () => {
  it("yields identical positions for shared nodes across filtered scenes", async () => {
    const union = await layoutUnion([globalScene, vendorScene], { engine: "elk" });
    const a = filterPositions(union, globalScene);
    const b = filterPositions(union, vendorScene);
    expect(coversGraph(a, globalScene)).toBe(true);
    expect(coversGraph(b, vendorScene)).toBe(true);
    const shared = vendorScene.nodes.map((n) => n.id).filter((id) => a.nodes[id]);
    expect(shared.length).toBe(vendorScene.nodes.length);
    for (const id of shared) expect(b.nodes[id]).toEqual(a.nodes[id]);
    for (const e of vendorScene.edges) if (union.edges[e.id]) expect(b.edges[e.id]).toEqual(a.edges[e.id]);
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
    const union = await layoutUnion([globalScene, vendorScene], { engine: "elk" });
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
