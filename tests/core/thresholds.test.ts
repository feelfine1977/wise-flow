/**
 * How the map reads across thresholds and sizes, on the Canvas drawing. Every
 * rung of the ladder (activities and paths at 0 %, the default, 5 %, 10 %,
 * 25 % and 50 %, keep connected on and off, stages shown and collapsed) on
 * the two committed scenes and on generated scenes of four magnitudes is
 * laid out by ELK, prepared as the Canvas map prepares it and drawn into a
 * recording context: at the view that fits it into 1,200 × 800, with every
 * element and text any zoom draws, and under a budget of 24 paths. The
 * readings are held against what the scene says (`checkReading`).
 *
 * Three kinds of failure are open decisions, written up and pinned below as
 * findings: texts drawn below 9 px, path counts that cover each other or a
 * card, and activities that keep connected leaves without a path from the
 * start or to the end. Every other failure fails the search, prints its seed
 * and the smallest graph that still fails, and attaches the picture of its
 * rung to the report.
 */
import { type TestContext, describe, expect, it } from "vitest";
import { type PreparedScene, prepareScene } from "../../src/canvas/index";
import { type FlowGraph, type Locale, type Overlay, type Positions, abstract, createPositions, layout, toSVG } from "../../src/index";
import { type LadderScene, type Rung, MAGNITUDES, RUNGS, committedScenes, generatedScene, optionsOf, randomSetting, rungOf, shownGraph } from "../support/ladder";
import { type Failure, type Finding, type Reading, checkReading, findingOf, fitView, pictureOf, readCanvas, weaklyConnected } from "../support/reading";
import { positionsOf } from "../support/scenes";
import { savePicture } from "../support/pictures";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { shrinkGraph } from "../support/shrink";

const VIEW = { width: 1200, height: 800 };
const BUDGET = 24;

type Annotate = TestContext["annotate"];

/** Layouts by the shown graph's structure: the magnitudes of a seed, and rungs that keep the same elements, share one. */
const layouts = new Map<string, Promise<Positions>>();
function positionsFor(shown: FlowGraph): Promise<Positions> {
  const key = `${shown.nodes.map((n) => `${n.id}@${n.group ?? ""}`).join()}|${shown.edges.map((e) => e.id).join()}|${(shown.groups ?? []).map((g) => g.id).join()}`;
  let p = layouts.get(key);
  if (!p) layouts.set(key, (p = layout(shown)));
  return p;
}

interface Cell {
  shown: FlowGraph;
  positions: Positions;
  overlays: Overlay[];
  failures: Failure[];
  fitted: Reading;
}

/** The scene's legend as data: the scale's ends written out in full, the colour scale's domain and stops. */
function legendOf(prepared: PreparedScene): Pick<Reading, "widthEnds" | "colorScale"> {
  const width = prepared.legend.items.find((i) => i.kind === "width");
  const color = prepared.legend.items.find((i) => i.kind === "sequential");
  return {
    ...(width?.kind === "width" ? { widthEnds: [String(width.domain[0]), String(width.domain[1])] as [string, string] } : {}),
    ...(color?.kind === "sequential" ? { colorScale: { domain: color.domain, stops: [...color.stops] } } : {}),
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
  return { shown, positions: at, overlays, failures, fitted };
}

const baseOf = (graph: FlowGraph, rung: Rung) => (rung.collapse ? abstract(graph, { collapse: rung.collapse, keepConnected: false }) : graph);

const findingsOf = (cell: Cell, graph: FlowGraph, rung: Rung): Finding[] => [...new Set(cell.failures.flatMap((f) => findingOf(f, cell.shown, baseOf(graph, rung)) ?? []))].sort();
const unexpected = (cell: Cell, graph: FlowGraph, rung: Rung): Failure[] => cell.failures.filter((f) => !findingOf(f, cell.shown, baseOf(graph, rung)));

/** The picture of a rung with its failures marked, saved beside the report and attached to the test. */
async function attach(annotate: Annotate, title: string, cell: Cell): Promise<void> {
  const svg = toSVG({ graph: cell.shown, positions: cell.positions, overlays: cell.overlays }, { legend: true });
  const path = savePicture(`canvas ${title}`, pictureOf(svg, cell.failures, `Canvas drawing · ${title}`));
  await annotate(`${title}: ${cell.failures.length} failing, picture ${path}`, { path, contentType: "image/svg+xml" });
}

const summary = (failures: readonly Failure[]) => failures.slice(0, 6).map((f) => `${f.property}: ${f.detail}`).join("\n  ");

/**
 * The open findings at each rung of the committed scenes, as written up with
 * their pictures: on the whole log and on the vendor, laid out by ELK.
 */
const WRITTEN_UP: Record<string, string> = {
  "global · 0 % · connected · stages shown": "path counts, small text",
  "global · default · connected · stages shown": "path counts, small text",
  "global · 5 % · connected · stages shown": "path counts, small text",
  "global · 10 % · connected · stages shown": "small text",
  "global · 25 % · connected · stages shown": "small text",
  "global · 50 % · connected · stages shown": "small text",
  "global · 0 % · not connected · stages shown": "path counts, small text",
  "global · default · not connected · stages shown": "path counts, small text",
  "global · 5 % · not connected · stages shown": "path counts, small text",
  "global · 10 % · not connected · stages shown": "small text",
  "global · 25 % · not connected · stages shown": "small text",
  "global · 50 % · not connected · stages shown": "small text",
  "global · 0 % · connected · stages collapsed": "path counts, small text",
  "global · default · connected · stages collapsed": "path counts",
  "global · 5 % · connected · stages collapsed": "small text",
  "global · 10 % · connected · stages collapsed": "small text",
  "global · 25 % · connected · stages collapsed": "",
  "global · 50 % · connected · stages collapsed": "",
  "global · 0 % · not connected · stages collapsed": "path counts, small text",
  "global · default · not connected · stages collapsed": "path counts",
  "global · 5 % · not connected · stages collapsed": "small text",
  "global · 10 % · not connected · stages collapsed": "small text",
  "global · 25 % · not connected · stages collapsed": "",
  "global · 50 % · not connected · stages collapsed": "",
  "vendor · 0 % · connected · stages shown": "path counts, small text",
  "vendor · default · connected · stages shown": "small text",
  "vendor · 5 % · connected · stages shown": "small text",
  "vendor · 10 % · connected · stages shown": "small text",
  "vendor · 25 % · connected · stages shown": "small text",
  "vendor · 50 % · connected · stages shown": "small text",
  "vendor · 0 % · not connected · stages shown": "path counts, small text",
  "vendor · default · not connected · stages shown": "small text",
  "vendor · 5 % · not connected · stages shown": "small text",
  "vendor · 10 % · not connected · stages shown": "small text",
  "vendor · 25 % · not connected · stages shown": "small text",
  "vendor · 50 % · not connected · stages shown": "small text",
  "vendor · 0 % · connected · stages collapsed": "small text",
  "vendor · default · connected · stages collapsed": "small text",
  "vendor · 5 % · connected · stages collapsed": "small text",
  "vendor · 10 % · connected · stages collapsed": "small text",
  "vendor · 25 % · connected · stages collapsed": "",
  "vendor · 50 % · connected · stages collapsed": "",
  "vendor · 0 % · not connected · stages collapsed": "small text",
  "vendor · default · not connected · stages collapsed": "small text",
  "vendor · 5 % · not connected · stages collapsed": "small text",
  "vendor · 10 % · not connected · stages collapsed": "small text",
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
          const bad = unexpected(cell, scene.graph, rung);
          if (!bad.length) continue;
          await attach(annotate, `${scene.name} · ${rung.name}`, cell);
          // The same failure: its property and its wording with the names and numbers left out.
          const kind = (f: Failure) => `${f.property}: ${f.detail.replace(/"[^"]*"|\S*\d\S*/g, "")}`;
          const fails = (g: FlowGraph) => {
            const sceneOverlays = g.overlays ?? [];
            const plain = { ...g, overlays: undefined };
            return readCell(plain, sceneOverlays, rung, locale).then((c) => c.failures.some((f) => kind(f) === kind(bad[0]) && !findingOf(f, c.shown, baseOf(plain, rung))));
          };
          const smallest = await shrinkAsync({ ...scene.graph, overlays: scene.overlays }, fails);
          expect(bad, `${caseLabel(seed, `${scene.name} · ${rung.name} · ${locale}`)}\n  ${summary(bad)}\n  smallest graph that still fails:\n  ${JSON.stringify(smallest)}`).toEqual([]);
        }
      }
    }
    expect(cells).toBe(caseCount(20) * MAGNITUDES.length * RUNGS.length);
  }, 600_000);

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
      // The higher setting moves one control or both up, and keeps the toggles.
      const high = { ...low, minNodeShare: Math.min(1, low.minNodeShare + rng.pick([0, 1, 5, 20]) / 100), minEdgeShare: Math.min(1, low.minEdgeShare + rng.pick([0, 1, 5, 20]) / 100) };
      const a = drawn(scene.graph, scene.overlays, low);
      const b = drawn(scene.graph, scene.overlays, high);
      // Only an element added back to keep the map connected may come back higher up, as the architecture says.
      const back = [...b.ids].filter((id) => !a.ids.has(id) && !b.reconnected.has(id));
      expect(back, caseLabel(seed, `${scene.name}: ${JSON.stringify(low)} → ${JSON.stringify(high)}`)).toEqual([]);
      if (!low.keepConnected) expect([...b.ids].filter((id) => !a.ids.has(id)), caseLabel(seed, `${scene.name}, not connected`)).toEqual([]);
      pairs++;
    }
    expect(pairs).toBeGreaterThanOrEqual(200);
  }, 120_000);
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

  it("finding: the map draws texts below 9 px at the zoom it is fitted at, and a stage's title at every zoom", () => {
    const { graph, positions } = row(8);
    const prepared = prepareScene(graph, positions, { lodBySize: true });
    const view = fitView(prepared.bounds, VIEW.width, VIEW.height);
    // 8 activities and their stage: 1,600 wide with the margin, so 1,200 / (1,600 · 1.16) = 0.647.
    expect(view.zoom).toBeCloseTo(0.6466, 3);
    const fitted = readCanvas(prepared, view);
    const px = (role: string, text: string) => fitted.texts.filter((t) => t.role === role && t.text === text).map((t) => Number((t.size * view.zoom).toFixed(2)));
    // Names at 12 and counts at 9 are drawn from zoom 0.2, so on screen at 7.76 and 5.82 px.
    expect(px("node", "Activity 3")).toEqual([7.76]);
    expect(px("node", "40")).toEqual(Array(8).fill(5.82));
    // A stage's title (14, semibold) has no level of detail: at zoom 0.06 it is drawn at 0.84 px.
    const far = readCanvas(prepared, { ...view, zoom: 0.06 });
    expect(far.texts.filter((t) => t.role === "group").map((t) => Number((t.size * 0.06).toFixed(2)))).toEqual([0.84]);
    expect(far.texts.filter((t) => t.role === "node")).toEqual([]);
  });

  it("finding: a path's count has no place of its own and covers the count of the path back and, when wide, an activity", () => {
    // a and b 20 apart with paths both ways: both run straight between the boxes, both counts sit at the same middle.
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
    // 40 and 20: "40" over "20" in the gap; 851,000 and 425,500: "851k" (22 wide at 10 px) is wider than the 20 between a and b.
    expect(check(40)).toEqual(['label covers label: path label "40" of a->b covers path label "20" of b->a']);
    expect(check(851_000)).toEqual([
      'label covers card: path label "851k" of a->b covers a',
      'label covers card: path label "851k" of a->b covers b',
      'label covers card: path label "426k" of b->a covers a',
      'label covers card: path label "426k" of b->a covers b',
      'label covers label: path label "851k" of a->b covers path label "426k" of b->a',
    ]);
  });

  it("finding: keep connected can leave an activity without a path from the start", () => {
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

