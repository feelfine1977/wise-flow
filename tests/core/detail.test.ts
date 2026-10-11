import { describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene } from "../../fixtures/bpic2019";
import { liteFromGraph } from "../../src/bpmn/headless";
import { ANCHOR_TAG, INDIRECT_TAG, type AbstractOptions, type FlowEdge, type FlowGraph, type FlowNode, type Overlay, abstract, buildViews, collapseGroups, diff, hasTag, layout, overlaysFor } from "../../src/index";
import { detailGraph, offWays, seeded, shuffled, wayThroughHidden } from "./detail-cases";

const isActivity = (n: FlowNode) => n.kind === "activity" || n.kind === "stage";
const ids = (elements: { id: string }[]) => elements.map((el) => el.id).sort();
const byShares = (activityDetail: number, pathDetail: number, more: AbstractOptions = {}): AbstractOptions => ({ activityDetail, pathDetail, ...more });
const PATH_SHARES = [0, 0.1, 0.25, 0.5, 1];
/** Every activity position of the whole log (42 activities), and 0. */
const POSITIONS = Array.from({ length: 43 }, (_, k) => k / 42);
const diffScene = diff(globalScene, vendorScene);

/** The activities a share shows by rank, written out: cases, then events, then id; ties enter whole. */
function rankedActivities(graph: FlowGraph, share: number): Set<string> {
  const value = (n: FlowNode, name: string) => n.metrics?.[name] ?? 0;
  const list = graph.nodes.filter(isActivity).sort((a, b) => value(b, "cases") - value(a, "cases") || value(b, "events") - value(a, "events") || (a.id < b.id ? -1 : 1));
  let count = Math.max(1, Math.ceil(share * list.length - 1e-9));
  while (count < list.length && value(list[count], "cases") === value(list[count - 1], "cases") && value(list[count], "events") === value(list[count - 1], "events")) count++;
  return new Set(list.slice(0, count).map((n) => n.id));
}

/** The paths in their rank over the whole graph: count, then id. */
const rankedPaths = (graph: FlowGraph) => graph.edges.filter((e) => e.kind !== "constraint").sort((a, b) => (b.metrics?.count ?? 0) - (a.metrics?.count ?? 0) || (a.id < b.id ? -1 : 1));

/** Checks that hold for every result: real paths unchanged but for the anchor tag, indirect paths without a count over a way of the graph. */
function expectHonestPaths(input: FlowGraph, result: FlowGraph, label: string) {
  const given = new Map(input.edges.map((e) => [e.id, e]));
  const shown = new Set(result.nodes.map((n) => n.id));
  for (const e of result.edges) {
    if (hasTag(e, INDIRECT_TAG)) {
      const payload = e.payload as { hiddenActivities: number; via: string[] };
      expect(e.metrics, `${label}: ${e.id}`).toBeUndefined();
      expect(given.has(e.id), `${label}: ${e.id}`).toBe(false);
      expect(payload.hiddenActivities, `${label}: ${e.id}`).toBe(payload.via.length);
      expect(payload.via.length, `${label}: ${e.id}`).toBeGreaterThan(0);
      expect(payload.via.every((id) => !shown.has(id)), `${label}: ${e.id}`).toBe(true);
      expect(wayThroughHidden(input, e.source, e.target, shown), `${label}: ${e.id}`).toBe(true);
      continue;
    }
    const original = given.get(e.id);
    expect(original, `${label}: ${e.id} is a path of the graph`).toBeDefined();
    expect({ ...e, tags: undefined }, `${label}: ${e.id}`).toEqual({ ...original, tags: undefined });
    expect((e.tags ?? []).filter((t) => t !== ANCHOR_TAG), `${label}: ${e.id}`).toEqual(original!.tags ?? []);
  }
}

describe("detail shares", () => {
  it("show every activity and every path, with their counts, at 1 and 1", () => {
    for (const graph of [globalScene, vendorScene]) {
      const result = abstract(graph, byShares(1, 1));
      expect(result.nodes).toEqual(graph.nodes);
      expect(result.edges).toEqual(graph.edges);
    }
    const all = abstract(globalScene, byShares(1, 1));
    expect(all.nodes.filter(isActivity)).toHaveLength(42);
    expect(all.edges).toHaveLength(677);
    expect(all.meta?.shown).toMatchObject({ activities: { shown: 42, of: 42 }, paths: { shown: 677, of: 677 }, anchorsOnly: 0, indirect: 0 });
    expect(all.meta?.shown?.strongestNotShown).toBeUndefined();
    expect(all.meta?.abstraction).toEqual({ activityDetail: 1, pathDetail: 1 });
  });

  it("show the activities a share takes by rank, and a tie whole", () => {
    for (const graph of [globalScene, vendorScene]) {
      for (const share of POSITIONS) {
        expect(ids(abstract(graph, byShares(share, 0)).nodes.filter(isActivity)), `${share}`).toEqual([...rankedActivities(graph, share)].sort());
      }
    }
    const tied: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        ...["a", "b", "c", "d"].map((id, i) => ({ id, kind: "activity" as const, label: id, metrics: { cases: i < 3 ? 10 : 5, events: i === 2 ? 11 : 10 } })),
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: ["a", "b", "c", "d"].flatMap((id) => [
        { id: `start->${id}`, kind: "follows" as const, source: "start", target: id, metrics: { count: 1 } },
        { id: `${id}->end`, kind: "follows" as const, source: id, target: "end", metrics: { count: 1 } },
      ]),
    };
    // c has the most events; a and b tie on cases and events and enter together.
    expect(ids(abstract(tied, byShares(0, 0)).nodes.filter(isActivity))).toEqual(["c"]);
    expect(ids(abstract(tied, byShares(0.5, 0)).nodes.filter(isActivity))).toEqual(["a", "b", "c"]);
    expect(ids(abstract(tied, byShares(0.26, 0)).nodes.filter(isActivity))).toEqual(["a", "b", "c"]);
  });

  it("keep every shown activity of the committed scenes on a way from start to end at every position", () => {
    for (const [name, graph] of [["global", globalScene], ["vendor", vendorScene], ["diff", diffScene]] as const) {
      for (const collapse of [false, "all"] as const) {
        for (const a of POSITIONS) {
          for (const p of PATH_SHARES) {
            const result = abstract(graph, byShares(a, p, { collapse }));
            expect(offWays(result), `${name} ${collapse} ${a} ${p}`).toEqual([]);
          }
        }
      }
    }
  });

  it("keep every shown activity of seeded graphs on a way from start to end, with stages collapsed and not", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const graph = detailGraph(seed);
      expect(offWays(graph), `seed ${seed}`).toEqual([]);
      for (const collapse of [false, "all"] as const) {
        const activities = (collapse ? collapseGroups(graph, "all") : graph).nodes.filter(isActivity).length;
        for (let k = 0; k <= activities; k++) {
          for (const p of [0, 0.25, 1]) {
            const result = abstract(graph, byShares(k / activities, p, { collapse }));
            expect(offWays(result), `seed ${seed} ${collapse} ${k}/${activities} ${p}`).toEqual([]);
            expectHonestPaths(collapse ? collapseGroups(graph, "all") : graph, result, `seed ${seed} ${collapse} ${k} ${p}`);
          }
        }
      }
    }
  });

  it("never remove an element when either share moves towards more detail, but an indirect path whose activities come into view", () => {
    const graphs: [string, FlowGraph, AbstractOptions][] = [
      ["global", globalScene, {}],
      ["vendor", vendorScene, {}],
      ["global collapsed", globalScene, { collapse: "all" }],
      ...Array.from({ length: 12 }, (_, i): [string, FlowGraph, AbstractOptions] => [`seed ${i + 1}`, detailGraph(i + 1), i % 2 ? { collapse: "all" } : {}]),
    ];
    let replaced = 0;
    for (const [name, graph, options] of graphs) {
      const rnd = seeded(name.length * 31 + 7);
      for (let pair = 0; pair < 500; pair++) {
        const [a1, a2] = [rnd(), rnd()].sort((x, y) => x - y);
        const [p1, p2] = [rnd(), rnd()].sort((x, y) => x - y);
        const less = abstract(graph, byShares(a1, p1, options));
        const more = abstract(graph, byShares(a2, p2, options));
        const nodes = new Set(more.nodes.map((n) => n.id));
        expect(less.nodes.filter((n) => !nodes.has(n.id)), `${name} ${a1}/${p1} → ${a2}/${p2}`).toEqual([]);
        const edges = new Set(more.edges.map((e) => e.id));
        for (const e of less.edges.filter((x) => !edges.has(x.id))) {
          expect(hasTag(e, INDIRECT_TAG), `${name} ${a1}/${p1} → ${a2}/${p2}: ${e.id}`).toBe(true);
          expect((e.payload as { via: string[] }).via.some((id) => nodes.has(id)), `${name}: ${e.id}`).toBe(true);
          replaced++;
        }
      }
    }
    expect(replaced).toBeGreaterThan(0);
  });

  it("keep the counts of the graph and invent no path but an indirect one", () => {
    for (const graph of [globalScene, vendorScene, diffScene]) {
      for (const a of [0, 0.1, 0.3, 0.6, 1]) for (const p of PATH_SHARES) expectHonestPaths(graph, abstract(graph, byShares(a, p)), `${a} ${p}`);
    }
  });

  it("give the same result whatever the order of the nodes and edges", () => {
    // What the collapse records of the members and merged paths follows the input order; the selection does not.
    const inIdOrder = (g: FlowGraph) => {
      const { collapsedMembers: _members, collapsedEdgeTargets: _targets, ...meta } = g.meta ?? {};
      return JSON.stringify({ ...g, nodes: [...g.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)), edges: [...g.edges].sort((a, b) => (a.id < b.id ? -1 : 1)), meta });
    };
    const cases: [FlowGraph, AbstractOptions[]][] = [
      [globalScene, [byShares(0, 0), byShares(0.3, 0.1), byShares(0.7, 0.5)]],
      [vendorScene, [byShares(0, 0), byShares(0.5, 0.25)]],
      ...Array.from({ length: 30 }, (_, i): [FlowGraph, AbstractOptions[]] => [detailGraph(i + 1), [byShares(0, 0), byShares(0.4, 0.2), byShares(0.4, 0.2, { collapse: "all" })]]),
    ];
    for (const [graph, list] of cases) {
      for (const options of list) {
        const expected = inIdOrder(abstract(graph, options));
        for (const seed of [1, 2, 3]) expect(inIdOrder(abstract(shuffled(graph, seed), options))).toBe(expected);
      }
    }
  });

  it("draw no indirect path on the whole log, and one through the activities not shown where the graph has no direct way", () => {
    for (const a of POSITIONS) expect(abstract(globalScene, byShares(a, 0)).meta?.shown?.indirect).toBe(0);
    const graph: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "busy", kind: "activity", label: "Busy", metrics: { cases: 100 } },
        { id: "late", kind: "activity", label: "Late", metrics: { cases: 90 } },
        { id: "rare", kind: "activity", label: "Rare", metrics: { cases: 5 } },
        { id: "rarer", kind: "activity", label: "Rarer", metrics: { cases: 3 } },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: [
        { id: "start->busy", kind: "follows", source: "start", target: "busy", metrics: { count: 100 } },
        { id: "busy->end", kind: "follows", source: "busy", target: "end", metrics: { count: 100 } },
        { id: "start->rarer", kind: "follows", source: "start", target: "rarer", metrics: { count: 3 } },
        { id: "rarer->rare", kind: "follows", source: "rarer", target: "rare", metrics: { count: 3 } },
        { id: "rare->late", kind: "follows", source: "rare", target: "late", metrics: { count: 5 } },
        { id: "late->end", kind: "follows", source: "late", target: "end", metrics: { count: 90 } },
      ],
    };
    // "late" is entered only from rarer activities: at two activities of four its way in passes both, not shown.
    const result = abstract(graph, byShares(0.5, 0));
    expect(ids(result.nodes)).toEqual(["busy", "end", "late", "start"]);
    const indirect = result.edges.filter((e) => hasTag(e, INDIRECT_TAG));
    expect(indirect).toEqual([{ id: "start->late:indirect", kind: "follows", source: "start", target: "late", tags: [INDIRECT_TAG], payload: { hiddenActivities: 2, via: ["rarer", "rare"] } }]);
    expect(result.meta?.shown).toMatchObject({ indirect: 1, anchorsOnly: 3 });
    expect(offWays(result)).toEqual([]);
    // With "rare" in view the indirect path gives way to the paths it stood for, and to a shorter indirect one.
    const more = abstract(graph, byShares(0.75, 0));
    expect(ids(more.edges)).toEqual(["busy->end", "late->end", "rare->late", "start->busy", "start->rare:indirect"]);
    expect(more.edges.find((e) => e.id === "start->rare:indirect")?.payload).toEqual({ hiddenActivities: 1, via: ["rarer"] });
  });

  it("state in meta what is shown, as computed from the graph", () => {
    for (const graph of [globalScene, vendorScene]) {
      for (const [a, p] of [[0, 0], [0.2, 0.05], [0.5, 0.25], [0.8, 0.5], [1, 0.1]]) {
        const result = abstract(graph, byShares(a, p));
        const shown = new Set(result.nodes.map((n) => n.id));
        const edges = new Set(result.edges.map((e) => e.id));
        const ranked = rankedPaths(graph);
        const byFrequency = ranked.slice(0, Math.ceil(p * ranked.length - 1e-9)).filter((e) => shown.has(e.source) && shown.has(e.target));
        const anchors = result.edges.filter((e) => hasTag(e, ANCHOR_TAG));
        expect(anchors.every((e) => !byFrequency.includes(graph.edges.find((x) => x.id === e.id)!))).toBe(true);
        expect(result.edges.filter((e) => !hasTag(e, INDIRECT_TAG))).toHaveLength(byFrequency.length + anchors.length);
        const expected = {
          activities: { shown: rankedActivities(graph, a).size, of: graph.nodes.filter(isActivity).length },
          paths: { shown: byFrequency.length + anchors.length, of: graph.edges.length },
          anchorsOnly: anchors.length,
          indirect: result.edges.filter((e) => hasTag(e, INDIRECT_TAG)).length,
          ...(byFrequency.length && { weakestByFrequency: byFrequency.at(-1)!.metrics!.count }),
          ...(ranked.some((e) => !edges.has(e.id)) && { strongestNotShown: ranked.find((e) => !edges.has(e.id))!.metrics!.count }),
          marksNotShown: [],
          forProtected: [],
        };
        const { keeps, ...rest } = result.meta!.shown!;
        expect(rest, `${a} ${p}`).toEqual(expected);
        expect(Object.keys(keeps!).sort()).toEqual(ids(anchors));
        for (const [edge, kept] of Object.entries(keeps!)) {
          const e = graph.edges.find((x) => x.id === edge)!;
          expect(kept.length && kept.every((id) => shown.has(id) && graph.nodes.find((n) => n.id === id)!.kind === "activity"), edge).toBeTruthy();
        }
      }
    }
  });

  it("let self-loops in through the paths share only", () => {
    const loops = globalScene.edges.filter((e) => e.source === e.target);
    for (const p of PATH_SHARES) {
      const result = abstract(globalScene, byShares(1, p));
      const ranked = rankedPaths(globalScene);
      const within = new Set(ranked.slice(0, Math.ceil(p * ranked.length - 1e-9)).map((e) => e.id));
      const shownLoops = result.edges.filter((e) => e.source === e.target);
      expect(ids(shownLoops)).toEqual(ids(loops.filter((e) => within.has(e.id))));
      expect(shownLoops.some((e) => hasTag(e, ANCHOR_TAG))).toBe(false);
    }
  });

  it("rank a self-loop by its count also when it is larger than every other path's", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "z", kind: "activity", label: "Z", metrics: { cases: 100 } },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: [
        { id: "start->z", kind: "follows", source: "start", target: "z", metrics: { count: 100 } },
        { id: "z->end", kind: "follows", source: "z", target: "end", metrics: { count: 90 } },
        { id: "z->z", kind: "follows", source: "z", target: "z", metrics: { count: 500 } },
      ],
    };
    // By count: z->z (500), start->z (100), z->end (90).
    const first = abstract(graph, byShares(1, 1 / 3));
    expect(ids(first.edges.filter((e) => !hasTag(e, ANCHOR_TAG)))).toEqual(["z->z"]);
    expect(first.meta?.shown?.weakestByFrequency).toBe(500);
    const two = abstract(graph, byShares(1, 2 / 3));
    expect(ids(two.edges.filter((e) => !hasTag(e, ANCHOR_TAG)))).toEqual(["start->z", "z->z"]);
    expect(two.meta?.shown).toMatchObject({ weakestByFrequency: 100, anchorsOnly: 1 });
    expect(two.meta?.shown?.strongestNotShown).toBeUndefined();
  });

  it("never remove an activity, a note or a path nobody measured, nor a flow edge, as thresholds do not", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "busy", kind: "activity", label: "Busy", metrics: { cases: 100, events: 120 } },
        { id: "next", kind: "activity", label: "Next", metrics: { cases: 50, events: 50 } },
        { id: "plain", kind: "activity", label: "Plain" },
        { id: "note", kind: "note", label: "A note" },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: [
        { id: "start->busy", kind: "follows", source: "start", target: "busy", metrics: { count: 100 } },
        { id: "busy->next", kind: "follows", source: "busy", target: "next", metrics: { count: 50 } },
        { id: "next->end", kind: "follows", source: "next", target: "end", metrics: { count: 50 } },
        { id: "busy->end", kind: "follows", source: "busy", target: "end", metrics: { count: 50 } },
        { id: "start->plain", kind: "follows", source: "start", target: "plain" },
        { id: "plain->end", kind: "flow", source: "plain", target: "end", metrics: { count: 1 } },
        { id: "next->plain", kind: "follows", source: "next", target: "plain" },
      ],
    };
    // The share takes one of the two measured activities; "plain", the note and the paths without a measure stay.
    const lowest = abstract(graph, byShares(0, 0));
    expect(ids(lowest.nodes)).toEqual(["busy", "end", "note", "plain", "start"]);
    expect(ids(lowest.edges)).toEqual(["busy->end", "plain->end", "start->busy", "start->plain"]);
    expect(ids(lowest.edges.filter((e) => hasTag(e, ANCHOR_TAG)))).toEqual(["busy->end", "start->busy"]);
    expect(lowest.meta?.shown).toMatchObject({ activities: { shown: 2, of: 3 }, anchorsOnly: 2, strongestNotShown: 50 });
    expect(lowest.meta?.shown?.weakestByFrequency).toBeUndefined();
    const loose = abstract(graph, { minNodeShare: 1, minEdgeShare: 1, keepConnected: false });
    expect(ids(lowest.nodes)).toEqual(ids(loose.nodes));
    // The unmeasured path from "next" enters with "next", as the measured share brings it in.
    expect(ids(abstract(graph, byShares(1, 0)).edges)).toContain("next->plain");
  });

  it("win over thresholds given with them", () => {
    const both = abstract(globalScene, { activityDetail: 0.5, pathDetail: 0.1, minNodeShare: 0.9, minEdgeShare: 0.9, keepConnected: false });
    expect(both).toEqual(abstract(globalScene, byShares(0.5, 0.1)));
    expect(abstract(globalScene, { pathDetail: 0 }).nodes).toEqual(globalScene.nodes);
    expect(abstract(globalScene, { activityDetail: 0 }).edges).toEqual(abstract(globalScene, byShares(0, 1)).edges);
  });

  it("keep a path given in keep with both its ends", () => {
    const weak = rankedPaths(globalScene).at(-1)!;
    const result = abstract(globalScene, byShares(0, 0, { keep: [weak.id] }));
    expect(result.edges.map((e) => e.id)).toContain(weak.id);
    expect(offWays(result)).toEqual([]);
    expect(result.meta?.shown?.forProtected).toEqual([]);
  });
});

describe("thresholds", () => {
  it("report the shown activities without a path when they do not keep the map connected", () => {
    const loose = abstract(globalScene, { minNodeShare: 0, minEdgeShare: 0.03, keepConnected: false });
    const touched = new Set(loose.edges.filter((e) => e.source !== e.target).flatMap((e) => [e.source, e.target]));
    expect(loose.edges).toHaveLength(31);
    expect(loose.meta?.shown).toEqual({ activities: { shown: 42, of: 42 }, paths: { shown: 31, of: 677 }, withoutPath: 30, marksNotShown: [], forProtected: [] });
    expect(loose.nodes.filter((n) => isActivity(n) && !touched.has(n.id))).toHaveLength(30);
    expect(abstract(globalScene, { minNodeShare: 0, minEdgeShare: 0.03 }).meta?.shown?.withoutPath).toBeUndefined();
  });
});

describe("comparisons", () => {
  const either = (graph: FlowGraph, elements: (FlowNode | FlowEdge)[], name: string) => {
    const max = (prefix: string) => Math.max(...elements.map((el) => el.metrics?.[`${prefix}${name}`] ?? 0));
    const [b, a] = [max(""), max("a_")];
    return new Map(elements.map((el) => [el.id, Math.max((el.metrics?.[name] ?? -Infinity) / b, (el.metrics?.[`a_${name}`] ?? -Infinity) / a, el.metrics?.[name] === undefined && el.metrics?.[`a_${name}`] === undefined ? 1 : -Infinity)]));
  };

  it("show the whole comparison at 1 and 1 and only what the rule keeps at the lowest shares", () => {
    expect(diffScene.nodes.filter(isActivity)).toHaveLength(42);
    const all = abstract(diffScene, byShares(1, 1));
    expect(all.nodes.filter(isActivity)).toHaveLength(42);
    expect(all.edges).toHaveLength(677);
    const lowest = abstract(diffScene, byShares(0, 0));
    const strength = either(diffScene, diffScene.nodes.filter(isActivity), "cases");
    const top = Math.max(...strength.values());
    const strongest = diffScene.nodes.filter((n) => isActivity(n) && strength.get(n.id) === top);
    const events = either(diffScene, strongest, "events");
    const first = strongest.sort((x, y) => events.get(y.id)! - events.get(x.id)! || (x.id < y.id ? -1 : 1))[0];
    expect(lowest.nodes.filter(isActivity).map((n) => n.id)).toEqual([first.id]);
    expect(lowest.edges.every((e) => hasTag(e, ANCHOR_TAG) || hasTag(e, INDIRECT_TAG))).toBe(true);
    expect(offWays(lowest)).toEqual([]);
  });

  it("take the strength of an element from either side for thresholds", () => {
    const nodeStrength = either(diffScene, diffScene.nodes.filter(isActivity), "cases");
    const follows = diffScene.edges.filter((e) => e.source !== e.target);
    const edgeStrength = either(diffScene, follows, "count");
    // Self-loops are measured against the strongest path of their side that is not one.
    const loopMax = (prefix: string) => Math.max(...follows.map((e) => e.metrics?.[`${prefix}count`] ?? 0));
    for (const e of diffScene.edges.filter((x) => x.source === x.target)) {
      edgeStrength.set(e.id, Math.max(Math.min(1, (e.metrics?.count ?? -Infinity) / loopMax("")), Math.min(1, (e.metrics?.a_count ?? -Infinity) / loopMax("a_"))));
    }
    const nodes = diffScene.nodes.filter((n) => !isActivity(n) || nodeStrength.get(n.id)! >= 1);
    const kept = new Set(nodes.map((n) => n.id));
    const edges = diffScene.edges.filter((e) => kept.has(e.source) && kept.has(e.target) && edgeStrength.get(e.id)! >= 1);
    const loose = abstract(diffScene, { minNodeShare: 1, minEdgeShare: 1, keepConnected: false });
    expect(ids(loose.nodes)).toEqual(ids(nodes));
    expect(ids(loose.edges)).toEqual(ids(edges));
    // Before, an element measured on side a only was never removed: 31 activities and 282 paths.
    expect([loose.nodes.filter(isActivity).length, loose.edges.length]).not.toEqual([31, 282]);
    expect([loose.nodes.filter(isActivity).length, loose.edges.length]).toEqual([1, 1]);
    const connected = abstract(diffScene, { minNodeShare: 1, minEdgeShare: 1 });
    expect([connected.nodes.filter(isActivity).length, connected.edges.length]).toEqual([1, 2]);
  });
});

describe("protected marks", () => {
  const rareGraph = (marks: Overlay[]): FlowGraph => ({
    nodes: [
      { id: "start", kind: "event", label: "Start", tags: ["start"] },
      { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
      { id: "b", kind: "activity", label: "B", metrics: { cases: 80 } },
      { id: "r", kind: "activity", label: "R", metrics: { cases: 2 } },
      { id: "end", kind: "event", label: "End", tags: ["end"] },
    ],
    edges: [
      { id: "start->a", kind: "follows", source: "start", target: "a", metrics: { count: 100 } },
      { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 80 } },
      { id: "b->end", kind: "follows", source: "b", target: "end", metrics: { count: 80 } },
      { id: "a->end", kind: "follows", source: "a", target: "end", metrics: { count: 20 } },
      { id: "a->r", kind: "follows", source: "a", target: "r", metrics: { count: 2 } },
      { id: "r->b", kind: "follows", source: "r", target: "b", metrics: { count: 2 } },
    ],
    overlays: marks,
  });
  const badge: Overlay = { kind: "badge", target: "r", payload: { text: "rare deviation" } };
  const onPath: Overlay = { kind: "badge", target: "r->b", payload: { text: "on a path" } };
  const arc: Overlay = { kind: "arc", target: "r->b", payload: { source: "r", target: "b", label: "connects two" } };

  it("hide a mark that is not protected with its element, and name it", () => {
    for (const [mark, id] of [[badge, "badge:r:0"], [onPath, "badge:r->b:0"], [arc, "arc:r->b:0"]] as const) {
      for (const options of [byShares(0, 0), { minNodeShare: 0.5, minEdgeShare: 0.5 }]) {
        const result = abstract(rareGraph([mark]), options);
        expect(result.nodes.map((n) => n.id)).not.toContain("r");
        expect(result.overlays).toEqual([]);
        expect(result.meta?.shown).toMatchObject({ marksNotShown: [id], forProtected: [] });
      }
    }
  });

  it("show the element of a protected mark at every share, on a way from start to end, with its mark", () => {
    for (const [mark, elements] of [[badge, ["r"]], [onPath, ["b", "r", "r->b"]], [arc, ["b", "r"]]] as const) {
      const marked = { ...mark, protected: true };
      for (const a of [0, 0.3, 0.6, 1]) {
        for (const p of PATH_SHARES) {
          const result = abstract(rareGraph([marked]), byShares(a, p));
          const shown = new Set([...result.nodes, ...result.edges].map((el) => el.id));
          expect(elements.every((id) => shown.has(id)), `${mark.target} ${a} ${p}`).toBe(true);
          expect(offWays(result)).toEqual([]);
          expect(result.overlays).toEqual([marked]);
          expect(result.meta?.shown?.marksNotShown).toEqual([]);
        }
      }
      const lowest = abstract(rareGraph([marked]), byShares(0, 0));
      // At the lowest shares only "a" is shown by rank; "b" stays for the arc and the path.
      // The path from "r" to "b" is the anchor of "r" out of it, so it is not shown for the mark alone.
      expect(lowest.meta?.shown?.forProtected).toEqual(mark === badge ? ["r"] : ["b", "r"]);
      const thresholds = abstract(rareGraph([marked]), { minNodeShare: 0.5, minEdgeShare: 0.5 });
      expect(elements.every((id) => [...thresholds.nodes, ...thresholds.edges].some((el) => el.id === id))).toBe(true);
      expect(thresholds.overlays).toEqual([marked]);
      // With thresholds an element is listed when its own strength is below them: "b" passes, "r" and its path do not.
      expect(thresholds.meta?.shown?.forProtected).toEqual(mark === onPath ? ["r", "r->b"] : ["r"]);
    }
  });

  it("see the marks the views draw and those of a graph converted to BPMN", async () => {
    const marked = { ...badge, protected: true };
    const positions = await layout(rareGraph([]), { engine: "dagre" });
    const set = await buildViews(rareGraph([]), [{ id: "plain", label: "Plain" }, { id: "marked", label: "Marked", overlays: [marked] }], { abstraction: byShares(0, 0), positions });
    expect(set.base.nodes.map((n) => n.id)).toContain("r");
    expect((await buildViews(rareGraph([]), [{ id: "plain", label: "Plain" }], { abstraction: byShares(0, 0), positions })).base.nodes.map((n) => n.id)).not.toContain("r");
    expect(liteFromGraph(rareGraph([marked]), { abstraction: byShares(0, 0) }).nodes.map((n) => n.id)).toContain("r");
    expect(liteFromGraph(rareGraph([badge]), { abstraction: byShares(0, 0) }).nodes.map((n) => n.id)).not.toContain("r");
  });

  it("see marks given beside the graph as those inside it", () => {
    const beside = abstract(rareGraph([]), byShares(0, 0, { marks: [{ ...badge, protected: true }] }));
    const inside = abstract(rareGraph([{ ...badge, protected: true }]), byShares(0, 0));
    expect(beside.nodes).toEqual(inside.nodes);
    expect(beside.edges).toEqual(inside.edges);
    expect(beside.overlays).toEqual([]);
    expect(beside.meta?.shown).toEqual(inside.meta?.shown);
    expect(abstract(rareGraph([]), byShares(0, 0, { marks: [badge] })).meta?.shown?.marksNotShown).toEqual(["badge:r:0"]);
  });

  it("count on the whole log the marks whose element is not shown, and keep a protected one at every share", () => {
    const marks = overlaysFor(constraintItems(), { graph: globalScene });
    const lowest = abstract(globalScene, byShares(0, 0, { marks }));
    const shown = new Set([...lowest.nodes, ...lowest.edges, ...(lowest.groups ?? [])].map((el) => el.id));
    const hidden = marks.filter((m) => (m.kind === "arc" ? !shown.has(String(m.payload?.source)) || !shown.has(String(m.payload?.target)) : m.target !== "__map" && !shown.has(m.target)));
    expect(hidden.length).toBeGreaterThan(0);
    expect(lowest.meta?.shown?.marksNotShown).toHaveLength(hidden.length);
    expect(lowest.meta?.shown?.marksNotShown.filter((id) => id.startsWith("badge:cancel_invoice_receipt:"))).toHaveLength(1);

    const exclusion = (m: Overlay) => m.kind === "badge" && m.target === "cancel_invoice_receipt";
    const protectedMarks = marks.map((m) => (exclusion(m) ? { ...m, protected: true } : m));
    for (const a of POSITIONS) {
      for (const p of PATH_SHARES) {
        const result = abstract({ ...globalScene, overlays: protectedMarks }, byShares(a, p));
        expect(result.nodes.some((n) => n.id === "cancel_invoice_receipt"), `${a} ${p}`).toBe(true);
        expect(result.overlays?.some(exclusion), `${a} ${p}`).toBe(true);
        expect(offWays(result), `${a} ${p}`).toEqual([]);
      }
    }
    // With stages collapsed the badge sits on the activity's stage.
    const stage = globalScene.nodes.find((n) => n.id === "cancel_invoice_receipt")!.group!;
    const collapsed = abstract({ ...globalScene, overlays: protectedMarks }, byShares(0, 0, { collapse: "all" }));
    expect(collapsed.nodes.map((n) => n.id)).toContain(stage);
    expect(collapsed.overlays?.filter((m) => m.kind === "badge" && m.target === stage && m.protected)).toHaveLength(1);
    const beside = abstract(globalScene, byShares(0, 0, { collapse: "all", marks: protectedMarks }));
    expect(beside.nodes).toEqual(collapsed.nodes);
    expect(beside.meta?.shown?.marksNotShown).toEqual(collapsed.meta?.shown?.marksNotShown);
  });
});
