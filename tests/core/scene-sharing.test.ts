import { describe, expect, it } from "vitest";
import { type FlowGraph, buildScene, createPositions } from "../../src/index";
import { prepareScene } from "../../src/canvas/index";

/**
 * Two of each: start events, activities, re-added activities; follows edges
 * without a count, re-added follows edges with one and constraint edges.
 */
const graph: FlowGraph = {
  nodes: [
    { id: "s1", kind: "event", label: "Start", tags: ["start"] },
    { id: "s2", kind: "event", label: "Start", tags: ["start"], metrics: { cases: 9 } },
    { id: "a1", kind: "activity", label: "A1", metrics: { cases: 7 } },
    { id: "a2", kind: "activity", label: "A2", metrics: { cases: 7 } },
    { id: "r1", kind: "activity", label: "R1", tags: ["reconnected"] },
    { id: "r2", kind: "activity", label: "R2", tags: ["reconnected"] },
  ],
  edges: [
    { id: "s1-a1", kind: "follows", source: "s1", target: "a1" },
    { id: "s2-a2", kind: "follows", source: "s2", target: "a2" },
    { id: "a1-r1", kind: "follows", source: "a1", target: "r1", tags: ["reconnected"], metrics: { count: 2 } },
    { id: "a2-r2", kind: "follows", source: "a2", target: "r2", tags: ["reconnected"], metrics: { count: 2 } },
    { id: "a1-a2", kind: "constraint", source: "a1", target: "a2" },
    { id: "r1-r2", kind: "constraint", source: "r1", target: "r2" },
  ],
};

// A row of boxes 200 apart; only a1-a2 has a route, a bend below the row.
const route = [{ x: 560, y: 30 }, { x: 580, y: 100 }, { x: 600, y: 30 }];
const positions = createPositions(
  { nodes: Object.fromEntries(graph.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 160, height: 60 }])), groups: {}, edges: { "a1-a2": { points: route } } },
  "given",
  "RIGHT",
);

describe("what the elements of a scene share", () => {
  const scene = buildScene(graph, positions);
  const node = (id: string) => scene.nodeMarks.find((m) => m.id === id)!;
  const edge = (id: string) => scene.edgeMarks.find((m) => m.id === id)!;

  it("gives node marks with the same outline one frozen outline", () => {
    expect(node("s2").stroke).toBe(node("s1").stroke);
    expect(node("a2").stroke).toBe(node("a1").stroke);
    expect(node("r2").stroke).toBe(node("r1").stroke);
    // Re-added activities are dashed, so their outline differs from the others'.
    expect(node("a1").stroke).toEqual({ paint: "lineStrong", width: 1 });
    expect(node("r1").stroke).toEqual({ paint: "lineStrong", width: 1, dash: [4, 3] });
    expect(node("r1").stroke).not.toBe(node("a1").stroke);
    for (const m of scene.nodeMarks) {
      expect(Object.isFrozen(m.stroke)).toBe(true);
      if (m.stroke.dash) expect(Object.isFrozen(m.stroke.dash)).toBe(true);
    }
    // Another scene reads the same outlines.
    expect(buildScene(graph, positions).nodeMarks.find((m) => m.id === "a2")!.stroke).toBe(node("a1").stroke);
  });

  it("gives edges without a count one frozen empty list of texts and the dashed edges of a kind one frozen dash", () => {
    const none = edge("s1-a1").texts;
    expect(none).toEqual([]);
    expect(Object.isFrozen(none)).toBe(true);
    for (const id of ["s2-a2", "a1-a2", "r1-r2"]) expect(edge(id).texts).toBe(none);
    expect(edge("a1-r1").texts.map((t) => t.text)).toEqual(["2"]);

    expect(edge("a1-r1").dash).toEqual([6, 5]);
    expect(edge("a2-r2").dash).toBe(edge("a1-r1").dash);
    // A constraint between re-added activities is not re-added itself: dotted.
    expect(edge("a1-a2").dash).toEqual([2, 4]);
    expect(edge("r1-r2").dash).toBe(edge("a1-a2").dash);
    for (const id of ["a1-r1", "a1-a2"]) expect(Object.isFrozen(edge(id).dash)).toBe(true);
    expect(edge("s1-a1").dash).toBeUndefined();
  });

  it("gives retained nodes without badges one frozen empty list and reads their count from the mark", () => {
    const prepared = prepareScene(graph, positions, { overlays: [{ kind: "badge", target: "a1", payload: { constraintId: "presence", value: 0.5 } }] });
    const retained = (id: string) => prepared.nodeById.get(id)!;
    expect(retained("a1").badges.map((s) => s.overlay.target)).toEqual(["a1"]);
    const none = retained("a2").badges;
    expect(none).toEqual([]);
    expect(Object.isFrozen(none)).toBe(true);
    for (const id of ["s1", "s2", "r1", "r2"]) expect(retained(id).badges).toBe(none);
    // The activities' cases are the count their marks write; an event's cases are not written on the map.
    expect(retained("a1").meta).toBe("7");
    expect(retained("a1").mark.texts.map((t) => t.text)).toEqual(["A1", "7", "· –"]);
    expect(retained("s2").meta).toBe("9");
    expect(retained("s2").mark.texts.map((t) => t.role)).toEqual(["label"]);
    expect(retained("r1").meta).toBeUndefined();
  });

  it("indexes a straight edge by its route and a bent edge by a segment per leg", () => {
    const prepared = prepareScene(graph, positions);
    const items = prepared.hit.within(prepared.bounds).filter((it) => it.kind === "edge");
    const legs = (id: string) => items.filter((it) => it.id === id).sort((a, b) => a.minX - b.minX);
    for (const id of ["s1-a1", "s2-a2", "a1-r1", "a2-r2", "r1-r2"]) {
      expect(legs(id)).toHaveLength(1);
      expect(legs(id)[0].segment).toBe(prepared.edgeById.get(id)!.points);
    }
    expect(legs("a1-a2").map((it) => it.segment)).toEqual([
      [route[0], route[1]],
      [route[1], route[2]],
    ]);
  });
});
