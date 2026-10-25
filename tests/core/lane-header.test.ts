import { describe, expect, it } from "vitest";
import { type FlowGraph, type Positions, buildScene, laneBands, toSVG } from "../../src/core/index.js";

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
    expect(header("s3")).toBe("1 activities");
    expect(header("s2")).toBe("none in this cohort");
    expect(scene.groupMarks.find((m) => m.id === "s2")!.fill.opacity).toBe(0);
  });

  it("speak German and print once in the export", () => {
    const scene = buildScene(graph, positions, { lanes: "stages", locale: "de", laneOptions: { counts: true } });
    expect(scene.groupMarks[0].texts[1].text).toBe("2 von 5 Aktivitäten");
    const svg = toSVG({ graph, positions, lanes: "stages", locale: "de", laneOptions: { counts: true } });
    expect(svg.split("2 von 5 Aktivitäten").length - 1).toBe(1);
  });

  it("are not drawn without `counts`", () => {
    const scene = buildScene(graph, positions, { lanes: "stages" });
    expect(scene.groupMarks.every((m) => m.texts.length === 1)).toBe(true);
  });
});
