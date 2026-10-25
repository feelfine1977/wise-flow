import { describe, expect, it } from "vitest";
import { type FlowGraph, type Positions, abstract, buildScene, laneBands, toSVG } from "../../src/core/index.js";

// Three stages in order; the middle one has none of its activities in this cohort.
const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1", metrics: { cases: 4 } },
    { id: "b", kind: "activity", label: "B", group: "s1", metrics: { cases: 4 } },
    { id: "c", kind: "activity", label: "C", group: "s3", metrics: { cases: 4 } },
  ],
  edges: [
    { id: "a-b", kind: "follows", source: "a", target: "b", metrics: { cases: 4 } },
    { id: "b-c", kind: "follows", source: "b", target: "c", metrics: { cases: 4 } },
  ],
  groups: [
    { id: "s1", kind: "stage", label: "Order", metrics: { activities: 5 } },
    { id: "s2", kind: "stage", label: "Approval", metrics: { activities: 3 } },
    { id: "s3", kind: "stage", label: "Invoice" },
  ],
};
const box = (x: number) => ({ x, y: 0, width: 100, height: 40 });
const positions: Positions = { nodes: { a: box(0), b: box(200), c: box(500) }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 600, height: 40 }, engine: "given", direction: "RIGHT" };

describe("empty stages", () => {
  it("are left out by default, as before", () => {
    expect(laneBands(graph, positions, { lanes: "stages" }).bands.map((b) => b.id)).toEqual(["s1", "s3"]);
  });

  it("draw a 12 px divider on the boundary between their neighbours, without moving a card", () => {
    const laid = laneBands(graph, positions, { lanes: "stages", emptyLanes: "divider" });
    const divider = laid.bands.find((b) => b.id === "s2")!;
    expect(divider.empty).toBe(true);
    expect(divider.box.width).toBe(12);
    const boundary = laid.positions.groups.s1.x + laid.positions.groups.s1.width;
    expect(divider.box.x + divider.box.width / 2).toBe(boundary);
    expect(laid.positions.nodes).toEqual(positions.nodes);
    expect(laneBands(graph, positions, { lanes: "stages", emptyLanes: "lane" }).bands.find((b) => b.id === "s2")!.box.width).toBe(36);
  });
});

describe("band headers", () => {
  it("count the activities shown, of the stage's where its metrics say, and note an empty stage", () => {
    const scene = buildScene(graph, positions, { lanes: "stages", laneOptions: { counts: true, emptyLanes: "divider" } });
    const header = (id: string) => scene.groupMarks.find((m) => m.id === id)!.texts.find((t) => t.role === "count")?.text;
    expect(header("s1")).toBe("2 of 5 activities");
    expect(header("s3")).toBe("1 activity");
    expect(header("s2")).toBe("none in this cohort");
    expect(scene.groupMarks.find((m) => m.id === "s2")!.fill.opacity).toBe(0);
  });

  it("speak German and print once in the export", () => {
    const scene = buildScene(graph, positions, { lanes: "stages", locale: "de", laneOptions: { counts: true } });
    expect(scene.groupMarks[0].texts[1].text).toBe("2 von 5 Aktivitäten");
    const svg = toSVG({ graph, positions, lanes: "stages", locale: "de", laneOptions: { counts: true } });
    expect(svg.split("2 von 5 Aktivitäten").length - 1).toBe(1);
  });

  it("count one activity in the singular, in English and in German", () => {
    const one: FlowGraph = { ...graph, groups: graph.groups!.map((g) => (g.id === "s3" ? { ...g, metrics: { activities: 1 } } : g)) };
    const header = (locale: "en" | "de") => buildScene(one, positions, { lanes: "stages", locale, laneOptions: { counts: true } }).groupMarks.find((m) => m.id === "s3")!.texts[1].text;
    expect(header("en")).toBe("1 of 1 activity");
    expect(header("de")).toBe("1 von 1 Aktivität");
  });

  it("are not drawn without `counts`", () => {
    const scene = buildScene(graph, positions, { lanes: "stages" });
    expect(scene.groupMarks.every((m) => m.texts.length === 1)).toBe(true);
  });
});

describe("empty stages after abstraction (WF-16 follow-up)", () => {
  // Three stages, each with one activity; abstraction removes the weak ones.
  const three = (weak: string[]): FlowGraph => ({
    nodes: ["s1", "s2", "s3"].map((g, i) => ({ id: `n${i}`, kind: "activity" as const, label: `N${i}`, group: g, metrics: { cases: weak.includes(g) ? 1 : 100 } })),
    edges: [{ id: "e01", kind: "follows", source: "n0", target: "n1", metrics: { cases: 1 } }, { id: "e12", kind: "follows", source: "n1", target: "n2", metrics: { cases: 1 } }],
    groups: ["s1", "s2", "s3"].map((id) => ({ id, kind: "stage" as const, label: id.toUpperCase(), metrics: { activities: 1 } })),
  });
  const shown = (weak: string[], keepEmptyStages?: boolean) => abstract(three(weak), { minNodeShare: 0.5, keepConnected: false, ...(keepEmptyStages && { keepEmptyStages }) });
  const at = (g: FlowGraph): Positions => ({ nodes: Object.fromEntries(g.nodes.map((n) => [n.id, box(Number(n.id.slice(1)) * 300)])), groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 800, height: 40 }, engine: "given", direction: "RIGHT" });

  it("drops a stage with no member left by default, as before", () => {
    expect(shown(["s2"]).groups!.map((g) => g.id)).toEqual(["s1", "s3"]);
  });

  for (const [name, weak] of [["middle", ["s2"]], ["first and last", ["s1", "s3"]]] as const) {
    it(`keeps an empty ${name} stage with keepEmptyStages and draws it as a labelled divider`, () => {
      const g = shown([...weak], true);
      expect(g.groups!.map((x) => x.id)).toEqual(["s1", "s2", "s3"]);
      const scene = buildScene(g, at(g), { lanes: "stages", laneOptions: { counts: true, emptyLanes: "divider" } });
      for (const id of weak) {
        const mark = scene.groupMarks.find((m) => m.id === id)!;
        expect(mark.band?.empty).toBe(true);
        expect(mark.texts.map((t) => t.text)).toEqual([id.toUpperCase(), "none in this cohort"]);
      }
    });
  }
});
