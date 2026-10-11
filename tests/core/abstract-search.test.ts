import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { joinComponents, thresholded } from "../../src/core/aggregate";
import { type AbstractOptions, type FlowEdge, type FlowGraph, type FlowNode, type Metrics, COLLAPSED_TAG, RECONNECTED_TAG, abstract, collapseGroups, hasTag } from "../../src/index";
import { families } from "../support/graphs";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { JOIN_OBJECTIVE, flood, globalMinimum, referenceAbstract, referenceJoin, referenceThresholds } from "./abstract-reference";

/**
 * A small graph for the exhaustive search: up to eight activities, mostly connected, sometimes start
 * and end events and a gateway, follows edges with self-loops, loops of two and
 * parallel edges, constraint edges, activities without edges and without metrics,
 * in a random input order. Counts are powers of two half of the time, so that
 * strengths relative to the maximum are exact and equally cheap paths are common.
 */
function smallGraph(rng: Random): FlowGraph {
  const n = rng.chance(0.85) ? rng.int(4, 8) : rng.int(0, 3);
  const powers = rng.chance(0.5);
  const value = () => (powers ? 2 ** rng.int(0, 4) : rng.int(1, 1000));
  const nodes: FlowNode[] = [];
  for (let i = 0; i < n; i++) nodes.push({ id: `a${i}`, kind: "activity", label: `A${i}`, ...(rng.chance(0.92) ? { metrics: { cases: value() } } : {}) });
  if (rng.chance(0.3)) nodes.push({ id: "start", kind: "event", label: "Start", tags: ["start"] });
  if (rng.chance(0.3)) nodes.push({ id: "end", kind: "event", label: "End", tags: ["end"] });
  if (rng.chance(0.2)) nodes.push({ id: "x", kind: "gateway", label: "X", tags: ["xor"] });
  const edges: FlowEdge[] = [];
  const ids = new Set<string>();
  const add = (source: string, target: string, kind: FlowEdge["kind"] = "follows", suffix = "") => {
    const id = `${source}->${target}${suffix}`;
    if (ids.has(id)) return;
    ids.add(id);
    edges.push({ id, kind, source, target, ...(kind === "follows" && rng.chance(0.93) ? { metrics: { count: value() } } : {}) });
  };
  if (nodes.length) {
    // Most graphs are connected: each node follows or precedes an earlier one.
    if (rng.chance(0.75)) {
      for (let i = 1; i < nodes.length; i++) {
        const earlier = nodes[rng.int(0, i - 1)].id;
        if (rng.chance(0.5)) add(earlier, nodes[i].id);
        else add(nodes[i].id, earlier);
      }
    }
    for (let k = rng.int(0, nodes.length + 2); k > 0; k--) {
      const source = rng.pick(nodes).id;
      const target = rng.chance(0.12) ? source : rng.pick(nodes).id;
      add(source, target);
      if (rng.chance(0.15)) add(target, source);
      if (rng.chance(0.1)) add(source, target, "follows", "#2");
      if (rng.chance(0.06)) add(source, target, "constraint", "~c");
    }
  }
  return { nodes: rng.shuffle(nodes), edges: rng.shuffle(edges) };
}

function smallOptions(rng: Random, graph: FlowGraph): AbstractOptions {
  const relativeTo = rng.pick(["max", "total"] as const);
  const shares = relativeTo === "max" ? [0, 0.125, 0.25, 0.5, 0.75, 1] : [0, 0.02, 0.05, 0.1, 0.2, 0.35];
  const nodeShares = relativeTo === "max" ? [0.125, 0.25, 0.5, 0.75] : [0.05, 0.1, 0.2];
  const activities = graph.nodes.filter((n) => n.kind === "activity");
  return {
    relativeTo,
    minEdgeShare: rng.pick(shares),
    minNodeShare: rng.chance(0.75) ? rng.pick(nodeShares) : rng.pick(shares),
    ...(activities.length && rng.chance(0.15) ? { keep: [rng.pick(activities).id] } : {}),
  };
}

const FAMILIES = ["chain", "layered", "tree", "cyclic", "hub", "components", "stages", "lanes", "nested", "overlaid"] as const;
const GROUPED = ["stages", "lanes", "nested", "overlaid"] as const;

/**
 * What the families do not make on their own: parallel follows edges, loops of two,
 * self-loops, constraint edges, activities without edges, members without a weight,
 * and node metrics that are maxima or means; then a random input order.
 */
function withQuirks(graph: FlowGraph, rng: Random, { constraints = true } = {}): FlowGraph {
  const nodes = graph.nodes.map((n) => ({ ...n, ...(n.metrics ? { metrics: { ...n.metrics } } : {}) }));
  const edges = graph.edges.map((e) => ({ ...e, ...(e.metrics ? { metrics: { ...e.metrics } } : {}) }));
  const ids = new Set(edges.map((e) => e.id));
  const add = (e: FlowEdge) => {
    if (ids.has(e.id)) return;
    ids.add(e.id);
    edges.push(e);
  };
  const count = () => rng.int(1, 1000);
  for (let k = rng.int(0, 4); k > 0 && graph.edges.length; k--) {
    const e = rng.pick(graph.edges);
    const kind = rng.weighted([["parallel", 3], ["reverse", 3], ["loop", 2], ["constraint", constraints ? 1 : 0]] as const);
    if (kind === "parallel") add({ ...e, id: `${e.id}#2`, metrics: { count: count(), cases: count() } });
    if (kind === "reverse") add({ id: `${e.target}->${e.source}`, kind: "follows", source: e.target, target: e.source, metrics: { count: count() } });
    if (kind === "loop") add({ id: `${e.source}->${e.source}`, kind: "follows", source: e.source, target: e.source, metrics: { count: count() } });
    if (kind === "constraint") add({ id: `${e.id}~c`, kind: "constraint", source: e.source, target: e.target });
  }
  if (rng.chance(0.2)) nodes.push({ id: "alone", kind: "activity", label: "Alone", metrics: { cases: count() } });
  for (const n of nodes) {
    if (n.kind !== "activity" || !rng.chance(0.15)) continue;
    n.metrics = { ...n.metrics, share: rng.int(1, 100) / 100, medianNextHours: rng.int(0, 48) };
    if (rng.chance(0.3)) n.metrics.cases = 0;
  }
  for (const e of edges) if (e.metrics && rng.chance(0.05)) e.metrics = { ...e.metrics, count: 0, cases: 0 };
  return { ...graph, nodes: rng.shuffle(nodes), edges: rng.shuffle(edges) };
}

function anyGraph(rng: Random, names: readonly (typeof FAMILIES)[number][] = FAMILIES, quirks = {}): FlowGraph {
  if (names === FAMILIES && rng.chance(0.2)) return smallGraph(rng);
  const graph = families[rng.pick(names)](rng.int(1, 40), rng.int(1, 1_000_000), { mixedKinds: rng.chance(0.3), scale: rng.pick([1, 1, 1, 0.01, 100]) });
  return withQuirks(graph, rng, quirks);
}

/**
 * The graph with each element's count turned into a `share` in sevenths, which
 * binary floating point cannot hold, so that sums depend on the order of adding.
 */
function fractional(graph: FlowGraph): FlowGraph {
  const sevenths = (m: Metrics | undefined, counts: string[]) => {
    if (!m) return m;
    const out: Metrics = {};
    for (const [k, v] of Object.entries(m)) if (!counts.includes(k)) out[k] = v;
    const count = counts.map((k) => m[k]).find((v) => v !== undefined);
    if (count !== undefined) out.share = count / 7;
    return out;
  };
  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({ ...n, metrics: sevenths(n.metrics, ["cases", "events"]) })),
    edges: graph.edges.map((e) => ({ ...e, metrics: sevenths(e.metrics, ["count", "cases"]) })),
  };
}

/**
 * The graph with every count rounded down to a power of two, so that many edges cost
 * the same and many paths are equally cheap: where the library broke such a tie by
 * the input order, two orders of one input would give different results.
 */
function tied(graph: FlowGraph): FlowGraph {
  const coarse = (m: Metrics | undefined) =>
    m && Object.fromEntries(Object.entries(m).map(([k, v]) => [k, ["count", "cases", "events"].includes(k) && v >= 1 ? 2 ** Math.floor(Math.log2(v)) : v]));
  return {
    ...graph,
    nodes: graph.nodes.map((n) => ({ ...n, metrics: coarse(n.metrics) })),
    edges: graph.edges.map((e) => ({ ...e, metrics: coarse(e.metrics) })),
  };
}

function anyOptions(rng: Random, graph: FlowGraph): AbstractOptions {
  const relativeTo = rng.pick(["max", "total"] as const);
  const shares = relativeTo === "max" ? [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1] : [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.3];
  const groups = (graph.groups ?? []).map((g) => g.id);
  const activities = graph.nodes.filter((n) => n.kind === "activity");
  return {
    relativeTo,
    minEdgeShare: rng.pick(shares),
    minNodeShare: rng.pick(shares),
    keepConnected: rng.chance(0.8),
    collapse: groups.length && rng.chance(0.5) ? (rng.chance(0.5) ? "all" : rng.sample(groups, rng.int(1, groups.length))) : false,
    ...(activities.length && rng.chance(0.1) ? { keep: [rng.pick(activities).id] } : {}),
  };
}

const byIdOrder = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sortedEntries = (record: unknown) => Object.entries((record ?? {}) as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));

/**
 * A result in a form that does not depend on what follows the input order by
 * design: the order of nodes and edges, the tags of a merged edge, the members
 * of a collapsed stage, and the order of the keys in metrics and `meta`.
 */
function canonical(graph: FlowGraph): string {
  const tagsSorted = <T extends { tags?: string[]; metrics?: Metrics }>(el: T) => ({
    ...el,
    ...(el.tags ? { tags: [...el.tags].sort() } : {}),
    ...(el.metrics ? { metrics: Object.fromEntries(sortedEntries(el.metrics)) } : {}),
  });
  const meta = { ...graph.meta } as Record<string, unknown>;
  if (meta.collapsedMembers) meta.collapsedMembers = sortedEntries(meta.collapsedMembers).map(([k, v]) => [k, [...(v as string[])].sort()]);
  if (meta.collapsedEdgeTargets) meta.collapsedEdgeTargets = sortedEntries(meta.collapsedEdgeTargets);
  return JSON.stringify({ ...graph, nodes: [...graph.nodes].sort(byIdOrder).map(tagsSorted), edges: [...graph.edges].sort(byIdOrder).map(tagsSorted), meta });
}

const sortedIds = (ids: Iterable<string>) => [...ids].sort();
const readdedIds = (g: FlowGraph) => sortedIds([...g.nodes, ...g.edges].filter((el) => hasTag(el, RECONNECTED_TAG)).map((el) => el.id));

describe("reconnection against the documented objective", () => {
  it("quotes the objective it checks from the architecture document", () => {
    const text = readFileSync(new URL("../../docs/ARCHITECTURE.md", import.meta.url), "utf8").replace(/\s+/g, " ");
    for (const sentence of JOIN_OBJECTIVE) expect(text, sentence).toContain(sentence);
  });

  it("joins small graphs exactly as the documented rule does, at its cost, and every tie order costs at least the global minimum", () => {
    let joining = 0;
    let aboveTies = 0;
    let aboveGlobal = 0;
    for (const seed of seeds(caseCount(2000))) {
      const rng = createRandom(seed);
      const graph = smallGraph(rng);
      const options = smallOptions(rng, graph);
      const label = caseLabel(seed, JSON.stringify(options));
      const reference = referenceAbstract(graph, options);
      const result = abstract(graph, options);
      expect(sortedIds(result.nodes.map((n) => n.id)), label).toEqual(sortedIds(reference.nodes));
      expect(sortedIds(result.edges.map((e) => e.id)), label).toEqual(sortedIds(reference.edges));
      expect(readdedIds(result), label).toEqual(sortedIds(reference.readded));

      const kept = thresholded(graph, options);
      const joined = joinComponents(kept);
      const keptEdges = new Set(kept.edges.map((e) => e.id));
      const state = referenceThresholds(graph, options);
      const cost = (e: FlowEdge) => 1 + (1 - state.edgeStrength.get(e.id)!);
      const added = joined.edges.filter((e) => !keptEdges.has(e.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
      const total = added.reduce((s, e) => s + cost(e), 0);
      expect(total, label).toBe(reference.join.cost);

      const ways = referenceJoin(state, (tied) => tied);
      const totals = ways.map((w) => w.cost);
      expect(totals, label).toContain(total);
      for (const way of ways) expect(sortedIds(way.reached), label).toEqual(sortedIds(reference.join.reached));
      const global = globalMinimum(state, reference.join.reached);
      const cheapest = totals.reduce((a, b) => Math.min(a, b));
      expect(cheapest, label).toBeGreaterThanOrEqual(global - 1e-9);
      if (reference.join.joins.length) joining++;
      if (total > cheapest + 1e-9) aboveTies++;
      if (total > global + 1e-9) aboveGlobal++;
    }
    // How often the id order of ties, and the per-join objective itself, cost more than the least possible.
    if (process.env.WISE_DEEP) console.log({ cases: caseCount(2000), joining, aboveTies, aboveGlobal });
    expect(joining).toBeGreaterThan(caseCount(2000) / 5);
  });
});

describe("abstraction invariants on random graphs", () => {
  it("gives the same result for every order of the input's nodes and edges", () => {
    for (const seed of seeds(caseCount(500))) {
      const rng = createRandom(seed);
      const plain = anyGraph(rng);
      const variant = rng.weighted([["plain", 4], ["fractional", 3], ["tied", 3]] as const);
      const graph = variant === "fractional" ? fractional(plain) : variant === "tied" ? tied(plain) : plain;
      const options = anyOptions(rng, graph);
      if (variant === "fractional" && options.relativeTo === "total" && rng.chance(0.6)) {
        // A threshold exactly at one element's share of the total, summed in some order: where
        // the total depends on the order of adding, the order decides whether it is kept.
        const shares = (els: { metrics?: Metrics }[]) => els.map((el) => el.metrics?.share).filter((v): v is number => v !== undefined);
        const at = (values: number[]) => (values.length ? rng.pick(values) / rng.shuffle(values).reduce((a, b) => a + b, 0) : 0);
        options.minEdgeShare = at(shares(graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target)));
        options.minNodeShare = at(shares(graph.nodes.filter((n) => n.kind !== "event" && n.kind !== "gateway")));
      }
      const expected = canonical(abstract(graph, options));
      for (let k = 0; k < 2; k++) {
        const permuted = { ...graph, nodes: rng.shuffle(graph.nodes), edges: rng.shuffle(graph.edges) };
        expect(canonical(abstract(permuted, options)), caseLabel(seed, `${variant}, order ${k}, ${JSON.stringify(options)}`)).toBe(expected);
      }
    }
  });

  it("keeps at a higher threshold nothing that a lower one dropped, before reconnection", () => {
    for (const seed of seeds(caseCount(500))) {
      const rng = createRandom(seed);
      const graph = anyGraph(rng);
      const { relativeTo, collapse, keep } = anyOptions(rng, graph);
      const shares = relativeTo === "max" ? [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1] : [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.3];
      let edge = 0;
      let node = 0;
      let previous: Record<string, Set<string>> | undefined;
      for (let step = 0; step < 6; step++) {
        const raise = rng.pick(["edge", "node", "both"] as const);
        if (raise !== "node") edge = rng.pick(shares.filter((x) => x >= edge));
        if (raise !== "edge") node = rng.pick(shares.filter((x) => x >= node));
        const options = { relativeTo, collapse, keep, minEdgeShare: edge, minNodeShare: node };
        const label = caseLabel(seed, `step ${step}, ${JSON.stringify(options)}`);
        const loose = abstract(graph, { ...options, keepConnected: false });
        const kept = {
          nodes: new Set(loose.nodes.map((n) => n.id)),
          edges: new Set(loose.edges.map((e) => e.id)),
          groups: new Set((loose.groups ?? []).map((g) => g.id)),
          overlays: new Set((loose.overlays ?? []).map((o) => JSON.stringify(o))),
        };
        if (previous) for (const [kind, ids] of Object.entries(kept)) for (const id of ids) expect(previous[kind].has(id), `${label}: ${kind} ${id} kept only at the higher threshold`).toBe(true);
        previous = kept;
        // Reconnection only adds: what is not re-added is exactly what the thresholds keep.
        const connected = abstract(graph, { ...options, keepConnected: true });
        const untagged = (els: { id: string; tags?: string[] }[]) => els.filter((el) => !hasTag(el, RECONNECTED_TAG)).map((el) => el.id).sort();
        expect([untagged(connected.nodes), untagged(connected.edges)], label).toEqual([[...kept.nodes].sort(), [...kept.edges].sort()]);
      }
    }
  });

  it("connects a connected input and joins no two components of a disconnected one", () => {
    let disconnected = 0;
    for (const seed of seeds(caseCount(500))) {
      const rng = createRandom(seed);
      const graph = anyGraph(rng);
      const options = { ...anyOptions(rng, graph), keepConnected: true };
      const label = caseLabel(seed, JSON.stringify(options));
      const base = options.collapse ? collapseGroups(graph, options.collapse) : graph;
      const result = abstract(graph, options);
      const baseEdges = new Map(base.edges.map((e) => [e.id, e]));
      for (const e of result.edges) {
        const original = baseEdges.get(e.id);
        expect(original && [original.kind, original.source, original.target], `${label}: edge ${e.id}`).toEqual([e.kind, e.source, e.target]);
      }
      const inputParts = flood(graph.nodes.map((n) => n.id), graph.edges);
      const baseParts = flood(base.nodes.map((n) => n.id), base.edges);
      const resultParts = flood(result.nodes.map((n) => n.id), result.edges);
      // A collapsed group without members is a stage node without edges; the joining may
      // start from it and then joins nothing (pinned as a finding in abstract.test.ts).
      const emptyStage = base.nodes.some((n) => n.kind === "stage" && n.metrics?.members === 0);
      if (new Set(inputParts.values()).size <= 1 && !emptyStage) {
        expect(new Set(resultParts.values()).size, `${label}: components of a connected input`).toBeLessThanOrEqual(1);
        continue;
      }
      disconnected++;
      const partOf = new Map<string, string>();
      for (const [id, part] of resultParts) {
        const seen = partOf.get(part);
        if (seen === undefined) partOf.set(part, baseParts.get(id)!);
        else expect(baseParts.get(id), `${label}: ${id} joined to another input component`).toBe(seen);
      }
    }
    expect(disconnected).toBeGreaterThan(caseCount(500) / 10);
  });

  it("keeps the counts of collapsed stages and merged edges as documented and invents no metric", () => {
    for (const seed of seeds(caseCount(500))) {
      const rng = createRandom(seed);
      // Constraint edges inside a stage are left out: what they count is an open question (see the pinned finding).
      const graph = anyGraph(rng, GROUPED, { constraints: false });
      const groups = (graph.groups ?? []).map((g) => g.id);
      const collapse = rng.chance(0.4) ? ("all" as const) : rng.sample(groups, rng.int(1, groups.length));
      const label = caseLabel(seed, `collapse ${JSON.stringify(collapse)}`);
      checkCollapse(graph, collapse, collapseGroups(graph, collapse), label);
      const options = { ...anyOptions(rng, graph), collapse, keepConnected: true };
      const base = collapseGroups(graph, collapse);
      const result = abstract(graph, options);
      // Re-added elements are the collapsed graph's own, with their counts, and only the tag added.
      const original = new Map<string, FlowNode | FlowEdge>([...base.nodes, ...base.edges].map((el) => [el.id, el]));
      for (const el of [...result.nodes, ...result.edges]) {
        const before = original.get(el.id);
        const expected = hasTag(el, RECONNECTED_TAG) && before ? { ...before, tags: [...(before.tags ?? []), RECONNECTED_TAG] } : before;
        expect(el, `${label}, ${JSON.stringify(options)}: ${el.id}`).toEqual(expected);
      }
    }
  });

  it("abstracts its own result to the same graph, and collapses a collapsed graph to itself", () => {
    for (const seed of seeds(caseCount(500))) {
      const rng = createRandom(seed);
      const graph = anyGraph(rng);
      const options = { ...anyOptions(rng, graph), keepConnected: false };
      const label = caseLabel(seed, JSON.stringify(options));
      const once = abstract(graph, options);
      expect(abstract(once, options), label).toEqual(once);
      if (options.collapse) {
        const collapsed = collapseGroups(graph, options.collapse);
        expect(collapseGroups(collapsed, options.collapse), label).toEqual(collapsed);
      }
    }
  });
});

const SUMMED = ["count", "events"];
const MAXIMA = ["cases", "share"];

/**
 * What docs/API.md says of a collapse, read naively: "A collapsed group becomes a
 * `stage` node with the group's id; counts are summed, `cases` and `share` are
 * maxima, other metrics weighted means, internal transitions land in
 * `internalCount`." The weights are not documented, so a mean is only required to
 * lie between the values it averages. Counts here are `count` and `events`, the
 * only ones the generators make. Once any group collapses, edges of one kind
 * between the same two shown nodes are merged, also where neither end collapsed.
 */
function checkCollapse(graph: FlowGraph, collapse: string[] | "all", result: FlowGraph, label: string) {
  const groups = new Map((graph.groups ?? []).map((g) => [g.id, g]));
  const requested = collapse === "all" ? [...groups.values()].filter((g) => g.kind === "stage" && !g.parent).map((g) => g.id) : collapse.filter((id) => groups.has(id));
  const outermost = (group: string | undefined) => {
    let found: string | undefined;
    for (let at = group; at !== undefined && groups.has(at); at = groups.get(at)!.parent) if (requested.includes(at)) found = at;
    return found;
  };
  if (requested.length === 0) {
    expect(result, `${label}: nothing to collapse`).toBe(graph);
    return;
  }
  const rootOf = new Map(graph.nodes.map((n) => [n.id, outermost(n.group)]));
  const target = (id: string) => rootOf.get(id) ?? id;
  const value = (m: Metrics | undefined, name: string) => (typeof m?.[name] === "number" && Number.isFinite(m[name]) ? m[name] : undefined);
  const expectMerged = (what: string, merged: Metrics | undefined, parts: (Metrics | undefined)[], extra: string[]) => {
    const names = new Set(parts.flatMap((m) => Object.keys(m ?? {}).filter((k) => value(m, k) !== undefined)));
    for (const name of Object.keys(merged ?? {})) expect(names.has(name) || extra.includes(name), `${label}: ${what} invents ${name}`).toBe(true);
    for (const name of names) {
      const values = parts.map((m) => value(m, name)).filter((v): v is number => v !== undefined);
      const got = merged?.[name];
      if (SUMMED.includes(name)) expect(got, `${label}: ${what} ${name} summed`).toBe(values.reduce((a, b) => a + b, 0));
      else if (MAXIMA.includes(name)) expect(got, `${label}: ${what} ${name} is the maximum, not a sum`).toBe(values.reduce((a, b) => Math.max(a, b)));
      else {
        const [low, high] = [values.reduce((a, b) => Math.min(a, b)), values.reduce((a, b) => Math.max(a, b))];
        const slack = 1e-9 * Math.max(1, Math.abs(high));
        expect(got! >= low - slack && got! <= high + slack, `${label}: ${what} ${name} = ${got} lies between ${low} and ${high}`).toBe(true);
      }
    }
  };

  const members = new Map<string, FlowNode[]>();
  for (const n of graph.nodes) if (rootOf.get(n.id)) members.set(rootOf.get(n.id)!, [...(members.get(rootOf.get(n.id)!) ?? []), n]);
  const internal = new Map<string, number>();
  const parallel = new Map<string, FlowEdge[]>();
  for (const e of graph.edges) {
    const [s, t] = [target(e.source), target(e.target)];
    if (s === t && rootOf.get(e.source) && rootOf.get(e.target)) internal.set(s, (internal.get(s) ?? 0) + e.metrics!.count);
    else parallel.set(JSON.stringify([e.kind, s, t]), [...(parallel.get(JSON.stringify([e.kind, s, t])) ?? []), e]);
  }
  const nodes = new Map(result.nodes.map((n) => [n.id, n]));
  for (const root of requested.filter((id) => outermost(id) === id)) {
    const stage = nodes.get(root);
    const own = members.get(root) ?? [];
    expect(stage && [stage.kind, stage.tags], `${label}: stage ${root}`).toEqual(["stage", [COLLAPSED_TAG]]);
    expect(stage!.metrics?.members, `${label}: members of ${root}`).toBe(own.length);
    expect(stage!.metrics?.internalCount, `${label}: transitions inside ${root}`).toBe(internal.get(root));
    expectMerged(`stage ${root}`, stage!.metrics, own.map((n) => n.metrics), ["members", "internalCount"]);
    const recorded = (result.meta?.collapsedMembers as Record<string, string[]>)[root];
    expect([...recorded].sort(), `${label}: activities of ${root}`).toEqual(own.filter((n) => n.kind === "activity").map((n) => n.id).sort());
  }
  for (const n of graph.nodes) if (!rootOf.get(n.id)) expect(nodes.get(n.id), `${label}: ${n.id} untouched`).toBe(n);

  const edgeIds = result.edges.map((e) => e.id);
  expect(new Set([...edgeIds, ...result.nodes.map((n) => n.id)]).size, `${label}: ids unique`).toBe(edgeIds.length + result.nodes.length);
  expect(result.edges.length, `${label}: one edge per kind and pair`).toBe(parallel.size);
  const targets = result.meta?.collapsedEdgeTargets as Record<string, string>;
  for (const [key, list] of parallel) {
    const [kind, source, target] = JSON.parse(key) as [string, string, string];
    const merged = result.edges.find((e) => e.kind === kind && e.source === source && e.target === target);
    expect(merged, `${label}: edge ${key}`).toBeDefined();
    for (const e of list) expect(targets[e.id], `${label}: ${e.id} shown as`).toBe(merged!.id);
    if (list.length === 1) expect(merged, `${label}: ${list[0].id} unchanged`).toEqual({ ...list[0], source, target });
    else expectMerged(`edge ${merged!.id}`, merged!.metrics, list.map((e) => e.metrics), []);
  }
  for (const [root] of internal) for (const e of graph.edges) if (target(e.source) === root && target(e.target) === root && rootOf.get(e.source)) expect(targets[e.id], `${label}: ${e.id} inside`).toBe(root);
  // Every transition is still counted once: on an edge or inside a stage.
  const counted = (g: FlowGraph) => g.edges.filter((e) => e.kind === "follows").reduce((sum, e) => sum + (e.metrics?.count ?? 0), 0);
  const inside = result.nodes.reduce((sum, n) => sum + (n.kind === "stage" ? (n.metrics?.internalCount ?? 0) : 0), 0);
  expect(counted(result) + inside, `${label}: transitions before and after`).toBe(counted(graph));
}
