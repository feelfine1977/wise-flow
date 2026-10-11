import { describe, expect, it } from "vitest";
import {
  type ActivityLabelOptions, type FlowGraph, type FlowNode,
  activityCounts, activityDescription, activityKeyLines, activityLabel,
  activityLabelLines, activityNodeCounts, activityNodeSize, activityReferences,
  defaultNodeSize, layout, toSVG, wrapActivityText, withObservedSelfLoops,
} from "../../src/index";
import { prepareScene } from "../../src/canvas/index";

const graph: FlowGraph = {
  nodes: [
    { id: "price", kind: "activity", label: "Change Price", metrics: { cases: 41, events: 57 } },
    { id: "quantity", kind: "activity", label: "Change Quantity", metrics: { cases: 1107, events: 2198 } },
    { id: "start", kind: "event", label: "start" },
  ],
  edges: [
    { id: "entry", kind: "follows", source: "start", target: "price", metrics: { count: 41 } },
    { id: "pq", kind: "follows", source: "price", target: "quantity", metrics: { count: 25 } },
    { id: "repeat", kind: "follows", source: "quantity", target: "quantity", metrics: { count: 13 } },
    { id: "rule", kind: "constraint", source: "quantity", target: "price" },
  ],
};
const names: ActivityLabelOptions = { mode: "names", references: activityReferences(graph), caseLabel: "items" };
const ids: ActivityLabelOptions = { ...names, mode: "ids" };

describe("activity presentation", () => {
  it("allocates deterministic inventory references, retains absent activities and never renumbers", () => {
    expect(activityReferences({ ...graph, nodes: [...graph.nodes].reverse() })).toEqual({ price: "A01", quantity: "A02" });
    const previous = Object.freeze(activityReferences(graph));
    const filtered: FlowGraph = { nodes: [graph.nodes[1]], edges: [] };
    expect(activityReferences(filtered, previous)).toEqual(previous);
    const extended = activityReferences({ nodes: [{ id: "earlier", label: "Earlier", kind: "activity" }, ...filtered.nodes], edges: [] }, previous);
    expect(extended).toEqual({ price: "A01", quantity: "A02", earlier: "A03" });
    expect(activityReferences(graph, { removed: "A99" })).toMatchObject({ removed: "A99", price: "A100", quantity: "A101" });
    expect(activityReferences({ nodes: [{ id: "__proto__", kind: "activity", label: "Safe" }], edges: [] })).toHaveProperty("__proto__", "A01");
  });

  it("keeps node subtitles to distinct items and reports both exact measures in descriptions", () => {
    expect(activityLabel(graph.nodes[0], names)).toBe("Change Price");
    expect(activityLabel(graph.nodes[1], ids)).toBe("A02");
    expect(activityNodeCounts(graph.nodes[1], names)).toBe("1,107 items");
    expect(activityCounts(graph.nodes[1], names, "en", true)).toBe("1,107 items · 2,198 events");
    expect(activityDescription(graph.nodes[1], { ...ids, showCounts: false })).toContain("Change Quantity. 1,107 items · 2,198 events");
    const missing: FlowNode = { id: "none", label: "Missing", kind: "activity" };
    expect(activityNodeCounts(missing, names)).toBe("– items");
    expect(activityDescription(missing, names)).toContain("items unavailable · events unavailable");
    expect(activityCounts({ ...missing, metrics: { cases: 0, events: 0 } }, { ...names, caseLabel: "" })).toBe("0 cases · 0 events");
  });

  it("reserves wrapped names and a count row regardless of checkbox or missing reference inventory", () => {
    for (const options of [names, ids]) {
      expect(activityNodeSize(graph.nodes[1], options)).toEqual(activityNodeSize(graph.nodes[1], { ...options, showCounts: false }));
    }
    expect(activityNodeSize(graph.nodes[1], { ...ids, references: {} })).toEqual(activityNodeSize(graph.nodes[1], ids));
    expect(activityNodeSize(graph.nodes[1], ids).width).toBe(140);
    const long: FlowNode = { ...graph.nodes[0], label: "Receive Order Confirmation with a long descriptive activity name" };
    const box = activityNodeSize(long, names);
    const lines = activityLabelLines(long, names, box.width);
    expect(lines.name.length).toBeGreaterThan(1);
    expect(lines.name.join(" ")).toBe(long.label);
    expect(box.height).toBeGreaterThanOrEqual(20 + lines.name.length * 18 + lines.counts.length * 16);
    expect(activityNodeSize(graph.nodes[2], names)).toEqual(defaultNodeSize(graph.nodes[2]));
    expect(wrapActivityText("漢字漢字漢字", 28).join("")).toBe("漢字漢字漢字");
    expect(wrapActivityText("", 0)).toEqual([""]);
  });

  it("preserves canonical identities, all edges and loop evidence in Canvas and SVG", async () => {
    const before = JSON.stringify(graph);
    const positions = await layout(graph, { engine: "dagre", nodeSize: (node) => activityNodeSize(node, names) });
    const aliased = { ...names, names: { price: "Price adjustment" } };
    const prepared = prepareScene(graph, positions, { activityLabels: aliased });
    expect(prepared.graph).toBe(graph);
    expect(prepared.nodeById.get("price")?.node).toBe(graph.nodes[0]);
    expect(prepared.nodeById.get("price")?.label).toBe("Price adjustment");
    expect(prepared.nodeById.get("quantity")?.label).toBe("Change Quantity");
    expect(prepared.edges.map((e) => e.edge.id)).toEqual(["entry", "pq", "rule"]);
    expect(prepared.shapes.some((shape) => shape.kind === "selfLoop" && shape.overlay.target === "quantity")).toBe(true);
    const svg = toSVG({ graph, positions, activityLabels: aliased }, { legend: false });
    expect(svg).toContain('data-id="pq"');
    expect(svg).toContain('data-id="rule"');
    expect(svg).toContain("Price adjustment");
    expect(svg).toContain("Change Price");
    expect(svg).toContain("41 items");
    expect(JSON.stringify(graph)).toBe(before);
  });

  it("always exports a visible, full canonical key with exact units even without a legend or node counts", async () => {
    const positions = await layout(graph, { engine: "dagre", nodeSize: (node) => activityNodeSize(node, ids) });
    const options = { ...ids, showCounts: false, references: {} };
    const svg = toSVG({ graph, positions, activityLabels: options }, { legend: false, lodZoom: 0.01 });
    expect(svg).toContain('>A01</text>');
    expect(svg).toContain('>A02</text>');
    const key = svg.slice(svg.indexOf('class="wf-activity-key"'));
    expect(key).toContain("A01 — Change Price. 41 items · 57 events.");
    expect(key).toContain("Change Quantity");
    expect(key).toContain("1,107 items");
    expect(key).toContain("2,198 events");
    expect(svg).not.toContain('class="wf-legend"');
    expect(activityKeyLines(graph, undefined, 200)).toEqual([]);
    expect(activityKeyLines({ nodes: [], edges: [] }, ids, 200)).toEqual([]);
    const escaped = toSVG({ graph: { nodes: [{ ...graph.nodes[0], label: '<Price & "quantity">' }], edges: [] }, positions, activityLabels: ids });
    expect(escaped).toContain("&lt;Price &amp; &quot;quantity&quot;&gt;");
  });
});


describe("observed loops in label-mode exports", () => {
  it("retains raw self-edges without explicit overlays, separately from constraint loops", async () => {
    const constraint = { kind: "selfLoop" as const, target: "quantity", payload: { constraintId: "singularity", value: 0.25, label: "Constraint repetition" } };
    const positions = await layout(graph, { engine: "dagre", nodeSize: (node) => activityNodeSize(node, ids) });
    const svg = toSVG({ graph, positions, activityLabels: ids, overlays: [constraint] }, { legend: false, lodZoom: 0.01 });
    expect(svg).toContain('data-edge-id="repeat"');
    expect(svg).toContain("13 transitions");
    expect(svg).toContain("repeat items unavailable");
    const observed = withObservedSelfLoops(graph, [constraint], "en", "items");
    expect(observed).toHaveLength(2);
    expect(observed[0]).toBe(constraint);
    expect(observed[1].payload?.value).toBeUndefined();
    expect(withObservedSelfLoops(graph, observed, "en", "items")).toHaveLength(2);
    expect(prepareScene(graph, positions, { activityLabels: ids }).shapes.filter((shape) => shape.kind === "selfLoop")).toHaveLength(1);
  });
});
