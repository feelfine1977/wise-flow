/**
 * How the map reads across thresholds and sizes, on the Canvas drawing. Every
 * rung of the ladder (activities and paths at 0 %, the default, 5 %, 10 %,
 * 25 % and 50 %, keep connected on and off, stages shown and collapsed) on
 * the two committed scenes and on generated scenes of four magnitudes is
 * laid out by ELK (by Dagre above 500 nodes and paths), prepared as the
 * Canvas map prepares it and drawn into a recording context: at the view
 * that fits it into 1,200 × 800, with every element and text any zoom draws,
 * and under a budget of 24 paths. The readings are held against what the
 * scene says (`checkReading`).
 *
 * Three kinds of failure are open decisions, written up and pinned below as
 * findings (`findingOf`): path counts that cover each other or a card, an arc
 * label on a card or a label where its arc had no free place, and a row of
 * badges wider than its card that covers the card beside it. Texts drawn
 * below 9 px were a fourth until the map kept its texts readable at every
 * zoom; now one fails the search. A fourth is the documented limit of keep connected, which `findingOf`
 * names too: an activity it leaves without a path from the start or to the
 * end, since it restores flow context only from activities still on the map.
 * The legend's path widths run from 0 to the strongest path of the graph
 * before abstraction by the rule of one width scale per graph, or show one
 * sample where every path shown has one count. Every other failure fails the
 * search, prints its seed and the smallest graph that still fails, and
 * attaches the picture of its rung to the report.
 */
import { readFileSync } from "node:fs";
import { type TestContext, describe, expect, it } from "vitest";
import { type PreparedScene, prepareScene } from "../../src/canvas/index";
import { type FlowGraph, type Locale, type Overlay, type Positions, abstract, createPositions, defaultTheme, layout, toSVG } from "../../src/index";
import { type LadderScene, type Rung, MAGNITUDES, RUNGS, collapsedGraph, committedScenes, generatedScene, optionsOf, randomSetting, rungOf, shownGraph } from "../support/ladder";
import { type Failure, type Finding, type Reading, arcLabelPlaces, checkReading, findingOf, fitView, pictureOf, readCanvas, weaklyConnected } from "../support/reading";
import { positionsOf } from "../support/scenes";
import { savePicture } from "../support/pictures";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { shrinkGraph } from "../support/shrink";

const VIEW = { width: 1200, height: 800 };
const BUDGET = 24;

type Annotate = TestContext["annotate"];

/**
 * Layouts by the shown graph's structure: the magnitudes of a seed, and rungs
 * that keep the same elements, share one. ELK, without the timeout that would
 * hand a loaded host's run to the fallback; Dagre above the fallback's limit
 * of 500 nodes and paths, which only the whole log at 0 % reaches (ELK takes
 * 7 s there, three times that under coverage).
 */
const layouts = new Map<string, Promise<Positions>>();
function positionsFor(shown: FlowGraph): Promise<Positions> {
  const key = `${shown.nodes.map((n) => `${n.id}@${n.group ?? ""}`).join()}|${shown.edges.map((e) => e.id).join()}|${(shown.groups ?? []).map((g) => g.id).join()}`;
  let p = layouts.get(key);
  if (!p) layouts.set(key, (p = layout(shown, shown.nodes.length + shown.edges.length > 500 ? { engine: "dagre" } : { engine: "elk", timeoutMs: 600_000 })));
  return p;
}

interface Cell {
  shown: FlowGraph;
  /** Whether each arc's label had a free place (`arcLabelPlaces`). */
  places: Map<string, boolean>;
  positions: Positions;
  overlays: Overlay[];
  failures: Failure[];
  fitted: Reading;
}

/**
 * The scene's legend as data: the scale's ends written out in full (its one sample twice, where every path has one
 * count), the colour scale's metric, domain and stops, placed by the square root where the style says so.
 */
function legendOf(prepared: PreparedScene): Pick<Reading, "widthEnds" | "colorScale"> {
  const width = prepared.legend.items.find((i) => i.kind === "width");
  const color = prepared.legend.items.find((i) => i.kind === "sequential");
  const one = width?.kind === "width" && width.samples?.length === 1 ? String(width.samples[0].value) : undefined;
  return {
    ...(width?.kind === "width" ? { widthEnds: (one ? [one, one] : [String(width.domain[0]), String(width.domain[1])]) as [string, string] } : {}),
    ...(color?.kind === "sequential" ? { colorScale: { metric: color.metric, domain: color.domain, stops: [...color.stops], sqrt: prepared.style.edgeColor?.scale === "sqrt" } } : {}),
  };
}

/** Lay out, prepare, draw and check one rung of a scene. */
async function readCell(graph: FlowGraph, sceneOverlays: Overlay[], rung: Rung, locale: Locale, positions?: Positions): Promise<Cell> {
  const options = optionsOf(rung);
  const shown = shownGraph(graph, options);
  const abstraction = abstract(graph, options);
  const at = positions ?? (await positionsFor(shown));
  const overlays = [...(shown.overlays ?? []), ...sceneOverlays];
  const prepared = prepareScene(shown, at, { overlays, lodBySize: true, locale });
  const whole = { x: -prepared.bounds.x, y: -prepared.bounds.y, zoom: 1, width: prepared.bounds.width, height: prepared.bounds.height };
  const fitted = readCanvas(prepared, fitView(prepared.bounds, VIEW.width, VIEW.height));
  const full = { ...readCanvas(prepared, whole, { lodZoom: 100 }), ...legendOf(prepared) };
  const budgeted = readCanvas(prepared, whole, { lodZoom: 100, edgeBudget: BUDGET });
  const failures = checkReading({ fitted, full, budgeted, expect: { graph, abstraction, rung, locale, positions: prepared.positions } });
  return { shown, positions: at, overlays, failures, fitted, places: arcLabelPlaces(prepared) };
}

const findingsOf = (cell: Cell, graph: FlowGraph, rung: Rung): Finding[] => [...new Set(cell.failures.flatMap((f) => findingOf(f, cell.shown, collapsedGraph(graph, rung), cell.places) ?? []))].sort();
const unexpected = (cell: Cell, graph: FlowGraph, rung: Rung): Failure[] => cell.failures.filter((f) => !findingOf(f, cell.shown, collapsedGraph(graph, rung), cell.places));

/** The picture of a rung with its failures marked, saved beside the report and attached to the test. */
async function attach(annotate: Annotate, title: string, cell: Cell): Promise<void> {
  const svg = toSVG({ graph: cell.shown, positions: cell.positions, overlays: cell.overlays }, { legend: true });
  const path = savePicture(`canvas ${title}`, pictureOf(svg, cell.failures, `Canvas drawing · ${title}`));
  await annotate(`${title}: ${cell.failures.length} failing, picture ${path}`, { path, contentType: "image/svg+xml" });
}

const summary = (failures: readonly Failure[]) => failures.slice(0, 6).map((f) => `${f.property}: ${f.detail}`).join("\n  ");

/**
 * The open findings at each rung of the committed scenes, as written up with
 * their pictures: on the whole log and on the vendor, laid out by ELK (the
 * whole log at 0 % by Dagre). No text is drawn below 9 px at the fitted zoom:
 * the cards scale their texts up to it and shed what does not fit, and
 * paths' counts go below it; paths are counted in cases, written in full up to 99,999, so counts
 * cover a card or each other where stages are shown; paths back run below the
 * flow, clear of the counts of the paths forward; and on the whole log at 5 %,
 * not connected, one arc's pill has no free place.
 */
const WRITTEN_UP: Record<string, string> = {
  "global · 0 % · connected · stages shown": "path counts",
  "global · default · connected · stages shown": "path counts",
  "global · 5 % · connected · stages shown": "path counts",
  "global · 10 % · connected · stages shown": "path counts",
  "global · 25 % · connected · stages shown": "path counts",
  "global · 50 % · connected · stages shown": "",
  "global · 0 % · not connected · stages shown": "path counts",
  "global · default · not connected · stages shown": "path counts",
  "global · 5 % · not connected · stages shown": "arc label without a place, path counts",
  "global · 10 % · not connected · stages shown": "path counts",
  "global · 25 % · not connected · stages shown": "path counts",
  "global · 50 % · not connected · stages shown": "",
  "global · 0 % · connected · stages collapsed": "",
  "global · default · connected · stages collapsed": "",
  "global · 5 % · connected · stages collapsed": "",
  "global · 10 % · connected · stages collapsed": "",
  "global · 25 % · connected · stages collapsed": "",
  "global · 50 % · connected · stages collapsed": "",
  "global · 0 % · not connected · stages collapsed": "",
  "global · default · not connected · stages collapsed": "",
  "global · 5 % · not connected · stages collapsed": "",
  "global · 10 % · not connected · stages collapsed": "",
  "global · 25 % · not connected · stages collapsed": "",
  "global · 50 % · not connected · stages collapsed": "",
  "vendor · 0 % · connected · stages shown": "path counts",
  "vendor · default · connected · stages shown": "path counts",
  "vendor · 5 % · connected · stages shown": "path counts",
  "vendor · 10 % · connected · stages shown": "",
  "vendor · 25 % · connected · stages shown": "",
  "vendor · 50 % · connected · stages shown": "",
  "vendor · 0 % · not connected · stages shown": "path counts",
  "vendor · default · not connected · stages shown": "path counts",
  "vendor · 5 % · not connected · stages shown": "",
  "vendor · 10 % · not connected · stages shown": "",
  "vendor · 25 % · not connected · stages shown": "",
  "vendor · 50 % · not connected · stages shown": "",
  "vendor · 0 % · connected · stages collapsed": "",
  "vendor · default · connected · stages collapsed": "",
  "vendor · 5 % · connected · stages collapsed": "",
  "vendor · 10 % · connected · stages collapsed": "",
  "vendor · 25 % · connected · stages collapsed": "",
  "vendor · 50 % · connected · stages collapsed": "",
  "vendor · 0 % · not connected · stages collapsed": "",
  "vendor · default · not connected · stages collapsed": "",
  "vendor · 5 % · not connected · stages collapsed": "",
  "vendor · 10 % · not connected · stages collapsed": "",
  "vendor · 25 % · not connected · stages collapsed": "",
  "vendor · 50 % · not connected · stages collapsed": "",
};

describe("how the map reads across thresholds and sizes, on the Canvas drawing", () => {
  it("holds every property at every rung of the committed scenes, or fails only as written up", async ({ annotate }) => {
    const found: Record<string, string> = {};
    for (const scene of committedScenes()) {
      for (const rung of RUNGS) {
        const name = `${scene.name} · ${rung.name}`;
        const cell = await readCell(scene.graph, scene.overlays, rung, "en");
        if (cell.failures.length) await attach(annotate, name, cell);
        expect(unexpected(cell, scene.graph, rung), `${name}:\n  ${summary(unexpected(cell, scene.graph, rung))}`).toEqual([]);
        found[name] = findingsOf(cell, scene.graph, rung).join(", ");
      }
    }
    expect(found).toEqual(WRITTEN_UP);
  }, 120_000);

  it("holds every property at every rung of generated scenes of 10², 10⁴, 10⁶ and 10⁷ events", async ({ annotate }) => {
    let cells = 0;
    // How many cells of each magnitude show each open finding, for the report.
    const tally = new Map<string, number>();
    for (const seed of seeds(caseCount(20))) {
      // German numbers on every other seed: the printed counts read back with the other separators.
      const locale: Locale = seed % 2 ? "en" : "de";
      for (const magnitude of MAGNITUDES) {
        const scene = generatedScene(seed, magnitude);
        expect(scene.events, scene.name).toBeGreaterThanOrEqual(magnitude / 2);
        expect(scene.events, scene.name).toBeLessThanOrEqual(magnitude * 2);
        for (const rung of RUNGS) {
          const cell = await readCell(scene.graph, scene.overlays, rung, locale);
          cells++;
          for (const f of findingsOf(cell, scene.graph, rung)) tally.set(`${f} at ${magnitude.toExponential(0)}`, (tally.get(`${f} at ${magnitude.toExponential(0)}`) ?? 0) + 1);
          const bad = unexpected(cell, scene.graph, rung);
          if (!bad.length) continue;
          await attach(annotate, `${scene.name} · ${rung.name}`, cell);
          // The same failure: its property and its wording with the names and numbers left out.
          const kind = (f: Failure) => `${f.property}: ${f.detail.replace(/"[^"]*"|\S*\d\S*/g, "")}`;
          const fails = (g: FlowGraph) => {
            const sceneOverlays = g.overlays ?? [];
            const plain = { ...g, overlays: undefined };
            return readCell(plain, sceneOverlays, rung, locale).then((c) => c.failures.some((f) => kind(f) === kind(bad[0]) && !findingOf(f, c.shown, collapsedGraph(plain, rung), c.places)));
          };
          const smallest = await shrinkAsync({ ...scene.graph, overlays: scene.overlays }, fails);
          expect(bad, `${caseLabel(seed, `${scene.name} · ${rung.name} · ${locale}`)}\n  ${summary(bad)}\n  smallest graph that still fails:\n  ${JSON.stringify(smallest)}`).toEqual([]);
        }
      }
    }
    expect(cells).toBe(caseCount(20) * MAGNITUDES.length * RUNGS.length);
    await annotate(`${cells} cells; cells with an open finding: ${[...tally].sort().map(([k, n]) => `${k} ${n}`).join(", ")}`);
  }, 600_000 * caseCount(1));

  it("never adds, moving the controls up, an element that a lower setting removed", () => {
    // Elements are what the scene draws: cards, path lines and self-loops. Positions do not decide which exist.
    const drawn = (graph: FlowGraph, overlays: Overlay[], setting: ReturnType<typeof randomSetting>) => {
      const shown = shownGraph(graph, setting);
      const p = positionsOf(shown, "grid", 1);
      const prepared = prepareScene(shown, p, { overlays: [...(shown.overlays ?? []), ...overlays], lodBySize: true });
      const reconnected = new Set([...shown.nodes, ...shown.edges].filter((e) => e.tags?.includes("reconnected")).map((e) => e.id));
      const ids = [...prepared.nodeMarks.map((m) => m.id), ...prepared.edgeMarks.map((m) => m.id), ...prepared.marks.flatMap((m) => (m.kind === "selfLoop" && m.edgeId ? [m.edgeId] : []))];
      return { ids: new Set(ids), reconnected };
    };
    const committed = committedScenes();
    let pairs = 0;
    for (const seed of seeds(caseCount(200))) {
      const rng = createRandom(seed);
      const scene: LadderScene = rng.chance(0.3) ? rng.pick(committed) : generatedScene(rng.int(1, 40), rng.pick(MAGNITUDES));
      const low = randomSetting(rng);
      // The higher setting moves one control or both up, and keeps the toggles; a pair of one setting twice is not a pair.
      const [node, edge] = rng.pick([["up", 0], [0, "up"], ["up", "up"]] as const).map((c) => (c === "up" ? rng.pick([1, 5, 20]) : 0));
      const high = { ...low, minNodeShare: Math.min(1, low.minNodeShare + node / 100), minEdgeShare: Math.min(1, low.minEdgeShare + edge / 100) };
      expect(high, caseLabel(seed, "a pair of two settings")).not.toEqual(low);
      const a = drawn(scene.graph, scene.overlays, low);
      const b = drawn(scene.graph, scene.overlays, high);
      // Only an element added back to keep the map connected may come back higher up, as the architecture says.
      const back = [...b.ids].filter((id) => !a.ids.has(id) && !b.reconnected.has(id));
      expect(back, caseLabel(seed, `${scene.name}: ${JSON.stringify(low)} → ${JSON.stringify(high)}`)).toEqual([]);
      if (!low.keepConnected) expect([...b.ids].filter((id) => !a.ids.has(id)), caseLabel(seed, `${scene.name}, not connected`)).toEqual([]);
      pairs++;
    }
    expect(pairs).toBeGreaterThanOrEqual(200);
  }, 120_000 * caseCount(1));
});

/** `shrinkGraph` for a predicate that lays out: the candidates are tried one at a time. */
async function shrinkAsync(graph: FlowGraph, fails: (g: FlowGraph) => Promise<boolean>): Promise<FlowGraph> {
  // The shrinker asks synchronously; answer from the outcomes recorded so far and run the unknown ones between passes.
  const known = new Map<string, boolean>();
  const key = (g: FlowGraph) => JSON.stringify([g.nodes.map((n) => n.id), g.edges.map((e) => e.id), g.overlays?.length]);
  let smallest = graph;
  for (let pass = 0; pass < 40; pass++) {
    const asked: FlowGraph[] = [];
    smallest = shrinkGraph(graph, (g) => {
      const k = key(g);
      if (known.has(k)) return known.get(k)!;
      asked.push(g);
      return false;
    });
    if (!asked.length) break;
    for (const g of asked) known.set(key(g), await fails(g));
  }
  return smallest;
}

describe("the open findings, pinned", () => {
  /** Activities in a row, 200 apart, in one stage; the map fits them at about 0.65. */
  const row = (n: number): { graph: FlowGraph; positions: Positions } => {
    const nodes = Object.fromEntries(Array.from({ length: n }, (_, i) => [`a${i}`, { x: i * 200, y: 0, width: 180, height: 48 }]));
    const graph: FlowGraph = {
      nodes: Object.keys(nodes).map((id) => ({ id, kind: "activity", label: `Activity ${id.slice(1)}`, group: "s", metrics: { cases: 40 } })),
      edges: Object.keys(nodes).slice(1).map((id, i) => ({ id: `a${i}->${id}`, kind: "follows", source: `a${i}`, target: id, metrics: { count: 40 } })),
      groups: [{ id: "s", kind: "stage", label: "Stage" }],
    };
    return { graph, positions: createPositions({ nodes, groups: { s: { x: -20, y: -40, width: n * 200, height: 108 } }, edges: {} }, "given", "RIGHT") };
  };

  it("closed finding: the map draws no text below 9 px at the zoom it is fitted at, nor a stage's title at any zoom", () => {
    const { graph, positions } = row(8);
    const prepared = prepareScene(graph, positions, { lodBySize: true });
    const view = fitView(prepared.bounds, VIEW.width, VIEW.height);
    // 8 activities and their stage: 1,600 wide with the margin, so 1,200 / (1,600 · 1.16) = 0.647.
    expect(view.zoom).toBeCloseTo(0.6466, 3);
    const fitted = readCanvas(prepared, view);
    const px = (role: string, text: string) => fitted.texts.filter((t) => t.role === role && t.text === text).map((t) => Number((t.size * view.zoom).toFixed(2)));
    // The floor is 9 / 0.6466 = 13.92 layout units, 14.67 on the ladder (2^(31/8)). The cards are 48 high: their texts
    // have 48 − 2 − 3 = 43, which holds the name's two lines (32) but not the number line too (46), so the number line is
    // shed and the name is scaled up 14.67 / 13 = 1.128: 9.49 px on the screen. The paths' counts (11) are shed too.
    expect(px("node", "Activity 3")).toEqual([9.49]);
    expect(px("node", "40")).toEqual([]);
    expect(fitted.texts.filter((t) => t.role === "path")).toEqual([]);
    // The stage's title goes with the names: at zoom 0.06 the floor, 150, is beyond the ladder's 128, and nothing is written.
    const far = readCanvas(prepared, { ...view, zoom: 0.06 });
    expect(far.texts).toEqual([]);
    // They were drawn at 8.41 px (the name), 7.11 (the number line) and, at 0.06, 0.78 (the title); a floor of 0 draws them so.
    const before = prepareScene(graph, positions, { lodBySize: true, theme: { ...defaultTheme, text: { ...defaultTheme.text, minScreenPx: 0 } } });
    expect(readCanvas(before, view).texts.filter((t) => t.role === "node" && t.text === "Activity 3").map((t) => Number((t.size * view.zoom).toFixed(2)))).toEqual([8.41]);
    expect(readCanvas(before, { ...view, zoom: 0.06 }).texts.filter((t) => t.role === "group").map((t) => Number((t.size * 0.06).toFixed(2)))).toEqual([0.78]);
  });

  it("finding: a path's count has no place of its own and, when wider than the gap it sits in, covers an activity", () => {
    // a and b 20 apart with paths both ways: a → b runs straight between the boxes, its count in the gap's middle at
    // (190, 20); the path back runs below both, 70.83 down, its count at (190, 64) below the cards.
    const at = { a: { x: 0, y: 0, width: 180, height: 48 }, b: { x: 200, y: 0, width: 180, height: 48 } };
    const graph = (count: number): FlowGraph => ({
      nodes: [{ id: "a", kind: "activity", label: "A", metrics: { cases: count } }, { id: "b", kind: "activity", label: "B", metrics: { cases: count } }],
      edges: [{ id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count } }, { id: "b->a", kind: "follows", source: "b", target: "a", metrics: { count: count / 2 } }],
    });
    const read = (count: number) => {
      const prepared = prepareScene(graph(count), createPositions({ nodes: at, groups: {}, edges: {} }, "given", "RIGHT"), {});
      return readCanvas(prepared, { x: 0, y: 0, zoom: 1, width: 400, height: 100 }, { lodZoom: 100 });
    };
    const rung = rungOf(0, false, false);
    const check = (count: number) => {
      const g = graph(count);
      return checkReading({ fitted: read(count), full: read(count), expect: { graph: g, abstraction: g, rung, locale: "en" } }).filter((f) => f.property !== "text too small").map((f) => `${f.property}: ${f.detail}`);
    };
    // 40 and 20: "40" (12.1 wide at 11 px) fits the gap, "20" lies below the cards; 851,000 and 425,500: "851k" (24.2
    // wide) is wider than the 20 between a and b, "426k" again below the cards.
    expect(check(40)).toEqual([]);
    expect(check(851_000)).toEqual(['label covers card: path label "851k" of a->b covers a', 'label covers card: path label "851k" of a->b covers b']);
  });

  it("restores flow context only from activities still on the map, so that keep connected can leave an activity without a path from the start, as the documents say", () => {
    // start → a0 → a1 → a3 → a4 → a8 and a1 → a7 → a8, cases 14, 14, 2, 4, 14 and 7.
    const node = (id: string, cases: number) => ({ id, kind: "activity" as const, label: id, metrics: { cases } });
    const edge = (source: string, target: string, count: number) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count, cases: count } });
    const graph: FlowGraph = {
      nodes: [{ id: "start", kind: "event", label: "Start", tags: ["start"] }, node("a0", 14), node("a1", 14), node("a3", 2), node("a4", 4), node("a7", 7), node("a8", 14), { id: "end", kind: "event", label: "End", tags: ["end"] }],
      edges: [edge("start", "a0", 14), edge("a0", "a1", 14), edge("a1", "a3", 2), edge("a3", "a4", 2), edge("a4", "a8", 4), edge("a1", "a7", 7), edge("a7", "a8", 7), edge("a8", "end", 14)],
    };
    // At 25 %, a3 (2 of 14) goes and a4 (4 of 14) stays; a4's only incoming path came from a3.
    const shown = abstract(graph, { minNodeShare: 0.25, minEdgeShare: 0.25, keepConnected: true });
    expect(shown.nodes.map((n) => n.id)).toEqual(["start", "a0", "a1", "a4", "a7", "a8", "end"]);
    expect(shown.edges.map((e) => e.id)).toEqual(["start->a0", "a0->a1", "a4->a8", "a1->a7", "a7->a8", "a8->end"]);
    expect(weaklyConnected(shown)).toBe(true);
    const rung = { ...rungOf(4, true, false) };
    const failures = checkReading({ fitted: emptyReading(), full: emptyReading(shown), expect: { graph, abstraction: shown, rung, locale: "en" } }).filter((f) => f.property === "reach");
    expect(failures.map((f) => f.detail)).toEqual(["a4 is not reachable from the start"]);
    for (const doc of ["ARCHITECTURE", "API"]) {
      const text = readFileSync(new URL(`../../docs/${doc}.md`, import.meta.url), "utf8").replace(/\s+/g, " ");
      expect(text, doc).toContain("restores flow context only from activities still on the map");
    }
  });

  it("shows one sample of the width every path is drawn at where all paths have one count, and no width row without paths", () => {
    const at = { a: { x: 0, y: 0, width: 180, height: 48 }, b: { x: 300, y: 0, width: 180, height: 48 }, c: { x: 600, y: 0, width: 180, height: 48 } };
    const node = (id: string) => ({ id, kind: "activity" as const, label: id.toUpperCase(), metrics: { cases: 9 } });
    const path = (source: string, target: string, count: number) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count } });
    const one: FlowGraph = { nodes: [node("a"), node("b")], edges: [path("a", "b", 9)] };
    const two: FlowGraph = { nodes: [node("a"), node("b"), node("c")], edges: [path("a", "b", 9), path("b", "c", 9)] };
    const mixed: FlowGraph = { nodes: [node("a"), node("b"), node("c")], edges: [path("a", "b", 9), path("b", "c", 4)] };
    const none: FlowGraph = { nodes: [node("a")], edges: [] };
    const widths = (graph: FlowGraph) => {
      const prepared = prepareScene(graph, createPositions({ nodes: Object.fromEntries(graph.nodes.map((n) => [n.id, at[n.id as "a" | "b" | "c"]])), groups: {}, edges: {} }, "given", "RIGHT"), {});
      const item = prepared.legend.items.find((i) => i.kind === "width");
      return { samples: item?.kind === "width" ? item.samples : undefined, drawn: prepared.edgeMarks.map((m) => m.width) };
    };
    // Paths of 9 transitions (the graph gives no cases), on one scale from 0 to the strongest, 9, onto widths up to 8:
    // every path is drawn at 8, and the legend shows that one sample instead of a scale from 0.
    expect(widths(one)).toEqual({ samples: [{ value: 9, width: 8 }], drawn: [8] });
    expect(widths(two)).toEqual({ samples: [{ value: 9, width: 8 }], drawn: [8, 8] });
    // Paths of 9 and 4: the scale, a count near the middle width (9 · (4.5 / 8)² = 2.85, written 3, at 8 · √(3/9) = 4.62)
    // and the strongest; 4 is drawn at 8 · √(4/9) = 5.33.
    expect(widths(mixed)).toEqual({ samples: [{ value: 3, width: 4.62 }, { value: 9, width: 8 }], drawn: [8, 5.33] });
    // No path: the legend has no width row, as it has no row for a mark that is not drawn.
    expect(widths(none)).toEqual({ samples: undefined, drawn: [] });
    // The check finds the one sample the rule's, and a scale from 0 not.
    const rung = rungOf(5, false, false);
    const ends = (widthEnds: [string, string]) =>
      checkReading({ fitted: emptyReading(), full: { ...emptyReading(one), widthEnds }, expect: { graph: one, abstraction: one, rung, locale: "en" } }).filter((f) => f.property === "legend ends").length;
    expect([ends(["9", "9"]), ends(["0", "9"])]).toEqual([0, 1]);
  });

  it("finding: an arc label covers an activity where its arc has no free place", () => {
    // Four activities in a column with gaps of 20, 16 and 16, and the two arcs of a precedence between a0 and a4; a
    // label's pill is 18 high and centred on its arc. Neither arc has a free place: the forward arc's centres nearest
    // its middle, in steps of 1/32, fall at 55.4 and 62.1 beside the one gap of 20 (48 … 68), which needs 57 … 59;
    // the reverse arc meets only gaps of 16. Each label then takes the place nearest the middle that covers fewest.
    const box = (y: number) => ({ x: 0, y, width: 180, height: 48 });
    const at = { a0: box(0), a2: box(68), a4: box(132), a3: box(196) };
    const graph: FlowGraph = {
      nodes: Object.keys(at).map((id) => ({ id, kind: "activity", label: id })),
      edges: [],
      overlays: [
        { kind: "arc", target: "a0->a4", payload: { constraintId: "order", source: "a0", target: "a4", value: 0.6, coverage: 0.8, glyph: "⇒" } },
        { kind: "arc", target: "a4->a0", payload: { constraintId: "order", source: "a4", target: "a0", value: 0.47, coverage: 0.47, reverse: true, glyph: "⇐" } },
      ],
    };
    const prepared = prepareScene(graph, createPositions({ nodes: at, groups: {}, edges: {} }, "given", "RIGHT"), {});
    const arcs = prepared.marks.filter((m) => m.kind === "arc").map((m) => [m.id, m.path, m.texts[0].text, m.texts[0].x, Number(m.texts[0].y.toFixed(2))]);
    expect(arcs).toEqual([
      ["arc:a0->a4:0", "M90 0 C90 -40 90 92 90 132", "order 60 %", 90, 36.5],
      ["arc:a4->a0:1", "M90 180 C90 220 90 88 90 48", "⇐ 47 %", 90, 144.5],
    ]);
    const places = arcLabelPlaces(prepared);
    expect([...places]).toEqual([["arc:a0->a4:0", false], ["arc:a4->a0:1", false]]);
    const full = readCanvas(prepared, { x: 0, y: 100, zoom: 1, width: 400, height: 500 }, { lodZoom: 100 });
    const covering = checkReading({ fitted: full, full, expect: { graph, abstraction: graph, rung: rungOf(0, false, false), locale: "en" } }).filter((f) => f.property.startsWith("label covers"));
    expect(covering.map((f) => [f.detail, findingOf(f, graph, graph, places)])).toEqual([
      ['arc label "order 60 %" of arc:a0->a4:0 covers a0', "arc label without a place"],
      ['arc label "⇐ 47 %" of arc:a4->a0:1 covers a4', "arc label without a place"],
    ]);
  });

  it("finding: a row of badges wider than its card runs past the card's left edge and covers the card beside it", () => {
    // b carries three badges; a lies 10 to its left and 10 higher. Badges are pills 18 high, 2 above their card, placed
    // leftwards from its top-right corner 4 apart: "∅ · 29 %" from 309.6, "≤1 · 59 %" from 239.15 and "≥1 · 8 %" from
    // 174.75, 15.25 left of b's edge at 190 and 5.25 over a's right end. The shape of seed 819 of the generated scenes.
    const at = { a: { x: 0, y: -10, width: 180, height: 64 }, b: { x: 190, y: 0, width: 180, height: 64 } };
    const badge = (id: string, glyph: string, value: number) => ({ kind: "badge" as const, target: "b", payload: { constraintId: id, label: id, glyph, value } });
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", metrics: { cases: 10 } }, { id: "b", kind: "activity", label: "B", metrics: { cases: 10 } }],
      edges: [],
      overlays: [badge("present", "≥1", 0.08), badge("once", "≤1", 0.59), badge("never", "∅", 0.29)],
    };
    const prepared = prepareScene(graph, createPositions({ nodes: at, groups: {}, edges: {} }, "given", "RIGHT"), {});
    const full = readCanvas(prepared, { x: 0, y: 100, zoom: 1, width: 400, height: 300 }, { lodZoom: 100 });
    expect(full.badges.map((b) => [b.id, Number(b.box.x.toFixed(2)), b.box.y])).toEqual([["badge:b:0", 309.6, -20], ["badge:b:1", 239.15, -20], ["badge:b:2", 174.75, -20]]);
    const covering = checkReading({ fitted: full, full, expect: { graph, abstraction: graph, rung: rungOf(0, false, false), locale: "en" } }).filter((f) => f.property.startsWith("label covers"));
    expect(covering.map((f) => [f.detail, findingOf(f, graph, graph)])).toEqual([["badge badge:b:2 covers a", "badges wider than their card"]]);
    // A badge within the sides of its card that covers another card is a fault, not this finding.
    const within: Failure = { ...covering[0], boxes: [{ x: 200, y: -20, width: 60, height: 18 }, covering[0].boxes[1], { x: 190, y: 0, width: 180, height: 64 }] };
    expect(findingOf(within, graph, graph)).toBeUndefined();
  });

  it("tells an arc label on a path's count from the open finding of path counts", () => {
    // Arc labels keep clear of the counts: one on a count is a fault where its arc had a free place, the rule's fallback where not.
    const graph: FlowGraph = { nodes: [], edges: [] };
    const failure = (property: Failure["property"], detail: string): Failure => ({ property, detail, boxes: [] });
    const onCount = failure("label covers label", 'arc label "⇐ 52 %" of arc:b->a:1 covers path label "110k" of b->a');
    const countOn = failure("label covers label", 'path label "2" of a->b covers arc label "⇐ 26 %" of arc:b->a:1');
    expect(findingOf(onCount, graph, graph, new Map([["arc:b->a:1", true]]))).toBeUndefined();
    expect(findingOf(countOn, graph, graph, new Map([["arc:b->a:1", true]]))).toBeUndefined();
    expect(findingOf(onCount, graph, graph, new Map([["arc:b->a:1", false]]))).toBe("arc label without a place");
    // Counts among themselves, on a card or on a badge have no place of their own.
    expect(findingOf(failure("label covers label", 'path label "40" of a->b covers path label "20" of b->a'), graph, graph)).toBe("path counts");
    expect(findingOf(failure("label covers card", 'path label "851k" of a->b covers a'), graph, graph)).toBe("path counts");
    expect(findingOf(failure("label covers label", 'path label "8" of a->b covers badge badge:a:0'), graph, graph)).toBe("path counts");
  });
});

/** A reading that draws exactly a graph's nodes and paths, nothing else. */
function emptyReading(graph?: FlowGraph): Reading {
  return {
    renderer: "canvas",
    zoom: 1,
    cards: (graph?.nodes ?? []).map((n, i) => ({ id: n.id, kind: n.kind, box: { x: i * 300, y: 0, width: 180, height: 48 } })),
    texts: [],
    badges: [],
    paths: (graph?.edges ?? []).filter((e) => e.source !== e.target).map((e) => ({ id: e.id, width: 1, color: "#000000" })),
    loops: [],
  };
}

