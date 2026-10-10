import { describe, expect, it } from "vitest";
import { describeEdge, describeIndexedEdge } from "../../src/core/describe.js";
import { type FlowGraph, indexGraph } from "../../src/index";

const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "Create Order" },
    { id: "b", kind: "activity", label: "Approve Order" },
  ],
  edges: [
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 1200, cases: 900, medianLagHours: 2.5, violationShare: 0.25 }, tags: ["reconnected"] },
    { id: "b->x", kind: "constraint", source: "b", target: "x" },
  ],
  groups: [{ id: "x", kind: "stage", label: "Stage X" }],
};

describe("describeEdge", () => {
  it("names the ends and the metrics of a path in English and German", () => {
    const [edge] = graph.edges;
    expect(describeEdge(edge, graph, "en")).toBe("path Create Order → Approve Order. 1,200 transitions. 900 cases. median lag 2.5 h. 25 % expectation shortfall. re-added to keep the map connected.");
    expect(describeEdge(edge, graph, "de")).toBe("Pfad Create Order → Approve Order. 1.200 Übergänge. 900 Fälle. Median-Wartezeit 2,5 h. 25 % Erwartungslücke. wieder eingefügt, damit die Karte zusammenhängt.");
  });

  it("names an end that is not a node by its id, also when a group has that id", () => {
    expect(describeEdge(graph.edges[1], graph, "en")).toBe("constraint Approve Order → x.");
  });

  it("gives the same text through an index built once for the graph", () => {
    const index = indexGraph(graph);
    for (const locale of ["en", "de"] as const) {
      for (const edge of graph.edges) expect(describeIndexedEdge(edge, index, locale)).toBe(describeEdge(edge, graph, locale));
    }
  });
});
