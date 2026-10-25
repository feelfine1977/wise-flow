import { describe, expect, it } from "vitest";
import { type Box, type EdgeMark, type FlowGraph, type Positions, buildScene, edgeMark, estimateTextWidth, placeEdgeLabels } from "../../src/core/index.js";

// Synthetic crossings: paths whose labels at the middle of their routes land on a card, on another label or on a trunk.
const path = (id: string, points: { x: number; y: number }[], cases: number, width = 2): EdgeMark =>
  edgeMark({ id, source: `${id}-a`, target: `${id}-b`, kind: "follows", metrics: { cases } }, points, { color: "#000", width });

const labelBox = (m: EdgeMark): Box => {
  const t = m.texts[0];
  const width = estimateTextWidth(t.text, t);
  return { x: t.x - width / 2, y: t.y - t.size, width, height: t.size * 1.2 };
};
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("placeEdgeLabels", () => {
  it("keeps a label that covers nothing where it is", () => {
    const m = path("p", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 12);
    expect(placeEdgeLabels([m], { nodes: [], titles: [] }, estimateTextWidth)[0]).toBe(m);
  });

  it("moves a label off a card it covers", () => {
    const m = path("p", [{ x: 0, y: 0 }, { x: 400, y: 0 }], 12);
    const card = { x: 180, y: -30, width: 40, height: 28 };
    const [placed] = placeEdgeLabels([m], { nodes: [card], titles: [] }, estimateTextWidth);
    expect(overlaps(labelBox(m), card)).toBe(true);
    expect(overlaps(labelBox(placed), card)).toBe(false);
  });

  it("never lets two labels overlap: the wider path keeps its place", () => {
    const wide = path("wide", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 900, 6);
    const thin = path("thin", [{ x: 0, y: 1 }, { x: 200, y: 1 }], 7, 1);
    const [a, b] = placeEdgeLabels([thin, wide], { nodes: [], titles: [] }, estimateTextWidth);
    expect(b).toBe(wide);
    expect(overlaps(labelBox(a), labelBox(b))).toBe(false);
  });

  it("attaches a leader when every place beside the line is covered", () => {
    const m = path("p", [{ x: 0, y: 0 }, { x: 60, y: 0 }], 12);
    // Cards right above and below the whole route.
    const cards = [{ x: -40, y: -20, width: 140, height: 18 }, { x: -40, y: 2, width: 140, height: 18 }];
    const [placed] = placeEdgeLabels([m], { nodes: cards, titles: [] }, estimateTextWidth);
    expect(placed.leader).toHaveLength(2);
    for (const card of cards) expect(overlaps(labelBox(placed), card)).toBe(false);
  });

  it("is deterministic and leaves the input marks as they were", () => {
    const marks = [path("a", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 5), path("b", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 5)];
    const before = JSON.stringify(marks);
    const one = placeEdgeLabels(marks, { nodes: [], titles: [] }, estimateTextWidth);
    const two = placeEdgeLabels([...marks].reverse(), { nodes: [], titles: [] }, estimateTextWidth).reverse();
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
    expect(JSON.stringify(marks)).toBe(before);
  });
});

describe("FlowSceneOptions.labelPlacement", () => {
  // Two activities side by side with a third right above the middle of the path between them.
  const graph: FlowGraph = {
    nodes: [
      { id: "a", label: "A", kind: "activity", metrics: { cases: 10 } },
      { id: "b", label: "B", kind: "activity", metrics: { cases: 10 } },
      { id: "c", label: "C", kind: "activity", metrics: { cases: 10 } },
    ],
    edges: [{ id: "a-b", source: "a", target: "b", kind: "follows", metrics: { cases: 10 } }],
  };
  const positions: Positions = {
    nodes: { a: { x: 0, y: 0, width: 100, height: 40 }, b: { x: 300, y: 0, width: 100, height: 40 }, c: { x: 180, y: -18, width: 40, height: 36 } },
    groups: {},
    edges: { "a-b": { points: [{ x: 100, y: 20 }, { x: 300, y: 20 }] } },
    bounds: { x: 0, y: -18, width: 400, height: 58 },
    engine: "given",
    direction: "RIGHT",
  };

  it("keeps `midpoint` as it was and moves a label clear with `clear`", () => {
    const plain = buildScene(graph, positions);
    expect(JSON.stringify(buildScene(graph, positions, { labelPlacement: "midpoint" }).edgeMarks)).toBe(JSON.stringify(plain.edgeMarks));
    const clear = buildScene(graph, positions, { labelPlacement: "clear" }).edgeMarks[0];
    const card = positions.nodes.c;
    expect(overlaps(labelBox(plain.edgeMarks[0]), card)).toBe(true);
    expect(overlaps(labelBox(clear), card)).toBe(false);
  });
});
