/**
 * Malformed input at the asynchronous functions of the core and Canvas entry
 * points: `layout`, `layoutUnion`, a layout scope, `buildViews` and `toPNG`.
 * Each runs once per malformed case (see `malformed-input.test.ts`); a call
 * settles within the time bound and rejects with nothing but a plain error
 * named below, and positions it returns place every node of the graph in a
 * box of finite numbers and nothing else.
 */
import { describe, expect, it } from "vitest";
import { type FlowGraph, type LayoutOptions, type Positions, LayoutUnavailableError, buildViews, clearLayoutCache, createLayoutScope, layout, layoutUnion } from "../../src/index";
import { toPNG } from "../../src/canvas/index";
import { families } from "../support/graphs";
import { Calls, type MalformedCase, argumentsRecorder, failure, junkCoordinate, junkNumber, junkString, malformedCase, SEARCH_TIMEOUT } from "../support/malformed";
import { caseCount, seeds } from "../support/random";

const CASES = seeds(caseCount(300)).map((seed) => malformedCase(seed, { maxSize: 8 }));

const fail = (message: string): never => expect.fail(message);
function must(ok: boolean, c: MalformedCase, what: () => string): void {
  if (!ok) expect.fail(failure(c, what()));
}

/**
 * The plain errors of a layout. Documented: `LayoutUnavailableError` above the
 * fallback limit, "layout timed out after … ms" for a run longer than
 * `timeoutMs`. Not documented: the engines' own errors on a graph that
 * validation rejects (an edge to a node that does not exist, a node without an
 * id for ELK, a cycle of group parents for Dagre), and Dagre's on a node size
 * that is zero or not finite.
 */
const LAYOUT_ERRORS: readonly RegExp[] = [
  /^LayoutUnavailableError: Dagre fallback not run on the calling thread/,
  /^Error: layout timed out after /,
  /^Error: org\.eclipse\.elk\.graph\.json\.JsonImportException: (Referenced shape does not exist|Id must be a string or an integer)/,
  /^Error: Setting .* as parent of .* would create a cycle$/,
  /^Error: Not possible to find intersection inside of the rectangle$/,
];

const KNOWN: Record<string, readonly RegExp[]> = { layout: LAYOUT_ERRORS, layoutUnion: LAYOUT_ERRORS, createLayoutScope: LAYOUT_ERRORS, buildViews: LAYOUT_ERRORS, toPNG: [] };

const finiteBox = (b: { x: number; y: number; width: number; height: number } | undefined) => !!b && [b.x, b.y, b.width, b.height].every(Number.isFinite);

/** Options a host passes, now and then with junk numbers; `sound` says whether a result must be finite. */
function options(c: MalformedCase): { options: LayoutOptions; sound: boolean } {
  const size = c.rng.chance(0.2) ? { width: junkCoordinate(c.rng, 180), height: junkCoordinate(c.rng, 60) } : undefined;
  const spacing = c.rng.chance(0.2) ? { node: junkCoordinate(c.rng, 28), layer: junkCoordinate(c.rng, 64), group: junkCoordinate(c.rng, 20) } : undefined;
  const timeoutMs = c.rng.chance(0.1) ? junkNumber(c.rng) : undefined;
  const fallbackLimit = c.rng.chance(0.2) ? junkNumber(c.rng) : undefined;
  const sound = [size?.width, size?.height, spacing?.node, spacing?.layer, spacing?.group].every((v) => v === undefined || (v > 0 && v < 1e6));
  return {
    options: {
      engine: c.rng.pick(["elk", "dagre", "auto"] as const),
      direction: c.rng.pick(["RIGHT", "DOWN", "LEFT", "UP"] as const),
      groups: c.rng.pick(["compound", "ignore"] as const),
      orderStages: c.rng.chance(),
      edgeRouting: c.rng.pick(["ORTHOGONAL", "POLYLINE", "SPLINES"] as const),
      nodeSize: size,
      spacing,
      timeoutMs,
      fallbackLimit,
    },
    sound,
  };
}

/** Every node of `graph` in a box of finite numbers, and no box for a node that is not there. */
function placesEvery(c: MalformedCase, name: string, graph: FlowGraph, p: Positions, sound: boolean): void {
  // A cycle of group parents is reported by validation; what a layout does with it is not decided.
  if (c.issues.some((i) => i.message === "group parent cycle")) return;
  const ids = new Set(graph.nodes.map((n) => String(n.id)));
  must(Object.keys(p.nodes).every((id) => ids.has(id)), c, () => `${name} placed a node the graph does not have: ${Object.keys(p.nodes).filter((id) => !ids.has(id))}`);
  if (!sound) return;
  must(graph.nodes.every((n) => finiteBox(p.nodes[n.id])), c, () => `${name} left ${graph.nodes.filter((n) => !finiteBox(p.nodes[n.id])).map((n) => n.id)} without a finite box`);
  must(finiteBox(p.bounds), c, () => `${name} bounds ${JSON.stringify(p.bounds)}`);
  must(Object.values(p.edges).every((r) => r.points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))), c, () => `${name} routed along a point that is not finite`);
}

describe("malformed input at the asynchronous core functions", () => {
  it("layout, layoutUnion, a layout scope and buildViews settle in time with positions of every node or a known error", async () => {
    const calls = new Calls(fail, 20_000);
    // A second scene of its own ids, so that what the union places for the case's graph can be told apart.
    const chain = families.chain(3, 1);
    const other: FlowGraph = { nodes: chain.nodes.map((n) => ({ ...n, id: `other ${n.id}` })), edges: chain.edges.map((e) => ({ ...e, id: `other ${e.id}`, source: `other ${e.source}`, target: `other ${e.target}` })) };
    for (const c of CASES) {
      const { options: o, sound } = options(c);
      const p = await calls.callAsync("layout", c, () => layout(c.graph, o));
      if (p) placesEvery(c, "layout", c.graph, p, sound);
      const union = await calls.callAsync("layoutUnion", c, () => layoutUnion([c.graph, other], { ...o, engine: c.rng.pick(["dagre", "auto"] as const) }));
      if (union) placesEvery(c, "layoutUnion", c.graph, { ...union, nodes: Object.fromEntries(Object.entries(union.nodes).filter(([id]) => !other.nodes.some((n) => n.id === id))) }, sound);
      await calls.callAsync("createLayoutScope", c, async () => {
        const scope = createLayoutScope({ maxEntries: c.rng.pick([0, 1, -1, NaN, 8]) });
        try {
          const scoped = await scope.layout(c.graph, { ...o, engine: "dagre" });
          placesEvery(c, "a scope's layout", c.graph, scoped, sound);
          await scope.layoutUnion([c.graph, other], { ...o, engine: "dagre" });
        } finally {
          scope.dispose();
        }
      });
      await calls.callAsync("buildViews", c, () =>
        buildViews(c.graph, [{ id: "a", label: junkString(c.rng) }, { id: "b", label: "B", overlays: c.graph.overlays }], c.rng.chance() ? { positions: c.positions } : { layout: { ...o, engine: "dagre" }, abstraction: c.rng.chance() ? { minNodeShare: junkNumber(c.rng) } : undefined }),
      );
      if (c.rng.chance(0.05)) clearLayoutCache();
      calls.call("LayoutUnavailableError", c, () => must(new LayoutUnavailableError(c.rng.chance() ? junkString(c.rng) : undefined).name === "LayoutUnavailableError", c, () => "the error's name"));
      const png = argumentsRecorder();
      await calls.callAsync("toPNG", c, () => toPNG({ graph: c.graph, positions: c.positions }, { legend: c.rng.chance(), scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx, convertToBlob: async () => new Blob([]) }) }));
    }
    expect(calls.ranAtLeast(["layout", "layoutUnion", "createLayoutScope", "buildViews", "toPNG", "LayoutUnavailableError"], CASES.length)).toEqual([]);
    expect(calls.unknown(KNOWN), "plain errors that are not documented").toEqual([]);
    if (process.env.WISE_DEEP) console.info(`plain errors over ${CASES.length} cases:\n${calls.report()}`);
  }, SEARCH_TIMEOUT);
});
