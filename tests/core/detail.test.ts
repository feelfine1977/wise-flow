import { describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene } from "../../fixtures/bpic2019";
import { liteFromGraph } from "../../src/bpmn/headless";
import { ANCHOR_TAG, INDIRECT_TAG, type AbstractOptions, type FlowEdge, type FlowGraph, type FlowNode, type Overlay, abstract, buildScene, buildViews, collapseGroups, diff, hasTag, layout, overlaysFor, toSVG } from "../../src/index";
import { detailGraph, offWays, seeded, shuffled, wayThrough, wayThroughHidden } from "./detail-cases";

const isActivity = (n: FlowNode) => n.kind === "activity" || n.kind === "stage";
const ids = (elements: { id: string }[]) => elements.map((el) => el.id).sort();
const byShares = (activityDetail: number, pathDetail: number, more: AbstractOptions = {}): AbstractOptions => ({ activityDetail, pathDetail, ...more });
const PATH_SHARES = [0, 0.1, 0.25, 0.5, 1];
/** Every activity position of the whole log (42 activities), and 0. */
const POSITIONS = Array.from({ length: 43 }, (_, k) => k / 42);
const diffScene = diff(globalScene, vendorScene);

/** What the rank reads: an activity's cases and events, a path's count. */
interface Measure {
  cases: (n: FlowNode) => number;
  events: (n: FlowNode) => number;
  count: (e: FlowEdge) => number;
}
const counted: Measure = { cases: (n) => n.metrics?.cases ?? 0, events: (n) => n.metrics?.events ?? 0, count: (e) => e.metrics?.count ?? 0 };

/**
 * Of a comparison, the larger of an element's value on side b and on side a (`a_<name>`), each relative to the
 * largest of its side; a self-loop against the largest path that is not one; 1 where neither side measured it.
 */
function eitherSide(graph: FlowGraph): Measure {
  const relative = (elements: (FlowNode | FlowEdge)[], name: string, against = elements) => {
    const max = (prefix: string) => Math.max(...against.map((el) => el.metrics?.[`${prefix}${name}`] ?? 0));
    const [b, a] = [max(""), max("a_")];
    return new Map(elements.map((el) => [el.id, el.metrics?.[name] === undefined && el.metrics?.[`a_${name}`] === undefined ? 1 : Math.max((el.metrics?.[name] ?? -Infinity) / b, (el.metrics?.[`a_${name}`] ?? -Infinity) / a)]));
  };
  const activities = graph.nodes.filter(isActivity);
  const follows = graph.edges.filter((e) => e.source !== e.target);
  const [cases, events] = [relative(activities, "cases"), relative(activities, "events")];
  const count = new Map([...relative(follows, "count"), ...relative(graph.edges.filter((e) => e.source === e.target), "count", follows)]);
  return { cases: (n) => cases.get(n.id)!, events: (n) => events.get(n.id)!, count: (e) => count.get(e.id)! };
}

/** The activities in their rank, written out: cases, then events, then id. */
const activityRank = (graph: FlowGraph, m: Measure) => graph.nodes.filter(isActivity).sort((a, b) => m.cases(b) - m.cases(a) || m.events(b) - m.events(a) || (a.id < b.id ? -1 : 1));

/** The activities a share shows by rank; ties enter whole. */
function rankedActivities(graph: FlowGraph, share: number, m: Measure = counted): Set<string> {
  const list = activityRank(graph, m);
  let count = Math.max(1, Math.ceil(share * list.length - 1e-9));
  while (count < list.length && m.cases(list[count]) === m.cases(list[count - 1]) && m.events(list[count]) === m.events(list[count - 1])) count++;
  return new Set(list.slice(0, count).map((n) => n.id));
}

/** The paths in their rank over the whole graph: count, then id. */
const rankedPaths = (graph: FlowGraph, m: Measure = counted) => graph.edges.filter((e) => e.kind !== "constraint").sort((a, b) => m.count(b) - m.count(a) || (a.id < b.id ? -1 : 1));

/** Whether a node is shown at an activity share: an event or gateway always, an activity by its rank. */
const isShownEnd = (graph: FlowGraph, shown: Set<string>, id: string) => shown.has(id) || graph.nodes.some((n) => n.id === id && !isActivity(n));

/**
 * The anchor-only paths and indirect paths of a graph at a pair of shares, by the rule written out: each
 * shown activity's strongest path from and to a more frequent activity, an event or a gateway that a start
 * reaches (that reaches an end), ties by id, no self-loop; without one, of the ways through rarer activities
 * to such a node, one whose rarest activity is the most frequent (tried limit by limit), then with the
 * fewest steps. A way is split at the shown activities: a step between two shown nodes outside the paths
 * share is an anchor-only path, keeping the activity; a stretch through hidden ones is an indirect path,
 * named by its way.
 */
function anchorKeeps(graph: FlowGraph, m: Measure = counted): (share: number, pathShare: number) => { keeps: Record<string, string[]>; indirect: string[] } {
  const order = activityRank(graph, m);
  const place = new Map(order.map((n, i) => [n.id, i]));
  const paths = graph.edges.filter((e) => e.kind !== "constraint" && e.source !== e.target).sort((a, b) => (a.id < b.id ? -1 : 1));
  const events = (tag: string) => graph.nodes.filter((n) => n.kind === "event" && n.tags?.includes(tag)).map((n) => n.id);
  const reach = (from: string[], back: boolean) => {
    const reached = new Set(from);
    for (const id of reached) for (const e of paths) if ((back ? e.target : e.source) === id) reached.add(back ? e.source : e.target);
    return reached;
  };
  const [fromStart, toEnd] = [reach(events("start"), false), reach(events("end"), true)];
  const ways = new Map<string, string[][]>();
  for (const v of order) {
    const list: string[][] = [];
    for (const back of [true, false]) {
      const live = back ? fromStart : toEnd;
      const terminal = new Set(events(back ? "start" : "end"));
      const anchoring = (id: string) => terminal.has(id) || (live.has(id) && (!place.has(id) || place.get(id)! < place.get(v.id)!));
      const near = (id: string) => paths.filter((e) => (back ? e.target : e.source) === id);
      const other = (e: FlowEdge) => (back ? e.source : e.target);
      const strongest = near(v.id).filter((e) => anchoring(other(e))).sort((a, b) => m.count(b) - m.count(a) || (a.id < b.id ? -1 : 1))[0];
      let way = strongest && [v.id, other(strongest)];
      for (let limit = place.get(v.id)! + 1; !way && limit < order.length; limit++) {
        const from = new Map<string, string>([[v.id, ""]]);
        const queue = [v.id];
        for (let i = 0; i < queue.length && !way; i++) {
          if (queue[i] !== v.id && anchoring(queue[i])) {
            way = [queue[i]];
            while (way[0] !== v.id) way.unshift(from.get(way[0])!);
            continue;
          }
          for (const e of near(queue[i])) {
            const next = other(e);
            if (from.has(next) || !live.has(next) || (!anchoring(next) && place.get(next)! > limit)) continue;
            from.set(next, queue[i]);
            queue.push(next);
          }
        }
      }
      expect(way, `${v.id} ${back ? "in" : "out"}`).toBeDefined();
      list.push(back ? [...way!].reverse() : way!);
    }
    ways.set(v.id, list);
  }
  const ranked = rankedPaths(graph, m);
  return (share, pathShare) => {
    const shown = rankedActivities(graph, share, m);
    const within = new Set(ranked.slice(0, Math.ceil(pathShare * ranked.length - 1e-9)).map((e) => e.id));
    const keeps = new Map<string, string[]>();
    const indirect = new Set<string>();
    for (const v of shown) {
      for (const way of ways.get(v)!) {
        const at = way.map((id, i) => i).filter((i) => isShownEnd(graph, shown, way[i]));
        for (let k = 1; k < at.length; k++) {
          const [source, target] = [way[at[k - 1]], way[at[k]]];
          if (at[k] > at[k - 1] + 1) indirect.add(`${way.slice(at[k - 1], at[k] + 1).join("->")}:indirect`);
          else {
            const e = paths.find((x) => x.source === source && x.target === target)!;
            if (!within.has(e.id)) keeps.set(e.id, [...(keeps.get(e.id) ?? []), v].sort());
          }
        }
      }
    }
    return { keeps: Object.fromEntries([...keeps].sort(([x], [y]) => (x < y ? -1 : 1))), indirect: [...indirect].sort() };
  };
}

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
          for (const p of PATH_SHARES) {
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
      ["diff", diffScene, {}],
      ["global marked", { ...globalScene, overlays: overlaysFor(constraintItems(), { graph: globalScene }).map((m, i) => (i % 3 ? m : { ...m, protected: true })) }, {}],
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
        // An indirect path that stays stands for the same way.
        for (const e of less.edges.filter((x) => edges.has(x.id) && hasTag(x, INDIRECT_TAG))) expect(more.edges.find((x) => x.id === e.id)?.payload, `${name}: ${e.id}`).toEqual(e.payload);
        for (const e of less.edges.filter((x) => !edges.has(x.id))) {
          expect(hasTag(e, INDIRECT_TAG), `${name} ${a1}/${p1} → ${a2}/${p2}: ${e.id}`).toBe(true);
          expect((e.payload as { via: string[] }).via.some((id) => nodes.has(id)), `${name}: ${e.id}`).toBe(true);
          // Replaced by the paths it stood for: a way between its ends through activities that came into view.
          const cameIntoView = new Set(more.nodes.filter((n) => !less.nodes.some((m) => m.id === n.id)).map((n) => n.id));
          expect(wayThrough(more, e.source, e.target, cameIntoView), `${name}: ${e.id} replaced`).toBe(true);
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
    expect(indirect).toEqual([{ id: "start->rarer->rare->late:indirect", kind: "follows", source: "start", target: "late", tags: [INDIRECT_TAG], payload: { hiddenActivities: 2, via: ["rarer", "rare"] } }]);
    expect(result.meta?.shown).toMatchObject({ indirect: 1, anchorsOnly: 3 });
    expect(offWays(result)).toEqual([]);
    // With "rare" in view the indirect path gives way to the paths it stood for, and to a shorter indirect one.
    const more = abstract(graph, byShares(0.75, 0));
    expect(ids(more.edges)).toEqual(["busy->end", "late->end", "rare->late", "start->busy", "start->rarer->rare:indirect"]);
    expect(more.edges.find((e) => e.id === "start->rarer->rare:indirect")?.payload).toEqual({ hiddenActivities: 1, via: ["rarer"] });
    // Of two ways into "late" through rarer activities, the one whose rarest activity is the more frequent
    // stands, though it is longer and its paths are weaker: through m1 (8 cases) and m2 (7), not through r (2).
    const choice: FlowGraph = {
      nodes: [
        ...graph.nodes.filter((n) => ["start", "busy", "late", "end"].includes(n.id)),
        { id: "m1", kind: "activity", label: "M1", metrics: { cases: 8 } },
        { id: "m2", kind: "activity", label: "M2", metrics: { cases: 7 } },
        { id: "r", kind: "activity", label: "R", metrics: { cases: 2 } },
      ],
      edges: [
        ...graph.edges.filter((e) => ["start->busy", "busy->end", "late->end"].includes(e.id)),
        { id: "start->r", kind: "follows", source: "start", target: "r", metrics: { count: 2 } },
        { id: "r->late", kind: "follows", source: "r", target: "late", metrics: { count: 2 } },
        { id: "start->m1", kind: "follows", source: "start", target: "m1", metrics: { count: 1 } },
        { id: "m1->m2", kind: "follows", source: "m1", target: "m2", metrics: { count: 1 } },
        { id: "m2->late", kind: "follows", source: "m2", target: "late", metrics: { count: 1 } },
      ],
    };
    expect(abstract(choice, byShares(0.4, 0)).edges.filter((e) => hasTag(e, INDIRECT_TAG)).map((e) => [e.id, e.payload])).toEqual([["start->m1->m2->late:indirect", { hiddenActivities: 2, via: ["m1", "m2"] }]]);
    // Every way into "late" passes w (1 case), so of them the one with the fewest steps stands: through b
    // (20 cases), not through a1 to a3 (60 to 40), though up to x (25) that way's rarest is the more frequent.
    const steps: FlowGraph = {
      nodes: [
        ...graph.nodes.filter((n) => ["start", "busy", "late", "end"].includes(n.id)),
        ...([["a1", 60], ["a2", 50], ["a3", 40], ["b", 20], ["u", 30], ["x", 25], ["w", 1]] as const).map(([id, cases]) => ({ id, kind: "activity" as const, label: id, metrics: { cases } })),
      ],
      edges: [
        ...graph.edges.filter((e) => ["start->busy", "busy->end", "late->end"].includes(e.id)),
        ...[["start", "w"], ["w", "x"], ["x", "a3"], ["a3", "a2"], ["a2", "a1"], ["a1", "u"], ["x", "b"], ["b", "u"], ["u", "late"]].map(([source, target]) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count: 1 } })),
      ],
    };
    expect(abstract(steps, byShares(2 / 9, 0)).edges.filter((e) => hasTag(e, INDIRECT_TAG)).map((e) => [e.id, e.payload])).toEqual([["start->w->x->b->u->late:indirect", { hiddenActivities: 4, via: ["w", "x", "b", "u"] }]]);
  });

  it("state in meta what is shown, as computed from the graph", () => {
    for (const graph of [globalScene, vendorScene]) {
      const anchorsAt = anchorKeeps(graph);
      for (const [a, p] of [[0, 0], [0.2, 0.05], [0.5, 0.25], [0.8, 0.5], [1, 0.1]]) {
        const result = abstract(graph, byShares(a, p));
        const shown = rankedActivities(graph, a);
        const ranked = rankedPaths(graph);
        const byFrequency = ranked.slice(0, Math.ceil(p * ranked.length - 1e-9)).filter((e) => isShownEnd(graph, shown, e.source) && isShownEnd(graph, shown, e.target));
        const { keeps, indirect } = anchorsAt(a, p);
        const edges = new Set([...byFrequency.map((e) => e.id), ...Object.keys(keeps)]);
        // The events of the shown activities, of all; the slider's stops are where a tie of cases and events ends.
        const order = activityRank(graph, counted);
        const events = (ids: Set<string>) => order.filter((n) => ids.has(n.id)).reduce((sum, n) => sum + n.metrics!.events!, 0);
        const stops = order.map((_, i) => i + 1).filter((k) => k === order.length || order[k].metrics!.cases !== order[k - 1].metrics!.cases || order[k].metrics!.events !== order[k - 1].metrics!.events);
        const expected = {
          activities: { shown: shown.size, of: graph.nodes.filter(isActivity).length },
          paths: { shown: edges.size, of: graph.edges.length },
          anchorsOnly: Object.keys(keeps).length,
          keeps,
          indirect: indirect.length,
          byFrequency: byFrequency.length,
          ...(byFrequency.length && { weakestByFrequency: byFrequency.at(-1)!.metrics!.count }),
          ...(ranked.some((e) => !edges.has(e.id)) && { strongestNotShown: ranked.find((e) => !edges.has(e.id))!.metrics!.count }),
          weakestShown: ranked.filter((e) => edges.has(e.id)).at(-1)!.metrics!.count,
          events: { shown: events(shown), of: events(new Set(order.map((n) => n.id))) },
          positions: { activities: stops, paths: ranked.length, at: { activities: shown.size, paths: Math.max(0, Math.ceil(p * ranked.length - 1e-9)) } },
          marksNotShown: [],
          forProtected: [],
        };
        expect(result.meta?.shown, `${a} ${p}`).toEqual(expected);
        expect(ids(result.edges), `${a} ${p}`).toEqual([...edges, ...indirect].sort());
      }
    }
    // With the scene's marks, the exclusion on "Cancel Invoice Receipt" protected: the marks whose element the
    // shares do not show, by kind and target, and the activity listed while its rank alone would not show it.
    const exclusion = (m: Overlay) => m.kind === "badge" && m.target === "cancel_invoice_receipt";
    const marks = overlaysFor(constraintItems(), { graph: globalScene }).map((m) => (exclusion(m) ? { ...m, protected: true } : m));
    for (const [a, p] of [[0, 0], [0.2, 0.05], [0.5, 0.25], [0.8, 0.5], [1, 0.1]]) {
      const result = abstract(globalScene, byShares(a, p, { marks }));
      const shown = new Set([...result.nodes, ...result.edges, ...(result.groups ?? [])].map((el) => el.id));
      const hidden = marks.filter((m) => (m.kind === "arc" ? !shown.has(String(m.payload?.source)) || !shown.has(String(m.payload?.target)) : m.target !== "__map" && !shown.has(m.target)));
      const named = result.meta!.shown!.marksNotShown;
      expect(named.map((id) => id.replace(/:\d+$/, "")).sort(), `${a} ${p}`).toEqual(hidden.map((m) => `${m.kind}:${m.target}`).sort());
      expect(new Set(named).size, `${a} ${p}`).toBe(named.length);
      expect(result.meta?.shown?.forProtected, `${a} ${p}`).toEqual(rankedActivities(globalScene, a).has("cancel_invoice_receipt") ? [] : ["cancel_invoice_receipt"]);
    }
  });

  it("anchor each shown activity of the committed scenes by its strongest path from and to a more frequent activity, the start or the end, or the way through rarer ones", () => {
    for (const graph of [globalScene, vendorScene]) {
      const anchorsAt = anchorKeeps(graph);
      for (const a of POSITIONS) {
        for (const p of PATH_SHARES) {
          const result = abstract(graph, byShares(a, p));
          const { keeps, indirect } = anchorsAt(a, p);
          expect(ids(result.edges.filter((e) => hasTag(e, ANCHOR_TAG))), `${a} ${p}`).toEqual(Object.keys(keeps));
          expect(result.meta?.shown?.keeps, `${a} ${p}`).toEqual(keeps);
          expect(ids(result.edges.filter((e) => hasTag(e, INDIRECT_TAG))), `${a} ${p}`).toEqual(indirect);
        }
      }
    }
  });

  it("anchor an activity only on a node that a start reaches, or that reaches an end", () => {
    const path = (source: string, target: string, count?: number): FlowEdge => ({ id: `${source}->${target}`, kind: "follows", source, target, ...(count !== undefined && { metrics: { count } }) });
    // "abort" is an event that ends no way: the strongest path out of "a" leads there, the way out is the path to the end.
    const deadEnd: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
        { id: "abort", kind: "event", label: "Abort" },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: [path("start", "a", 100), path("a", "abort", 60), path("a", "end", 40)],
    };
    const loose = abstract(deadEnd, byShares(1, 0));
    expect(offWays(loose)).toEqual([]);
    expect(ids(loose.edges.filter((e) => hasTag(e, ANCHOR_TAG)))).toEqual(["a->end", "start->a"]);
    // "u" is more frequent than "v" but no start reaches it: "v" comes in from the start, for its protected mark too.
    const unreached: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
        { id: "u", kind: "activity", label: "U", metrics: { cases: 50 } },
        { id: "v", kind: "activity", label: "V", metrics: { cases: 10 } },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: [path("start", "a", 100), path("a", "end", 100), path("start", "v", 5), path("v", "end", 10), path("u", "v", 50), path("u", "end", 50)],
      overlays: [{ kind: "badge", target: "v", payload: { text: "rare" }, protected: true }],
    };
    expect(offWays(unreached)).toEqual(["u"]);
    for (const a of [0, 0.5, 1]) {
      const result = abstract(unreached, byShares(a, 0));
      expect(offWays(result), `${a}`).toEqual(result.nodes.some((n) => n.id === "u") ? ["u"] : []);
      expect(result.edges.map((e) => e.id), `${a}`).toContain("start->v");
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
    // At the thresholds, the sliders stand where the activities and paths they pass are: all 42 activities, the 31 paths of
    // at least 3 % of the strongest's count, counted here.
    const strongest = Math.max(...globalScene.edges.filter((e) => e.source !== e.target).map((e) => e.metrics!.count!));
    const passing = globalScene.edges.filter((e) => e.metrics!.count! >= 0.03 * strongest).length;
    expect(passing).toBe(31);
    expect(loose.meta?.shown).toMatchObject({ activities: { shown: 42, of: 42 }, paths: { shown: 31, of: 677 }, withoutPath: 30, marksNotShown: [], forProtected: [] });
    expect(loose.meta?.shown?.positions.at).toEqual({ activities: 42, paths: passing });
    expect(loose.meta?.shown?.positions.paths).toBe(677);
    expect(loose.meta?.shown?.anchorsOnly).toBeUndefined();
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
    // Ranked and anchored by either side, as written out in the test.
    const measure = eitherSide(diffScene);
    const anchorsAt = anchorKeeps(diffScene, measure);
    for (const [a, p] of [[0, 0], [0.25, 0.1], [0.5, 0.5]]) {
      const result = abstract(diffScene, byShares(a, p));
      const shown = rankedActivities(diffScene, a, measure);
      const ranked = rankedPaths(diffScene, measure);
      const byFrequency = ranked.slice(0, Math.ceil(p * ranked.length - 1e-9)).filter((e) => isShownEnd(diffScene, shown, e.source) && isShownEnd(diffScene, shown, e.target));
      const { keeps, indirect } = anchorsAt(a, p);
      expect(ids(result.nodes.filter(isActivity)), `${a} ${p}`).toEqual([...shown].sort());
      expect(ids(result.edges), `${a} ${p}`).toEqual([...new Set([...byFrequency.map((e) => e.id), ...Object.keys(keeps)]), ...indirect].sort());
      expect(result.meta?.shown?.keeps, `${a} ${p}`).toEqual(keeps);
      expect(offWays(result), `${a} ${p}`).toEqual([]);
    }
    const lowest = abstract(diffScene, byShares(0, 0));
    expect(lowest.nodes.filter(isActivity)).toHaveLength(1);
    expect(lowest.edges.every((e) => hasTag(e, ANCHOR_TAG) || hasTag(e, INDIRECT_TAG))).toBe(true);
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

  it("move the marks of the views to their stage when stages are collapsed, as those inside the graph", async () => {
    const staged = (marks: Overlay[]): FlowGraph => ({
      ...rareGraph(marks),
      nodes: rareGraph([]).nodes.map((n) => (n.kind === "activity" ? { ...n, group: n.id === "r" ? "g2" : "g1" } : n)),
      groups: [{ id: "g1", kind: "stage", label: "G1" }, { id: "g2", kind: "stage", label: "G2" }],
    });
    const marked = { ...badge, protected: true };
    const plain = { ...badge, target: "a", payload: { text: "plain" } };
    const options = byShares(0, 0, { collapse: "all" });
    const inside = abstract(staged([marked, plain]), options);
    expect(inside.overlays).toEqual([{ ...marked, target: "g2" }, { ...plain, target: "g1" }]);
    const positions = await layout(inside, { engine: "dagre" });
    const set = await buildViews(staged([]), [{ id: "marked", label: "Marked", overlays: [marked, plain] }], { abstraction: options, positions });
    expect(set.base.nodes).toEqual(inside.nodes);
    expect(set.views[0].overlays).toEqual(inside.overlays);
    expect(buildScene(set.views[0].graph, set.positions, { overlays: set.views[0].overlays }).marks).toHaveLength(2);
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

  it("export the same marks whether they are given beside the graph or inside it", async () => {
    // At the lowest shares "b" is not shown: its mark is not drawn, the protected one on "r" is.
    const marks: Overlay[] = [{ ...badge, protected: true }, { kind: "badge", target: "b", payload: { text: "plain mark" } }];
    const inside = abstract(rareGraph(marks), byShares(0, 0));
    const beside = abstract(rareGraph([]), byShares(0, 0, { marks }));
    const positions = await layout(inside, { engine: "dagre" });
    const svg = toSVG({ graph: inside, positions });
    expect(toSVG({ graph: beside, positions, overlays: marks })).toBe(svg);
    expect(buildScene(beside, positions, { overlays: marks }).marks.map((m) => m.id)).toEqual(buildScene(inside, positions).marks.map((m) => m.id));
    expect(buildScene(inside, positions).marks.map((m) => m.overlay.target)).toEqual(["r"]);
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
