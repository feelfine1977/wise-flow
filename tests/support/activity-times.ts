import { type FlowGraph, type LineSpec, createPositions } from "../../src/index";

export const timedGraph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "Review the unusually long supplier invoice activity name", metrics: { cases: 9, medianPrevHours: 81.6, medianNextHours: 2 / 60, meanPrevHours: 96, meanNextHours: 3 / 60, prevPassages: 8, nextPassages: 7 } },
    { id: "b", kind: "activity", label: "Check", metrics: { cases: 9, medianPrevHours: 1 / 600, medianNextHours: 0 } },
    { id: "c", kind: "activity", label: "Missing" },
    { id: "s", kind: "stage", label: "Stage", metrics: { medianPrevHours: 40, medianNextHours: 2 }, metricBasis: { medianPrevHours: "mean", medianNextHours: "mean" } },
  ],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 9, medianLagHours: 1 / 600, meanLagHours: 0, lagPassages: 6 } }],
  meta: { cases: 100 },
};

export function timedPositions(direction: "RIGHT" | "DOWN") {
  return createPositions({ nodes: Object.fromEntries(timedGraph.nodes.map((n, i) => [n.id, { x: direction === "RIGHT" ? i * 230 : 20, y: direction === "DOWN" ? i * 110 : 20, width: 180, height: 64 }])), edges: {}, groups: {} }, "dagre", direction);
}

export function timedStyle(format: "fromPrev" | "toNext" | "both") {
  return { nodeLine: { metric: format === "toNext" ? "medianNextHours" : "medianPrevHours", format, then: "none" } as LineSpec, edgeColor: { metric: "meanLagHours" } };
}
