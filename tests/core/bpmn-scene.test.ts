import { describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay } from "../../src/index";
import { createIdMap, createIdResolver, registerId, renameToActivities } from "../../src/bpmn/ids";
import { diagramScene, registryPositions } from "../../src/bpmn/scene";

// Registry elements as bpmn-js holds them: a business object of a BPMN type, a box or waypoints.
const element = (id: string, type: string, box?: [number, number, number, number], extra: Record<string, unknown> = {}) => ({
  id,
  businessObject: { id, $type: type, get: () => undefined, set() {}, $instanceOf: (t: string) => t === type || (type === "bpmn:Task" && t === "bpmn:Activity") },
  ...(box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : {}),
  ...extra,
});
const registry = [
  element("Process_1", "bpmn:Process"),
  element("Lane_1", "bpmn:Lane", [50, 60, 600, 200]),
  element("Task_A", "bpmn:Task", [100, 100, 100, 80]),
  element("Task_A_label", "bpmn:Task", [110, 190, 80, 14], { labelTarget: {} }),
  element("Task_B", "bpmn:Task", [300, 100, 100, 80]),
  element("Task_C", "bpmn:Task", [500, 100, 100, 80]),
  element("Flow_AB", "bpmn:SequenceFlow", undefined, { waypoints: [{ x: 200, y: 140 }, { x: 300, y: 140 }] }),
];

// FlowGraph ids differ from the BPMN ids; `b` is mapped to the activity `approve`.
const idMap = createIdMap();
for (const [bpmnId, flowId] of [["Task_A", "a"], ["Task_B", "b"], ["Task_C", "clear invoice"], ["Lane_1", "lane1"], ["Flow_AB", "ab"]]) registerId(idMap, bpmnId, flowId);
const resolver = createIdResolver({ ids: idMap, mapping: { approve: "b" } });
const renaming = renameToActivities(["a", "b", "clear invoice"], resolver);
const ids = { resolver, renaming };

// The table's graph: the imported graph with the mapped task under its activity id.
const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A" },
    { id: "approve", kind: "activity", label: "Approve" },
    { id: "clear invoice", kind: "activity", label: "Clear invoice" },
  ],
  edges: [{ id: "ab", kind: "flow", source: "a", target: "approve" }],
  groups: [{ id: "lane1", kind: "lane", label: "Lane" }],
};

describe("the scene of a BPMN diagram", () => {
  it("places the rendered elements under the ids of the diagram's graph", () => {
    const { positions, elements } = registryPositions(registry, ids);
    expect(positions.nodes).toEqual({
      a: { x: 100, y: 100, width: 100, height: 80 },
      approve: { x: 300, y: 100, width: 100, height: 80 },
      "clear invoice": { x: 500, y: 100, width: 100, height: 80 },
    });
    expect(positions.groups).toEqual({ lane1: { x: 50, y: 60, width: 600, height: 200 } });
    expect(positions.edges.ab.points).toEqual([{ x: 200, y: 140 }, { x: 300, y: 140 }]);
    expect(positions.bounds).toEqual({ x: 50, y: 60, width: 600, height: 200 });
    expect([...elements].map(([key, el]) => [key, el.id])).toEqual([["lane1", "Lane_1"], ["a", "Task_A"], ["approve", "Task_B"], ["clear invoice", "Task_C"]]);
  });

  it("lists the overlays the view projects, resolved, kept and ordered by the scene", () => {
    const o = {
      badgeByBpmnId: { kind: "badge", target: "Task_A", payload: { constraintId: "k1", value: 0.5 } },
      badgeByActivity: { kind: "badge", target: "approve", payload: { constraintId: "k2" } },
      arc: { kind: "arc", target: "a", payload: { constraintId: "k3", source: "Task_A", target: "clear invoice" } },
      plainLoop: { kind: "selfLoop", target: "b", payload: {} },
      observedLoop: { kind: "selfLoop", target: "Task_C", payload: { observed: true, displayLabel: "↻ 3 transitions" } },
      laneChip: { kind: "chip", target: "Lane_1", payload: { text: "in lane" } },
      unknown: { kind: "badge", target: "ghost", payload: {} },
      mapChip: { kind: "chip", target: "__map", payload: { text: "map" } },
      arcToUnknown: { kind: "arc", target: "a", payload: { source: "a", target: "ghost" } },
    } satisfies Record<string, Overlay>;
    const { positions } = registryPositions(registry, ids);
    const { scene, listed } = diagramScene(graph, positions, Object.values(o), ids, { lod: { badges: 0.5 } });

    // Kind order arc, selfLoop, badge, chip; then by the resolved target. Unknown targets and endpoints are dropped.
    expect(listed).toEqual([o.arc, o.plainLoop, o.observedLoop, o.badgeByBpmnId, o.badgeByActivity, o.mapChip, o.laneChip]);
    expect(listed[0]).toBe(o.arc);
    expect(scene.overlays.map((x) => [x.kind, x.target])).toEqual([
      ["arc", "a"], ["selfLoop", "approve"], ["selfLoop", "clear invoice"], ["badge", "a"], ["badge", "approve"], ["chip", "__map"], ["chip", "lane1"],
    ]);
    expect(scene.overlays[0].payload).toEqual({ constraintId: "k3", source: "a", target: "clear invoice" });
    expect(scene.geometry.shapes.map((s) => s.id)).toEqual([
      "arc:a:0", "selfLoop:approve:1", "selfLoop:clear invoice:2", "badge:a:3", "badge:approve:4", "chip:__map:5", "chip:lane1:6",
    ]);

    // Three nodes leave the rules at their defaults, with the given badge zoom.
    expect(scene.lod).toEqual({ labels: 0.2, edgeLabels: 0.6, badges: 0.5, arcs: 0.22, chips: 0.22, hatch: 0.15, selfLoops: 0.25 });
    const shape = (id: string) => scene.geometry.shapes.find((s) => s.id === id)!;
    // Arc from the top centre of A (150, 100) to C (550, 100), lifted by 0.22 × 400.
    expect(shape("arc:a:0").path).toBe("M150 100 C150 12 550 12 550 100");
    // Self-loop at the top right corner of B (300, 100, 100 × 80).
    expect(shape("selfLoop:approve:1").path).toBe("M382 100 C382 72 428 112 400 112");
    // The first badge slot on A spans 22 px ending 2 px inside its right edge (200 - 26 + 2), half above it.
    expect(shape("badge:a:3")).toMatchObject({ x: 176, y: 89, width: 22, height: 22, minZoom: 0.5 });
  });

  it("sizes the level of detail by the nodes of the diagram's graph", () => {
    const many: FlowGraph = { nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, kind: "activity" as const, label: `N${i}` })), edges: [] };
    const { positions } = registryPositions(registry, ids);
    // Above 60 nodes every rule is raised by 15 %.
    expect(diagramScene(many, positions, [], ids).scene.lod.badges).toBeCloseTo(0.22 * 1.15);
    expect(diagramScene(undefined, positions, [], ids).scene.lod.badges).toBe(0.22);
  });
});
