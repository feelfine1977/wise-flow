import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type ActivityClause, type ActivityOp, type BuildViewsOptions, type ColorSpec, type DefaultActionOptions, type DiffOptions, type FlowEdge, type FlowElement,
  type FlowGraph, type FlowNode, type FollowsSelfLoopOptions, type HitItem, type HitKind, type NodeMarkOptions, type PaletteName, type PathsOptions, type PatternShape,
  buildScales, buildViews, byId, colorOn, defaultActions, diff, followsSelfLoops, isEdge, nodeMark, pathsFor, patternTwin,
} from "../../src/index";

// The replacements docs/API.md names for the deprecated names of the entry point.
describe("deprecated names of the entry point", () => {
  it("name the same types as their replacements", () => {
    expectTypeOf<FlowElement>().toEqualTypeOf<FlowNode | FlowEdge>();
    expectTypeOf<DiffOptions>().toEqualTypeOf<NonNullable<Parameters<typeof diff>[2]>>();
    expectTypeOf<PaletteName>().toEqualTypeOf<NonNullable<ColorSpec["palette"]>>();
    expectTypeOf<PatternShape>().toEqualTypeOf<ReturnType<typeof patternTwin>>();
    expectTypeOf<HitKind>().toEqualTypeOf<HitItem["kind"]>();
    expectTypeOf<BuildViewsOptions>().toEqualTypeOf<NonNullable<Parameters<typeof buildViews>[2]>>();
    expectTypeOf<PathsOptions>().toEqualTypeOf<NonNullable<Parameters<typeof pathsFor>[2]>>();
    expectTypeOf<ActivityOp>().toEqualTypeOf<ActivityClause["op"]>();
    expectTypeOf<DefaultActionOptions>().toEqualTypeOf<NonNullable<Parameters<typeof defaultActions>[3]>>();
    expectTypeOf<FollowsSelfLoopOptions>().toEqualTypeOf<NonNullable<Parameters<typeof followsSelfLoops>[1]>>();
    expectTypeOf<NodeMarkOptions>().toEqualTypeOf<Parameters<typeof nodeMark>[2]>();
  });

  it("keep working: colorOn is the scales' colour, isEdge tests for a source, byId compares ids", () => {
    const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }], edges: [{ id: "e", kind: "follows", source: "a", target: "a" }] };
    expect(buildScales(graph).color).toBe(colorOn);
    expect(graph.edges.map((e) => [isEdge(e), "source" in e])).toEqual([[true, true]]);
    expect(graph.nodes.map((n) => [isEdge(n), "source" in n])).toEqual([[false, false]]);
    expect([{ id: "b" }, { id: "B" }, { id: "a" }, { id: "b" }].sort(byId).map((e) => e.id)).toEqual(["B", "a", "b", "b"]);
  });
});
