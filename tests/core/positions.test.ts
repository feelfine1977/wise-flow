import { describe, expect, it } from "vitest";
import {
  type Box,
  type FlowGraph,
  type Positions,
  createPositions,
  filterPositions,
  laneBands,
  layout,
  repositionNodes,
  unionBoxes,
} from "../../src/index";
import { exportBpmn, importBpmn, layoutBpmn } from "../../src/bpmn/index";

/** Deterministic pseudo-random numbers in [0, 1) (LCG). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * A connected chain with random extra edges. `stages` puts the nodes into stage
 * groups, one of them nested in another; `lanes` into lanes of a pool, one of
 * them split into two sub-lanes.
 */
function randomGraph(seed: number, kind: "stages" | "lanes"): FlowGraph {
  const r = rng(seed);
  const n = 5 + Math.floor(r() * 8);
  const groups: FlowGraph["groups"] =
    kind === "stages"
      ? [
          { id: "s1", kind: "stage", label: "Stage 1" },
          { id: "s2", kind: "stage", label: "Stage 2" },
          { id: "s2a", kind: "stage", label: "Stage 2a", parent: "s2" },
          { id: "s3", kind: "stage", label: "Stage 3" },
        ]
      : [
          { id: "pool", kind: "pool", label: "Pool" },
          { id: "l1", kind: "lane", label: "Lane 1", parent: "pool" },
          { id: "l2", kind: "lane", label: "Lane 2", parent: "pool" },
          { id: "l2a", kind: "lane", label: "Lane 2a", parent: "l2" },
          { id: "l2b", kind: "lane", label: "Lane 2b", parent: "l2" },
        ];
  const homes = kind === "stages" ? ["s1", "s2", "s2a", "s3"] : ["l1", "l2a", "l2b"];
  const nodes: FlowGraph["nodes"] = [];
  for (let i = 0; i < n; i++) {
    const home = homes[Math.min(homes.length - 1, Math.floor((i / n) * homes.length + r() * 0.8))];
    nodes.push({ id: `n${i}`, kind: "activity", label: `Activity ${i}`, group: home, metrics: { cases: 10 + Math.floor(r() * 90) } });
  }
  const edges: FlowGraph["edges"] = [];
  for (let i = 1; i < n; i++) edges.push({ id: `e${i - 1}-${i}`, kind: "follows", source: `n${i - 1}`, target: `n${i}`, metrics: { count: 1 + Math.floor(r() * 50) } });
  for (let k = 0; k < n / 2; k++) {
    const a = Math.floor(r() * n);
    const b = Math.floor(r() * n);
    if (a !== b && !edges.some((e) => e.source === `n${a}` && e.target === `n${b}`)) {
      edges.push({ id: `x${a}-${b}`, kind: "follows", source: `n${a}`, target: `n${b}`, metrics: { count: 1 + Math.floor(r() * 20) } });
    }
  }
  return { nodes, edges, groups };
}

/** Bounds of everything the positions hold, derived here without library helpers. */
function expectedBounds(p: Positions): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const b of [...Object.values(p.nodes), ...Object.values(p.groups)]) {
    xs.push(b.x, b.x + b.width);
    ys.push(b.y, b.y + b.height);
  }
  for (const route of Object.values(p.edges)) {
    for (const pt of route.points) {
      xs.push(pt.x);
      ys.push(pt.y);
    }
  }
  if (!xs.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function expectBoundsMatch(p: Positions, what: string) {
  const want = expectedBounds(p);
  for (const k of ["x", "y", "width", "height"] as const) expect(p.bounds[k], `${what}: bounds.${k}`).toBeCloseTo(want[k], 9);
}

const SEEDS = [1, 2, 3, 4, 5, 6];

describe("positions keep bounds that match their contents", () => {
  it.each(SEEDS)("after layout, lane bands, reposition and filtering (stages, seed %i)", async (seed) => {
    const g = randomGraph(seed, "stages");
    for (const engine of ["elk", "dagre"] as const) {
      const laid = await layout(g, { engine });
      expectBoundsMatch(laid, `${engine} layout`);
      const banded = laneBands(g, laid, { lanes: "stages" }).positions;
      expectBoundsMatch(banded, `${engine} stage bands`);
      const moved = repositionNodes(g, banded, { n0: { x: banded.nodes.n0.x - 400, y: banded.nodes.n0.y + 300 } });
      expect(moved).not.toBe(banded);
      expectBoundsMatch(moved, `${engine} reposition`);
      const part = filterPositions(laid, { ...g, nodes: g.nodes.slice(0, 3), edges: g.edges.slice(0, 2), groups: g.groups?.slice(0, 1) });
      expectBoundsMatch(part, `${engine} filtered`);
    }
  });

  it.each(SEEDS)("after role bands, BPMN layout and BPMN import (lanes, seed %i)", async (seed) => {
    const g = randomGraph(seed, "lanes");
    const laid = await layout(g, { engine: "elk" });
    const roles = laneBands(g, laid, { lanes: "roles" }).positions;
    expectBoundsMatch(roles, "role bands");
    const last = `n${g.nodes.length - 1}`;
    expectBoundsMatch(repositionNodes(g, roles, { [last]: { x: -250, y: -120 } }), "reposition in role bands");
    const bpmn = await layoutBpmn(g);
    expectBoundsMatch(bpmn, "BPMN layout");
    const exported = await exportBpmn(g, { positions: bpmn });
    const imported = await importBpmn(exported.xml);
    expect(imported.positions).toBeDefined();
    expect(Object.keys(imported.positions!.nodes).length).toBe(g.nodes.length);
    expectBoundsMatch(imported.positions!, "BPMN import");
  });

  it("creates positions with bounds over nodes, groups and routes", () => {
    const p = createPositions(
      {
        nodes: { a: { x: 10, y: 20, width: 30, height: 10 } },
        groups: { g: { x: 0, y: 15, width: 50, height: 20 } },
        edges: { e: { points: [{ x: 40, y: 25 }, { x: 70, y: -5 }] } },
      },
      "given",
      "DOWN",
    );
    // x from the group (0) to the route's end (70); y from the route (-5) to the group's bottom (35).
    expect(p.bounds).toEqual({ x: 0, y: -5, width: 70, height: 40 });
    expect(p.engine).toBe("given");
    expect(p.direction).toBe("DOWN");
    expect(createPositions({ nodes: {}, groups: {}, edges: {} }, "elk", "RIGHT").bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("unionBoxes", () => {
  it("encloses every box and ignores boxes without a valid size", () => {
    expect(unionBoxes([{ x: 2, y: 3, width: 4, height: 5 }, { x: -1, y: 6, width: 2, height: 10 }])).toEqual({ x: -1, y: 3, width: 7, height: 13 });
    // A zero-size box still counts as a point; negative and NaN sizes do not.
    expect(unionBoxes([{ x: 5, y: 5, width: 0, height: 0 }, { x: 8, y: 9, width: 1, height: 1 }])).toEqual({ x: 5, y: 5, width: 4, height: 5 });
    expect(unionBoxes([{ x: 100, y: 100, width: -1, height: 3 }, { x: 0, y: 0, width: Number.NaN, height: 1 }, { x: 1, y: 2, width: 3, height: 4 }])).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(unionBoxes([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
