import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay, MAP_TARGET, validateGraph } from "../../src/index";
import type { View } from "../../src/canvas/index";
import { type FamilyName, type InvalidFamilyName, OVERLAY_KINDS, componentCount, families, invalidFamilies, layerOf } from "../support/graphs";
import { caseSettled, eachCase } from "../support/malformed";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { POSITION_KINDS, SIDES, VIEWPORT_KINDS, brokenPositionsOf, oddPositionsOf, positionsOf, viewportAtSide, viewportsOf } from "../support/scenes";
import { interleave, schedule } from "../support/schedules";

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIZES = [0, 1, 2, 3, 7, 24, 60];
const familyNames = Object.keys(families) as FamilyName[];
const invalidNames = Object.keys(invalidFamilies) as InvalidFamilyName[];

// ---------------------------------------------------------------------------
// Naive graph questions, written here and shared with nothing under src/.

/** Depth-first search with colours; a self-loop is a cycle. */
function hasCycle(g: FlowGraph): boolean {
  const next = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) next.get(e.source)?.push(e.target);
  const colour = new Map<string, 1 | 2>();
  const visit = (id: string): boolean => {
    const c = colour.get(id);
    if (c === 1) return true;
    if (c === 2) return false;
    colour.set(id, 1);
    for (const t of next.get(id) ?? []) if (visit(t)) return true;
    colour.set(id, 2);
    return false;
  };
  return g.nodes.some((n) => visit(n.id));
}

/** Weakly connected components by repeated flooding. */
function componentsOf(g: FlowGraph): string[][] {
  const adj = new Map<string, Set<string>>(g.nodes.map((n) => [n.id, new Set()]));
  for (const e of g.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of g.nodes) {
    if (seen.has(n.id)) continue;
    const comp: string[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const m of adj.get(id)!) if (!seen.has(m)) {
        seen.add(m);
        stack.push(m);
      }
    }
    out.push(comp);
  }
  return out;
}

function reachable(g: FlowGraph, from: string): Set<string> {
  const next = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) next.get(e.source)?.push(e.target);
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length) for (const t of next.get(stack.pop()!) ?? []) if (!seen.has(t)) {
    seen.add(t);
    stack.push(t);
  }
  return seen;
}

const degrees = (g: FlowGraph) => {
  const inn = new Map<string, number>();
  const out = new Map<string, number>();
  for (const e of g.edges) {
    inn.set(e.target, (inn.get(e.target) ?? 0) + 1);
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
  }
  return { inn, out };
};

const index = (id: string) => Number(id.slice(1));

/** JSON that tells `NaN`, `Infinity`, `-Infinity` and `undefined` apart, which `JSON.stringify` writes alike or drops. */
const exact = (value: unknown) => JSON.stringify(value, (_, v) => (v === undefined ? "undefined" : typeof v === "number" && !Number.isFinite(v) ? String(v) : v));

// ---------------------------------------------------------------------------

describe("the seeded random stream", () => {
  it("is the same stream for the same seed and another for the next seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const c = createRandom(43);
    const draws = (r: typeof a) => Array.from({ length: 20 }, () => r.next());
    const first = draws(a);
    expect(draws(b)).toEqual(first);
    expect(draws(c)).not.toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("draws integers on both ends of a range, picks, samples distinct and shuffles a permutation", () => {
    const r = createRandom(7);
    const ints = Array.from({ length: 500 }, () => r.int(3, 6));
    expect(new Set(ints)).toEqual(new Set([3, 4, 5, 6]));
    expect(r.int(5, 5)).toBe(5);
    const items = ["a", "b", "c", "d", "e"];
    for (let i = 0; i < 50; i++) expect(items).toContain(r.pick(items));
    const shuffled = r.shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d", "e"]);
    const sample = r.sample(items, 3);
    expect(sample).toHaveLength(3);
    expect(new Set(sample).size).toBe(3);
    expect(r.sample(items, 9)).toHaveLength(5);
    expect(() => r.pick([])).toThrow(/empty/);
    expect(() => r.int(2, 1)).toThrow(/below/);
  });

  it("chooses by weight, never an entry of weight zero, and about three to one for weights three and one", () => {
    const r = createRandom(11);
    const counts = { heavy: 0, light: 0, never: 0 };
    for (let i = 0; i < 4000; i++) counts[r.weighted([["heavy", 3], ["light", 1], ["never", 0]] as const)]++;
    expect(counts.never).toBe(0);
    expect(counts.heavy / counts.light).toBeGreaterThan(2.4);
    expect(counts.heavy / counts.light).toBeLessThan(3.6);
    expect(() => r.weighted([["x", 0]])).toThrow(/positive weight/);
    expect(() => r.weighted([["x", -1]])).toThrow(/negative/);
  });

  it("forks a stream that depends on the parent's seed only", () => {
    const one = createRandom(5).fork();
    const two = createRandom(5).fork();
    expect(one.seed).toBe(two.seed);
    expect(one.next()).toBe(two.next());
    expect(() => createRandom(1.5)).toThrow(/integer/);
  });
});

describe("the deep-mode convention", () => {
  const saved = { deep: process.env.WISE_DEEP, seed: process.env.WISE_SEED };
  afterEach(() => {
    if (saved.deep === undefined) delete process.env.WISE_DEEP;
    else process.env.WISE_DEEP = saved.deep;
    if (saved.seed === undefined) delete process.env.WISE_SEED;
    else process.env.WISE_SEED = saved.seed;
  });

  it("runs the base count by default, fifty times as many with WISE_DEEP=1 and more with a larger factor", () => {
    delete process.env.WISE_DEEP;
    expect(caseCount(20)).toBe(20);
    process.env.WISE_DEEP = "0";
    expect(caseCount(20)).toBe(20);
    process.env.WISE_DEEP = "1";
    expect(caseCount(20)).toBe(1000);
    process.env.WISE_DEEP = "true";
    expect(caseCount(20)).toBe(1000);
    process.env.WISE_DEEP = "3";
    expect(caseCount(20)).toBe(3000);
  });

  it("starts the seeds at 1, or at WISE_SEED to replay one case, and names the seed in the case label", () => {
    delete process.env.WISE_SEED;
    expect(seeds(3)).toEqual([1, 2, 3]);
    process.env.WISE_SEED = "4711";
    expect(seeds(2)).toEqual([4711, 4712]);
    process.env.WISE_SEED = "not a number";
    expect(seeds(1)).toEqual([1]);
    expect(caseLabel(9, "step 3")).toBe("seed 9 (step 3); replay with WISE_SEED=9");
  });

  it("stops a search over cases at the next case once its test is aborted, and says when the case in flight has ended", async () => {
    const controller = new AbortController();
    const ran: number[] = [];
    let release = () => {};
    const search = eachCase([1, 2, 3], controller.signal, async (c) => {
      ran.push(c);
      // The test times out while case 2 is in flight.
      if (c === 2) {
        controller.abort(new Error("timed out"));
        await new Promise<void>((resolve) => (release = resolve));
      }
    });
    await Promise.resolve();
    let settled = false;
    const waiting = caseSettled().then(() => (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    release();
    await waiting;
    await expect(search).rejects.toThrow("timed out");
    expect(ran).toEqual([1, 2]);
  });
});

describe("every family is deterministic for a seed", () => {
  it.each(familyNames)("%s", (name) => {
    const family = families[name];
    for (const seed of SEEDS) {
      const a = JSON.stringify(family(30, seed));
      expect(JSON.stringify(family(30, seed)), caseLabel(seed, name)).toBe(a);
      expect(JSON.stringify(family(30, seed + 1)), caseLabel(seed, `${name} differs from the next seed`)).not.toBe(a);
      expect(JSON.stringify(family(30, seed, { mixedKinds: true })), caseLabel(seed, `${name} mixed kinds`)).toBe(JSON.stringify(family(30, seed, { mixedKinds: true })));
    }
    for (const size of SIZES) expect(() => family(size, 1)).not.toThrow();
    expect(() => family(-1, 1)).toThrow(/non-negative/);
  });

  it.each(invalidNames)("%s (invalid)", (name) => {
    for (const seed of SEEDS) {
      const a = exact(invalidFamilies[name](20, seed));
      expect(exact(invalidFamilies[name](20, seed)), caseLabel(seed, name)).toBe(a);
      expect(exact(invalidFamilies[name](20, seed + 1)), caseLabel(seed, `${name} differs from the next seed`)).not.toBe(a);
    }
  });
});

describe("every valid family validates, has unique ids and sound metrics", () => {
  it.each(familyNames)("%s", (name) => {
    for (const seed of SEEDS) {
      for (const size of SIZES) {
        for (const options of [{}, { mixedKinds: true }, { scale: 1000 }]) {
          const g = families[name](size, seed, options);
          const label = caseLabel(seed, `${name} size ${size} ${JSON.stringify(options)}`);
          expect(validateGraph(g), label).toEqual([]);
          expect(new Set(g.nodes.map((n) => n.id)).size, label).toBe(g.nodes.length);
          expect(new Set(g.edges.map((e) => e.id)).size, label).toBe(g.edges.length);
          for (const n of g.nodes) {
            expect(n.label.length, label).toBeGreaterThan(0);
            if (n.kind === "activity") expect(n.metrics!.cases, label).toBeGreaterThanOrEqual(options.scale ?? 1);
            for (const v of Object.values(n.metrics ?? {})) expect(Number.isFinite(v) && v >= 0, label).toBe(true);
          }
          for (const e of g.edges) {
            expect(g.nodes.some((n) => n.id === e.source) && g.nodes.some((n) => n.id === e.target), label).toBe(true);
            if (e.kind === "follows") {
              expect(e.metrics!.count, label).toBeGreaterThanOrEqual(e.metrics!.cases);
              expect(e.metrics!.cases, label).toBeGreaterThanOrEqual(1);
              if (e.metrics!.violationShare !== undefined) expect(e.metrics!.violationShare, label).toBeLessThanOrEqual(1);
            }
            for (const v of Object.values(e.metrics ?? {})) expect(Number.isFinite(v) && v >= 0, label).toBe(true);
          }
        }
      }
    }
  });

  it("puts a start and an end event around a graph of mixed kinds", () => {
    for (const seed of SEEDS) {
      const g = families.chain(12, seed, { mixedKinds: true });
      const label = caseLabel(seed);
      expect(g.nodes[0], label).toMatchObject({ id: "start", kind: "event", tags: ["start"] });
      expect(g.nodes.at(-1), label).toMatchObject({ id: "end", kind: "event", tags: ["end"] });
      expect(g.edges.some((e) => e.source === "start" && e.target === "n0"), label).toBe(true);
      expect(g.edges.some((e) => e.source === "n11" && e.target === "end"), label).toBe(true);
      expect(new Set(g.nodes.map((n) => n.kind)).size, label).toBeGreaterThan(1);
      for (const n of g.nodes) if (n.kind === "gateway") expect(["xor", "and", "or"]).toContain(n.tags?.[0]);
    }
  });

  it("scales counts without changing the shape", () => {
    const plain = families.layered(30, 3);
    const big = families.layered(30, 3, { scale: 10_000 });
    expect(big.edges.map((e) => e.id)).toEqual(plain.edges.map((e) => e.id));
    expect(Math.max(...big.nodes.map((n) => n.metrics!.cases))).toBeGreaterThanOrEqual(1e6);
  });
});

describe("the defining property of each family", () => {
  it("chain: a path through every node with no branching and no cycle", () => {
    for (const seed of SEEDS) for (const n of [1, 2, 9, 40]) {
      const g = families.chain(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      expect(g.nodes, label).toHaveLength(n);
      expect(g.edges, label).toHaveLength(n - 1);
      const { inn, out } = degrees(g);
      for (const node of g.nodes) {
        expect(inn.get(node.id) ?? 0, label).toBeLessThanOrEqual(1);
        expect(out.get(node.id) ?? 0, label).toBeLessThanOrEqual(1);
      }
      expect(hasCycle(g), label).toBe(false);
      expect(componentsOf(g), label).toHaveLength(1);
      expect(reachable(g, "n0").size, label).toBe(n);
    }
  });

  it("layered: acyclic, every edge goes to a later layer, every node beyond the first layer has a predecessor in the layer before", () => {
    for (const seed of SEEDS) for (const n of [1, 2, 5, 30, 100]) {
      const g = families.layered(n, seed);
      const layer = layerOf(n);
      const label = caseLabel(seed, `size ${n}`);
      expect(hasCycle(g), label).toBe(false);
      for (const e of g.edges) expect(layer(index(e.source)), label).toBeLessThan(layer(index(e.target)));
      for (const node of g.nodes) {
        if (layer(index(node.id)) === 0) continue;
        expect(g.edges.some((e) => e.target === node.id && layer(index(e.source)) === layer(index(node.id)) - 1), label).toBe(true);
      }
      expect(Math.max(0, ...g.nodes.map((x) => layer(index(x.id)))) + 1, label).toBe(n ? Math.max(1, Math.round(Math.sqrt(n))) : 1);
    }
  });

  it("tree: n − 1 edges, one predecessor per node but the root, the root reaches all", () => {
    for (const seed of SEEDS) for (const n of [1, 2, 6, 50]) {
      const g = families.tree(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      expect(g.edges, label).toHaveLength(n - 1);
      const { inn } = degrees(g);
      expect(inn.get("n0") ?? 0, label).toBe(0);
      for (const node of g.nodes) if (node.id !== "n0") expect(inn.get(node.id), label).toBe(1);
      for (const e of g.edges) expect(index(e.source), label).toBeLessThan(index(e.target));
      expect(reachable(g, "n0").size, label).toBe(n);
      expect(hasCycle(g), label).toBe(false);
    }
  });

  it("cyclic: a ring through every node, at least one self-loop and at most a third of the nodes looping", () => {
    for (const seed of SEEDS) for (const n of [1, 2, 3, 9, 50]) {
      const g = families.cyclic(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      expect(hasCycle(g), label).toBe(true);
      const loops = g.edges.filter((e) => e.source === e.target);
      expect(loops.length, label).toBeGreaterThanOrEqual(1);
      expect(loops.length, label).toBeLessThanOrEqual(Math.max(1, Math.ceil(n / 3)));
      for (let i = 0; i < n; i++) expect(g.edges.some((e) => e.source === `n${i}` && e.target === `n${(i + 1) % n}`), label).toBe(true);
      expect(componentsOf(g), label).toHaveLength(1);
    }
  });

  it("hub: n0 touches every node and every edge touches n0", () => {
    for (const seed of SEEDS) for (const n of [1, 2, 7, 40]) {
      const g = families.hub(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      for (const e of g.edges) expect(e.source === "n0" || e.target === "n0", label).toBe(true);
      for (const node of g.nodes) if (node.id !== "n0") expect(g.edges.some((e) => (e.source === "n0" && e.target === node.id) || (e.target === "n0" && e.source === node.id)), label).toBe(true);
      expect(g.edges.some((e) => e.source === e.target), label).toBe(false);
      if (n > 1) expect(componentsOf(g), label).toHaveLength(1);
    }
  });

  it("components: exactly the announced number of pieces, at least two", () => {
    for (const seed of SEEDS) for (const n of [0, 1, 2, 3, 10, 61]) {
      const g = families.components(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      const k = componentCount(n, seed);
      if (n >= 2) expect(k, label).toBeGreaterThanOrEqual(2);
      expect(componentsOf(g), label).toHaveLength(k);
      expect(hasCycle(g), label).toBe(false);
    }
  });

  it("stages: flat stage groups in layer order that hold every node", () => {
    for (const seed of SEEDS) for (const n of [1, 4, 30]) {
      const g = families.stages(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      expect(g.groups!.every((x) => x.kind === "stage" && x.parent === undefined), label).toBe(true);
      const order = new Map(g.groups!.map((x, i) => [x.id, i]));
      let last = 0;
      for (const node of g.nodes) {
        expect(order.has(node.group!), label).toBe(true);
        expect(order.get(node.group!)!, label).toBeGreaterThanOrEqual(last);
        last = order.get(node.group!)!;
      }
      for (const e of g.edges) expect(order.get(g.nodes.find((x) => x.id === e.source)!.group!)!, label).toBeLessThan(order.get(g.nodes.find((x) => x.id === e.target)!.group!)!);
    }
  });

  it("lanes: two to five lanes of one pool with every node in a lane", () => {
    for (const seed of SEEDS) {
      const g = families.lanes(30, seed);
      const label = caseLabel(seed);
      const pools = g.groups!.filter((x) => x.kind === "pool");
      const lanes = g.groups!.filter((x) => x.kind === "lane");
      expect(pools, label).toHaveLength(1);
      expect(lanes.length, label).toBeGreaterThanOrEqual(2);
      expect(lanes.length, label).toBeLessThanOrEqual(5);
      expect(lanes.every((l) => l.parent === pools[0].id), label).toBe(true);
      const laneIds = new Set(lanes.map((l) => l.id));
      for (const node of g.nodes) expect(laneIds.has(node.group!), label).toBe(true);
    }
  });

  it("nested: groups with a parent, a lane two levels down, nodes in a nested stage, and no parent cycle", () => {
    let nestedMembers = 0;
    for (const seed of SEEDS) {
      const g = families.nested(40, seed);
      const label = caseLabel(seed);
      const byId = new Map(g.groups!.map((x) => [x.id, x]));
      const depth = (id: string): number => {
        let d = 0;
        const seen = new Set<string>();
        for (let cur = byId.get(id); cur?.parent; cur = byId.get(cur.parent)) {
          expect(seen.has(cur.id), `${label}: parent cycle`).toBe(false);
          seen.add(cur.id);
          d++;
        }
        return d;
      };
      expect(Math.max(...g.groups!.map((x) => depth(x.id))), label).toBe(2);
      expect(g.groups!.some((x) => x.kind === "stage" && x.parent && byId.get(x.parent)?.kind === "stage"), label).toBe(true);
      for (const node of g.nodes) if (depth(node.group!) > 0) nestedMembers++;
    }
    expect(nestedMembers).toBeGreaterThan(0);
  });

  it("overlaid: one overlay of every kind, on existing targets, with a map chip and a reverse arc on a real back edge", () => {
    for (const seed of SEEDS) for (const n of [1, 3, 20]) {
      const g = families.overlaid(n, seed);
      const label = caseLabel(seed, `size ${n}`);
      const kinds = new Set(g.overlays!.map((o) => o.kind));
      for (const kind of OVERLAY_KINDS) expect(kinds.has(kind), `${label}: ${kind}`).toBe(true);
      expect(g.overlays!.some((o) => o.target === MAP_TARGET), label).toBe(true);
      const reverse = g.overlays!.find((o) => o.kind === "arc" && o.payload?.reverse) as Overlay;
      expect(g.edges.some((e) => e.id === reverse.target && e.source === reverse.payload!.source && e.target === reverse.payload!.target), label).toBe(true);
      expect(hasCycle(g), label).toBe(true);
    }
  });

  it("labels: long ones are 200 characters or more, German ones carry umlauts or ß, right-to-left ones Hebrew or Arabic, markup-like ones markup characters", () => {
    const expectations: Record<string, (s: string) => boolean> = {
      longLabels: (s) => s.length >= 200,
      germanLabels: (s) => /[äöüÄÖÜß]/.test(s),
      rtlLabels: (s) => /[֐-׿؀-ۿ]/.test(s),
      markupLabels: (s) => /[<>&"']/.test(s),
    };
    for (const [name, holds] of Object.entries(expectations)) {
      for (const seed of SEEDS) {
        const g = families[name as FamilyName](12, seed);
        const label = caseLabel(seed, name);
        for (const node of g.nodes) expect(holds(node.label), `${label}: ${node.label}`).toBe(true);
        for (const group of g.groups!) expect(holds(group.label), `${label}: ${group.label}`).toBe(true);
      }
    }
  });
});

describe("the invalid families and validateGraph", () => {
  it.each(invalidNames)("%s: every planted defect the validation looks at is reported with its message and id", (name) => {
    for (const seed of SEEDS) {
      const { graph, defects } = invalidFamilies[name](12, seed);
      const issues = validateGraph(graph);
      const label = caseLabel(seed, name);
      expect(defects.length, label).toBeGreaterThan(0);
      // One issue per reported defect and none besides: the base graph is valid and the silent defects add nothing.
      expect(issues, label).toHaveLength(defects.filter((d) => d.expect !== null).length);
      for (const d of defects) {
        if (d.expect === null) continue;
        expect(issues.some((i) => i.message === d.expect && (d.kind === "overlay-target-missing" || i.id === d.id)), `${label}: ${d.kind} on ${d.id} expects "${d.expect}" among ${JSON.stringify(issues)}`).toBe(true);
      }
    }
  });

  it("finding: the structural validation does not look at metric values, empty or missing ids or unknown kinds", () => {
    const silent = new Set<string>();
    for (const name of invalidNames) {
      const { graph, defects } = invalidFamilies[name](12, 1);
      for (const d of defects) if (d.expect === null) silent.add(d.kind);
      // Every issue belongs to a defect with a message, so a silent defect that starts being reported fails here.
      expect(validateGraph(graph), `${name}: a defect without a message is reported today; record the message in the family`).toHaveLength(defects.filter((d) => d.expect !== null).length);
    }
    expect([...silent].sort()).toEqual(["empty-id", "missing-id", "missing-metric", "negative-metric", "non-finite-metric", "string-metric", "unknown-edge-kind", "unknown-node-kind", "zero-metric"]);
  });

  it("plants what it says: metric defects sit on the named elements, structural ones in the graph", () => {
    const value = (g: FlowGraph, id: string) => g.nodes.find((n) => n.id === id)?.metrics?.cases ?? g.edges.find((e) => e.id === id)?.metrics?.count;
    for (const seed of SEEDS) {
      const label = caseLabel(seed);
      for (const d of invalidFamilies.missingMetrics(12, seed).defects) expect(value(invalidFamilies.missingMetrics(12, seed).graph, d.id), label).toBeUndefined();
      for (const d of invalidFamilies.zeroMetrics(12, seed).defects) expect(value(invalidFamilies.zeroMetrics(12, seed).graph, d.id), label).toBe(0);
      for (const d of invalidFamilies.negativeMetrics(12, seed).defects) expect(value(invalidFamilies.negativeMetrics(12, seed).graph, d.id), label).toBeLessThan(0);
      for (const d of invalidFamilies.nonFiniteMetrics(12, seed).defects) expect(Number.isFinite(value(invalidFamilies.nonFiniteMetrics(12, seed).graph, d.id)), label).toBe(false);
      for (const d of invalidFamilies.stringMetrics(12, seed).defects) expect(typeof value(invalidFamilies.stringMetrics(12, seed).graph, d.id), label).toBe("string");
      const { graph: cyc } = invalidFamilies.brokenGroups(12, seed);
      expect(cyc.groups!.find((g) => g.id === "ring1")!.parent, label).toBe("ring2");
      expect(cyc.groups!.find((g) => g.id === "ring2")!.parent, label).toBe("ring1");
      expect(invalidFamilies.emptyIds(12, seed).graph.nodes.some((n) => n.id === ""), label).toBe(true);
      const { graph: unnamed } = invalidFamilies.missingIds(12, seed);
      expect(unnamed.nodes.some((n) => n.id === undefined) && unnamed.edges.some((e) => e.id === undefined), label).toBe(true);
      expect(invalidFamilies.strayOverlays(12, seed).graph.overlays!.map((o) => o.kind).sort(), label).toEqual([...OVERLAY_KINDS].sort());
    }
  });
});

describe("positions of a graph", () => {
  const graphFor = (seed: number) => families.nested(24, seed);

  it("are deterministic and give every node a box of its kind's size, groups around their members, bounds around everything", () => {
    for (const seed of SEEDS) for (const kind of POSITION_KINDS) {
      const g = graphFor(seed);
      const p = positionsOf(g, kind, seed, { routes: kind === "grid" });
      const label = caseLabel(seed, kind);
      expect(JSON.stringify(positionsOf(g, kind, seed, { routes: kind === "grid" })), label).toBe(JSON.stringify(p));
      expect(Object.keys(p.nodes).sort(), label).toEqual(g.nodes.map((n) => n.id).sort());
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const grow = (x: number, y: number, w: number, h: number) => {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + w);
        y1 = Math.max(y1, y + h);
      };
      for (const n of g.nodes) {
        const b = p.nodes[n.id];
        expect([b.x, b.y, b.width, b.height].every(Number.isFinite), label).toBe(true);
        expect(b.width, label).toBe(n.kind === "activity" ? 180 : n.kind === "gateway" ? 44 : n.kind === "event" ? 36 : n.kind === "note" ? 160 : 200);
        const gb = p.groups[n.group!];
        expect(gb.x <= b.x && gb.y <= b.y && gb.x + gb.width >= b.x + b.width && gb.y + gb.height >= b.y + b.height, `${label}: ${n.id} inside ${n.group}`).toBe(true);
        grow(b.x, b.y, b.width, b.height);
      }
      for (const group of g.groups!) {
        const gb = p.groups[group.id];
        const parent = group.parent ? p.groups[group.parent] : undefined;
        if (parent && (gb.width || gb.height)) expect(parent.x <= gb.x && parent.y <= gb.y && parent.x + parent.width >= gb.x + gb.width && parent.y + parent.height >= gb.y + gb.height, `${label}: ${group.id} inside ${group.parent}`).toBe(true);
        if (gb.width || gb.height) grow(gb.x, gb.y, gb.width, gb.height);
      }
      for (const r of Object.values(p.edges)) for (const pt of r.points) grow(pt.x, pt.y, 0, 0);
      expect(p.bounds, label).toEqual({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
      expect(p.engine).toBe("given");
      if (kind === "grid") expect(Object.keys(p.edges).length, label).toBe(g.edges.filter((e) => e.source !== e.target).length);
      else expect(p.edges, label).toEqual({});
    }
    expect(positionsOf({ nodes: [], edges: [] }, "grid", 1).bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("grid: no two boxes meet; layered: every edge of an acyclic graph points right; overlapping: boxes meet; extreme: far from the origin", () => {
    for (const seed of SEEDS) {
      const g = families.layered(30, seed);
      const label = caseLabel(seed);
      const meets = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      const pairs = (p: Record<string, { x: number; y: number; width: number; height: number }>) => {
        const boxes = Object.values(p);
        let n = 0;
        for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) if (meets(boxes[i], boxes[k])) n++;
        return n;
      };
      expect(pairs(positionsOf(g, "grid", seed).nodes), label).toBe(0);
      const layered = positionsOf(g, "layered", seed).nodes;
      for (const e of g.edges) expect(layered[e.source].x, label).toBeLessThan(layered[e.target].x);
      expect(pairs(positionsOf(g, "overlapping", seed).nodes), label).toBeGreaterThan(0);
      for (const b of Object.values(positionsOf(g, "extreme", seed).nodes)) expect(Math.abs(b.x) >= 1e9 - 1 && Math.abs(b.y) >= 1e9 - 1, label).toBe(true);
    }
  });

  it("layered: a cycle does not stop the columns", () => {
    const g = families.cyclic(10, 3);
    const p = positionsOf(g, "layered", 3);
    expect(Object.keys(p.nodes)).toHaveLength(10);
  });

  it("broken positions leave the named boxes out or put a non-finite number in them", () => {
    for (const seed of SEEDS) {
      const g = families.chain(12, seed);
      const missing = brokenPositionsOf(g, "missing", seed);
      expect(missing.broken.length).toBeGreaterThan(0);
      for (const id of missing.broken) expect(missing.positions.nodes[id]).toBeUndefined();
      expect(exact(brokenPositionsOf(g, "missing", seed)), caseLabel(seed)).toBe(exact(missing));
      const bad = brokenPositionsOf(g, "nonFinite", seed);
      expect(exact(brokenPositionsOf(g, "nonFinite", seed)), caseLabel(seed)).toBe(exact(bad));
      for (const id of bad.broken) expect(Object.values(bad.positions.nodes[id]).some((v) => !Number.isFinite(v))).toBe(true);
      expect([bad.positions.bounds.x, bad.positions.bounds.width].every(Number.isFinite)).toBe(true);
    }
  });

  it("bent routes run from centre to centre through one or two right-angled corners, drawn from the seed; straight routes are as before", () => {
    const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    for (const seed of SEEDS) {
      const g = families.cyclic(30, seed);
      const label = caseLabel(seed);
      for (const p of [positionsOf(g, "grid", seed, { routes: "bent" }), oddPositionsOf(g, seed, { routes: "bent" }).positions]) {
        let corners = 0;
        for (const e of g.edges) {
          if (e.source === e.target) {
            expect(p.edges[e.id], label).toBeUndefined();
            continue;
          }
          const pts = p.edges[e.id].points;
          expect([3, 4], `${label}: ${e.id}`).toContain(pts.length);
          expect(pts[0], label).toEqual(centre(p.nodes[e.source]));
          expect(pts[pts.length - 1], label).toEqual(centre(p.nodes[e.target]));
          for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, `${label}: ${e.id} segment ${i} is axis-aligned`).toBe(true);
          corners += pts.length - 2;
        }
        expect(corners, label).toBeGreaterThan(0);
      }
      expect(JSON.stringify(positionsOf(g, "grid", seed, { routes: "bent" })), label).toBe(JSON.stringify(positionsOf(g, "grid", seed, { routes: "bent" })));
      const straight = positionsOf(g, "grid", seed, { routes: true });
      for (const e of g.edges) if (e.source !== e.target) expect(straight.edges[e.id].points, label).toEqual([centre(straight.nodes[e.source]), centre(straight.nodes[e.target])]);
    }
  });
});

describe("viewports over bounds", () => {
  const bounds = { x: 100, y: -50, width: 2400, height: 900 };
  const screen = (v: View, x: number, y: number) => ({ x: x * v.zoom + v.x, y: y * v.zoom + v.y });

  it("are deterministic and of their kind", () => {
    for (const seed of SEEDS) {
      const all = viewportsOf(bounds, seed);
      expect(JSON.stringify(viewportsOf(bounds, seed))).toBe(JSON.stringify(all));
      const label = caseLabel(seed);
      const o = all.ordinary;
      const tl = screen(o, bounds.x, bounds.y);
      const br = screen(o, bounds.x + bounds.width, bounds.y + bounds.height);
      expect(tl.x >= 0 && tl.y >= 0 && br.x <= o.width && br.y <= o.height, `${label}: ordinary shows the bounds`).toBe(true);
      expect(all.tiny.width <= 40 && all.tiny.height <= 40 && all.tiny.zoom === 1, label).toBe(true);
      const centre = screen(all.tiny, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      expect(Math.abs(centre.x) <= bounds.width / 2 + 40 && Math.abs(centre.y) <= bounds.height / 2 + 40, `${label}: tiny lies over the bounds`).toBe(true);
      expect(all.huge.width >= 10_000 && all.huge.height >= 10_000, label).toBe(true);
      const far = all.farAway;
      const ftl = screen(far, bounds.x, bounds.y);
      const fbr = screen(far, bounds.x + bounds.width, bounds.y + bounds.height);
      expect(fbr.x < -1e6 || ftl.x > far.width + 1e6 || fbr.y < -1e6 || ftl.y > far.height + 1e6, `${label}: far away sees none of the bounds`).toBe(true);
      expect([1e-6, 1e-4, 1e4, 1e6], label).toContain(all.extremeZoom.zoom);
      for (const kind of VIEWPORT_KINDS) expect(Object.values(all[kind]).every(Number.isFinite), `${label}: ${kind}`).toBe(true);
    }
  });
});

describe("odd positions and viewports at a side", () => {
  it("odd positions hold a point, a huge box and a twin of another node, drawn from the seed, inside the bounds", () => {
    for (const seed of SEEDS) {
      const g = families.layered(20, seed);
      const { positions, odd } = oddPositionsOf(g, seed, { routes: true });
      const label = caseLabel(seed);
      expect(JSON.stringify(oddPositionsOf(g, seed, { routes: true })), label).toBe(JSON.stringify({ positions, odd }));
      expect(Object.keys(odd).sort(), label).toEqual(["huge", "point", "twin"]);
      expect(new Set(Object.values(odd)).size, label).toBe(3);
      expect(positions.nodes[odd.point!], label).toMatchObject({ width: 0, height: 0 });
      expect(positions.nodes[odd.huge!], label).toMatchObject({ width: 20_000, height: 12_000 });
      const twin = positions.nodes[odd.twin!];
      expect(g.nodes.some((n) => n.id !== odd.twin && JSON.stringify(positions.nodes[n.id]) === JSON.stringify(twin)), `${label}: the twin shares a box`).toBe(true);
      const b = positions.bounds;
      for (const box of Object.values(positions.nodes)) expect(box.x >= b.x && box.y >= b.y && box.x + box.width <= b.x + b.width && box.y + box.height <= b.y + b.height, `${label}: inside the bounds`).toBe(true);
      for (const e of g.edges) if (e.source !== e.target) expect(positions.edges[e.id].points, label).toHaveLength(2);
    }
    expect(oddPositionsOf(families.chain(1, 1), 1).odd).toEqual({});
    expect(Object.keys(oddPositionsOf(families.chain(3, 1), 1).odd)).toEqual(["point", "huge"]);
  });

  it("a viewport at a side puts the box's far edge the offset inside the view and centres the box across", () => {
    const box = { x: 1000, y: -200, width: 180, height: 48 };
    for (const seed of SEEDS) for (const side of SIDES) for (const offset of [30, 0.5, -0.5, -40]) {
      const v = viewportAtSide(box, side, offset, seed);
      const label = caseLabel(seed, `${side} ${offset}`);
      expect(JSON.stringify(viewportAtSide(box, side, offset, seed)), label).toBe(JSON.stringify(v));
      const s = (x: number, y: number) => ({ x: x * v.zoom + v.x, y: y * v.zoom + v.y });
      const tl = s(box.x, box.y);
      const br = s(box.x + box.width, box.y + box.height);
      if (side === "left") expect(br.x, label).toBeCloseTo(offset);
      if (side === "right") expect(tl.x, label).toBeCloseTo(v.width - offset);
      if (side === "top") expect(br.y, label).toBeCloseTo(offset);
      if (side === "bottom") expect(tl.y, label).toBeCloseTo(v.height - offset);
      if (side === "left" || side === "right") expect((tl.y + br.y) / 2, label).toBeCloseTo(v.height / 2);
      else expect((tl.x + br.x) / 2, label).toBeCloseTo(v.width / 2);
      expect([0.5, 0.75, 1, 1.5, 2], label).toContain(v.zoom);
      expect(v.width >= 800 && v.width <= 1600 && v.height >= 600 && v.height <= 1000, label).toBe(true);
    }
  });
});

describe("event schedules", () => {
  it("are deterministic, as long as asked, in time order within the gaps, drawn by weight from the alphabet", () => {
    for (const seed of SEEDS) {
      const alphabet = [["mount", 3], ["change", 5], ["abort", 1], ["never", 0]] as const;
      const s = schedule(alphabet, seed, { length: 200, minGap: 5, maxGap: 50 });
      const label = caseLabel(seed);
      expect(JSON.stringify(schedule(alphabet, seed, { length: 200, minGap: 5, maxGap: 50 })), label).toBe(JSON.stringify(s));
      expect(s, label).toHaveLength(200);
      expect(s[0].at, label).toBe(0);
      s.forEach((e, i) => {
        expect(e.step, label).toBe(i);
        if (i) {
          expect(e.at - s[i - 1].at, label).toBeGreaterThanOrEqual(5);
          expect(e.at - s[i - 1].at, label).toBeLessThanOrEqual(50);
        }
        expect(e.event, label).not.toBe("never");
      });
      expect(new Set(s.map((e) => e.event)), label).toEqual(new Set(["mount", "change", "abort"]));
      const same = schedule([["a", 1]] as const, seed, { length: 5, minGap: 0, maxGap: 0 });
      expect(same.map((e) => e.at), label).toEqual([0, 0, 0, 0, 0]);
    }
    expect(() => schedule([["a", 1]] as const, 1, { length: 1, minGap: 3, maxGap: 2 })).toThrow(/gaps/);
  });

  it("interleaves sequences keeping each one's order", () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const merged = interleave(seed, ["a1", "a2", "a3"], ["b1", "b2"], ["c1"]);
      const label = caseLabel(seed);
      expect(interleave(seed, ["a1", "a2", "a3"], ["b1", "b2"], ["c1"]), label).toEqual(merged);
      expect([...merged].sort(), label).toEqual(["a1", "a2", "a3", "b1", "b2", "c1"]);
      for (const prefix of ["a", "b", "c"]) expect(merged.filter((x) => x.startsWith(prefix)), label).toEqual(merged.filter((x) => x.startsWith(prefix)).sort());
      seen.add(merged.join(""));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(interleave(1)).toEqual([]);
    expect(interleave(1, [], [1, 2])).toEqual([1, 2]);
  });
});

describe("a searching test over the families", () => {
  it("runs caseCount seeds and names the failing seed", () => {
    for (const seed of seeds(caseCount(4))) {
      for (const name of familyNames) {
        const g = families[name](10, seed);
        expect(validateGraph(g), caseLabel(seed, name)).toEqual([]);
      }
    }
  });
});
