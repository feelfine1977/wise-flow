import { describe, expect, it } from "vitest";
import { abstract } from "../../src/index";
import { abstractionCases, abstractionDigest, abstractionGraphs } from "./abstract-cases";
// Recorded from the implementation before the denominators of the strengths were
// computed once per abstraction; only a deliberate change of the output may change it.
import expected from "./abstract-expected.json";

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
});
