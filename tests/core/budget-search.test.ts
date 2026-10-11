import { describe, expect, it } from "vitest";
import { type EdgeSelection, type FlowEdge, type FlowGraph, type FlowScene, type Overlay, type Positions, type ShownEdges, type StyleSpec, budgetEdges, buildScene, toSVG } from "../../src/index";
import { type DrawContext, type PreparedScene, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { type FamilyName, families } from "../support/graphs";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { positionsOf } from "../support/scenes";
import { shrinkCase, shrinkGraph } from "../support/shrink";

// ---------------------------------------------------------------------------
// The rule as docs/API.md states it, written here and shared with nothing under src/: protected
// edges first (an overlay mark on the edge, selected, at the keyboard position, on a highlighted
// path), then the weight the edge width reads descending (an edge without it last), then the id.
// A budget of n draws the first n edges of that order and every protected edge even beyond n.

interface Protection {
  selection?: { edges: readonly string[] };
  focused?: string | null;
  highlighted?: ReadonlySet<string>;
}

/** An overlay of the graph marks the edge: an arc from its source to its target, or an overlay that names it. */
function marked(edge: FlowEdge, overlays: readonly Overlay[]): boolean {
  return overlays.some((o) => (o.kind === "arc" && String(o.payload?.source) === edge.source && String(o.payload?.target) === edge.target) || o.payload?.edgeId === edge.id);
}

function weightOf(edge: FlowEdge, metricName: string): number {
  const v = edge.metrics?.[metricName];
  return typeof v === "number" && Number.isFinite(v) ? v : -Infinity;
}

interface Expected {
  /** Protected edges in view, then the heaviest others the budget has room for. */
  drawn: string[];
  kept: number;
  shown: number;
  total: number;
  withheld: boolean;
}

/** What a budget draws of `viewIds`, the ids of the edges in view in the scene's order. */
function expectedDrawn(graph: FlowGraph, style: StyleSpec | undefined, viewIds: readonly string[], budget: number, protection: Protection): Expected {
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  const overlays = graph.overlays ?? [];
  const metricName = style?.edgeWidth?.metric ?? "count";
  const isProtected = (id: string) => marked(byId.get(id)!, overlays) || !!protection.selection?.edges.includes(id) || protection.focused === id || !!protection.highlighted?.has(id);
  const kept = viewIds.filter(isProtected);
  const others = viewIds
    .filter((id) => !isProtected(id))
    .sort((a, b) => {
      const wa = weightOf(byId.get(a)!, metricName);
      const wb = weightOf(byId.get(b)!, metricName);
      if (wa !== wb) return wb > wa ? 1 : -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const drawn = [...kept, ...others.slice(0, Math.max(0, budget - kept.length))];
  return { drawn, kept: kept.length, shown: drawn.length, total: viewIds.length, withheld: drawn.length < viewIds.length };
}

/** The note's text, by hand; every count here is below a thousand. */
const noteText = (shown: number, total: number) => `Showing ${shown} of ${total} flows`;

// ---------------------------------------------------------------------------
// Cases: a graph of a family, its weights in one of four modes, overlays that protect edges, a
// selection, a keyboard position, a highlighted path, and sometimes only part of the edges in view.

const FAMILIES: readonly FamilyName[] = ["chain", "layered", "tree", "cyclic", "hub", "components", "stages", "lanes", "nested", "overlaid"];
type WeightMode = "ties" | "distinct" | "missing" | "cases";
const MODES: readonly WeightMode[] = ["ties", "distinct", "missing", "cases"];

interface BudgetCase {
  seed: number;
  family: FamilyName;
  size: number;
  mode: WeightMode;
  graph: FlowGraph;
  style: StyleSpec | undefined;
  positions: Positions;
  scene: FlowScene;
  /** Positions in `scene.edgeMarks` of the edges in view, or undefined for every edge. */
  inView: number[] | undefined;
  /** The ids of the edges in view, in the scene's order. */
  viewIds: string[];
  protection: { selection: { edges: string[] }; focused: string | null; highlighted: Set<string> };
}

/** Everything a case holds besides its graph, drawn from the seed so that a shrunk graph is dressed the same way. */
function dress(given: FlowGraph, seed: number, family: FamilyName, size: number): BudgetCase {
  const rng = createRandom(seed + 700_007);
  const mode = rng.pick(MODES);
  // Activities count at least a thousand cases, so their labels ("1.2k") are told apart from edge counts.
  const graph: FlowGraph = {
    ...given,
    nodes: given.nodes.map((n) => (n.kind === "activity" ? { ...n, metrics: { ...n.metrics, cases: 1000 + rng.int(0, 9000) } } : n)),
    edges: given.edges.map((e) => ({ ...e, metrics: e.metrics && { ...e.metrics } })),
  };
  for (const e of graph.edges) {
    if (e.kind !== "follows") continue;
    if (e.metrics?.count !== undefined) e.metrics.count = Math.min(999, e.metrics.count);
    if (mode === "ties") e.metrics = { ...e.metrics, count: rng.int(1, 4) };
    if (mode === "missing" && rng.chance(0.3)) {
      if (rng.chance()) delete e.metrics;
      else delete e.metrics!.count;
    }
    if (mode === "cases" && rng.chance(0.2)) delete e.metrics?.cases;
  }
  const overlays: Overlay[] = [...(given.overlays ?? [])];
  const drawable = graph.edges.filter((e) => e.source !== e.target);
  for (let k = rng.int(0, 3); k > 0 && drawable.length; k--) {
    const e = rng.pick(drawable);
    if (rng.chance(0.6)) overlays.push({ kind: "arc", target: e.id, payload: { constraintId: "lag", source: e.source, target: e.target, value: 0.5 } });
    // A reverse arc protects the edge the other way, if there is one.
    else if (rng.chance()) overlays.push({ kind: "arc", target: `${e.target}->${e.source}`, payload: { constraintId: "order", source: e.target, target: e.source, value: 0.3, reverse: true } });
    else overlays.push({ kind: "badge", target: e.source, payload: { constraintId: "loop", glyph: "↺", value: 0.2, edgeId: e.id } });
  }
  graph.overlays = overlays;
  const style: StyleSpec | undefined = mode === "cases" ? { edgeWidth: { metric: "cases" } } : undefined;
  const positions = positionsOf(graph, "grid", seed);
  const scene = buildScene(graph, positions, { style, selfLoops: false });
  const marks = scene.edgeMarks;
  const all = marks.map((_, i) => i);
  const inView = rng.chance(0.5) ? undefined : rng.sample(all, rng.int(0, marks.length));
  const viewIds = (inView ?? all).map((i) => marks[i].id);
  const ids = marks.map((m) => m.id);
  const nodeIds = graph.nodes.map((n) => n.id);
  // Some of the protection names no edge of the scene.
  const ghost = () => (rng.chance(0.2) ? ["ghost"] : []);
  const protection = {
    selection: { edges: [...rng.sample(ids, rng.int(0, Math.min(3, ids.length))), ...ghost()] },
    focused: rng.pick([null, null, ids.length ? rng.pick(ids) : null, nodeIds.length ? rng.pick(nodeIds) : null]),
    highlighted: new Set([...rng.sample(ids, rng.int(0, Math.min(4, ids.length))), ...ghost()]),
  };
  return { seed, family, size, mode, graph, style, positions, scene, inView, viewIds, protection };
}

/** Searching tests run fifty times longer in deep mode; so may their timeout. */
const TIMEOUT = 30_000 * caseCount(1);

const cases = new Map<number, BudgetCase>();
function caseOf(seed: number): BudgetCase {
  let c = cases.get(seed);
  if (!c) {
    const rng = createRandom(seed);
    const family = rng.pick(FAMILIES);
    const size = rng.int(2, 40);
    c = dress(families[family](size, seed), seed, family, size);
    cases.set(seed, c);
  }
  return c;
}

type Check = (c: BudgetCase) => string | undefined;

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const idsOf = (scene: Pick<FlowScene, "edgeMarks">, sel: EdgeSelection) => [...sel.drawn].map((i) => scene.edgeMarks[i].id).sort();
const sorted = (ids: readonly string[]) => [...ids].sort();

/** The smallest case of the seed that still fails the check, by size and then by elements. */
function smallest(c: BudgetCase, check: Check): string {
  const fails = (g: FlowGraph) => check(dress(g, c.seed, c.family, c.size)) !== undefined;
  const small = shrinkCase({ size: c.size, generate: (n) => families[c.family](n, c.seed), shrink: shrinkGraph }, fails);
  const again = dress(small.value, c.seed, c.family, c.size);
  const { graph, mode, style, inView, protection } = again;
  const shown = { graph, mode, style, inView, protection: { ...protection, highlighted: [...protection.highlighted] } };
  return `smallest failing case after ${small.tests} tries (${graph.nodes.length} nodes, ${graph.edges.length} edges):\n${JSON.stringify(shown)}\n→ ${check(again)}`;
}

function holds(check: Check) {
  for (const seed of seeds(caseCount(300))) {
    const c = caseOf(seed);
    const problem = check(c);
    if (problem !== undefined) expect(problem, `${caseLabel(seed, `${c.family} ${c.size} ${c.mode}`)}: ${problem}\n${smallest(c, check)}`).toBeUndefined();
  }
}

// ---------------------------------------------------------------------------
// The checks.

const everyBudget: Check = (c) => {
  const { scene, viewIds, inView, protection, graph, style } = c;
  const total = viewIds.length;
  for (let budget = total + 1; budget >= 0; budget--) {
    const want = expectedDrawn(graph, style, viewIds, budget, protection);
    const got = budgetEdges(scene, budget, protection, inView);
    if (!want.withheld) {
      if (got !== undefined) return `budget ${budget} withholds nothing by the rule but reported ${got.shown} of ${got.total}`;
      continue;
    }
    if (!got) return `budget ${budget} should draw ${want.shown} of ${want.total} but withheld nothing`;
    const gotIds = idsOf(scene, got);
    if (!same(gotIds, sorted(want.drawn))) return `budget ${budget} drew [${gotIds}] instead of [${sorted(want.drawn)}]`;
    if (got.shown !== want.shown || got.total !== want.total) return `budget ${budget} counts ${got.shown} of ${got.total} instead of ${want.shown} of ${want.total}`;
  }
  for (const none of ["all", undefined, NaN] as const) {
    if (budgetEdges(scene, none, protection, inView) !== undefined) return `a budget of ${String(none)} withheld edges`;
  }
  return undefined;
};

const lowering: Check = (c) => {
  const { scene, viewIds, inView, protection, graph, style } = c;
  const total = viewIds.length;
  const everything = new Set(inView ?? scene.edgeMarks.map((_, i) => i));
  let previous: Set<number> | undefined;
  for (let budget = total; budget >= 0; budget--) {
    const drawn = budgetEdges(scene, budget, protection, inView)?.drawn ?? everything;
    if (previous) {
      for (const i of drawn) if (!previous.has(i)) return `budget ${budget} draws ${scene.edgeMarks[i].id}, which budget ${budget + 1} did not`;
      const removed = [...previous].filter((i) => !drawn.has(i)).map((i) => scene.edgeMarks[i].id);
      if (removed.length > 1) return `lowering the budget from ${budget + 1} to ${budget} removed ${removed.length} edges: ${removed}`;
      // The one removed is the last unprotected edge of the order drawn before; protected edges stay.
      const before = expectedDrawn(graph, style, viewIds, budget + 1, protection);
      const last = before.drawn.length > before.kept ? before.drawn[before.drawn.length - 1] : undefined;
      if (removed.length === 1 && removed[0] !== last) return `lowering the budget from ${budget + 1} to ${budget} removed ${removed[0]} instead of ${last ?? "nothing"}`;
    }
    previous = drawn;
  }
  return undefined;
};

const reported: Check = (c) => {
  const { scene, viewIds, inView, protection } = c;
  const total = viewIds.length;
  const rng = createRandom(c.seed + 900_009);
  for (let k = 0; k < 3 && total; k++) {
    const budget = rng.int(0, total);
    const sel = budgetEdges(scene, budget, protection, inView);
    // What a map reports: the drawn ids in the scene's order and the total of its note; sometimes an id of no edge too.
    const drawnIds = sel ? [...sel.drawn].sort((a, b) => a - b).map((i) => scene.edgeMarks[i].id) : viewIds;
    const shown: ShownEdges = { edges: rng.chance(0.3) ? [...drawnIds, "ghost"] : drawnIds, total: sel ? sel.total : total };
    const again = budgetEdges(scene, shown, {}, inView);
    if (!sel) {
      if (again !== undefined) return `a report of every edge in view withheld ${again.total - again.shown} edges`;
      continue;
    }
    if (!again) return `the report of budget ${budget} (${sel.shown} of ${sel.total}) withheld nothing`;
    if (!same(idsOf(scene, again), idsOf(scene, sel))) return `the report of budget ${budget} drew [${idsOf(scene, again)}] instead of [${idsOf(scene, sel)}]`;
    if (again.shown !== sel.shown || again.total !== shown.total) return `the report of budget ${budget} counts ${again.shown} of ${again.total} instead of ${sel.shown} of ${shown.total}`;
  }
  // A report counts what the map counted, also when the map saw a view of its own.
  if (total > 1) {
    const half = viewIds.slice(0, Math.floor(total / 2));
    const own = budgetEdges(scene, { edges: half, total: 12_345 }, {}, inView);
    if (!own || own.shown !== half.length || own.total !== 12_345) return `a report of ${half.length} edges with a total of 12,345 counts ${own?.shown} of ${own?.total}`;
  }
  return undefined;
};

/** The edges and the note of an SVG export. */
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const svgEdges = (svg: string) => [...svg.matchAll(/<g class="wf-edge" data-id="([^"]*)"/g)].map((m) => unescape(m[1])).sort();
const svgNote = (svg: string) => /<text [^>]*class="wf-edge-note"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];

/** The texts a PNG export without its legend writes. */
function pngTexts(scene: Parameters<typeof toPNGCanvas>[0], edgeBudget: number | "all"): string[] {
  const texts: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), fillText: (s: string) => texts.push(s) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  toPNGCanvas(scene, { scale: 1, legend: false, edgeBudget, createCanvas: (width, height) => ({ width, height, getContext: () => ctx as unknown as DrawContext }) });
  return texts;
}

const exported: Check = (c) => {
  const { graph, style, positions, scene } = c;
  const given = { graph, positions, style, selfLoops: false };
  const all = scene.edgeMarks.map((m) => m.id);
  const byId = new Map(graph.edges.map((e) => [e.id, e]));
  const rng = createRandom(c.seed + 800_008);
  for (const budget of [rng.int(0, all.length), all.length, "all" as const]) {
    // A figure has no selection, keyboard position or highlighted path: the overlay marks alone protect.
    const want = typeof budget === "number" ? expectedDrawn(graph, style, all, budget, {}) : { drawn: all, shown: all.length, total: all.length, withheld: false };
    const wantNote = want.withheld ? noteText(want.shown, want.total) : undefined;
    const svg = toSVG(given, { edgeBudget: budget });
    if (!same(svgEdges(svg), sorted(want.drawn))) return `SVG with budget ${budget} drew [${svgEdges(svg)}] instead of [${sorted(want.drawn)}]`;
    if (svgNote(svg) !== wantNote) return `SVG with budget ${budget} notes "${svgNote(svg)}" instead of "${wantNote}"`;
    // PNG: the note, and one count label per drawn edge that has a count.
    const texts = pngTexts(given, budget);
    const notes = texts.filter((s) => s.startsWith("Showing"));
    if (!same(notes, wantNote ? [wantNote] : [])) return `PNG with budget ${budget} notes [${notes}] instead of [${wantNote ?? ""}]`;
    const wantLabels = want.drawn.map((id) => byId.get(id)!.metrics?.count).filter((n): n is number => typeof n === "number").map(String).sort();
    const gotLabels = texts.filter((s) => /^\d+$/.test(s)).sort();
    if (!same(gotLabels, wantLabels)) return `PNG with budget ${budget} wrote the counts [${gotLabels}] instead of [${wantLabels}]`;
  }
  return undefined;
};

/** The ids of the edges whose mark the drawing reads, once each. */
function watched(scene: PreparedScene) {
  const read = new Set<string>();
  const edges = scene.edges.map((e) => new Proxy(e, { get: (target, key, receiver) => (key === "mark" && read.add(target.edge.id), Reflect.get(target, key, receiver)) }));
  return { scene: { ...scene, edges }, read: () => [...read].sort() };
}

const quiet = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string | symbol, unknown>, {
  get: (target, key) => (key in target ? target[key] : () => {}),
  set: (target, key, value) => ((target[key] = value), true),
}) as unknown as DrawContext;

const canvasDrawing: Check = (c) => {
  const { graph, style, positions, protection } = c;
  const prepared = prepareScene(graph, positions, { style, selfLoops: false, lodBySize: false });
  const all = prepared.edgeMarks.map((m) => m.id);
  const budget = createRandom(c.seed + 600_006).int(0, all.length);
  const want = expectedDrawn(graph, style, all, budget, protection);
  const { scene, read } = watched(prepared);
  const state = { selection: { nodes: [], edges: protection.selection.edges, groups: [] }, focused: protection.focused, highlighted: protection.highlighted };
  const stats = drawScene(quiet, scene, { x: 0, y: 0, zoom: 1, width: 400, height: 300 }, state, { cull: false, edgeBudget: budget, lodZoom: 2 });
  if (!same(read(), sorted(want.drawn))) return `the Canvas drawing with budget ${budget} read [${read()}] instead of [${sorted(want.drawn)}]`;
  if (stats.edges !== want.shown) return `the Canvas drawing with budget ${budget} counted ${stats.edges} edges instead of ${want.shown}`;
  if (!want.withheld) return stats.withheld === undefined ? undefined : `the Canvas drawing with budget ${budget} withheld nothing by the rule but reported ${stats.withheld.shown} of ${stats.withheld.total}`;
  if (!stats.withheld) return `the Canvas drawing with budget ${budget} reported nothing withheld`;
  if (stats.withheld.shown !== want.shown || stats.withheld.total !== want.total) return `the Canvas drawing with budget ${budget} reported ${stats.withheld.shown} of ${stats.withheld.total} instead of ${want.shown} of ${want.total}`;
  return undefined;
};

describe("the edge budget over random graphs, budgets and protected edges", () => {
  it("draws exactly the protected edges and the heaviest others up to the budget, ties by id, and counts shown and total", () => holds(everyBudget), TIMEOUT);

  it("removes only the last edge of the order when the budget is lowered by one", () => holds(lowering), TIMEOUT);

  it("draws exactly the edges a map reported and states the total the map counted", () => holds(reported), TIMEOUT);

  it("exports by the same order with the overlay marks as the only protection, and writes the note only while edges are withheld", () => holds(exported), TIMEOUT);

  it("is applied by the Canvas drawing, which reads exactly the budgeted edges and reports their numbers", () => holds(canvasDrawing), TIMEOUT);
});
