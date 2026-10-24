/**
 * A collapsed stage's numbers (WF-09): the card prints a lower bound as
 * "≥ 211,379 · ≥ 84 %", while descriptions and tables keep "at least"; the
 * legend explains the mark only where a card carries it; the host's exact
 * numbers of the stage (`FlowGroup.metrics`) replace the bound.
 */
import { describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { type FlowGraph, buildScene, collapseGroups, createPositions, defaultNodeSize, metricBasis } from "../../src/index";
import { describeNode } from "../../src/react/describe";

function row(graph: FlowGraph) {
  let x = 0;
  const nodes = Object.fromEntries(graph.nodes.map((n) => {
    const s = defaultNodeSize(n);
    const box = { x, y: 0, ...s };
    x += s.width + 40;
    return [n.id, box];
  }));
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}
const numbers = (g: FlowGraph, id: string) => buildScene(g, row(g)).nodeMarks.find((m) => m.id === id)!.texts.filter((t) => t.role === "countLine" || t.role === "share").map((t) => t.text);

describe("a collapsed stage", () => {
  const collapsed = collapseGroups(smallP2P, ["receipt"]);

  it("prints its lower bound compactly on the card and in full in its description", () => {
    expect(metricBasis(collapsed.nodes.find((n) => n.id === "receipt")!, "cases")).toBe("atLeast");
    // Record Goods Receipt (900) is the stage's largest member: at least 900 cases, 90 % of 1,000.
    expect(numbers(collapsed, "receipt")).toEqual(["≥ 900", "· ≥ 90 %"]);
    expect(describeNode(collapsed.nodes.find((n) => n.id === "receipt")!, [], "en")).toContain("at least 900 cases");
  });

  it("keys the lower bound in the legend only where a card carries it", () => {
    const keys = (g: FlowGraph) => buildScene(g, row(g)).legend.keys.map((k) => k.kind);
    expect(keys(collapsed)).toContain("atLeast");
    expect(keys(smallP2P)).not.toContain("atLeast");
    expect(buildScene(collapsed, row(collapsed)).legend.rows.find((r) => r.kind === "key" && r.key === "atLeast")).toMatchObject({ glyph: "≥", text: "≥ a lower bound: the cases of the stage's largest activity" });
  });

  it("takes the host's exact cases of the stage, and then prints plain numbers", () => {
    const exact: FlowGraph = { ...smallP2P, groups: smallP2P.groups!.map((g) => (g.id === "receipt" ? { ...g, metrics: { cases: 930 } } : g)) };
    const stage = collapseGroups(exact, ["receipt"]).nodes.find((n) => n.id === "receipt")!;
    expect([stage.metrics?.cases, stage.metrics?.share, metricBasis(stage, "cases"), metricBasis(stage, "share")]).toEqual([930, 0.93, undefined, undefined]);
    expect(numbers(collapseGroups(exact, ["receipt"]), "receipt")).toEqual(["930", "· 93 %"]);
    expect(buildScene(collapseGroups(exact, ["receipt"]), row(collapseGroups(exact, ["receipt"]))).legend.keys.map((k) => k.kind)).not.toContain("atLeast");
  });
});
