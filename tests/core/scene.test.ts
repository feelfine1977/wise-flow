import { describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay, type Positions, MAP_TARGET, buildScene, defaultLod } from "../../src/index";

// Three activities in a row, 100 × 40 each; a and b in stage s1/s2, c in s2. c repeats itself.
const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1", metrics: { cases: 10 } },
    { id: "b", kind: "activity", label: "B", group: "s2", metrics: { cases: 8 } },
    { id: "c", kind: "activity", label: "C", group: "s2", metrics: { cases: 4 } },
  ],
  edges: [
    { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 9, cases: 8, violationShare: 0.5 } },
    { id: "bc", kind: "follows", source: "b", target: "c", metrics: { count: 4, cases: 4, violationShare: 0 } },
    { id: "cc", kind: "follows", source: "c", target: "c", metrics: { count: 6, cases: 2 } },
  ],
  groups: [
    { id: "s1", kind: "stage", label: "Stage 1" },
    { id: "s2", kind: "stage", label: "Stage 2" },
  ],
};

const positions: Positions = {
  nodes: {
    a: { x: 0, y: 0, width: 100, height: 40 },
    b: { x: 200, y: 0, width: 100, height: 40 },
    c: { x: 400, y: 0, width: 100, height: 40 },
  },
  groups: {
    s1: { x: -10, y: -10, width: 120, height: 60 },
    s2: { x: 190, y: -10, width: 320, height: 60 },
  },
  edges: {},
  bounds: { x: -10, y: -10, width: 520, height: 60 },
  engine: "dagre",
  direction: "RIGHT",
};

const repetition: Overlay = { kind: "selfLoop", target: "c", payload: { constraintId: "rep", value: 0.25, label: "Repetition" } };
const given: Overlay[] = [
  { kind: "chip", target: MAP_TARGET, payload: { constraintId: "scope", glyph: "⊂", text: "Scope" } },
  { kind: "badge", target: "b", payload: { constraintId: "c2", glyph: "≥1", value: 0.2 } },
  { kind: "badge", target: "ghost", payload: { constraintId: "c3" } },
  repetition,
  { kind: "hatch", target: "ab", payload: { constraintId: "edge" } },
  { kind: "arc", target: "x", payload: { constraintId: "lost", source: "a", target: "ghost" } },
  { kind: "badge", target: "a", payload: { constraintId: "c1" } },
  { kind: "arc", target: "a->c", payload: { constraintId: "lag", source: "a", target: "c" } },
  { kind: "tint", target: "s2", payload: { constraintId: "bal", value: 0.4 } },
];

const summary = (overlays: Overlay[]) => overlays.map((o) => `${o.kind}:${o.target}:${o.payload?.constraintId ?? o.payload?.edgeId}`);

describe("buildScene", () => {
  it("keeps known targets and arcs with known endpoints, adds the follows self-loop and orders canonically", () => {
    const scene = buildScene(graph, positions, { overlays: given });
    // Dropped: the badge on "ghost", the hatch on edge "ab" and the arc to "ghost".
    expect(summary(scene.overlays)).toEqual([
      "tint:s2:bal",
      "arc:a->c:lag",
      "selfLoop:c:cc",
      "selfLoop:c:rep",
      "badge:a:c1",
      "badge:b:c2",
      `chip:${MAP_TARGET}:scope`,
    ]);
    expect(buildScene(graph, positions, { overlays: [...given].reverse() }).overlays).toEqual(scene.overlays);
  });

  it("reads graph.overlays when no overlays are given", () => {
    expect(summary(buildScene({ ...graph, overlays: [given[1]] }, positions).overlays)).toEqual(["selfLoop:c:cc", "badge:b:c2"]);
    expect(buildScene({ ...graph, overlays: [given[1]] }, positions, { overlays: [] }).overlays).toHaveLength(1);
  });

  it("derives follows self-loops in one place: plain by default, observed with activity labels, none on request", () => {
    const plain = buildScene(graph, positions).overlays;
    // cases of the loop / cases of the activity = 2 / 4.
    expect(plain).toEqual([{ kind: "selfLoop", target: "c", payload: { label: "cc", value: 0.5, text: "6 ×", edgeId: "cc" } }]);

    const observed = buildScene(graph, positions, { activityLabels: { mode: "names", references: {}, caseLabel: "items" } }).overlays;
    expect(observed).toEqual([{
      kind: "selfLoop",
      target: "c",
      payload: {
        edgeId: "cc",
        observed: true,
        label: "Observed directly-follows repeat: C",
        displayLabel: "↻ 6 transitions",
        text: "6 transitions · 2 items with this direct repeat / 4 items with activity (50 %)",
      },
    }]);

    // A loop overlay that already stands for the edge is replaced in both variants; constraint loops stay.
    const stale: Overlay = { kind: "selfLoop", target: "c", payload: { edgeId: "cc", label: "stale" } };
    expect(summary(buildScene(graph, positions, { overlays: [stale, repetition] }).overlays)).toEqual(["selfLoop:c:cc", "selfLoop:c:rep"]);
    expect(buildScene(graph, positions, { overlays: [stale] }).overlays[0].payload?.label).toBe("cc");
    expect(buildScene(graph, positions, { overlays: [stale], activityLabels: { mode: "ids", references: {} } }).overlays[0].payload?.observed).toBe(true);

    expect(summary(buildScene(graph, positions, { overlays: [repetition], selfLoops: false }).overlays)).toEqual(["selfLoop:c:rep"]);
  });

  it("qualifies the observed share with distinct cases and never invents a share", () => {
    const g: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "Review", metrics: { cases: 10, events: 1000 } }],
      edges: [{ id: "aa", kind: "follows", source: "a", target: "a", metrics: { cases: 3, count: 990 } }],
    };
    const p: Positions = { ...positions, nodes: { a: positions.nodes.a }, groups: {} };
    const read = (graph: FlowGraph) => buildScene(graph, p, { activityLabels: { mode: "names", references: {}, caseLabel: "items" } }).overlays[0].payload!;
    expect(read(g).text).toBe("990 transitions · 3 items with this direct repeat / 10 items with activity (30 %)");
    expect(read(g).value).toBeUndefined();
    expect(read({ ...g, edges: [{ ...g.edges[0], metrics: {} }] }).text).toBe("transition count unavailable · repeat items unavailable");
    expect(read({ ...g, edges: [{ ...g.edges[0], metrics: { cases: 20, count: 990 } }] }).text).not.toContain("%");
    // The plain variant falls back to the count against the strongest follows edge.
    expect(buildScene({ ...g, nodes: [{ ...g.nodes[0], metrics: {} }] }, p).overlays[0].payload?.value).toBe(1);
  });

  it("places the overlay geometry on the positions", () => {
    const scene = buildScene(graph, positions, { overlays: given });
    // Margin = max(140 + 24, 22 + 8, 24 + 8) = 164.
    expect(scene.geometry.margin).toBe(164);
    const shapes = Object.fromEntries(scene.geometry.shapes.map(({ id, x, y, width, height, path, labelX, labelY, minZoom }) => [id, { x, y, width, height, path, labelX, labelY, minZoom }]));
    expect(shapes).toEqual({
      "tint:s2:0": { x: 190, y: -10, width: 320, height: 60, path: undefined, labelX: undefined, labelY: undefined, minZoom: 0 },
      // From the top centres (50, 0) and (450, 0); height max(40, 400 × 0.22) = 88; apex at 0.75 × −88.
      "arc:a->c:1": { x: 50, y: -88, width: 400, height: 88, path: "M50 0 C50 -88 450 -88 450 0", labelX: 250, labelY: -74, minZoom: defaultLod.arcs },
      // Anchored 18 left of c's top-right corner (500, 0), radius 14.
      "selfLoop:c:2": { x: 480, y: -23, width: 45, height: 37, path: "M482 0 C482 -28 528 12 500 12", labelX: 506, labelY: -6, minZoom: defaultLod.selfLoops },
      "selfLoop:c:3": { x: 480, y: -23, width: 45, height: 37, path: "M482 0 C482 -28 528 12 500 12", labelX: 506, labelY: -6, minZoom: defaultLod.selfLoops },
      // Slot 0 at the right end of the top edge: x = right − (width + 4) + 2, centred on the edge.
      "badge:a:4": { x: 76, y: -11, width: 22, height: 22, path: undefined, labelX: undefined, labelY: undefined, minZoom: defaultLod.badges },
      "badge:b:5": { x: 274, y: -11, width: 24, height: 22, path: undefined, labelX: undefined, labelY: undefined, minZoom: defaultLod.badges },
      // Map chips start at the top-left of the margin: y = −10 − 164 + 4.
      [`chip:${MAP_TARGET}:6`]: { x: -10, y: -170, width: 60, height: 24, path: undefined, labelX: undefined, labelY: undefined, minZoom: defaultLod.chips },
    });
    expect(scene.geometry.bounds).toEqual({ x: -10, y: -170, width: 535, height: 220 });
    expect(scene.bounds).toEqual({ x: -10, y: -170, width: 535, height: 220 });
    expect(buildScene(graph, positions, { selfLoops: false }).bounds).toEqual(positions.bounds);
  });

  it("cuts stage bands half-way between stages and returns the moved positions", () => {
    const scene = buildScene(graph, positions, { lanes: "stages", selfLoops: false });
    // Padding 24, label space 32: across the flow from 0 − 24 − 32 to 40 + 24; along it from −24 to 524, cut at (100 + 200) / 2.
    expect(scene.bands).toEqual([
      { id: "s1", index: 0, axis: "main", box: { x: -24, y: -56, width: 174, height: 120 } },
      { id: "s2", index: 1, axis: "main", box: { x: 150, y: -56, width: 374, height: 120 } },
    ]);
    expect(scene.positions.groups).toEqual({ s1: scene.bands[0].box, s2: scene.bands[1].box });
    expect(scene.positions.nodes).toEqual(positions.nodes);
    expect(scene.positions.bounds).toEqual({ x: -24, y: -56, width: 548, height: 120 });
    expect(buildScene(graph, positions).bands).toEqual([]);
    expect(buildScene(graph, positions).positions).toBe(positions);
  });

  it("builds the scales over the follows edges", () => {
    const scene = buildScene(graph, positions);
    // Counts 9, 4 and 6; colour by a share metric reads [0, 1].
    expect(scene.scales.domains.edgeWidth).toEqual([4, 9]);
    expect(scene.scales.domains.edgeColor).toEqual([0, 1]);
    expect(scene.scales.edgeWidth(graph.edges[0])).toBe(8);
    expect(scene.scales.edgeWidth(graph.edges[1])).toBe(1);
    const linear = buildScene(graph, positions, { style: { edgeWidth: { metric: "cases", scale: "linear", range: [2, 4] } } });
    expect(linear.scales.domains.edgeWidth).toEqual([2, 8]);
    expect(linear.scales.edgeWidth(graph.edges[0])).toBe(4);
  });

  it("merges level-of-detail rules and tightens them by size only on request", () => {
    expect(buildScene(graph, positions).lod).toEqual(defaultLod);
    const merged = buildScene(graph, positions, { style: { lod: { labels: 0.5, arcs: 0.3 } }, lod: { arcs: 0.9 } });
    expect(merged.lod).toEqual({ ...defaultLod, labels: 0.5, arcs: 0.9 });
    expect(merged.geometry.shapes.find((s) => s.kind === "selfLoop")?.minZoom).toBe(defaultLod.selfLoops);

    const many: FlowGraph = { nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, kind: "activity" as const, label: `N${i}` })), edges: [] };
    expect(buildScene(many, positions).lod).toEqual(defaultLod);
    const tightened = buildScene(many, positions, { lodBySize: true, lod: { badges: 0.4 } }).lod;
    // More than 60 nodes: every rule × 1.15.
    expect(tightened.badges).toBeCloseTo(0.46);
    expect(tightened.labels).toBeCloseTo(0.23);
    expect(buildScene(graph, positions, { lodBySize: true }).lod).toEqual(defaultLod);
  });

  it("gives every activity a reference and keeps the given ones", () => {
    const scene = buildScene(graph, positions, { activityLabels: { mode: "ids", references: { b: "A07" } } });
    expect(scene.activityLabels?.references).toEqual({ b: "A07", a: "A08", c: "A09" });
    expect(scene.activityLabels?.mode).toBe("ids");
    expect(buildScene(graph, positions).activityLabels).toBeUndefined();
    expect(buildScene(graph, positions, { locale: "de" }).locale).toBe("de");
  });
});
