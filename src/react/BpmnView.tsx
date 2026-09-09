import { type CSSProperties, type ReactNode, forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  type Box,
  type EdgeRoute,
  type FlowGraph,
  type Locale,
  type LodRules,
  type Overlay,
  type OverlayShape,
  type Positions,
  MAP_TARGET,
  buildScales,
  canonicalOverlays,
  colorOn,
  contrastText,
  defaultLod,
  defaultStyle,
  formatShare,
  lodForSize,
  overlayGeometry,
  positionsBounds,
  t,
} from "../core/index.js";
import { type BpmnExport, exportBpmn } from "../bpmn/export.js";
import { type BpmnImport, type MappingRow, applyMapping, importBpmn, mappingIndex } from "../bpmn/import.js";
import type { BpmnLayoutOptions } from "../bpmn/layout.js";
import { type ModdleElement, flowIdOf, isType, wiseModdleDescriptor } from "../bpmn/moddle.js";
import { Legend } from "./Legend.js";
import { Chip, tintFor } from "./nodes.js";
import { TableAlternative } from "./TableAlternative.js";
import type { Selection } from "./types.js";

/** Selected BPMN elements in FlowGraph ids (tasks, sequence flows, lanes or pools). */
export interface BpmnSelection {
  tasks: string[];
  flows: string[];
  lanes: string[];
}

export const emptyBpmnSelection: BpmnSelection = { tasks: [], flows: [], lanes: [] };

export interface BpmnViewHandle {
  /** The bpmn-js instance (viewer or modeler) once created. */
  viewer(): unknown;
  saveXML(): Promise<string | undefined>;
  saveSVG(): Promise<string | undefined>;
  fit(): void;
}

export interface BpmnViewProps {
  /** BPMN 2.0 XML to show. */
  xml?: string;
  /** A BPMN-lite graph to show instead of XML; exported with `exportBpmn` on the fly. */
  graph?: FlowGraph;
  layout?: BpmnLayoutOptions;
  /** Viewer with navigation (default) or the modeler. */
  mode?: "view" | "model";
  /** Overlays whose targets are FlowGraph ids, BPMN element ids, or activity ids resolved through `mapping`. */
  overlays?: Overlay[];
  /** Task ↔ activity mapping: rows from `importBpmn` or an object activity id → task id. */
  mapping?: MappingRow[] | Record<string, string>;
  selection?: BpmnSelection;
  onSelect?: (selection: BpmnSelection) => void;
  onHover?: (id: string | null) => void;
  view?: "diagram" | "table";
  onViewChange?: (view: "diagram" | "table") => void;
  /** Show the view toggle. Default true. */
  controls?: boolean;
  /** Show the legend. Default true. */
  legend?: boolean;
  locale?: Locale;
  lod?: Partial<LodRules>;
  /** Fit the diagram after import. Default true. */
  fitView?: boolean;
  /** Called with the headless import of the XML (graph, mapping table, warnings). */
  onImport?: (result: BpmnImport) => void;
  /** Modeler: called with the XML after every change (debounced). */
  onChange?: (xml: string) => void;
  onError?: (error: Error) => void;
  /** Extra bpmn-js options (`additionalModules`, `keyboard`, …). */
  viewerOptions?: Record<string, unknown>;
  ariaLabel?: string;
  className?: string;
  containerStyle?: CSSProperties;
  children?: ReactNode;
}

// Structural view of the bpmn-js services in use (the packages' own types stay out of the public surface).
interface DjsElement {
  id: string;
  type?: string;
  businessObject?: ModdleElement;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  waypoints?: { x: number; y: number }[];
  labelTarget?: unknown;
}
interface Viewer {
  importXML(xml: string): Promise<{ warnings: string[] }>;
  saveXML(options?: { format?: boolean }): Promise<{ xml?: string }>;
  saveSVG(): Promise<{ svg: string }>;
  get<T>(name: string): T;
  on(event: string, callback: (event: Record<string, unknown>) => void): void;
  off(event: string, callback: (event: Record<string, unknown>) => void): void;
  destroy(): void;
}
interface OverlaysService {
  add(element: string, type: string, overlay: { html: HTMLElement; position: { top?: number; left?: number; right?: number; bottom?: number }; show?: { minZoom?: number; maxZoom?: number }; scale?: boolean | { min?: number; max?: number } }): string;
  remove(filter: { type?: string }): void;
}
interface CanvasService {
  getLayer(name: string, index?: number): SVGGElement;
  zoom(scale?: number | "fit-viewport"): number;
  resized(): void;
  addMarker(element: string, marker: string): void;
  removeMarker(element: string, marker: string): void;
}
interface RegistryService {
  get(id: string): DjsElement | undefined;
  getAll(): DjsElement[];
}
interface SelectionService {
  get(): DjsElement[];
  select(elements: DjsElement[] | DjsElement | null): void;
}

type ViewerCtor = new (options: Record<string, unknown>) => Viewer;

async function loadViewer(mode: "view" | "model"): Promise<ViewerCtor> {
  const mod = mode === "model" ? await import("bpmn-js/lib/Modeler.js") : await import("bpmn-js/lib/NavigatedViewer.js");
  return mod.default as unknown as ViewerCtor;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const OVERLAY_TYPE = "wise";
const LAYER = "wise-overlays";

function isTask(bo: ModdleElement | undefined): boolean {
  return isType(bo, "bpmn:Activity");
}
function isLane(bo: ModdleElement | undefined): boolean {
  return isType(bo, "bpmn:Lane") || isType(bo, "bpmn:Participant");
}
function isGroupShape(el: DjsElement): boolean {
  const bo = el.businessObject;
  return isLane(bo) || (isType(bo, "bpmn:SubProcess") && ((bo?.get("flowElements") as unknown[] | undefined)?.length ?? 0) > 0);
}

/** Positions of the rendered elements keyed by FlowGraph id, BPMN id and mapped activity id. */
function registryPositions(registry: RegistryService, aliases: Map<string, string[]>): Positions {
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const edges: Record<string, EdgeRoute> = {};
  const keys = (el: DjsElement): string[] => {
    const bo = el.businessObject;
    const flowId = bo ? flowIdOf(bo) : el.id;
    return [...new Set([el.id, flowId, ...(aliases.get(flowId) ?? []), ...(aliases.get(el.id) ?? [])])];
  };
  for (const el of registry.getAll()) {
    if (el.labelTarget || !el.businessObject) continue;
    if (el.waypoints) {
      for (const k of keys(el)) edges[k] = { points: el.waypoints.map((p) => ({ x: p.x, y: p.y })) };
      continue;
    }
    if (typeof el.x !== "number" || typeof el.y !== "number") continue;
    const box = { x: el.x, y: el.y, width: el.width ?? 0, height: el.height ?? 0 };
    const target = isGroupShape(el) ? groups : nodes;
    for (const k of keys(el)) target[k] = box;
  }
  const partial = { nodes, groups, edges };
  return { ...partial, bounds: positionsBounds(partial), engine: "di", direction: "RIGHT" };
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function overlayColor(o: Overlay): string {
  const v = o.payload?.value;
  return typeof v === "number" && Number.isFinite(v) ? colorOn(v, "sequential", [0, 1]) : "#8c8c8c";
}

function tooltip(o: Overlay): string {
  return [o.payload?.label, o.payload?.text].filter(Boolean).join(" — ");
}

/**
 * BPMN diagram on bpmn-js (viewer by default, modeler with `mode="model"`) with
 * the constraint overlays of the core projected onto it: badges and heat tints
 * on tasks, hatching for tasks outside a scope, arcs for lag and precedence
 * drawn in an SVG layer, chips on lanes. Overlay datasets can be switched while
 * the diagram and its viewport stay fixed. Selection and hover callbacks
 * report tasks, sequence flows and lanes in FlowGraph ids for constraint
 * authoring; a table alternative lists the same tasks, flows and overlays. The
 * bpmn.io watermark stays, as its licence asks.
 */
export const BpmnView = forwardRef<BpmnViewHandle, BpmnViewProps>(function BpmnView(props, ref) {
  const {
    graph,
    layout: layoutOptions,
    mode = "view",
    overlays = [],
    mapping,
    onSelect,
    onHover,
    controls = true,
    legend = true,
    locale = "en",
    fitView = true,
    onImport,
    onChange,
    onError,
    viewerOptions,
    ariaLabel,
    className,
    containerStyle,
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const [viewerVersion, setViewerVersion] = useState(0);
  const [exported, setExported] = useState<BpmnExport | undefined>();
  const [imported, setImported] = useState<BpmnImport | undefined>();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [renderVersion, setRenderVersion] = useState(0);
  const [innerView, setInnerView] = useState<"diagram" | "table">("diagram");
  const view = props.view ?? innerView;
  const setView = (v: "diagram" | "table") => {
    if (props.view === undefined) setInnerView(v);
    props.onViewChange?.(v);
  };
  const [innerSelection, setInnerSelection] = useState<BpmnSelection>(emptyBpmnSelection);
  const selection = props.selection ?? innerSelection;
  const lastEmitted = useRef<string>("");
  const savedXml = useRef<string | undefined>(undefined);
  const callbacks = useRef({ onSelect, onHover, onChange, onError });
  callbacks.current = { onSelect, onHover, onChange, onError };
  const fitRef = useRef(fitView);
  fitRef.current = fitView;
  const importedRef = useRef(false);

  // 1. A graph is exported to XML; explicit XML wins.
  const layoutKey = JSON.stringify({ ...(layoutOptions ?? {}), elk: undefined, elkWorkerUrl: layoutOptions?.elkWorkerUrl ? String(layoutOptions.elkWorkerUrl) : undefined });
  useEffect(() => {
    if (props.xml !== undefined || !graph) {
      setExported(undefined);
      return;
    }
    let live = true;
    exportBpmn(graph, { layout: layoutOptions })
      .then((r) => live && setExported(r))
      .catch((e: Error) => {
        if (!live) return;
        setStatus("error");
        callbacks.current.onError?.(e);
      });
    return () => {
      live = false;
    };
  }, [graph, props.xml, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const xml = props.xml ?? exported?.xml;

  // 2. Headless import of the XML for ids, the mapping table, the table alternative and ARIA.
  useEffect(() => {
    if (!xml) {
      setImported(undefined);
      return;
    }
    let live = true;
    importBpmn(xml, { positions: false })
      .then((r) => {
        if (!live) return;
        setImported(r);
        onImport?.(r);
      })
      .catch((e: Error) => live && callbacks.current.onError?.(e));
    return () => {
      live = false;
    };
  }, [xml]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. Viewer lifecycle: created once per mode, destroyed on unmount.
  const optionsKey = JSON.stringify(viewerOptions ?? {});
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let live = true;
    let viewer: Viewer | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let changeFrame: number | undefined;
    let observer: ResizeObserver | undefined;
    // bpmn-js caches the container size; after a resize the canvas is told and the diagram refitted.
    const onResize = () => {
      if (!viewer || container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        const canvas = viewer.get<CanvasService>("canvas");
        canvas.resized();
        if (fitRef.current && importedRef.current) canvas.zoom("fit-viewport");
      } catch {
        // A canvas without SVG geometry (test environments) cannot be refitted.
      }
    };
    const onSelectionChanged = (event: Record<string, unknown>) => {
      const elements = (event.newSelection as DjsElement[] | undefined) ?? [];
      const s: BpmnSelection = { tasks: [], flows: [], lanes: [] };
      for (const e of elements) {
        const bo = e.businessObject;
        if (!bo) continue;
        const id = flowIdOf(bo);
        if (isTask(bo)) s.tasks.push(id);
        else if (isType(bo, "bpmn:SequenceFlow")) s.flows.push(id);
        else if (isLane(bo)) s.lanes.push(id);
      }
      const key = JSON.stringify(s);
      if (key === lastEmitted.current) return;
      lastEmitted.current = key;
      setInnerSelection(s);
      callbacks.current.onSelect?.(s);
    };
    const onElementHover = (event: Record<string, unknown>) => {
      const bo = (event.element as DjsElement | undefined)?.businessObject;
      if (bo && (isTask(bo) || isType(bo, "bpmn:SequenceFlow") || isLane(bo))) callbacks.current.onHover?.(flowIdOf(bo));
    };
    const onElementOut = () => callbacks.current.onHover?.(null);
    const onElementsChanged = () => {
      if (changeFrame !== undefined) return;
      changeFrame = window.requestAnimationFrame(() => {
        changeFrame = undefined;
        setRenderVersion((n) => n + 1);
      });
    };
    const onCommand = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        viewer
          ?.saveXML({ format: true })
          .then(({ xml: out }) => {
            if (!live || !out) return;
            savedXml.current = out;
            callbacks.current.onChange?.(out);
            setRenderVersion((n) => n + 1);
          })
          .catch((e: Error) => callbacks.current.onError?.(e));
      }, 250);
    };
    loadViewer(mode)
      .then((Ctor) => {
        if (!live) return;
        viewer = new Ctor({ container, moddleExtensions: { wise: wiseModdleDescriptor }, ...(viewerOptions ?? {}) });
        viewer.on("selection.changed", onSelectionChanged);
        viewer.on("element.hover", onElementHover);
        viewer.on("element.out", onElementOut);
        viewer.on("elements.changed", onElementsChanged);
        if (mode === "model") viewer.on("commandStack.changed", onCommand);
        viewerRef.current = viewer;
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(onResize);
          observer.observe(container);
        }
        setViewerVersion((n) => n + 1);
      })
      .catch((e: Error) => {
        if (!live) return;
        setStatus("error");
        callbacks.current.onError?.(e);
      });
    return () => {
      live = false;
      if (saveTimer) clearTimeout(saveTimer);
      if (changeFrame !== undefined) window.cancelAnimationFrame(changeFrame);
      observer?.disconnect();
      viewerRef.current = null;
      importedRef.current = false;
      viewer?.destroy();
    };
  }, [mode, optionsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Import the XML into the viewer; an XML that the modeler itself produced is not re-imported.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !xml) return;
    if (savedXml.current !== undefined && xml === savedXml.current) return;
    let live = true;
    setStatus("loading");
    importedRef.current = false;
    viewer
      .importXML(xml)
      .then(() => {
        if (!live) return;
        importedRef.current = true;
        if (fitView) viewer.get<CanvasService>("canvas").zoom("fit-viewport");
        setStatus("ready");
        setRenderVersion((n) => n + 1);
      })
      .catch((e: Error) => {
        if (!live) return;
        setStatus("error");
        callbacks.current.onError?.(e);
      });
    return () => {
      live = false;
    };
  }, [viewerVersion, xml, fitView]);

  // Overlay bookkeeping: mapping aliases and the graph with activity ids for the table.
  const aliasIndex = useMemo(() => {
    const aliases = new Map<string, string[]>();
    if (!mapping) return aliases;
    const { toTasks } = mappingIndex(mapping);
    for (const [activity, tasks] of Object.entries(toTasks)) for (const task of tasks) aliases.set(task, [...(aliases.get(task) ?? []), activity]);
    return aliases;
  }, [mapping]);
  const tableGraph = useMemo(() => (imported ? (mapping ? applyMapping(imported.graph, mapping) : imported.graph) : undefined), [imported, mapping]);
  const scales = useMemo(() => buildScales(tableGraph ?? { nodes: [], edges: [] }, defaultStyle), [tableGraph]);
  const lodRules = useMemo(() => lodForSize(tableGraph?.nodes.length ?? 0, { ...defaultLod, ...(props.lod ?? {}) }), [tableGraph?.nodes.length, props.lod]);
  const lodRef = useRef(lodRules);
  lodRef.current = lodRules;
  const orderedOverlays = useMemo(() => canonicalOverlays(overlays), [overlays]);
  const mapChips = orderedOverlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET);

  // 5. Project the overlays onto the diagram. The diagram is not touched; only overlays change.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready") return;
    const overlaysService = viewer.get<OverlaysService>("overlays");
    const registry = viewer.get<RegistryService>("elementRegistry");
    const canvas = viewer.get<CanvasService>("canvas");
    overlaysService.remove({ type: OVERLAY_TYPE });
    const layer = canvas.getLayer(LAYER, 10);
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    for (const e of registry.getAll()) {
      canvas.removeMarker(e.id, "wf-bpmn--tinted");
      canvas.removeMarker(e.id, "wf-bpmn--hatched");
    }
    if (!orderedOverlays.length) return;

    const positions = registryPositions(registry, aliasIndex);
    const geometry = overlayGeometry(orderedOverlays, positions, { lod: lodRules });
    const elementOf = (id: string): DjsElement | undefined => {
      if (registry.get(id)) return registry.get(id);
      for (const e of registry.getAll()) {
        const bo = e.businessObject;
        if (!bo || e.labelTarget) continue;
        const flowId = flowIdOf(bo);
        if (flowId === id || aliasIndex.get(flowId)?.includes(id) || aliasIndex.get(e.id)?.includes(id)) return e;
      }
      return undefined;
    };
    const arrow = svgEl("marker", { id: "wf-bpmn-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 12, markerHeight: 12, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
    arrow.appendChild(svgEl("path", { d: "M0 0L10 5L0 10z", fill: "context-stroke" }));
    const defs = svgEl("defs", {});
    defs.appendChild(arrow);
    layer.appendChild(defs);
    layer.setAttribute("class", "wf-bpmn-overlays");

    const selectPair = (shape: OverlayShape) => {
      const s = shape.overlay.payload?.source;
      const tg = shape.overlay.payload?.target;
      const elements = [s, tg, shape.overlay.target].filter((x): x is string => typeof x === "string").map(elementOf).filter((x): x is DjsElement => !!x);
      if (elements.length) viewer.get<SelectionService>("selection").select(elements);
    };

    for (const shape of geometry.shapes) {
      const o = shape.overlay;
      const p = o.payload ?? {};
      switch (o.kind) {
        case "badge": {
          const target = elementOf(o.target);
          if (!target || typeof target.x !== "number") break;
          const bg = overlayColor(o);
          const badge = el("span", "wf-badge");
          badge.style.background = bg;
          badge.style.color = contrastText(bg);
          badge.title = tooltip(o);
          if (p.constraintId) badge.dataset.constraint = String(p.constraintId);
          badge.appendChild(el("span", "wf-badge__glyph", p.glyph ?? "●"));
          if (typeof p.value === "number" && Number.isFinite(p.value)) badge.appendChild(el("span", "wf-badge__share", formatShare(p.value, locale)));
          overlaysService.add(target.id, OVERLAY_TYPE, {
            html: badge,
            position: { top: shape.y - target.y!, left: shape.x - target.x },
            show: { minZoom: lodRules.badges },
            scale: { min: 0.8, max: 1.2 },
          });
          break;
        }
        case "tint":
        case "hatch": {
          const target = elementOf(o.target);
          if (!target || typeof target.x !== "number") break;
          const cover = el("div", o.kind === "tint" ? "wf-bpmn-tint" : "wf-bpmn-hatch");
          cover.style.width = `${target.width ?? 0}px`;
          cover.style.height = `${target.height ?? 0}px`;
          if (o.kind === "tint") cover.style.background = tintFor(typeof p.value === "number" ? p.value : undefined) ?? "transparent";
          cover.title = tooltip(o);
          overlaysService.add(target.id, OVERLAY_TYPE, { html: cover, position: { top: 0, left: 0 }, show: o.kind === "hatch" ? { minZoom: lodRules.hatch } : undefined, scale: true });
          canvas.addMarker(target.id, o.kind === "tint" ? "wf-bpmn--tinted" : "wf-bpmn--hatched");
          break;
        }
        case "chip": {
          if (o.target === MAP_TARGET) break;
          const target = elementOf(o.target);
          if (!target || typeof target.x !== "number") break;
          const chip = el("span", "wf-chip");
          chip.style.setProperty("--wf-chip-color", overlayColor(o));
          chip.title = tooltip(o);
          if (p.glyph) chip.appendChild(el("span", "", p.glyph));
          const label = el("span", "");
          if (p.label) {
            const strong = document.createElement("strong");
            strong.textContent = `${p.label}: `;
            label.appendChild(strong);
          }
          label.appendChild(document.createTextNode(p.text ?? (typeof p.value === "number" ? formatShare(p.value, locale) : "")));
          chip.appendChild(label);
          overlaysService.add(target.id, OVERLAY_TYPE, { html: chip, position: { top: shape.y - target.y!, left: shape.x - target.x }, show: { minZoom: lodRules.chips }, scale: { min: 0.8, max: 1.2 } });
          break;
        }
        case "arc":
        case "selfLoop": {
          if (!shape.path) break;
          const color = overlayColor(o);
          const g = svgEl("g", { class: o.kind === "arc" ? `wf-arc${p.reverse ? " wf-arc--reverse" : ""}` : "wf-selfloop", "data-kind": o.kind });
          if (p.constraintId) g.setAttribute("data-constraint", String(p.constraintId));
          const title = svgEl("title", {});
          title.textContent = tooltip(o);
          g.appendChild(title);
          const coverage = typeof p.coverage === "number" ? Math.max(0, Math.min(1, p.coverage)) : 1;
          const path = svgEl("path", {
            d: shape.path,
            fill: "none",
            stroke: color,
            "stroke-width": o.kind === "arc" ? 2 + 8 * coverage : 2.5,
            "stroke-opacity": 0.9,
            "marker-end": "url(#wf-bpmn-arrow)",
          });
          if (p.reverse) path.setAttribute("stroke-dasharray", "6 4");
          path.addEventListener("click", () => selectPair(shape));
          g.appendChild(path);
          if (shape.labelX !== undefined && shape.labelY !== undefined) {
            const value = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "";
            const text = svgEl("text", { x: shape.labelX, y: shape.labelY, "text-anchor": o.kind === "arc" ? "middle" : "start" });
            text.textContent = o.kind === "arc" ? `${p.glyph ?? ""} ${value}`.trim() : `↻ ${value}`;
            g.appendChild(text);
          }
          g.setAttribute("data-min-zoom", String(shape.minZoom));
          layer.appendChild(g);
          break;
        }
      }
    }
    // Arcs follow the level of detail: hidden below their minimum zoom.
    const applyZoom = () => {
      const zoom = canvas.zoom();
      for (const child of Array.from(layer.children)) {
        const min = Number(child.getAttribute("data-min-zoom") ?? 0);
        (child as SVGElement).style.visibility = zoom >= min ? "visible" : "hidden";
      }
    };
    applyZoom();
    viewer.on("canvas.viewbox.changed", applyZoom);
    return () => {
      viewer.off("canvas.viewbox.changed", applyZoom);
    };
  }, [status, renderVersion, orderedOverlays, aliasIndex, lodRules, locale]);

  // 6. Controlled selection: applied to the diagram when it differs from what the diagram reported.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready" || props.selection === undefined) return;
    const key = JSON.stringify(props.selection);
    if (key === lastEmitted.current) return;
    const registry = viewer.get<RegistryService>("elementRegistry");
    const wanted = new Set([...props.selection.tasks, ...props.selection.flows, ...props.selection.lanes]);
    const elements = registry.getAll().filter((e) => {
      const bo = e.businessObject;
      if (!bo || e.labelTarget) return false;
      const flowId = flowIdOf(bo);
      return wanted.has(flowId) || wanted.has(e.id) || (aliasIndex.get(flowId) ?? []).some((a) => wanted.has(a));
    });
    lastEmitted.current = key;
    viewer.get<SelectionService>("selection").select(elements);
  }, [props.selection, status, renderVersion, aliasIndex]);

  useImperativeHandle(
    ref,
    () => ({
      viewer: () => viewerRef.current,
      saveXML: async () => (await viewerRef.current?.saveXML({ format: true }))?.xml,
      saveSVG: async () => (await viewerRef.current?.saveSVG())?.svg,
      fit: () => viewerRef.current?.get<CanvasService>("canvas").zoom("fit-viewport"),
    }),
    [],
  );

  const descId = useId();
  const liveId = useId();
  const counts = useMemo(() => {
    const g = tableGraph;
    return {
      tasks: g?.nodes.filter((n) => n.kind === "activity" || n.kind === "stage").length ?? 0,
      gateways: g?.nodes.filter((n) => n.kind === "gateway").length ?? 0,
      flows: g?.edges.length ?? 0,
      lanes: g?.groups?.filter((gr) => gr.kind !== "pool").length ?? 0,
    };
  }, [tableGraph]);
  const description = t(locale, "bpmn.description", counts) + (orderedOverlays.length ? ` ${t(locale, "map.overlays", { count: orderedOverlays.length })}` : "");
  const tableSelection: Selection = { nodes: selection.tasks, edges: selection.flows, groups: selection.lanes };
  const onTableSelect = useCallback(
    (s: Selection) => {
      const next: BpmnSelection = { tasks: s.nodes, flows: s.edges, lanes: s.groups };
      lastEmitted.current = "";
      setInnerSelection(next);
      onSelect?.(next);
    },
    [onSelect],
  );

  return (
    <div
      className={`wf-bpmn${className ? ` ${className}` : ""}`}
      style={{ width: "100%", height: "100%", ...containerStyle }}
      role="group"
      aria-label={ariaLabel ?? description}
      aria-describedby={descId}
      data-bpmn-status={status}
      data-bpmn-mode={mode}
      data-bpmn-view={view}
    >
      <p id={descId} className="wf-sr-only">
        {description}
      </p>
      <p id={liveId} className="wf-sr-only" aria-live="polite">
        {selection.tasks.length + selection.flows.length + selection.lanes.length > 0
          ? t(locale, "bpmn.selected", { tasks: selection.tasks.length, flows: selection.flows.length, lanes: selection.lanes.length })
          : ""}
      </p>
      <div ref={containerRef} className="wf-bpmn__canvas" aria-hidden={view === "table" ? true : undefined} />
      {view === "table" && tableGraph ? (
        <div className="wf-bpmn__table">
          <TableAlternative graph={tableGraph} overlays={orderedOverlays} scales={scales} locale={locale} selection={tableSelection} onSelect={onTableSelect} />
        </div>
      ) : null}
      {controls ? (
        <div className="wf-panel wf-bpmn__panel wf-bpmn__panel--top-left wf-controls">
          <div className="wf-controls__row">
            <button type="button" className="wf-button" aria-pressed={view === "table"} onClick={() => setView(view === "table" ? "diagram" : "table")}>
              {view === "table" ? t(locale, "bpmn.diagram") : t(locale, "bpmn.table")}
            </button>
          </div>
        </div>
      ) : null}
      {legend && view !== "table" ? (
        <div className="wf-bpmn__panel wf-bpmn__panel--bottom-right">
          <Legend scales={scales} overlays={orderedOverlays} locale={locale} chips={mapChips.length ? mapChips.map((c, i) => <Chip key={`${c.payload?.constraintId ?? "chip"}-${i}`} chip={c} locale={locale} />) : undefined} />
        </div>
      ) : null}
      {status === "loading" || (status === "idle" && (xml || graph)) ? (
        <div className="wf-panel wf-bpmn__panel wf-bpmn__panel--top-right" role="status">
          {t(locale, "bpmn.loading")}
        </div>
      ) : null}
      {status === "error" ? (
        <div className="wf-panel wf-bpmn__panel wf-bpmn__panel--top-right" role="alert">
          {t(locale, "bpmn.error")}
        </div>
      ) : null}
      {children}
    </div>
  );
});
