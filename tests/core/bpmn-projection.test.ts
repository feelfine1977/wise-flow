import { describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay } from "../../src/index";
import { createIdMap, createIdResolver, registerId, renameToActivities } from "../../src/bpmn/ids";
import { projectMarks } from "../../src/bpmn/projection";
import { diagramScene, registryPositions } from "../../src/bpmn/scene";

// Registry elements as bpmn-js holds them: a business object of a BPMN type, a box or waypoints.
const element = (id: string, type: string, box?: [number, number, number, number], extra: Record<string, unknown> = {}) => ({
  id,
  businessObject: { id, $type: type, get: () => undefined, set() {}, $instanceOf: (t: string) => t === type || (type === "bpmn:Task" && t === "bpmn:Activity") },
  ...(box ? { x: box[0], y: box[1], width: box[2], height: box[3] } : {}),
  ...extra,
});
const registry = [
  element("Lane_1", "bpmn:Lane", [50, 60, 600, 200]),
  element("Task_A", "bpmn:Task", [100, 100, 100, 80]),
  element("Task_B", "bpmn:Task", [300, 100, 100, 80]),
  element("Flow_AB", "bpmn:SequenceFlow", undefined, { waypoints: [{ x: 200, y: 140 }, { x: 300, y: 140 }] }),
];

// FlowGraph ids differ from the BPMN ids; `b` is mapped to the activity `approve`.
const idMap = createIdMap();
for (const [bpmnId, flowId] of [["Task_A", "a"], ["Task_B", "b"], ["Lane_1", "lane1"], ["Flow_AB", "ab"]]) registerId(idMap, bpmnId, flowId);
const resolver = createIdResolver({ ids: idMap, mapping: { approve: "b" } });
const ids = { resolver, renaming: renameToActivities(["a", "b"], resolver) };
const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A" },
    { id: "approve", kind: "activity", label: "Approve" },
  ],
  edges: [{ id: "ab", kind: "flow", source: "a", target: "approve" }],
  groups: [{ id: "lane1", kind: "lane", label: "Lane" }],
};
// Zoom thresholds of their own per kind, so that each placement shows where its zoom comes from.
const lod = { badges: 0.3, hatch: 0.2, chips: 0.4, selfLoops: 0.5, arcs: 0.6 };

function project(overlays: Overlay[]) {
  const { positions, elements } = registryPositions(registry, ids);
  const { scene } = diagramScene(graph, positions, overlays, ids, { lod });
  return { scene, elements, ...projectMarks(scene.marks, elements) };
}

describe("the overlay projection onto a BPMN diagram", () => {
  const overlays: Record<string, Overlay> = {
    badge: { kind: "badge", target: "Task_A", payload: { value: 0.5 } },
    tint: { kind: "tint", target: "a", payload: { value: 0.5 } },
    hatch: { kind: "hatch", target: "approve", payload: {} },
    chip: { kind: "chip", target: "Lane_1", payload: { text: "in lane" } },
    arc: { kind: "arc", target: "lag1", payload: { source: "Task_A", target: "approve", value: 1 } },
    selfLoop: { kind: "selfLoop", target: "b", payload: {} },
    observedLoop: { kind: "selfLoop", target: "Task_A", payload: { observed: true, displayLabel: "↻ 3 transitions" } },
    mapChip: { kind: "chip", target: "__map", payload: { text: "map" } },
  };
  const { boxes, paths } = project(Object.values(overlays));
  const box = (kind: string) => {
    const found = boxes.filter((b) => b.mark.kind === kind);
    expect(found).toHaveLength(1);
    const { element, position, show, scale, className, marker } = found[0];
    return { element, position, show, scale, className, marker };
  };

  it("attaches a badge to its task at its slot, wholly above the top edge, from the badge zoom, legible at every zoom", () => {
    // "● · 50 %" in a pill 60.4 wide (8 characters of 6.05 and 6 on either side) ending 22 left of the task's right edge, clear of the observed self-loop the task carries:
    // 100 + 100 − 22 − 60.4 = 117.6, 100 − 18 − 2 = 80, offset from the task at (100, 100).
    expect(box("badge")).toEqual({ element: "Task_A", position: { top: -20, left: expect.closeTo(17.6, 5) }, show: { minZoom: 0.3 }, scale: { min: 0.8, max: 1.2 }, className: "wf-badge", marker: "wf-bpmn--badge" });
  });

  it("covers the task with a tint below its shape at every zoom, scaled with the diagram", () => {
    expect(box("tint")).toEqual({ element: "Task_A", position: { top: 0, left: 0 }, show: undefined, scale: true, className: "wf-tint wf-mark--below", marker: "wf-bpmn--tint" });
  });

  it("covers a task named by its activity id with hatching from the hatch zoom", () => {
    expect(box("hatch")).toEqual({ element: "Task_B", position: { top: 0, left: 0 }, show: { minZoom: 0.2 }, scale: true, className: "wf-hatch", marker: "wf-bpmn--hatch" });
  });

  it("puts a chip inside its lane at the top right, from the chip zoom", () => {
    // 60 px wide (the minimum; 16 + 7 × 6.2 is less), 8 px from the lane's right edge and 6 px below its top: (582, 66) − (50, 60).
    expect(box("chip")).toEqual({ element: "Lane_1", position: { top: 6, left: 532 }, show: { minZoom: 0.4 }, scale: { min: 0.8, max: 1.2 }, className: "wf-chip", marker: "wf-bpmn--chip" });
  });

  it("draws arcs and self-loops in the layer from their zoom, selecting the elements they connect", () => {
    expect(paths.map((p) => [p.mark.kind, p.minZoom, p.selects])).toEqual([
      ["arc", 0.6, ["Task_A", "Task_B"]],
      // Canonical order by target: `a` before `approve`; an observed repeat shows at every zoom.
      ["selfLoop", 0, ["Task_A"]],
      ["selfLoop", 0.5, ["Task_B"]],
    ]);
  });

  it("leaves map-level chips to the legend", () => {
    expect(boxes.map((b) => b.mark.overlay.target)).not.toContain("__map");
    expect(boxes).toHaveLength(4);
  });

  it("drops boxes whose element has no rendered box and keeps paths without elements to select", () => {
    const { scene } = project(Object.values(overlays));
    const none = projectMarks(scene.marks, new Map());
    expect(none.boxes).toEqual([]);
    expect(none.paths.map((p) => p.selects)).toEqual([[], [], []]);
  });
});
