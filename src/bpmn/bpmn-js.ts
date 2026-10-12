/** The bpmn-js adapter of the viewer seam: the navigated viewer, or the modeler, loaded on demand. */
import type { Box } from "../core/index.js";
import { wiseModdleDescriptor } from "./moddle.js";
import type { RegistryElement } from "./scene.js";
import type { BpmnViewer, ConnectViewer, ViewerEvents, ViewerOverlay } from "./viewer.js";

// Structural view of the bpmn-js services in use (the packages' own types stay out of the public surface).
interface Viewer {
  importXML(xml: string): Promise<{ warnings: string[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>;
  saveSVG(): Promise<{ svg: string }>;
  get<T>(name: string): T;
  on(event: string, callback: (event: Record<string, unknown>) => void): void;
  off(event: string, callback: (event: Record<string, unknown>) => void): void;
  destroy(): void;
}
interface Services {
  overlays: { add(element: string, type: string, overlay: ViewerOverlay): string; remove(filter: { type: string }): void };
  canvas: {
    getLayer(name: string, index?: number): SVGGElement;
    zoom(scale?: number | "fit-viewport"): number;
    resized(): void;
    viewbox(box: Box): void;
    addMarker(element: string, marker: string): void;
    removeMarker(element: string, marker: string): void;
  };
  elementRegistry: { getAll(): RegistryElement[] };
  selection: { get(): RegistryElement[]; select(elements: RegistryElement[]): void };
}

const OVERLAY_TYPE = "wise";
const LAYER = "wise-overlays";

// The bpmn-js event behind each seam event, and what the seam passes on.
const EVENTS: { [K in keyof ViewerEvents]: [string, (event: Record<string, unknown>) => ViewerEvents[K]] } = {
  selection: ["selection.changed", (e) => (e.newSelection as RegistryElement[] | undefined) ?? []],
  hover: ["element.hover", (e) => e.element as RegistryElement | undefined],
  out: ["element.out", () => undefined],
  changed: ["elements.changed", () => undefined],
  command: ["commandStack.changed", () => undefined],
  viewbox: ["canvas.viewbox.changed", () => undefined],
};

export const connectBpmnJs: ConnectViewer = async ({ container, mode, options }) => {
  const mod = mode === "model" ? await import("bpmn-js/lib/Modeler.js") : await import("bpmn-js/lib/NavigatedViewer.js");
  const Ctor = mod.default as unknown as new (options: Record<string, unknown>) => Viewer;
  const viewer = new Ctor({ container, moddleExtensions: { wise: wiseModdleDescriptor }, ...(options ?? {}) });
  const get = <K extends keyof Services>(name: K): Services[K] => viewer.get<Services[K]>(name);
  const canvas = () => get("canvas");
  const adapter: BpmnViewer = {
    instance: viewer,
    importXML: async (xml) => {
      await viewer.importXML(xml);
    },
    saveXML: async () => (await viewer.saveXML({ format: true })).xml,
    saveSVG: async () => (await viewer.saveSVG()).svg,
    elements: () => get("elementRegistry").getAll(),
    selected: () => get("selection").get(),
    select: (elements) => get("selection").select(elements),
    addOverlay: (element, overlay) => {
      get("overlays").add(element, OVERLAY_TYPE, overlay);
    },
    clearOverlays: () => get("overlays").remove({ type: OVERLAY_TYPE }),
    layer: () => canvas().getLayer(LAYER, 10),
    addMarker: (element, marker) => canvas().addMarker(element, marker),
    removeMarker: (element, marker) => canvas().removeMarker(element, marker),
    zoom: (scale) => canvas().zoom(scale),
    viewbox: (box) => canvas().viewbox(box),
    resized: () => canvas().resized(),
    on: (event, listener) => {
      const [name, read] = EVENTS[event];
      const callback = (e: Record<string, unknown>) => listener(read(e) as never);
      viewer.on(name, callback);
      return () => viewer.off(name, callback);
    },
    destroy: () => viewer.destroy(),
  };
  return adapter;
};
