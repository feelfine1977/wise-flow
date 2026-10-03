/**
 * The viewer seam: what `<BpmnView/>` needs from a BPMN diagram viewer, and
 * how the elements it reports become FlowGraph ids. bpmn-js satisfies it
 * through `connectBpmnJs`; tests use an in-memory viewer with the same
 * interface.
 */
import type { Box } from "../core/index.js";
import type { IdResolver } from "./ids.js";
import { type ModdleElement, isType } from "./moddle.js";
import type { RegistryElement } from "./scene.js";

/** Selected BPMN elements in FlowGraph ids (tasks, sequence flows, lanes or pools). */
export interface BpmnSelection {
  tasks: string[];
  flows: string[];
  lanes: string[];
}

/** A DOM overlay attached to a diagram element, offset from its top-left corner. */
export interface ViewerOverlay {
  html: HTMLElement;
  position: { top: number; left: number };
  show?: { minZoom: number };
  scale: true | { min: number; max: number };
}

/** What the viewer reports: the new selection, the hovered element, and plain signals. */
export interface ViewerEvents {
  selection: RegistryElement[];
  hover: RegistryElement | undefined;
  out: undefined;
  /** Elements of the diagram changed (the registry's boxes may have moved). */
  changed: undefined;
  /** The modeler executed or undid a command. */
  command: undefined;
  /** The viewport moved or zoomed. */
  viewbox: undefined;
}

export interface BpmnViewer {
  /** The underlying viewer object (the bpmn-js viewer or modeler). */
  readonly instance: unknown;
  /** Show the XML; the diagram's selection is cleared. */
  importXML(xml: string): Promise<void>;
  saveXML(): Promise<string | undefined>;
  saveSVG(): Promise<string | undefined>;
  /** The element registry: every rendered element with its box or waypoints. */
  elements(): RegistryElement[];
  selected(): RegistryElement[];
  select(elements: RegistryElement[]): void;
  /** Overlays added here are removed together by `clearOverlays`. */
  addOverlay(element: string, overlay: ViewerOverlay): void;
  clearOverlays(): void;
  /** An SVG layer above the diagram, in diagram coordinates. */
  layer(): SVGGElement;
  addMarker(element: string, marker: string): void;
  removeMarker(element: string, marker: string): void;
  /** Set the zoom when a value is given; returns the current zoom. */
  zoom(scale?: number | "fit-viewport"): number;
  viewbox(box: Box): void;
  /** The container changed its size. */
  resized(): void;
  /** Subscribe to an event; returns the unsubscription. */
  on<K extends keyof ViewerEvents>(event: K, listener: (value: ViewerEvents[K]) => void): () => void;
  destroy(): void;
}

export interface ViewerOptions {
  container: HTMLElement;
  mode: "view" | "model";
  /** Extra options of the viewer implementation. */
  options?: Record<string, unknown>;
}

/** Create a viewer in a container; loads the implementation on demand. */
export type ConnectViewer = (options: ViewerOptions) => Promise<BpmnViewer>;

export function isTask(bo: ModdleElement | undefined): boolean {
  return isType(bo, "bpmn:Activity");
}

function isLane(bo: ModdleElement | undefined): boolean {
  return isType(bo, "bpmn:Lane") || isType(bo, "bpmn:Participant");
}

function roleOf(bo: ModdleElement | undefined): keyof BpmnSelection | undefined {
  return isTask(bo) ? "tasks" : isType(bo, "bpmn:SequenceFlow") ? "flows" : isLane(bo) ? "lanes" : undefined;
}

/** The selection of tasks, sequence flows and lanes among the elements, in FlowGraph ids; other elements are left out. */
export function selectionOf(elements: readonly RegistryElement[], resolver: IdResolver): BpmnSelection {
  const s: BpmnSelection = { tasks: [], flows: [], lanes: [] };
  for (const e of elements) {
    const role = roleOf(e.businessObject);
    if (role) s[role].push(resolver.flowId(e.businessObject!));
  }
  return s;
}

/** The FlowGraph id that hovering the element reports: tasks, sequence flows and lanes only. */
export function hoverOf(element: RegistryElement | undefined, resolver: IdResolver): string | undefined {
  const bo = element?.businessObject;
  return roleOf(bo) ? resolver.flowId(bo!) : undefined;
}

/** The rendered elements (not their labels) that ids name: FlowGraph ids, BPMN ids or mapped activity ids. */
export function elementsNamed<E extends RegistryElement>(elements: readonly E[], resolver: IdResolver, ids: readonly string[]): E[] {
  return elements.filter((e) => !e.labelTarget && e.businessObject && ids.some((id) => resolver.matches(e.businessObject!, id)));
}
