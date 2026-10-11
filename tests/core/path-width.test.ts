import { beforeAll, describe, expect, it } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { type AbstractOptions, type FlowEdge, type FlowGraph, type FlowScene, type LegendRow, type StyleSpec, abstract, buildScene, defaultStyle, layout, resolveViews } from "../../src/index";

/** The settings of the map's two sliders the map was drawn at: activities and paths both at 0 %, the stories' default, 5, 10, 25 and 50 %. */
const SETTINGS: [string, AbstractOptions][] = [
  ["0 %", { minNodeShare: 0, minEdgeShare: 0 }],
  ["default", { minNodeShare: 0.01, minEdgeShare: 0.03 }],
  ["5 %", { minNodeShare: 0.05, minEdgeShare: 0.05 }],
  ["10 %", { minNodeShare: 0.1, minEdgeShare: 0.1 }],
  ["25 %", { minNodeShare: 0.25, minEdgeShare: 0.25 }],
  ["50 %", { minNodeShare: 0.5, minEdgeShare: 0.5 }],
];

/** What the map shows at a setting: stages collapsed first, then the sliders, as `<ProcessMap/>` abstracts. */
function shown(graph: FlowGraph, setting: AbstractOptions, collapse: boolean): FlowGraph {
  const base = collapse ? abstract(graph, { collapse: "all", keepConnected: false }) : graph;
  return abstract(base, { ...setting, keepConnected: true, collapse: false });
}

/** The cases of the log's strongest path, read from the fixture: every path of the whole log, before any abstraction. */
const strongest = Math.max(...globalScene.edges.filter((e) => e.kind === "follows").map((e) => e.metrics?.cases ?? 0));

/**
 * The width the ticket's scale gives a count, derived by hand: the square root
 * from 0 to the strongest path onto 0 to 8, rounded to hundredths, and never
 * under the thinnest line of 1.
 */
const expected = (cases: number, max = strongest) => Math.max(1, Math.round(800 * Math.sqrt(Math.min(1, cases / max))) / 100);

const scenes = new Map<string, FlowScene>();
const key = (name: string, collapse: boolean) => `${name}${collapse ? " collapsed" : ""}`;

beforeAll(async () => {
  for (const collapse of [false, true]) {
    for (const [name, setting] of SETTINGS) {
      const graph = shown(globalScene, setting, collapse);
      scenes.set(key(name, collapse), buildScene(graph, await layout(graph, { engine: "dagre" }), { selfLoops: false }));
    }
  }
}, 120_000);

const widthRow = (scene: FlowScene) => scene.legend.rows.find((r): r is Extract<LegendRow, { kind: "width" }> => r.kind === "width");

describe("one width scale per graph", () => {
  it("draws every shown path of the whole log at the width its cases have on the log's scale, at every setting, with stages shown and collapsed", () => {
    // The strongest path of the whole log is the start → Create Purchase Order Item with 194,821 cases (counted from the fixture).
    expect(strongest).toBe(194_821);
    const widths = new Map<string, number>();
    for (const collapse of [false, true]) {
      for (const [name] of SETTINGS) {
        const scene = scenes.get(key(name, collapse))!;
        const paths = scene.edgeMarks.filter((m) => m.kind === "follows");
        expect(paths.length).toBeGreaterThan(0);
        for (const m of paths) {
          // A collapsed stage's merged path reads the largest of its paths' cases, on the same scale.
          expect([name, collapse, m.id, m.width]).toEqual([name, collapse, m.id, expected(m.edge.metrics!.cases!)]);
          // A path that stays keeps its width when a slider moves or stages collapse.
          if (widths.has(m.id) && m.edge.metrics?.cases === globalScene.edges.find((e) => e.id === m.id)?.metrics?.cases) expect([m.id, m.width]).toEqual([m.id, widths.get(m.id)]);
          widths.set(m.id, m.width);
        }
      }
    }
    // At 50 % the path of 102,901 cases is no hairline: √(102,901 / 194,821) × 8 = 5.81.
    const p = scenes.get(key("50 %", false))!.edgeMarks.find((m) => m.edge.metrics?.cases === 102_901);
    expect(p?.width).toBe(5.81);
  });

  it("shows the same width entry in the legend at every setting: three reference widths with the counts the scale gives them", () => {
    const rows = [...scenes.values()].map(widthRow);
    for (const row of rows) expect(row).toEqual(rows[0]);
    // The thinnest line takes every count up to 194,821 × (1/8)² = 3,044.1; the middle width 4.5 is
    // 194,821 × (4.5/8)² = 61,642, so 62,000 with two significant digits, drawn at √(62,000 / 194,821) × 8 = 4.51.
    expect(rows[0]).toEqual({
      kind: "width",
      title: "Path width: cases (count) · whole graph",
      samples: [
        { width: 1, text: "≤ 3,044" },
        { width: 4.51, text: "62,000" },
        { width: 8, text: "195k" },
      ],
    });
    // The samples are what the scale draws: each value at its width.
    const scene = scenes.get(key("default", false))!;
    const item = scene.legend.items.find((i) => i.kind === "width");
    const samples = item?.kind === "width" ? item.samples! : [];
    expect(samples.map((s) => s.value)).toEqual([3044, 62_000, 194_821]);
    for (const s of samples) {
      const edge: FlowEdge = { id: "probe", kind: "follows", source: "a", target: "b", metrics: { cases: s.value } };
      expect(scene.scales.edgeWidth(edge)).toBe(s.width);
      expect(s.width).toBe(expected(s.value));
    }
    // One case more than the floor's count rounds to the thinnest line still; 3,100 is drawn a hundredth wider.
    expect(scene.scales.edgeWidth({ id: "probe", kind: "follows", source: "a", target: "b", metrics: { cases: 3045 } })).toBe(1);
    expect(scene.scales.edgeWidth({ id: "probe", kind: "follows", source: "a", target: "b", metrics: { cases: 3100 } })).toBe(1.01);
    expect(scene.scales.domains.edgeWidth).toEqual([0, 194_821]);
  });

  it("names the scale and its floor in German", () => {
    const graph = shown(globalScene, SETTINGS[1][1], false);
    const scene = buildScene(graph, scenes.get(key("default", false))!.positions, { selfLoops: false, locale: "de" });
    expect(widthRow(scene)).toEqual({
      kind: "width",
      title: "Pfadbreite: Fälle (Anzahl) · ganzer Graph",
      samples: [
        { width: 1, text: "≤ 3.044" },
        { width: 4.51, text: "62.000" },
        { width: 8, text: "195k" },
      ],
    });
  });

  it("draws a path whose width rounds under the thinnest line at the thinnest line", () => {
    const graph: FlowGraph = {
      nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase() })),
      edges: [
        { id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 6400 } },
        { id: "bc", kind: "follows", source: "b", target: "c", metrics: { cases: 1 } },
        { id: "ac", kind: "follows", source: "a", target: "c", metrics: { cases: 100 } },
      ],
    };
    const positions = scenes.get(key("default", false))!.positions;
    const scene = buildScene(graph, { ...positions, nodes: { a: { x: 0, y: 0, width: 100, height: 40 }, b: { x: 200, y: 0, width: 100, height: 40 }, c: { x: 400, y: 0, width: 100, height: 40 } }, edges: {}, groups: {} }, { selfLoops: false });
    // √(1 / 6,400) × 8 = 0.1 and √(100 / 6,400) × 8 = 1: both at the thinnest line; the floor takes counts up to 6,400 / 64 = 100.
    expect(scene.edgeMarks.map((m) => [m.id, m.width])).toEqual([["ab", 8], ["bc", 1], ["ac", 1]]);
    // The middle width 4.5 is 6,400 × (4.5/8)² = 2,025, so 2,000, drawn at √(2,000 / 6,400) × 8 = 4.47.
    expect(widthRow(scene)?.samples).toEqual([{ width: 1, text: "≤ 100" }, { width: 4.47, text: "2,000" }, { width: 8, text: "6,400" }]);
  });
});

describe("the scale's upper end given by the host", () => {
  it("draws equal counts at equal widths on two maps given the same upper end", async () => {
    const style: StyleSpec = { ...defaultStyle, edgeWidth: { ...defaultStyle.edgeWidth!, max: 200_000 } };
    const g = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
    const v = abstract(vendorScene, { minEdgeShare: 0.02 });
    const a = buildScene(g, await layout(g, { engine: "dagre" }), { style, selfLoops: false });
    const b = buildScene(v, await layout(v, { engine: "dagre" }), { style, selfLoops: false });
    // A count drawn on both maps: √(n / 200,000) × 8, whatever each map's own strongest path.
    for (const n of [1, 327, 5_000, 194_821]) {
      const edge: FlowEdge = { id: "probe", kind: "follows", source: "a", target: "b", metrics: { cases: n } };
      expect(a.scales.edgeWidth(edge)).toBe(b.scales.edgeWidth(edge));
      expect(a.scales.edgeWidth(edge)).toBe(Math.max(1, Math.round(800 * Math.sqrt(n / 200_000)) / 100));
    }
    for (const m of b.edgeMarks.filter((m) => m.kind === "follows")) expect(m.width).toBe(expected(m.edge.metrics!.cases!, 200_000));
    // The legend says the scale is shared and shows the same entry on both maps.
    expect(widthRow(a)).toEqual(widthRow(b));
    expect(widthRow(a)?.title).toBe("Path width: cases (count) · shared scale");
    expect(widthRow(a)?.samples.at(-1)).toEqual({ width: 8, text: "200k" });
  });

  it("shares the upper end across views through the same option", () => {
    const base = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
    const positions = { nodes: Object.fromEntries(base.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 180, height: 64 }])), groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 1, height: 1 }, engine: "given" as const, direction: "RIGHT" as const };
    // A second view whose paths carry half the cases: its widths are read on the first view's upper end.
    const halved = Object.fromEntries(base.edges.map((e) => [e.id, { cases: Math.round((e.metrics?.cases ?? 0) / 2) }]));
    const set = resolveViews(base, [{ id: "all", label: "All" }, { id: "half", label: "Half", edgeMetrics: halved }], positions);
    expect(set.views.map((v) => v.style.edgeWidth?.max)).toEqual([strongest, strongest]);
    const [all, half] = set.views;
    const edge: FlowEdge = { id: "probe", kind: "follows", source: "a", target: "b", metrics: { cases: 30_000 } };
    expect(all.scales.edgeWidth(edge)).toBe(half.scales.edgeWidth(edge));
    expect(all.scales.edgeWidth(edge)).toBe(expected(30_000));
  });

  it("shares an upper end that holds a view whose paths carry more than the base", () => {
    const base = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
    const positions = { nodes: Object.fromEntries(base.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 180, height: 64 }])), groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 1, height: 1 }, engine: "given" as const, direction: "RIGHT" as const };
    // A second view whose paths carry twice the cases: the strongest of them, 389,642, is the upper end of both views.
    const doubled = Object.fromEntries(base.edges.map((e) => [e.id, { cases: (e.metrics?.cases ?? 0) * 2 }]));
    const set = resolveViews(base, [{ id: "all", label: "All" }, { id: "double", label: "Double", edgeMetrics: doubled }], positions);
    expect(set.views.map((v) => v.style.edgeWidth?.max)).toEqual([389_642, 389_642]);
    const width = (i: number, id: string) => set.views[i].scales.edgeWidth(set.views[i].graph.edges.find((e) => e.id === id)!);
    const top = base.edges.find((e) => e.metrics?.cases === strongest)!.id;
    // The base's strongest path is √(194,821 / 389,642) × 8 = 5.66 wide in the first view and 8 in the second, not 8 in both.
    expect([width(0, top), width(1, top)]).toEqual([5.66, 8]);
  });
});
