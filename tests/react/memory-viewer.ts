import type { Box } from "../../src/index";
import { createModdle, type ModdleElement } from "../../src/bpmn/moddle";
import type { RegistryElement } from "../../src/bpmn/scene";
import type { BpmnViewer, ConnectViewer, ViewerEvents, ViewerOptions, ViewerOverlay } from "../../src/bpmn/viewer";

/**
 * The in-memory adapter of the viewer seam. Importing XML reads the diagram
 * interchange into a registry as bpmn-js builds it (one element per shape
 * and edge, with its business object, box or waypoints); everything the view
 * does to the viewer is recorded, and tests emit the viewer's events.
 */
export interface MemoryViewer extends BpmnViewer {
  readonly options: ViewerOptions;
  /** Overlays currently attached, in the order they were added. */
  overlays: { element: string; overlay: ViewerOverlay }[];
  /** Markers per element id. */
  markers: Map<string, Set<string>>;
  /** Every zoom the view set, and every viewbox. */
  zooms: (number | "fit-viewport")[];
  viewboxes: Box[];
  resizes: number;
  /** The XML of each finished import. */
  imported: string[];
  /** Imports waiting to finish when `deferImports` is set. */
  pending: (() => void)[];
  /** What `saveXML` returns: the imported XML or the last edit. */
  xml: string | undefined;
  destroyed: boolean;
  emit<K extends keyof ViewerEvents>(event: K, value: ViewerEvents[K]): void;
  /** A modeler command that leaves the diagram as `xml`. */
  edit(xml: string): void;
  /** The element with this BPMN id. */
  element(id: string): RegistryElement;
}

export interface MemoryViewerOptions {
  /** Hold every import until the test calls its entry in `pending`. */
  deferImports?: boolean;
  /** Zoom that fitting the viewport sets. Default 1. */
  fitZoom?: number;
  /** Use this registry instead of the diagram interchange of the XML. */
  registry?: RegistryElement[];
}

interface Di {
  bpmnElement?: ModdleElement;
  bounds?: Box;
  waypoint?: { x: number; y: number }[];
}

/** The registry bpmn-js builds from the XML's diagram interchange, in its order; labels are left out. */
export async function registryOf(xml: string): Promise<RegistryElement[]> {
  const { rootElement } = await createModdle().fromXML(xml);
  const diagrams = (rootElement.get("diagrams") as { plane: { planeElement?: Di[] } }[] | undefined) ?? [];
  return diagrams.flatMap((d) =>
    (d.plane.planeElement ?? []).flatMap((di): RegistryElement[] => {
      const bo = di.bpmnElement;
      if (!bo?.id) return [];
      if (di.waypoint) return [{ id: bo.id, businessObject: bo, waypoints: di.waypoint.map(({ x, y }) => ({ x, y })) }];
      const b = di.bounds;
      return b ? [{ id: bo.id, businessObject: bo, x: b.x, y: b.y, width: b.width, height: b.height }] : [];
    }),
  );
}

export function memoryViewers(settings: MemoryViewerOptions = {}) {
  const instances: MemoryViewer[] = [];
  const connect: ConnectViewer = async (options) => {
    const listeners = new Map<keyof ViewerEvents, Set<(value: never) => void>>();
    let registry: RegistryElement[] = [];
    let selected: RegistryElement[] = [];
    let zoom = 1;
    const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const viewer: MemoryViewer = {
      options,
      overlays: [],
      markers: new Map(),
      zooms: [],
      viewboxes: [],
      resizes: 0,
      imported: [],
      pending: [],
      xml: undefined,
      destroyed: false,
      get instance() {
        return viewer;
      },
      async importXML(xml) {
        // bpmn-js clears the diagram, and with it the selection, before it imports.
        viewer.select([]);
        const elements = settings.registry ?? (await registryOf(xml));
        if (settings.deferImports) await new Promise<void>((resolve) => viewer.pending.push(resolve));
        registry = elements;
        viewer.xml = xml;
        viewer.imported.push(xml);
      },
      saveXML: async () => viewer.xml,
      saveSVG: async () => (viewer.xml === undefined ? undefined : "<svg/>"),
      elements: () => [...registry],
      selected: () => [...selected],
      select(elements) {
        selected = [...elements];
        viewer.emit("selection", viewer.selected());
      },
      addOverlay: (element, overlay) => void viewer.overlays.push({ element, overlay }),
      clearOverlays: () => void (viewer.overlays = []),
      layer: () => layer,
      addMarker: (element, marker) => void viewer.markers.set(element, new Set([...(viewer.markers.get(element) ?? []), marker])),
      removeMarker: (element, marker) => void viewer.markers.get(element)?.delete(marker),
      zoom(scale) {
        if (scale !== undefined) {
          viewer.zooms.push(scale);
          zoom = scale === "fit-viewport" ? (settings.fitZoom ?? 1) : scale;
          viewer.emit("viewbox", undefined);
        }
        return zoom;
      },
      viewbox: (box) => void viewer.viewboxes.push(box),
      resized: () => void viewer.resizes++,
      on(event, listener) {
        const set = listeners.get(event) ?? new Set();
        listeners.set(event, set);
        set.add(listener as (value: never) => void);
        return () => set.delete(listener as (value: never) => void);
      },
      emit(event, value) {
        for (const listener of [...(listeners.get(event) ?? [])]) (listener as (value: unknown) => void)(value);
      },
      edit(xml) {
        viewer.xml = xml;
        viewer.emit("command", undefined);
      },
      element(id) {
        const found = registry.find((e) => e.id === id);
        if (!found) throw new Error(`No element ${id}`);
        return found;
      },
      destroy() {
        viewer.destroyed = true;
        viewer.select([]);
      },
    };
    instances.push(viewer);
    return viewer;
  };
  return { connect, instances };
}
