import { describe, expect, it } from "vitest";
import { byId } from "../../src/core/model";
import { joinComponents, thresholded } from "../../src/core/aggregate";
import { type FlowEdge, type FlowNode, RECONNECTED_TAG, abstract, components, hasTag, isConnected } from "../../src/index";
import { abstractionCases, abstractionDigest, abstractionGraphs, seededCyclicGraph, tiedGraph } from "./abstract-cases";
// Recorded from the implementation before self-loop strength and reconnection were made
// linear; only a deliberate change of the output may change it.
import expected from "./abstract-expected.json";
import { addedCost, previousJoinComponents } from "./abstract-previous";

const ids = (elements: { id: string }[]) => elements.map((el) => el.id).sort();
const inIdOrder = (joined: { nodes: FlowNode[]; edges: FlowEdge[] }) => JSON.stringify([[...joined.nodes].sort(byId), [...joined.edges].sort(byId)]);
const componentCount = (joined: { nodes: FlowNode[]; edges: FlowEdge[] }) => new Set(components(ids(joined.nodes), joined.edges).values()).size;

describe("abstraction output", () => {
  it("is the recorded output on every committed fixture and a seeded cyclic graph", async () => {
    const graphs = await abstractionGraphs();
    const cases = abstractionCases();
    const recorded = expected as Record<string, Record<string, ReturnType<typeof abstractionDigest>>>;
    expect(Object.keys(recorded)).toEqual(Object.keys(graphs));
    for (const [name, graph] of Object.entries(graphs)) {
      expect(Object.keys(recorded[name])).toEqual(Object.keys(cases));
      for (const [label, options] of Object.entries(cases)) {
        expect(abstractionDigest(abstract(graph, options)), `${name}: ${label}`).toEqual(recorded[name][label]);
      }
    }
  });

  it("reconnects every recorded case at the cost of the previous reconnection and keeps what the thresholds keep", async () => {
    const graphs = await abstractionGraphs();
    for (const [name, graph] of Object.entries(graphs)) {
      for (const [label, options] of Object.entries(abstractionCases())) {
        if (!options.keepConnected) continue;
        const kept = thresholded(graph, options);
        const joined = joinComponents(kept);
        const previous = previousJoinComponents(kept);
        expect(addedCost(kept, joined), `${name}: ${label}`).toBeCloseTo(addedCost(kept, previous), 9);
        expect(componentCount(joined), `${name}: ${label}`).toBe(componentCount(previous));
        const result = abstract(graph, options);
        expect(isConnected(result), `${name}: ${label}`).toBe(true);
        const loose = abstract(graph, { ...options, keepConnected: false });
        const unchanged = (elements: { id: string; tags?: string[] }[]) => ids(elements.filter((el) => !hasTag(el, RECONNECTED_TAG)));
        expect([unchanged(result.nodes), unchanged(result.edges)], `${name}: ${label}`).toEqual([ids(loose.nodes), ids(loose.edges)]);
      }
    }
  });

  it("joins what one search per join joins when that search breaks ties by id", () => {
    // The previous reconnection searched anew from everything joined after each join; with
    // its ties broken by id it must choose exactly what the one growing search chooses.
    for (let seed = 1; seed <= 60; seed++) {
      const graph = seed % 4 === 0 ? seededCyclicGraph(seed, 20 + (seed % 50)) : tiedGraph(seed, 10 + (seed % 50));
      for (const relativeTo of ["max", "total"] as const) {
        for (const [minEdgeShare, minNodeShare] of [[0.5, 0.5], [0.75, 0.5], [0.3, 0.75], [1, 0.25], [0.3, 0.2]]) {
          const kept = thresholded(graph, { relativeTo, minEdgeShare, minNodeShare });
          const joined = joinComponents(kept);
          const searched = previousJoinComponents(kept, { ties: "id" });
          expect(inIdOrder(joined), `seed ${seed}, ${relativeTo} ${minEdgeShare}/${minNodeShare}`).toBe(inIdOrder(searched));
        }
      }
    }
  });
});
