import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Positions, buildScene, collapseGroups, createPositions, pathsFor, toSVG } from "../../src/index";
import { describeEdge } from "../../src/core/describe";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";

/**
 * Case 1 does A then X, case 2 does B then X; A and B are in stage S. Two
 * cases touch S, but the graph holds no case sets: collapsed, S can only say
 * that at least one case touches it.
 */
const twoCases: FlowGraph = {
  nodes: [
    { id: "A", kind: "activity", label: "A", group: "S", metrics: { cases: 1, share: 0.5, events: 1, medianNextHours: 10 } },
    { id: "B", kind: "activity", label: "B", group: "S", metrics: { cases: 1, share: 0.5, events: 1, medianNextHours: 20 } },
    { id: "X", kind: "activity", label: "X", metrics: { cases: 2, share: 1, events: 2 } },
  ],
  edges: [
    { id: "AX", kind: "follows", source: "A", target: "X", metrics: { count: 1, cases: 1, share: 0.5, medianLagHours: 10, p90LagHours: 10 } },
    { id: "BX", kind: "follows", source: "B", target: "X", metrics: { count: 1, cases: 1, share: 0.5, medianLagHours: 20, p90LagHours: 20 } },
  ],
  groups: [{ id: "S", kind: "stage", label: "S" }],
  meta: { cases: 2 },
};

const box = (x: number) => ({ x, y: 0, width: 200, height: 56 });
const at = (ids: string[]): Positions => createPositions({ nodes: Object.fromEntries(ids.map((id, i) => [id, box(i * 300)])), groups: {}, edges: {} }, "given", "RIGHT");

/** The texts of the SVG export, unescaped. */
const svgTexts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));

describe("a collapsed stage says what its numbers are", () => {
  const collapsed = collapseGroups(twoCases, ["S"]);
  const stage = collapsed.nodes.find((n) => n.id === "S")!;
  const merged = collapsed.edges.find((e) => e.source === "S" && e.target === "X")!;

  it("keeps the values and marks the maximum as a lower bound and the averages as means; sums stay exact", () => {
    expect(stage.metrics).toEqual({ cases: 1, share: 0.5, events: 2, medianNextHours: 15, members: 2 });
    expect(stage.metricBasis).toEqual({ cases: "atLeast", share: "atLeast", medianNextHours: "mean" });
    expect(merged.metrics).toEqual({ count: 2, cases: 1, share: 0.5, medianLagHours: 15, p90LagHours: 15 });
    expect(merged.metricBasis).toEqual({ cases: "atLeast", share: "atLeast", medianLagHours: "mean", p90LagHours: "mean" });
    // One merged element is exact; elements not merged carry no basis.
    expect(collapseGroups({ ...twoCases, nodes: twoCases.nodes.filter((n) => n.id !== "B"), edges: twoCases.edges.slice(0, 1) }, ["S"]).nodes.find((n) => n.id === "S")!.metricBasis).toBeUndefined();
    expect(collapsed.nodes.find((n) => n.id === "X")!.metricBasis).toBeUndefined();
    // A merge of merged elements keeps what they were.
    expect(collapseGroups({ ...collapsed, groups: [{ id: "T", kind: "stage", label: "T" }], nodes: collapsed.nodes.map((n) => (n.id === "S" ? { ...n, group: "T" } : n)) }, ["T"]).nodes.find((n) => n.id === "T")!.metricBasis).toEqual({ cases: "atLeast", share: "atLeast", medianNextHours: "mean" });
  });

  it("prints its cases as at least 1 on the card and in both exports", () => {
    const positions = at(["S", "X"]);
    const scene = buildScene(collapsed, positions, { selfLoops: false });
    const card = scene.nodeMarks.find((m) => m.id === "S")!.texts.find((t) => t.role === "count")!.text;
    expect(card).toBe("2 · at least 1");
    expect(buildScene(collapsed, positions, { selfLoops: false, locale: "de" }).nodeMarks.find((m) => m.id === "S")!.texts.find((t) => t.role === "count")!.text).toBe("2 · mindestens 1");
    expect(svgTexts(toSVG({ graph: collapsed, positions, selfLoops: false }))).toContain("2 · at least 1");
    const written: string[] = [];
    const ctx = new Proxy({}, { get: (_t, key) => (key === "fillText" ? (s: string) => written.push(s) : key === "measureText" ? (s: string) => ({ width: s.length * 6 }) : key === "createLinearGradient" || key === "createPattern" ? undefined : () => undefined), set: () => true });
    toPNGCanvas({ graph: collapsed, positions, selfLoops: false }, { scale: 1, createCanvas: (w, h) => ({ width: w, height: h, getContext: () => ctx }) });
    expect(written).toContain("2 · at least 1");
    expect(prepareScene(collapsed, positions, { selfLoops: false }).nodes.find((n) => n.node.id === "S")!.meta).toBe("2 · at least 1");
  });

  it("leaves an averaged median out of the path's label and names it a mean of medians in its description", () => {
    const scene = buildScene(collapsed, at(["S", "X"]), { selfLoops: false });
    // The label is the path's cases, a lower bound; no median.
    expect(scene.edgeMarks.find((m) => m.id === merged.id)!.texts.map((t) => t.text)).toEqual(["≥1"]);
    const text = describeEdge(merged, collapsed, "en");
    expect(text).toContain("lag, mean of medians 15 h");
    expect(text).toContain("at least 1 cases");
    expect(text).not.toContain("median lag");
    expect(describeEdge(merged, collapsed, "de")).toContain("Wartezeit, Mittel der Mediane 15 h");
    // A path that was not merged keeps its median.
    expect(describeEdge(twoCases.edges[0], twoCases, "en")).toContain("median lag 10 h");
  });

  it("derives no share of a stage's paths from its cases, which are lower bounds", () => {
    // Without shares on the paths, a path's share would be its cases over the stage's: at least 1 over at least 1 says nothing.
    const bare = collapseGroups({ ...twoCases, edges: twoCases.edges.map((e) => ({ ...e, metrics: { count: 1, cases: 1 } })) }, ["S"]);
    expect(pathsFor(bare, "S").outgoing).toEqual([expect.objectContaining({ count: 2, cases: 1, share: undefined, metricBasis: { cases: "atLeast" } })]);
    // A share the path carries is kept, with its basis.
    expect(pathsFor(collapsed, "S").outgoing[0]).toMatchObject({ share: 0.5, metricBasis: { share: "atLeast" } });
    // Exact cases keep the derived share: X's incoming path from A, 1 of X's 2 cases.
    const plain = { ...twoCases, edges: twoCases.edges.map((e) => ({ ...e, metrics: { count: 1, cases: 1 } })) };
    expect(pathsFor(plain, "X").incoming.map((r) => r.share)).toEqual([0.5, 0.5]);
  });

  it("prints stage Invoice of the whole log as at least 211,379", () => {
    const whole = collapseGroups(globalScene, "all");
    const invoice = whole.nodes.find((n) => n.id === "invoice")!;
    // The most frequent invoice activity has 211,379 cases; the log has 251,734, an upper bound.
    expect(invoice.metrics?.cases).toBe(211379);
    const positions = at(whole.nodes.map((n) => n.id));
    const card = buildScene(whole, positions, { selfLoops: false }).nodeMarks.find((m) => m.id === "invoice")!.texts.find((t) => t.role === "count")!.text;
    expect(card).toBe(`${invoice.metrics?.members} · at least 211,379`);
    expect(svgTexts(toSVG({ graph: whole, positions, selfLoops: false }))).toContain(card);
  });

  it("prints a stage's own numbers plainly where the host supplies them", () => {
    const stages: FlowGraph = {
      nodes: [
        { id: "order", kind: "stage", label: "Order", metrics: { cases: 900, share: 0.9, members: 4 } },
        { id: "pay", kind: "stage", label: "Payment", metrics: { cases: 780, share: 0.78, members: 2 } },
      ],
      edges: [{ id: "op", kind: "follows", source: "order", target: "pay", metrics: { count: 790, cases: 780, medianLagHours: 30 } }],
    };
    const scene = buildScene(stages, at(["order", "pay"]), { selfLoops: false });
    expect(scene.nodeMarks.find((m) => m.id === "order")!.texts.find((t) => t.role === "count")!.text).toBe("4 · 900");
    expect(describeEdge(stages.edges[0], stages, "en")).toContain("median lag 30 h");
    expect(scene.edgeMarks[0].texts.map((t) => t.text)).toEqual(["780"]);
  });
});
