import { describe, expect, it } from "vitest";
import type { FlowGraph, HitItem, OverlayShape } from "../../src/index";
import type { MapEvent } from "../../src/core/map-controller";
import { canvasPointer, flowPointer, overlayPointer } from "../../src/react/map-pointer";

const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1" },
    { id: "b", kind: "activity", label: "B" },
  ],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }],
  groups: [{ id: "s1", kind: "stage", label: "Intake" }],
};
const arc: OverlayShape = { id: "arc-1", kind: "arc", x: 0, y: 0, width: 10, height: 10, minZoom: 0, overlay: { kind: "arc", target: "a", payload: { source: "a", target: "b" } } };
const chip: OverlayShape = { id: "chip-1", kind: "chip", x: 0, y: 0, width: 10, height: 10, minZoom: 0, overlay: { kind: "chip", target: "s1" } };
const lost: OverlayShape = { id: "map-1", kind: "chip", x: 0, y: 0, width: 10, height: 10, minZoom: 0, overlay: { kind: "chip", target: "nowhere" } };
const shapes = new Map([arc, chip, lost].map((s) => [s.id, s]));

const hit = (kind: HitItem["kind"], id: string, shapeId?: string): HitItem => ({ minX: 0, minY: 0, maxX: 1, maxY: 1, kind, id, shapeId });
const mouse = (mod: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } = {}) => ({ clientX: 30, clientY: 40, shiftKey: false, metaKey: false, ctrlKey: false, preventDefault() {}, ...mod });
const plain = { shiftKey: false, metaKey: false, ctrlKey: false };
const at = { x: 30, y: 40 };

function recorder() {
  const events: MapEvent[] = [];
  return { events, send: (e: MapEvent) => void events.push(e) };
}

type Flow = ReturnType<typeof flowPointer>;
type Handler = (event: unknown, element: unknown) => void;
const call = (handler: Flow[keyof Flow], event: unknown, element?: unknown) => (handler as Handler)(event, element);

describe("pointer input of the two map renderers", () => {
  it("turns the same clicks, right clicks and hovers into the same controller events", () => {
    const flow = recorder();
    const f = flowPointer(flow.send, (e) => ({ x: e.clientX, y: e.clientY }));
    const canvas = recorder();
    const c = canvasPointer(canvas.send, shapes, graph);

    call(f.onNodeClick, mouse(), { id: "a" });
    c.onClick(hit("node", "a"), plain);
    call(f.onNodeClick, mouse({ metaKey: true }), { id: "group:s1" });
    c.onClick(hit("group", "s1"), { ...plain, metaKey: true });
    call(f.onEdgeClick, mouse({ shiftKey: true }), { id: "ab" });
    c.onClick(hit("edge", "ab"), { ...plain, shiftKey: true });
    call(f.onPaneClick, mouse());
    c.onClick(undefined, plain);
    call(f.onNodeContextMenu, mouse(), { id: "group:s1" });
    c.onContextMenu(hit("group", "s1"), at);
    call(f.onEdgeContextMenu, mouse(), { id: "ab" });
    c.onContextMenu(hit("edge", "ab"), at);
    call(f.onPaneContextMenu, mouse());
    c.onContextMenu(undefined, at);
    call(f.onNodeMouseEnter, mouse(), { id: "group:s1" });
    c.onHover(hit("group", "s1"));
    call(f.onNodeMouseLeave, mouse(), { id: "a" });
    c.onHover(null);

    expect(canvas.events).toEqual(flow.events);
    expect(flow.events).toEqual([
      { type: "click", element: { kind: "node", id: "a" }, multi: false },
      { type: "click", element: { kind: "group", id: "s1" }, multi: true },
      { type: "click", element: { kind: "edge", id: "ab" }, multi: true },
      { type: "click", element: null, multi: false },
      { type: "openMenu", element: { kind: "group", id: "s1" }, at },
      { type: "openMenu", element: { kind: "edge", id: "ab" }, at },
      { type: "dismissMenu" },
      { type: "hover", id: "s1" },
      { type: "hover", id: null },
    ]);
  });

  it("selects through an overlay on both, and opens the menu of the element a Canvas overlay is drawn for", () => {
    const flow = recorder();
    overlayPointer(flow.send).onSelect(arc);
    overlayPointer(flow.send).onHover("arc-1");
    const canvas = recorder();
    const c = canvasPointer(canvas.send, shapes, graph);
    c.onClick(hit("overlay", "a", "arc-1"), { ...plain, shiftKey: true });
    c.onHover(hit("overlay", "a", "arc-1"));
    expect(canvas.events).toEqual(flow.events);
    expect(flow.events).toEqual([{ type: "clickOverlay", overlay: arc.overlay }, { type: "hover", id: "arc-1" }]);

    const menus = recorder();
    const m = canvasPointer(menus.send, shapes, graph);
    m.onContextMenu(hit("overlay", "a", "arc-1"), at);
    m.onContextMenu(hit("overlay", "s1", "chip-1"), at);
    // An overlay of no element on the map, and a hit whose shape the scene does not know.
    m.onContextMenu(hit("overlay", "nowhere", "map-1"), at);
    m.onContextMenu(hit("overlay", "b", "gone"), at);
    m.onClick(hit("overlay", "b", "gone"), plain);
    m.onClick(hit("overlay", "nowhere", "gone"), plain);
    expect(menus.events).toEqual([
      { type: "openMenu", element: { kind: "node", id: "a" }, at },
      { type: "openMenu", element: { kind: "group", id: "s1" }, at },
      { type: "dismissMenu" },
      { type: "openMenu", element: { kind: "node", id: "b" }, at },
      { type: "click", element: { kind: "node", id: "b" }, multi: false },
      { type: "click", element: null, multi: false },
    ]);
  });
});
