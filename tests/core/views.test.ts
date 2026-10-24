import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type ViewSpec, abstract, buildViews, createPositions, defaultTheme, layout, overlaysFor, resolveViews, themePalette, viewsSharePositions } from "../../src/index";

const base = abstract(globalScene, { minNodeShare: 0.02, minEdgeShare: 0.05 });
const items = constraintItems("global");
const views: ViewSpec[] = [
  { id: "finance", label: "Finance", overlays: overlaysFor(items.filter((it) => it.description.layer === "L1" || it.description.type === "balance"), { graph: base }) },
  {
    id: "logistics",
    label: "Logistics",
    style: { edgeWidth: { metric: "cases", scale: "sqrt", range: [1, 8] }, edgeColor: { metric: "medianLagHours", palette: "sequentialBlue" }, nodeColor: { metric: "medianNextHours", palette: "sequentialBlue" } },
    overlays: overlaysFor(items.filter((it) => it.description.type === "lag"), { graph: base }),
  },
  { id: "compliance", label: "Compliance", overlays: overlaysFor(items.filter((it) => it.description.type === "precedence" || it.description.type === "exclusion"), { graph: base }) },
  {
    id: "automation",
    label: "Automation",
    style: { edgeWidth: { metric: "count", scale: "sqrt", range: [1, 8] }, edgeColor: { metric: "count" }, nodeColor: { metric: "events" } },
    nodeMetrics: Object.fromEntries(base.nodes.map((n) => [n.id, { events: (n.metrics?.events ?? 0) * 2 }])),
  },
];

describe("views", () => {
  it("keeps positions identical across views", async () => {
    const set = await buildViews(base, views, { layout: { engine: "dagre" } });
    expect(set.views.map((v) => v.id)).toEqual(["finance", "logistics", "compliance", "automation"]);
    expect(viewsSharePositions(set)).toBe(true);
    for (const v of set.views) {
      expect(v.graph.nodes.map((n) => n.id)).toEqual(base.nodes.map((n) => n.id));
      expect(v.graph.edges.map((e) => e.id)).toEqual(base.edges.map((e) => e.id));
      for (const n of v.graph.nodes) expect(set.positions.nodes[n.id]).toBe(set.positions.nodes[n.id]);
    }
    const given = await layout(base, { engine: "dagre" });
    const withGiven = await buildViews(base, views, { positions: given });
    expect(withGiven.positions.nodes).toEqual(given.nodes);
  });

  it("shares colour domains and the width's upper end across views with the same metric", async () => {
    const positions = await layout(base, { engine: "dagre" });
    const set = resolveViews(base, views, positions);
    const [finance, logistics, compliance, automation] = set.views;
    // The width runs from 0 to the strongest path of the whole log, 194,821 cases, before the base was abstracted.
    expect(finance.style.edgeWidth?.max).toBe(194_821);
    expect(compliance.style.edgeWidth?.max).toBe(194_821);
    expect(logistics.style.edgeWidth?.max).toBe(194_821);
    expect(finance.scales.domains.edgeWidth).toEqual([0, 194_821]);
    expect(finance.scales.domains.edgeWidth).toEqual(compliance.scales.domains.edgeWidth);
    // The default style colours paths by the cases too, over their extent in the views.
    expect(finance.style.edgeColor?.metric).toBe("cases");
    expect(finance.style.edgeColor?.domain).toEqual(set.domains["edgeColor:cases"]);
    expect(logistics.style.edgeColor?.metric).toBe("medianLagHours");
    expect(logistics.scales.domains.edgeColor).toEqual(set.domains["edgeColor:medianLagHours"]);
    // The automation view doubles `events`; its node domain covers the doubled values.
    const maxEvents = Math.max(...base.nodes.map((n) => n.metrics?.events ?? 0));
    expect(automation.style.nodeColor?.domain?.[1]).toBe(maxEvents * 2);
    expect(automation.graph.nodes[1].metrics?.events).toBe((base.nodes[1].metrics?.events ?? 0) * 2);
    // The same edge gets the same width in every view that shares the width metric.
    const edge = base.edges[0];
    expect(finance.scales.edgeWidth(edge)).toBe(compliance.scales.edgeWidth(edge));
    expect(finance.scales.edgeWidth(edge)).toBe(logistics.scales.edgeWidth(edge));
    // Without sharing, domains are per view.
    const own = resolveViews(base, views, positions, { shareScales: false });
    expect(own.views[3].style.nodeColor?.domain).toBeUndefined();
  });

  it("colours paths that give only counts by their counts on the shared domain, as their width reads them", () => {
    // Two paths of 5 and 500 transitions and no cases: the default style's cases fall back to the counts for the
    // colour as for the width, once for all views, so the two ends of the neutral ramp tell them apart.
    const graph: FlowGraph = {
      nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity" as const, label: id })),
      edges: [
        { id: "few", kind: "follows", source: "a", target: "b", metrics: { count: 5 } },
        { id: "many", kind: "follows", source: "b", target: "c", metrics: { count: 500 } },
      ],
    };
    const positions = createPositions({ nodes: {}, groups: {}, edges: {} }, "given", "RIGHT");
    const set = resolveViews(graph, [{ id: "one", label: "One" }, { id: "two", label: "Two" }], positions);
    const ramp = themePalette(defaultTheme, "neutral");
    for (const view of set.views) {
      expect([view.scales.edgeColor(graph.edges[0]), view.scales.edgeColor(graph.edges[1])]).toEqual([ramp[0], ramp[ramp.length - 1]]);
      expect(view.style.edgeColor?.metric).toBe("count");
      expect(view.style.edgeWidth?.metric).toBe("count");
      expect(view.style.edgeColor?.domain).toEqual([5, 500]);
    }
    expect(set.domains).toEqual({ "edgeWidth:count": [0, 500], "edgeColor:count": [5, 500] });
  });
});
