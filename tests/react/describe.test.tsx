import { describe, expect, it } from "vitest";
import { type FlowGraph, abstract } from "../../src/index.js";
import { describeMap } from "../../src/react/index.js";

const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", metrics: { cases: 10 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 4 } },
  ],
  edges: [{ id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 4 } }],
};

describe("describeMap", () => {
  it("names the thresholds that abstract recorded", () => {
    const text = describeMap(abstract(graph, { minNodeShare: 0.25, minEdgeShare: 0.5 }), [], "en");
    expect(text).toMatch(/Abstraction: activities above 25\s?%, paths above 50\s?%\./);
  });

  it("does not read a server threshold share as zero thresholds", () => {
    // A number in `meta.abstraction` is not the recorded object: it has no node and path shares.
    const text = describeMap({ ...graph, meta: { abstraction: 0.2 } }, [], "en");
    expect(text).not.toContain("Abstraction:");
    expect(describeMap({ ...graph, meta: { abstraction: 0 } }, [], "en")).not.toContain("Abstraction:");
  });
});
