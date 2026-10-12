/**
 * Pointer input of both map renderers as the controller's events. React Flow
 * names nodes, groups (as compound nodes) and edges; the Canvas map hits
 * scene items and overlay shapes. Both end up as the same `click`,
 * `clickOverlay`, `openMenu`, `dismissMenu` and `hover` events.
 */
import type { EdgeMouseHandler, NodeMouseHandler } from "@xyflow/react";
import type { ElementRef, FlowGraph, HitItem, Overlay, OverlayShape, XY } from "../core/index.js";
import type { MapEvent } from "../core/map-controller.js";
import type { WfEdge, WfGroupNode, WfNode } from "./types.js";

export const GROUP_PREFIX = "group:";

/** What the pointer is on: an element, an overlay (with the element it is drawn for), or nothing. */
type PointerTarget = { element?: ElementRef; overlay?: Overlay } | null;

interface Modifiers {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/** A click: on an overlay it selects what the overlay is about, elsewhere it is a click on the element or beside them. */
function pointerClick(target: PointerTarget, mod: Modifiers): MapEvent {
  if (target?.overlay) return { type: "clickOverlay", overlay: target.overlay };
  return { type: "click", element: target?.element ?? null, multi: mod.shiftKey || mod.metaKey || mod.ctrlKey };
}

/** A right click opens the menu of the element (an overlay's: the element it is drawn for) or closes an open one. */
function pointerMenu(target: PointerTarget, at: XY): MapEvent {
  return target?.element ? { type: "openMenu", element: target.element, at } : { type: "dismissMenu" };
}

/** The element of a React Flow node id. */
function flowElement(id: string): ElementRef {
  return id.startsWith(GROUP_PREFIX) ? { kind: "group", id: id.slice(GROUP_PREFIX.length) } : { kind: "node", id };
}

/** The element a node or group id names on the graph. */
function elementOf(graph: FlowGraph, id: string): ElementRef | undefined {
  if (graph.nodes.some((n) => n.id === id)) return { kind: "node", id };
  return (graph.groups ?? []).some((g) => g.id === id) ? { kind: "group", id } : undefined;
}

/** What a Canvas hit is on; an overlay's shape is looked up in the scene. */
function canvasTarget(hit: HitItem | undefined, shapes: ReadonlyMap<string, OverlayShape> | undefined, graph: FlowGraph): PointerTarget {
  if (!hit) return null;
  if (hit.kind !== "overlay") return { element: { kind: hit.kind, id: hit.id } };
  const shape = shapes?.get(hit.shapeId ?? "");
  const element = elementOf(graph, shape?.overlay.target ?? hit.id);
  return shape ? { overlay: shape.overlay, element } : element ? { element } : null;
}

/** The hovered id of a Canvas hit: an overlay's shape, or the element. */
const canvasHoverId = (hit: HitItem | null): string | null => (hit ? (hit.kind === "overlay" ? (hit.shapeId ?? hit.id) : hit.id) : null);

type Send = (event: MapEvent) => unknown;

/** React Flow's pointer callbacks; `point` turns a mouse position into one relative to the map body. */
export function flowPointer(send: Send, point: (event: { clientX: number; clientY: number }) => XY) {
  const onNodeClick: NodeMouseHandler<WfNode | WfGroupNode> = (event, node) => void send(pointerClick({ element: flowElement(node.id) }, event));
  const onEdgeClick: EdgeMouseHandler<WfEdge> = (event, edge) => void send(pointerClick({ element: { kind: "edge", id: edge.id } }, event));
  const onNodeContextMenu: NodeMouseHandler<WfNode | WfGroupNode> = (event, node) => {
    event.preventDefault();
    send(pointerMenu({ element: flowElement(node.id) }, point(event)));
  };
  const onEdgeContextMenu: EdgeMouseHandler<WfEdge> = (event, edge) => {
    event.preventDefault();
    send(pointerMenu({ element: { kind: "edge", id: edge.id } }, point(event)));
  };
  return {
    onNodeClick,
    onEdgeClick,
    onPaneClick: (event: React.MouseEvent) => void send(pointerClick(null, event)),
    onNodeContextMenu,
    onEdgeContextMenu,
    onPaneContextMenu: (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      send(pointerMenu(null, point(event)));
    },
    onNodeMouseEnter: ((_, node) => void send({ type: "hover", id: flowElement(node.id).id })) as NodeMouseHandler<WfNode | WfGroupNode>,
    onNodeMouseLeave: () => void send({ type: "hover", id: null }),
    onEdgeMouseEnter: ((_, edge) => void send({ type: "hover", id: edge.id })) as EdgeMouseHandler<WfEdge>,
    onEdgeMouseLeave: () => void send({ type: "hover", id: null }),
  };
}

/** The overlay layer's callbacks over React Flow. */
export function overlayPointer(send: Send) {
  return {
    onHover: (id: string | null) => void send({ type: "hover", id }),
    onSelect: (shape: OverlayShape) => void send(pointerClick({ overlay: shape.overlay }, { shiftKey: false, metaKey: false, ctrlKey: false })),
  };
}

/** The Canvas map's pointer callbacks. */
export function canvasPointer(send: Send, shapes: ReadonlyMap<string, OverlayShape> | undefined, graph: FlowGraph) {
  return {
    onHover: (hit: HitItem | null) => void send({ type: "hover", id: canvasHoverId(hit) }),
    onClick: (hit: HitItem | undefined, mod: Modifiers) => void send(pointerClick(canvasTarget(hit, shapes, graph), mod)),
    onContextMenu: (hit: HitItem | undefined, at: XY) => void send(pointerMenu(canvasTarget(hit, shapes, graph), at)),
  };
}
