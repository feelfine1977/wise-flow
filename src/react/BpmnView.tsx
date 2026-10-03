import { type CSSProperties, type ReactNode, forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { type FlowGraph, type Locale, type LodRules, type Overlay, type OverlayShape, MAP_TARGET, arcWidth, contrastText, createPositions, formatShare, overlayArrow, overlayColor, t, tintColor } from "../core/index.js";
import { type BpmnExport, exportBpmn } from "../bpmn/export.js";
import { type IdResolver, createIdResolver, renameToActivities } from "../bpmn/ids.js";
import { type BpmnImport, type MappingRow, applyRenaming, importBpmn } from "../bpmn/import.js";
import type { BpmnLayoutOptions } from "../bpmn/layout.js";
import { type ModdleElement, isType, wiseModdleDescriptor } from "../bpmn/moddle.js";
import { type DiagramPositions, diagramScene, registryPositions } from "../bpmn/scene.js";
import { Legend } from "./Legend.js";
import { Chip } from "./nodes.js";
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
  /** Show zoom, fit and readable-size controls. Defaults to `controls`. */
  navigation?: boolean;
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
  viewbox(box: { x: number; y: number; width: number; height: number }): void;
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

/** The rendered elements (not their labels) that an id names: FlowGraph id, BPMN id or mapped activity id. */
function elementsNamed(registry: RegistryService, resolver: IdResolver, ids: Iterable<string>): DjsElement[] {
  const wanted = [...ids];
  return registry.getAll().filter((e) => !e.labelTarget && e.businessObject && wanted.some((id) => resolver.matches(e.businessObject!, id)));
}

const NO_ELEMENTS: DiagramPositions<DjsElement> = { positions: createPositions({ nodes: {}, groups: {}, edges: {} }, "di", "RIGHT"), elements: new Map() };

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
    navigation = controls,
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
  const [importedXml, setImportedXml] = useState<string | undefined>();
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
  const manualNavigation = useRef(false);

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
      setImportedXml(undefined);
      return;
    }
    let live = true;
    importBpmn(xml, { positions: false })
      .then((r) => {
        if (!live) return;
        setImported(r);
        setImportedXml(xml);
        onImport?.(r);
      })
      .catch((e: Error) => live && callbacks.current.onError?.(e));
    return () => {
      live = false;
    };
  }, [xml]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ids of the shown XML: the export's id map, or the headless import's once it belongs to this XML.
  const ids = props.xml === undefined && exported ? exported.ids : importedXml === xml ? imported?.ids : undefined;
  const resolver = useMemo(() => createIdResolver({ ids, mapping }), [ids, mapping]);
  const resolverRef = useRef(resolver);
  resolverRef.current = resolver;

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
        if (fitRef.current && importedRef.current && !manualNavigation.current) canvas.zoom("fit-viewport");
      } catch {
        // A canvas without SVG geometry (test environments) cannot be refitted.
      }
    };
    const onSelectionChanged = (event: Record<string, unknown>) => {
      // Import and destruction clear the diagram; those resets are not user selections.
      if (!live || !importedRef.current) return;
      const elements = (event.newSelection as DjsElement[] | undefined) ?? [];
      const s: BpmnSelection = { tasks: [], flows: [], lanes: [] };
      for (const e of elements) {
        const bo = e.businessObject;
        if (!bo) continue;
        const id = resolverRef.current.flowId(bo);
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
      if (bo && (isTask(bo) || isType(bo, "bpmn:SequenceFlow") || isLane(bo))) callbacks.current.onHover?.(resolverRef.current.flowId(bo));
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
    manualNavigation.current = false;
    importedRef.current = false;
    viewer
      .importXML(xml)
      .then(() => {
        if (!live) return;
        // The new diagram has no selection, even when the controlled value is unchanged.
        lastEmitted.current = "";
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

  // The table lists the graph with mapped tasks renamed to their activity ids.
  const renaming = useMemo(() => (imported ? renameToActivities(imported.graph.nodes.map((n) => n.id), resolver) : undefined), [imported, resolver]);
  const tableGraph = useMemo(() => (imported && renaming ? applyRenaming(imported.graph, renaming) : undefined), [imported, renaming]);
  // The scene of the diagram over the boxes of its rendered elements, read again after every import and change.
  const placed = useMemo(
    () => (status === "ready" && viewerRef.current && renaming ? registryPositions(viewerRef.current.get<RegistryService>("elementRegistry").getAll(), { resolver, renaming }) : NO_ELEMENTS),
    [status, renderVersion, resolver, renaming], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { scene, listed } = useMemo(
    () => diagramScene(tableGraph, placed.positions, overlays, { resolver, renaming: renaming ?? renameToActivities([], resolver) }, { locale, lod: props.lod }),
    [tableGraph, placed, overlays, resolver, renaming, locale, props.lod],
  );
  const { scales, lod: lodRules } = scene;
  const mapChips = listed.filter((o) => o.kind === "chip" && o.target === MAP_TARGET);

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
    if (!scene.geometry.shapes.length) return;

    const elementOf = (id: string): DjsElement | undefined => placed.elements.get(id);
    const arrow = svgEl("marker", { id: "wf-bpmn-arrow", viewBox: "0 0 10 10", refX: 10 * (1 - overlayArrow.overhang), refY: 5, markerWidth: overlayArrow.size, markerHeight: overlayArrow.size, markerUnits: "userSpaceOnUse", orient: "auto-start-reverse" });
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

    for (const shape of scene.geometry.shapes) {
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
          if (o.kind === "tint") cover.style.background = tintColor(o) ?? "transparent";
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
          const path = svgEl("path", {
            d: shape.path,
            fill: "none",
            stroke: color,
            "stroke-width": o.kind === "arc" ? arcWidth(o) : 2.5,
            "stroke-opacity": 0.9,
            "marker-end": "url(#wf-bpmn-arrow)",
          });
          if (p.reverse) path.setAttribute("stroke-dasharray", "6 4");
          path.addEventListener("click", () => selectPair(shape));
          g.appendChild(path);
          const value = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "";
          // A self-loop without a label or a value draws no text.
          if (shape.labelX !== undefined && shape.labelY !== undefined && (o.kind === "arc" || p.displayLabel || value)) {
            const text = svgEl("text", { x: shape.labelX, y: shape.labelY, "text-anchor": o.kind === "arc" ? "middle" : "start" });
            text.textContent = typeof p.displayLabel === "string" ? p.displayLabel : o.kind === "arc" ? `${p.glyph ?? ""} ${value}`.trim() : `↻ ${value}`;
            g.appendChild(text);
          }
          // Observed repeats are recorded data and stay at every zoom.
          g.setAttribute("data-min-zoom", String(o.kind === "selfLoop" && p.observed ? 0 : shape.minZoom));
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
  }, [status, scene, placed, lodRules, locale]);

  // 6. Controlled selection: applied to the diagram when it differs from what the diagram reported.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || status !== "ready" || props.selection === undefined) return;
    const key = JSON.stringify(props.selection);
    if (key === lastEmitted.current) return;
    const registry = viewer.get<RegistryService>("elementRegistry");
    const elements = elementsNamed(registry, resolver, [...props.selection.tasks, ...props.selection.flows, ...props.selection.lanes]);
    lastEmitted.current = key;
    viewer.get<SelectionService>("selection").select(elements);
  }, [props.selection, status, renderVersion, resolver]);

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
  const description = t(locale, "bpmn.description", counts) + (listed.length ? ` ${t(locale, "map.overlays", { count: listed.length })}` : "");
  // The table names mapped tasks by activity id; selections cross it in FlowGraph ids.
  const tableSelection: Selection = { nodes: selection.tasks.map((id) => renaming?.toMapped(id) ?? id), edges: selection.flows, groups: selection.lanes };
  const onTableSelect = useCallback(
    (s: Selection) => {
      const next: BpmnSelection = { tasks: s.nodes.map((id) => renaming?.toFlow(id) ?? id), flows: s.edges, lanes: s.groups };
      lastEmitted.current = "";
      setInnerSelection(next);
      onSelect?.(next);
    },
    [onSelect, renaming],
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
      onWheelCapture={() => { manualNavigation.current = true; }}
      onPointerDownCapture={(event) => {
        if ((event.target as Element).closest(".djs-container")) manualNavigation.current = true;
      }}
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
          <TableAlternative graph={tableGraph} overlays={listed} scales={scales} locale={locale} selection={tableSelection} onSelect={onTableSelect} />
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
      {navigation && view !== "table" ? (
        <div className="wf-panel wf-bpmn__navigation" role="group" aria-label={t(locale, "bpmn.navigation")}>
          <button type="button" className="wf-button" aria-label={t(locale, "map.zoomIn")} disabled={status !== "ready"} onClick={() => {
            const canvas = viewerRef.current?.get<CanvasService>("canvas");
            if (canvas) { manualNavigation.current = true; canvas.zoom(Math.min(4, canvas.zoom() * 1.25)); }
          }}>+</button>
          <button type="button" className="wf-button" aria-label={t(locale, "map.zoomOut")} disabled={status !== "ready"} onClick={() => {
            const canvas = viewerRef.current?.get<CanvasService>("canvas");
            if (canvas) { manualNavigation.current = true; canvas.zoom(Math.max(0.05, canvas.zoom() / 1.25)); }
          }}>−</button>
          <button type="button" className="wf-button" title={t(locale, "bpmn.fit")} aria-label={t(locale, "bpmn.fit")} disabled={status !== "ready"} onClick={() => {
            manualNavigation.current = true; viewerRef.current?.get<CanvasService>("canvas").zoom("fit-viewport");
          }}>⛶</button>
          <button type="button" className="wf-button" disabled={status !== "ready"} onClick={() => {
            const viewer = viewerRef.current, container = containerRef.current;
            if (!viewer || !container) return;
            manualNavigation.current = true;
            const selected = viewer.get<SelectionService>("selection").get().find((e) => isTask(e.businessObject));
            const task = selected ?? viewer.get<RegistryService>("elementRegistry").getAll().find((e) => !e.labelTarget && isTask(e.businessObject));
            const canvas = viewer.get<CanvasService>("canvas");
            if (task && task.x !== undefined && task.y !== undefined) canvas.viewbox({ x: task.x + (task.width ?? 0) / 2 - container.clientWidth / 2, y: task.y + (task.height ?? 0) / 2 - container.clientHeight / 2, width: container.clientWidth, height: container.clientHeight });
            else canvas.zoom(1);
          }}>{t(locale, "bpmn.readable")}</button>
        </div>
      ) : null}
      {legend && view !== "table" ? (
        <div className="wf-bpmn__panel wf-bpmn__panel--bottom-right">
          <Legend scales={scales} overlays={listed} locale={locale} chips={mapChips.length ? mapChips.map((c, i) => <Chip key={`${c.payload?.constraintId ?? "chip"}-${i}`} chip={c} locale={locale} />) : undefined} />
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
