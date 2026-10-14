import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowEdge, type FlowGraph, type FlowNode, type Locale, type Overlay, type Positions, abstract, activityReferences, buildScene, createPositions, overlaysFor } from "../../src/index";
import { describeEdge, describeGroup, describeNode } from "../../src/react/index";
import { useCanvasElements, useElementDescriptions, useFlowElements } from "../../src/react/map-elements";
import { GROUP_PREFIX } from "../../src/react/map-pointer";

// Count the indexes the map's descriptions build; the core's own modules import it from `model.js`.
vi.mock("../../src/core/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/index.js")>();
  return { ...original, indexGraph: vi.fn(original.indexGraph) };
});
const { indexGraph } = await import("../../src/core/index.js");

afterEach(() => {
  cleanup();
  vi.mocked(indexGraph).mockClear();
});

const LOOKUPS = ["find", "findIndex", "findLast", "some", "every", "filter", "map", "forEach", "reduce", "indexOf", "includes"] as const;

/** An array whose lookup methods count their calls; iteration with `for…of` is not counted. */
function counted<T>(items: T[], calls: Map<string, number>, name: string): T[] {
  const out = [...items];
  for (const method of LOOKUPS) {
    const original = (Array.prototype as unknown as Record<string, (...args: unknown[]) => unknown>)[method];
    Object.defineProperty(out, method, {
      value: function (this: T[], ...args: unknown[]) {
        calls.set(`${name}.${method}`, (calls.get(`${name}.${method}`) ?? 0) + 1);
        return original.apply(this, args);
      },
    });
  }
  return out;
}

/** A chain of `n` activities in stages of ten, with the positions of a grid. */
function chain(n: number) {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups = Array.from({ length: Math.ceil(n / 10) }, (_, i) => ({ id: `s${i}`, kind: "stage" as const, label: `Stage ${i}` }));
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `a${i}`, kind: "activity", label: `Activity ${i}`, group: `s${Math.floor(i / 10)}`, metrics: { cases: 10 + i } });
    if (i > 0) edges.push({ id: `a${i - 1}->a${i}`, kind: "follows", source: `a${i - 1}`, target: `a${i}`, metrics: { count: i } });
  }
  const boxes = Object.fromEntries(nodes.map((node, i) => [node.id, { x: (i % 10) * 200, y: Math.floor(i / 10) * 100, width: 150, height: 60 }]));
  const positions: Positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT");
  return { graph: { nodes, edges, groups } satisfies FlowGraph, positions };
}

/** Lookups on the arrays of the shown graph while the map describes all of its elements. */
function describeAll(n: number) {
  const { graph, positions } = chain(n);
  const scene = buildScene(graph, positions);
  const calls = new Map<string, number>();
  const shown: FlowGraph = { ...graph, nodes: counted(graph.nodes, calls, "nodes"), edges: counted(graph.edges, calls, "edges") };
  const { result } = renderHook(() => {
    const descriptions = useElementDescriptions(shown, [], "en", undefined);
    const common = { scene, graph: shown, positions, selection: { nodes: [], edges: [], groups: [] }, hovered: null, focused: "a0->a1", bright: undefined, locale: "en" as const, activityLabels: undefined };
    const flow = useFlowElements({ ...common, enabled: true, descriptions, nodesDraggable: false });
    const canvas = useCanvasElements({ ...common, enabled: true, descriptions });
    return { descriptions, flow, canvas };
  });
  const { descriptions, flow, canvas } = result.current;
  const texts = [
    ...graph.nodes.map((node) => descriptions.describeElement({ kind: "node", id: node.id })),
    ...graph.edges.map((edge) => descriptions.describeElement({ kind: "edge", id: edge.id })),
    ...graph.groups.map((group) => descriptions.describeElement({ kind: "group", id: group.id })),
    ...graph.nodes.map((node) => canvas.describe({ kind: "node", id: node.id, minX: 0, minY: 0, maxX: 0, maxY: 0 })),
  ];
  return { texts, calls, flow, canvas };
}

describe("element descriptions", () => {
  it("describe every element of a shown graph through one index", () => {
    const small = describeAll(100);
    expect(indexGraph).toHaveBeenCalledTimes(1);
    vi.mocked(indexGraph).mockClear();
    const large = describeAll(200);
    expect(indexGraph).toHaveBeenCalledTimes(1);

    // 200 nodes, 199 edges and 20 stages, each described; the Canvas list holds the
    // nodes, the stages and the focused edge.
    expect(large.texts).toHaveLength(200 + 199 + 20 + 200);
    expect(large.flow.edges).toHaveLength(199);
    expect(large.canvas.descendants).toHaveLength(200 + 20 + 1);
    expect(large.texts[5]).toBe("Activity 5, activity (Stage 0). 15 cases.");
    expect(large.texts[200 + 4]).toBe("path Activity 4 → Activity 5. 5 transitions.");
    expect(large.flow.edges[4].ariaLabel).toBe("path Activity 4 → Activity 5. 5 transitions.");
    expect(large.texts[200 + 199 + 3]).toBe("Stage 3, stage. 10 activities.");

    // No lookup over the nodes or edges runs per element: twice the elements, the same calls.
    expect(large.calls.get("nodes.find") ?? 0).toBe(0);
    expect(large.calls.get("edges.find") ?? 0).toBe(0);
    expect(Object.fromEntries(large.calls)).toEqual(Object.fromEntries(small.calls));
  });

  it("build the index again only for another shown graph", () => {
    const { graph } = chain(30);
    const { result, rerender } = renderHook(({ shown, locale }: { shown: FlowGraph; locale: Locale }) => useElementDescriptions(shown, [], locale, undefined), {
      initialProps: { shown: graph, locale: "en" },
    });
    expect(result.current.describeElement({ kind: "edge", id: "a0->a1" })).toBe("path Activity 0 → Activity 1. 1 transitions.");
    rerender({ shown: graph, locale: "de" });
    expect(result.current.describeElement({ kind: "edge", id: "a0->a1" })).toBe("Pfad Activity 0 → Activity 1. 1 Übergänge.");
    expect(indexGraph).toHaveBeenCalledTimes(1);
    const renamed = { ...graph, nodes: graph.nodes.map((node) => (node.id === "a0" ? { ...node, label: "Start" } : node)) };
    rerender({ shown: renamed, locale: "de" });
    expect(result.current.describeElement({ kind: "edge", id: "a0->a1" })).toBe("Pfad Start → Activity 1. 1 Übergänge.");
    expect(indexGraph).toHaveBeenCalledTimes(2);
  });

  it("count the activities inside a group at any depth", () => {
    // A pool of two lanes with 5 and 7 activities, none of them directly in the pool; a stage of
    // 2 activities and a nested stage of 3; an activity outside every group.
    const activities = (n: number, group: string) => Array.from({ length: n }, (_, i): FlowNode => ({ id: `${group}-${i}`, kind: "activity", label: `${group} ${i}`, group }));
    const graph: FlowGraph = {
      nodes: [...activities(5, "sales"), ...activities(7, "billing"), ...activities(2, "outer"), ...activities(3, "inner"), { id: "free", kind: "activity", label: "Free" }],
      edges: [],
      groups: [
        { id: "pool", kind: "pool", label: "Pool" },
        { id: "sales", kind: "lane", label: "Sales", parent: "pool" },
        { id: "billing", kind: "lane", label: "Billing", parent: "pool" },
        { id: "outer", kind: "stage", label: "Outer" },
        { id: "inner", kind: "stage", label: "Inner", parent: "outer" },
      ],
    };
    const positions = createPositions({ nodes: Object.fromEntries(graph.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 150, height: 60 }])), groups: {}, edges: {} }, "dagre", "RIGHT");
    const scene = buildScene(graph, positions);
    const groupBoxes = { ...positions, groups: Object.fromEntries(graph.groups!.map((g, i) => [g.id, { x: 0, y: i * 100, width: 4000, height: 90 }])) };
    for (const [locale, texts] of [
      ["en", ["Pool, pool. 12 activities.", "Sales, lane. 5 activities.", "Billing, lane. 7 activities.", "Outer, stage. 5 activities.", "Inner, stage. 3 activities."]],
      ["de", ["Pool, Pool. 12 Aktivitäten.", "Sales, Bahn. 5 Aktivitäten.", "Billing, Bahn. 7 Aktivitäten.", "Outer, Phase. 5 Aktivitäten.", "Inner, Phase. 3 Aktivitäten."]],
    ] as const) {
      const { result } = renderHook(() => {
        const descriptions = useElementDescriptions(graph, [], locale, undefined);
        const common = { scene, graph, positions: groupBoxes, selection: { nodes: [], edges: [], groups: [] }, hovered: null, focused: null, bright: undefined, locale, activityLabels: undefined };
        return { descriptions, flow: useFlowElements({ ...common, enabled: true, descriptions, nodesDraggable: false }) };
      });
      const { descriptions, flow } = result.current;
      expect(graph.groups!.map((g) => descriptions.describeElement({ kind: "group", id: g.id }))).toEqual(texts);
      // The React Flow map names its group nodes alike.
      expect(graph.groups!.map((g) => flow.nodes.find((n) => n.id === GROUP_PREFIX + g.id)?.ariaLabel)).toEqual(texts);
    }
  });

  it("name an element it does not know by its id", () => {
    const { result } = renderHook(() => useElementDescriptions(chain(3).graph, [], "en", undefined));
    for (const kind of ["node", "edge", "group"] as const) expect(result.current.describeElement({ kind, id: "missing" })).toBe("missing");
  });
});

describe("element descriptions of the fixtures", () => {
  const vendorOverlays = overlaysFor(constraintItems(vendorSceneKey), { graph: vendorScene });

  it("read the vendor scene's texts in English and German", () => {
    const en = renderHook(() => useElementDescriptions(vendorScene, vendorOverlays, "en", undefined)).result.current.describeElement;
    const de = renderHook(() => useElementDescriptions(vendorScene, vendorOverlays, "de", undefined)).result.current.describeElement;
    // Count 1 and cases 1 name the transitions once; a lag of 1.2833 h reads 1.3 h; violation share 1.0.
    const edge = { kind: "edge", id: "change_quantity->record_goods_receipt" } as const;
    expect(en(edge)).toBe("path Change Quantity → Record Goods Receipt. 1 transitions. median lag 1.3 h. 100 % expectation shortfall.");
    expect(de(edge)).toBe("Pfad Change Quantity → Record Goods Receipt. 1 Übergänge. Median-Wartezeit 1,3 h. 100 % Erwartungslücke.");
    // One case of the vendor's 327 items is a share of 0.0031; events equal cases and are not repeated.
    const node = { kind: "node", id: "change_quantity" } as const;
    expect(en(node)).toBe("Change Quantity, activity (Purchase order). 1 cases (0.3 %). 100 % expectation shortfall. median time to next event 1.3 h.");
    expect(de(node)).toBe("Change Quantity, Aktivität (Purchase order). 1 Fälle (0,3 %). 100 % Erwartungslücke. Median bis zum nächsten Ereignis 1,3 h.");
  });

  // The same texts as the public describers give for each element on its own, without an index.
  const cases: [string, FlowGraph, Overlay[]][] = [
    ["global scene", globalScene, overlaysFor(constraintItems("global"), { graph: globalScene })],
    ["vendor scene", vendorScene, vendorOverlays],
    ["collapsed global scene", abstract(globalScene, { collapse: "all" }), []],
  ];
  for (const [name, graph, overlays] of cases) {
    for (const locale of ["en", "de"] as const) {
      for (const labels of [undefined, { mode: "ids" as const, references: activityReferences(graph) }]) {
        it(`match the describers for the ${name} in ${locale}${labels ? " with activity ids" : ""}`, () => {
          const { describeElement } = renderHook(() => useElementDescriptions(graph, overlays, locale, labels)).result.current;
          const on = (id: string) => overlays.filter((o) => o.target === id);
          const label = (id: string | undefined) => graph.groups?.find((g) => g.id === id)?.label;
          for (const n of graph.nodes) {
            expect(describeElement({ kind: "node", id: n.id })).toBe(describeNode(n, on(n.id), locale, label(n.group), n.kind === "activity" ? labels : undefined));
          }
          for (const e of graph.edges) expect(describeElement({ kind: "edge", id: e.id })).toBe(describeEdge(e, graph, locale));
          // A node is inside a group when the group is its own or above it, through the parents.
          const above = (n: FlowNode) => {
            const out: string[] = [];
            for (let id = n.group; id !== undefined && !out.includes(id); id = graph.groups?.find((g) => g.id === id)?.parent) out.push(id);
            return out;
          };
          for (const g of graph.groups ?? []) {
            const members = graph.nodes.filter((n) => above(n).includes(g.id)).length;
            expect(describeElement({ kind: "group", id: g.id })).toBe(describeGroup(g, members, on(g.id), locale));
          }
        });
      }
    }
  }
});
