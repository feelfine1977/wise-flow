import { describe, expect, it } from "vitest";
import { type Box, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type LayoutDirection, type Positions, createLayoutScope, createPositions, layout } from "../../src/index";
import { knownLayout } from "../../src/core/layout";
import { type ProvisionalWork, provisionalLayout, reusePositions } from "../../src/core/provisional";

const activity = (id: string, group?: string): FlowNode => ({ id, kind: "activity", label: id.toUpperCase(), ...(group ? { group } : {}) });
const edge = (source: string, target: string): FlowEdge => ({ id: `${source}->${target}`, kind: "follows", source, target });

/** a → b, a → c, b → d, c → d with activities of 180 × 48. */
const diamond: FlowGraph = {
  nodes: ["a", "b", "c", "d"].map((id) => activity(id)),
  edges: [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")],
};

const at = (p: Positions, id: string) => ({ x: p.nodes[id].x, y: p.nodes[id].y });
const inside = (b: Box, outer: Box) => b.x >= outer.x && b.y >= outer.y && b.x + b.width <= outer.x + outer.width && b.y + b.height <= outer.y + outer.height;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("provisional arrangement", () => {
  // Ranks a 0, b and c 1, d 2; columns 180 wide, 64 apart; rank 1 is 48 + 28 + 48 = 124 high and the others are centred on it.
  it("places nodes by longest-path rank along the flow and centres each rank", () => {
    const p = provisionalLayout(diamond);
    expect(p.engine).toBe("provisional");
    expect(p.direction).toBe("RIGHT");
    expect(at(p, "a")).toEqual({ x: 0, y: 38 });
    expect(at(p, "b")).toEqual({ x: 244, y: 0 });
    expect(at(p, "c")).toEqual({ x: 244, y: 76 });
    expect(at(p, "d")).toEqual({ x: 488, y: 38 });
    expect(p.bounds).toEqual({ x: 0, y: 0, width: 668, height: 124 });
  });

  it("respects the flow direction", () => {
    // Down: rows 48 high and 64 apart, rank 1 is 180 + 28 + 180 = 388 wide.
    const down = provisionalLayout(diamond, { direction: "DOWN" });
    expect([at(down, "a"), at(down, "b"), at(down, "c"), at(down, "d")]).toEqual([{ x: 104, y: 0 }, { x: 0, y: 112 }, { x: 208, y: 112 }, { x: 104, y: 224 }]);
    // Left and up mirror the ranks along the flow: 668 and 272 long.
    const left = provisionalLayout(diamond, { direction: "LEFT" });
    expect([at(left, "a"), at(left, "b"), at(left, "d")]).toEqual([{ x: 488, y: 38 }, { x: 244, y: 0 }, { x: 0, y: 38 }]);
    const up = provisionalLayout(diamond, { direction: "UP" });
    expect([at(up, "a"), at(up, "b"), at(up, "d")]).toEqual([{ x: 104, y: 224 }, { x: 0, y: 112 }, { x: 104, y: 0 }]);
    const along: Record<LayoutDirection, (b: Box) => number> = { RIGHT: (b) => b.x, LEFT: (b) => -b.x, DOWN: (b) => b.y, UP: (b) => -b.y };
    for (const direction of ["RIGHT", "LEFT", "DOWN", "UP"] as const) {
      const p = provisionalLayout(diamond, { direction, spacing: { node: 10, layer: 30 } });
      for (const e of diamond.edges) expect(along[direction](p.nodes[e.target])).toBeGreaterThan(along[direction](p.nodes[e.source]));
    }
  });

  it("orders a rank by the mean place of its predecessors", () => {
    // Rank 1 is p, q (input order); rank 2 lists y (after q) before x (after p), the pass puts x first.
    const g: FlowGraph = { nodes: ["s", "p", "q", "y", "x"].map((id) => activity(id)), edges: [edge("s", "p"), edge("s", "q"), edge("q", "y"), edge("p", "x")] };
    const p = provisionalLayout(g);
    expect(p.nodes.x.y).toBeLessThan(p.nodes.y.y);
    expect(p.nodes.p.y).toBeLessThan(p.nodes.q.y);
  });

  it("releases cycles in input order and places every node", () => {
    const g: FlowGraph = { nodes: ["a", "b", "c"].map((id) => activity(id)), edges: [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("b", "b")] };
    const p = provisionalLayout(g);
    expect([p.nodes.a.x, p.nodes.b.x, p.nodes.c.x]).toEqual([0, 244, 488]);
    // Straight routes for every edge between two boxes; none for the self-loop.
    expect(Object.keys(p.edges).sort()).toEqual(["a->b", "b->c", "c->a"]);
    expect(p.edges["a->b"].points).toEqual([{ x: 180, y: 24 }, { x: 244, y: 24 }]);
  });

  it("keeps stages in their order, each a box around its members", () => {
    // Start → [a → b] → [c → d] → end. The map's ranks: start, stage 1, stage 2, end. A stage holds two
    // ranks of one activity: 180 + 64 + 180 + 40 = 464 wide, 48 + 64 = 112 high; events are 36 square.
    const g: FlowGraph = {
      nodes: [{ id: "start", kind: "event", label: "Start" }, activity("a", "s1"), activity("b", "s1"), activity("c", "s2"), activity("d", "s2"), { id: "end", kind: "event", label: "End" }],
      edges: [edge("start", "a"), edge("a", "b"), edge("b", "c"), edge("c", "d"), edge("d", "end"), edge("d", "a")],
      groups: [{ id: "s1", kind: "stage", label: "S1" }, { id: "s2", kind: "stage", label: "S2" }],
    };
    const p = provisionalLayout(g);
    expect(p.groups.s1).toEqual({ x: 100, y: 0, width: 464, height: 112 });
    expect(p.groups.s2).toEqual({ x: 628, y: 0, width: 464, height: 112 });
    expect(at(p, "start")).toEqual({ x: 0, y: 38 });
    expect(at(p, "a")).toEqual({ x: 120, y: 44 });
    expect(at(p, "b")).toEqual({ x: 364, y: 44 });
    expect(at(p, "c")).toEqual({ x: 648, y: 44 });
    expect(at(p, "d")).toEqual({ x: 892, y: 44 });
    expect(at(p, "end")).toEqual({ x: 1156, y: 38 });
    // Without stage ordering a stage that only leads back is not held after the others.
    const back: FlowGraph = { ...g, edges: [edge("c", "a")] };
    expect(provisionalLayout(back).groups.s2.x).toBeGreaterThan(provisionalLayout(back).groups.s1.x);
    expect(provisionalLayout(back, { orderStages: false }).groups.s2.x).toBeLessThan(provisionalLayout(back, { orderStages: false }).groups.s1.x);
    // Groups ignored: no boxes, the nodes ranked on the map.
    expect(provisionalLayout(g, { groups: "ignore" }).groups).toEqual({});
  });

  it("keeps nested groups contiguous: no box holds a node or box of another group", () => {
    const g = seeded(300, 2.5, 7);
    for (const direction of ["RIGHT", "DOWN"] as const) {
      const p = provisionalLayout(g, { direction });
      expect(Object.keys(p.nodes)).toHaveLength(g.nodes.length);
      const byId = new Map(g.groups!.map((x) => [x.id, x]));
      const chain = (id: string | undefined) => {
        const out: string[] = [];
        for (let c = id; c; c = byId.get(c)?.parent) out.push(c);
        return out;
      };
      const groupIds = Object.keys(p.groups);
      expect(groupIds.sort()).toEqual(g.groups!.map((x) => x.id).sort());
      for (const n of g.nodes) {
        const own = chain(n.group);
        for (const id of groupIds) {
          if (own.includes(id)) expect(inside(p.nodes[n.id], p.groups[id])).toBe(true);
          else expect(overlaps(p.nodes[n.id], p.groups[id])).toBe(false);
        }
      }
      for (const a of groupIds) {
        for (const b of groupIds) {
          if (a === b) continue;
          if (chain(a).includes(b)) expect(inside(p.groups[a], p.groups[b])).toBe(true);
          else if (!chain(b).includes(a)) expect(overlaps(p.groups[a], p.groups[b])).toBe(false);
        }
      }
      // No two nodes overlap.
      const boxes = Object.values(p.nodes).sort((a, b) => a.x - b.x);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length && boxes[j].x < boxes[i].x + boxes[i].width; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
      // Every edge between two nodes has a route.
      for (const e of g.edges) if (e.source !== e.target) expect(p.edges[e.id]?.points).toHaveLength(2);
    }
  });

  it("places groups whose parents lead back to them on the map", () => {
    const g: FlowGraph = {
      nodes: [activity("a", "x"), activity("b", "y"), activity("c")],
      edges: [edge("a", "b"), edge("b", "c")],
      groups: [{ id: "x", kind: "lane", label: "X", parent: "y" }, { id: "y", kind: "lane", label: "Y", parent: "x" }, { id: "empty", kind: "lane", label: "E" }],
    };
    const p = provisionalLayout(g);
    // x is cut loose and holds y, which holds b; the empty group has no box.
    expect(Object.keys(p.nodes).sort()).toEqual(["a", "b", "c"]);
    expect(Object.keys(p.groups).sort()).toEqual(["x", "y"]);
    expect(inside(p.groups.y, p.groups.x)).toBe(true);
    expect(inside(p.nodes.b, p.groups.y)).toBe(true);
    expect(overlaps(p.nodes.c, p.groups.x)).toBe(false);
  });

  it("is deterministic", () => {
    const g = seeded(200, 3, 11);
    expect(provisionalLayout(g)).toEqual(provisionalLayout(structuredClone(g)));
  });

  it("does work linear in nodes plus edges", () => {
    const steps = (g: FlowGraph) => {
      const work: ProvisionalWork = { steps: 0 };
      provisionalLayout(g, {}, work);
      return work.steps;
    };
    const shapes: [string, (n: number) => FlowGraph][] = [
      ["dense layered graph with nested groups", (n) => seeded(n, 6, 3)],
      ["chain with edges back to the start", (n) => ({ nodes: range(n).map((i) => activity(`n${i}`)), edges: range(n - 1).flatMap((i) => [edge(`n${i}`, `n${i + 1}`), edge(`n${i + 1}`, "n0")]) })],
      ["hub with every node before and after it", (n) => ({ nodes: [activity("hub"), ...range(n).map((i) => activity(`n${i}`))], edges: range(n).flatMap((i) => [edge(`n${i}`, "hub"), edge("hub", `n${i}`)]) })],
      ["rings that only cycles connect", (n) => ({ nodes: range(n).map((i) => activity(`n${i}`)), edges: range(n).map((i) => edge(`n${i}`, `n${i - (i % 4) + ((i + 1) % 4)}`)) })],
    ];
    for (const [name, make] of shapes) {
      const small = make(4000);
      const large = make(8000);
      const ratio = steps(large) / steps(small);
      expect(ratio, name).toBeGreaterThan(1.8);
      expect(ratio, name).toBeLessThan(2.2);
      // A few steps per element, not per pair of them.
      expect(steps(large), name).toBeLessThan(12 * (large.nodes.length + large.edges.length));
    }
  });
});

describe("reused positions", () => {
  const before = createPositions(
    { nodes: { a: { x: 0, y: 0, width: 180, height: 48 }, b: { x: 300, y: 0, width: 180, height: 48 } }, groups: {}, edges: { "a->b": { points: [{ x: 180, y: 24 }, { x: 300, y: 24 }] } } },
    "elk",
    "RIGHT",
  );

  it("keeps surviving nodes and their routes and puts new nodes beside their neighbours", () => {
    const g: FlowGraph = { nodes: ["a", "b", "c", "d", "z"].map((id) => activity(id)), edges: [edge("a", "b"), edge("b", "c"), edge("b", "d"), edge("z", "a")] };
    const p = reusePositions(g, before)!;
    expect(p.engine).toBe("provisional");
    expect(p.nodes.a).toEqual(before.nodes.a);
    expect(p.nodes.b).toEqual(before.nodes.b);
    expect(p.edges["a->b"]).toBe(before.edges["a->b"]);
    // The provisional arrangement of the new graph has z (0, 38), a (244, 38), b (488, 38), c (732, 0), d (732, 76).
    // z is reached from a and keeps its offset from it (-244, 0); c and d from b (+244, -38 and +38).
    expect(at(p, "z")).toEqual({ x: -244, y: 0 });
    expect(at(p, "c")).toEqual({ x: 544, y: -38 });
    expect(at(p, "d")).toEqual({ x: 544, y: 38 });
    expect(p.edges["b->c"].points).toHaveLength(2);
  });

  it("keeps a survivor's centre when its size changes, and places unconnected nodes by the first survivor", () => {
    const g: FlowGraph = { nodes: [activity("a"), activity("q"), activity("r")], edges: [edge("q", "r")] };
    const p = reusePositions(g, before, { nodeSize: { width: 100, height: 40 } })!;
    expect(p.nodes.a).toEqual({ x: 40, y: 4, width: 100, height: 40 });
    // Provisionally a (0, 0) and q (0, 68) share rank 0, r is at (164, 34); a moved by (40, 4) and so do q and r.
    expect(at(p, "q")).toEqual({ x: 40, y: 72 });
    expect(at(p, "r")).toEqual({ x: 204, y: 38 });
  });

  it("encloses groups and keeps an earlier group box that still holds its members", () => {
    const grouped = createPositions({ ...before, groups: { s: { x: -20, y: -44, width: 520, height: 112 } } }, "elk", "RIGHT");
    const g: FlowGraph = { nodes: [activity("a", "s"), activity("b", "s"), activity("c", "t")], edges: [edge("b", "c")], groups: [{ id: "s", kind: "stage", label: "S" }, { id: "t", kind: "stage", label: "T" }] };
    const p = reusePositions(g, grouped)!;
    expect(p.groups.s).toBe(grouped.groups.s);
    // Provisionally b is at (20, 120) in stage s and c at (304, 82) in stage t: c keeps that offset from b.
    expect(at(p, "c")).toEqual({ x: 584, y: -38 });
    expect(p.groups.t).toEqual({ x: 564, y: -82, width: 220, height: 112 });
    expect(reusePositions(g, grouped, { groups: "ignore" })!.groups).toEqual({});
  });

  it("is undefined when no node survives", () => {
    expect(reusePositions({ nodes: [activity("p"), activity("q")], edges: [edge("p", "q")] }, before)).toBeUndefined();
  });
});

describe("known layouts", () => {
  it("returns a scope's finished layout for the same inputs without computing", async () => {
    const scope = createLayoutScope();
    expect(knownLayout(scope, diamond, { engine: "dagre" })).toBeUndefined();
    const pending = scope.layout(diamond, { engine: "dagre" });
    expect(knownLayout(scope, diamond, { engine: "dagre" })).toBeUndefined();
    const done = await pending;
    expect(knownLayout(scope, diamond, { engine: "dagre" })).toBe(done);
    expect(knownLayout(scope, diamond, { engine: "dagre", direction: "DOWN" })).toBeUndefined();
    expect(knownLayout(createLayoutScope(), diamond, { engine: "dagre" })).toBeUndefined();
    scope.dispose();
    expect(knownLayout(scope, diamond, { engine: "dagre" })).toBeUndefined();
  });

  it("reads a caller key's finished layout", async () => {
    const scope = createLayoutScope();
    const options = { engine: "dagre" as const, cacheKey: "provisional-test" };
    const done = await layout(diamond, options);
    expect(knownLayout(scope, { nodes: [], edges: [] }, options)).toBe(done);
    expect(knownLayout(scope, diamond, { ...options, cacheKey: "unknown" })).toBeUndefined();
  });
});

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** A seeded layered graph with stages, nested lanes, ungrouped events, edges back and self-loops. */
function seeded(n: number, degree: number, seed: number): FlowGraph {
  let s = seed;
  const random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const stages = Math.max(2, Math.round(Math.sqrt(n) / 3));
  const groups: FlowGroup[] = [];
  for (let k = 0; k < stages; k++) {
    groups.push({ id: `stage${k}`, kind: "stage", label: `Stage ${k}` });
    groups.push({ id: `lane${k}`, kind: "lane", label: `Lane ${k}`, parent: `stage${k}` });
  }
  const nodes: FlowNode[] = range(n).map((i) => {
    const k = Math.floor((i / n) * stages);
    return i % 17 === 0 ? { id: `e${i}`, kind: "event", label: "E" } : activity(`n${i}`, i % 3 === 0 ? `lane${k}` : `stage${k}`);
  });
  const edges: FlowEdge[] = [];
  for (let i = 0; i < n * degree; i++) {
    const a = Math.floor(random() * n);
    const b = random() < 0.85 ? Math.min(n - 1, a + 1 + Math.floor(random() * 12)) : Math.floor(random() * n);
    edges.push({ id: `x${i}`, kind: "follows", source: nodes[a].id, target: nodes[b].id });
  }
  return { nodes, edges, groups };
}
