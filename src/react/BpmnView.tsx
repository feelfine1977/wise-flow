import { type CSSProperties, type ReactNode, forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { type FlowGraph, type Locale, type LodRules, type Overlay, createPositions, t } from "../core/index.js";
import { connectBpmnJs } from "../bpmn/bpmn-js.js";
import { type BpmnExport, exportBpmn } from "../bpmn/export.js";
import { createIdResolver, renameToActivities } from "../bpmn/ids.js";
import { type BpmnImport, type MappingRow, applyRenaming, importBpmn } from "../bpmn/import.js";
import type { BpmnLayoutOptions } from "../bpmn/layout.js";
import { projectMarks } from "../bpmn/projection.js";
import { type DiagramPositions, type RegistryElement, diagramScene, registryPositions } from "../bpmn/scene.js";
import { type BpmnSelection, type BpmnViewer, type ConnectViewer, elementsNamed, hoverOf, isTask, selectionOf } from "../bpmn/viewer.js";
import type { ActivityRenaming, IdResolver } from "../bpmn/ids.js";
import { useMapController } from "./controller.js";
import { Legend } from "./Legend.js";
import { type MarkIds, MarkFigure, domMark, markDefs, svgDom } from "./marks.js";
import { TableAlternative } from "./TableAlternative.js";
import type { Selection } from "./types.js";

export type { BpmnSelection } from "../bpmn/viewer.js";

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
  /** Called with the headless import of the XML (graph, mapping table, warnings) once the diagram is shown and fitted, or could not be shown. */
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

const SVG_NS = "http://www.w3.org/2000/svg";
const MARK_IDS: MarkIds = { arrow: "wf-bpmn-arrow", pattern: "wf-bpmn-outofscope" };

const NO_GRAPH: FlowGraph = { nodes: [], edges: [] };

// The table names mapped tasks by activity id; the controller and the selections that leave the view, by FlowGraph id,
// so that a new mapping or the import changes no selection the controller has announced.
const toTable = (s: BpmnSelection, renaming?: ActivityRenaming): Selection => ({ nodes: s.tasks.map((id) => renaming?.toMapped(id) ?? id), edges: s.flows, groups: s.lanes });
// A host's selection may name tasks by activity id.
const toFlow = (s: BpmnSelection, resolver: IdResolver): Selection => ({ nodes: s.tasks.map((id) => resolver.flowIdsOfActivity(id)[0] ?? id), edges: s.flows, groups: s.lanes });
const toBpmn = (s: Selection, renaming?: ActivityRenaming): BpmnSelection => ({ tasks: s.nodes.map((id) => renaming?.toFlow(id) ?? id), flows: s.edges, lanes: s.groups });

const NO_ELEMENTS: DiagramPositions = { positions: createPositions({ nodes: {}, groups: {}, edges: {} }, "di", "RIGHT"), elements: new Map() };

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** The BPMN view on the viewer that `connect` creates (`connectBpmnJs` for `<BpmnView/>`). */
export function createBpmnView(connect: ConnectViewer) {
  return forwardRef<BpmnViewHandle, BpmnViewProps>(function BpmnView(props, ref) {
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
    // The viewer as state re-runs the effects that use it; the ref is cleared as soon as it is destroyed.
    const [viewer, setViewer] = useState<BpmnViewer | null>(null);
    const viewerRef = useRef<BpmnViewer | null>(null);
    // The element registry, read again after every import, change and save.
    const [elements, setElements] = useState<RegistryElement[]>([]);
    // Markers the overlays put on elements, removed before the next projection.
    const markersRef = useRef(new Set<string>());
    const [exported, setExported] = useState<BpmnExport | undefined>();
    const [imported, setImported] = useState<BpmnImport | undefined>();
    const [importedXml, setImportedXml] = useState<string | undefined>();
    const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
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
    const callbacks = useRef({ onSelect, onHover, onChange, onError, onImport });
    callbacks.current = { onSelect, onHover, onChange, onError, onImport };
    const fitRef = useRef(fitView);
    fitRef.current = fitView;
    const importedRef = useRef(false);
    // The current viewer is done with the XML (imported or failed), or none could be created.
    const [settled, setSettled] = useState(false);
    const announced = useRef<BpmnImport | undefined>(undefined);
    const manualNavigation = useRef(false);
    // A selection the diagram reported, passed to the controller.
    const diagramSelect = useRef<(s: BpmnSelection) => void>(() => {});

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
        })
        .catch((e: Error) => live && callbacks.current.onError?.(e));
      return () => {
        live = false;
      };
    }, [xml]);

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
      let current: BpmnViewer | undefined;
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      let changeFrame: number | undefined;
      let observer: ResizeObserver | undefined;
      const offs: (() => void)[] = [];
      // The viewer caches the container size; after a resize it is told and the diagram refitted.
      const onResize = () => {
        if (!current || container.clientWidth === 0 || container.clientHeight === 0) return;
        try {
          current.resized();
          if (fitRef.current && importedRef.current && !manualNavigation.current) current.zoom("fit-viewport");
        } catch {
          // A canvas without SVG geometry (test environments) cannot be refitted.
        }
      };
      connect({ container, mode, options: viewerOptions })
        .then((v) => {
          if (!live) return v.destroy();
          current = v;
          offs.push(
            v.on("selection", (selected) => {
              // Import and destruction clear the diagram; those resets are not user selections.
              if (!live || !importedRef.current) return;
              const s = selectionOf(selected, resolverRef.current);
              const key = JSON.stringify(s);
              if (key === lastEmitted.current) return;
              lastEmitted.current = key;
              diagramSelect.current(s);
            }),
            v.on("hover", (element) => {
              const id = hoverOf(element, resolverRef.current);
              if (id !== undefined) callbacks.current.onHover?.(id);
            }),
            v.on("out", () => callbacks.current.onHover?.(null)),
            v.on("changed", () => {
              if (changeFrame !== undefined) return;
              changeFrame = window.requestAnimationFrame(() => {
                changeFrame = undefined;
                setElements(v.elements());
              });
            }),
          );
          // The modeler's changes are saved once commands pause for 250 ms.
          if (mode === "model")
            offs.push(
              v.on("command", () => {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => {
                  v.saveXML()
                    .then((out) => {
                      if (!live || !out) return;
                      savedXml.current = out;
                      callbacks.current.onChange?.(out);
                      setElements(v.elements());
                    })
                    .catch((e: Error) => callbacks.current.onError?.(e));
                }, 250);
              }),
            );
          if (typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(onResize);
            observer.observe(container);
          }
          viewerRef.current = v;
          setViewer(v);
        })
        .catch((e: Error) => {
          if (!live) return;
          setSettled(true);
          setStatus("error");
          callbacks.current.onError?.(e);
        });
      return () => {
        live = false;
        clearTimeout(saveTimer);
        if (changeFrame !== undefined) window.cancelAnimationFrame(changeFrame);
        observer?.disconnect();
        importedRef.current = false;
        setSettled(false);
        viewerRef.current = null;
        setViewer(null);
        // The next viewer starts empty; overlays wait for its own registry.
        setElements([]);
        for (const off of offs) off();
        current?.destroy();
      };
    }, [mode, optionsKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // 4. Import the XML into the viewer; an XML that the modeler itself produced is not re-imported.
    useEffect(() => {
      if (!viewer || viewer !== viewerRef.current || !xml) return;
      if (savedXml.current !== undefined && xml === savedXml.current) return;
      let live = true;
      setStatus("loading");
      manualNavigation.current = false;
      importedRef.current = false;
      setSettled(false);
      viewer
        .importXML(xml)
        .then(() => {
          if (!live) return;
          // The new diagram has no selection, even when the controlled value is unchanged.
          lastEmitted.current = "";
          importedRef.current = true;
          setSettled(true);
          if (fitView) viewer.zoom("fit-viewport");
          setElements(viewer.elements());
          setStatus("ready");
        })
        .catch((e: Error) => {
          if (!live) return;
          setSettled(true);
          setStatus("error");
          callbacks.current.onError?.(e);
        });
      return () => {
        live = false;
      };
    }, [viewer, xml, fitView]);

    // The table lists the graph with mapped tasks renamed to their activity ids.
    const renaming = useMemo(() => (imported ? renameToActivities(imported.graph.nodes.map((n) => n.id), resolver) : undefined), [imported, resolver]);
    const tableGraph = useMemo(() => (imported && renaming ? applyRenaming(imported.graph, renaming) : undefined), [imported, renaming]);
    // The scene of the diagram over the boxes of its rendered elements.
    const placed = useMemo(
      () => (status === "ready" && viewer && renaming ? registryPositions(elements, { resolver, renaming }) : NO_ELEMENTS),
      [status, viewer, elements, resolver, renaming],
    );
    const { scene, listed } = useMemo(
      () => diagramScene(tableGraph, placed.positions, overlays, { resolver, renaming: renaming ?? renameToActivities([], resolver) }, { locale, lod: props.lod }),
      [tableGraph, placed, overlays, resolver, renaming, locale, props.lod],
    );
    const { scales } = scene;

    // Selections from the diagram and from the table are the map controller's `select` events, so they are
    // announced as on the map; the controller sees the view's selection as the controlling host's.
    const renamingRef = useRef(renaming);
    renamingRef.current = renaming;
    const tableSelection = useMemo(() => toTable(selection, renaming), [selection, renaming]);
    const flowSelection = useMemo(() => toFlow(selection, resolver), [selection, resolver]);
    const report = useCallback((s: Selection) => {
      const next = toBpmn(s);
      setInnerSelection(next);
      callbacks.current.onSelect?.(next);
    }, []);
    const controller = useMapController({ selection: flowSelection, onSelect: report });
    controller.context.current = { graph: imported?.graph ?? NO_GRAPH, locale };
    const { dispatch } = controller;
    diagramSelect.current = (s) => void dispatch({ type: "select", selection: toTable(s) });
    const legendMarks = scene.marks.filter((m) => !m.inMap);

    // 5. Project the overlays onto the diagram. The diagram is not touched; only overlays change.
    useEffect(() => {
      if (!viewer || viewer !== viewerRef.current || status !== "ready") return;
      viewer.clearOverlays();
      const layer = viewer.layer();
      layer.replaceChildren();
      for (const e of viewer.elements()) for (const marker of markersRef.current) viewer.removeMarker(e.id, marker);
      markersRef.current.clear();
      if (!scene.marks.some((m) => m.inMap)) return;
      const { boxes, paths } = projectMarks(scene.marks, placed.elements);
      const byId = new Map([...placed.elements.values()].map((e) => [e.id, e]));
      layer.appendChild(svgDom(markDefs(MARK_IDS), document));
      layer.setAttribute("class", "wf-bpmn-overlays");
      for (const p of paths) {
        const g = svgDom(domMark(p.mark, MARK_IDS), document) as SVGGElement;
        g.setAttribute("data-kind", p.mark.kind);
        g.setAttribute("data-min-zoom", String(p.minZoom));
        g.addEventListener("click", () => p.selects.length && viewer.select(p.selects.map((id) => byId.get(id)!)));
        layer.appendChild(g);
      }
      for (const b of boxes) {
        const { mark } = b;
        const html = document.createElement("span");
        html.className = b.className;
        html.title = mark.title;
        const constraint = mark.overlay.payload?.constraintId;
        if (constraint) html.dataset.constraint = String(constraint);
        const { x, y, width, height } = mark.box;
        const svg = svgEl("svg", { width, height, viewBox: `${x} ${y} ${width} ${height}`, overflow: "visible" });
        svg.appendChild(svgDom(domMark(mark, MARK_IDS), document));
        html.appendChild(svg);
        viewer.addOverlay(b.element, { html, position: b.position, show: b.show, scale: b.scale });
        viewer.addMarker(b.element, b.marker);
        markersRef.current.add(b.marker);
      }
      // Paths follow the level of detail: hidden below their minimum zoom.
      const applyZoom = () => {
        const zoom = viewer.zoom();
        for (const child of Array.from(layer.children)) {
          const min = Number(child.getAttribute("data-min-zoom") ?? 0);
          (child as SVGElement).style.visibility = zoom >= min ? "visible" : "hidden";
        }
      };
      applyZoom();
      return viewer.on("viewbox", applyZoom);
    }, [viewer, status, scene, placed]);

    // The import is reported once the viewer shows it fitted, or cannot show it.
    useEffect(() => {
      if (!imported || importedXml !== xml || announced.current === imported || !settled) return;
      announced.current = imported;
      callbacks.current.onImport?.(imported);
    }, [imported, importedXml, xml, settled]);

    // 6. Controlled selection: applied to the diagram when it differs from what the diagram reported.
    useEffect(() => {
      if (!viewer || viewer !== viewerRef.current || status !== "ready" || props.selection === undefined) return;
      const key = JSON.stringify(props.selection);
      if (key === lastEmitted.current) return;
      const { tasks, flows, lanes } = props.selection;
      lastEmitted.current = key;
      viewer.select(elementsNamed(viewer.elements(), resolver, [...tasks, ...flows, ...lanes]));
    }, [viewer, props.selection, status, elements, resolver]);

    useImperativeHandle(
      ref,
      () => ({
        viewer: () => viewerRef.current?.instance ?? null,
        saveXML: async () => viewerRef.current?.saveXML(),
        saveSVG: async () => viewerRef.current?.saveSVG(),
        fit: () => viewerRef.current?.zoom("fit-viewport"),
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
    const onTableSelect = useCallback(
      (s: Selection) => {
        lastEmitted.current = "";
        dispatch({ type: "select", selection: toTable(toBpmn(s, renamingRef.current)) });
      },
      [dispatch],
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
          {controller.live}
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
              if (viewer) { manualNavigation.current = true; viewer.zoom(Math.min(4, viewer.zoom() * 1.25)); }
            }}>+</button>
            <button type="button" className="wf-button" aria-label={t(locale, "map.zoomOut")} disabled={status !== "ready"} onClick={() => {
              if (viewer) { manualNavigation.current = true; viewer.zoom(Math.max(0.05, viewer.zoom() / 1.25)); }
            }}>−</button>
            <button type="button" className="wf-button" title={t(locale, "bpmn.fit")} aria-label={t(locale, "bpmn.fit")} disabled={status !== "ready"} onClick={() => {
              manualNavigation.current = true; viewer?.zoom("fit-viewport");
            }}>⛶</button>
            <button type="button" className="wf-button" disabled={status !== "ready"} onClick={() => {
              const container = containerRef.current;
              if (!viewer || !container) return;
              manualNavigation.current = true;
              const selected = viewer.selected().find((e) => isTask(e.businessObject));
              const task = selected ?? viewer.elements().find((e) => !e.labelTarget && isTask(e.businessObject));
              if (task && task.x !== undefined && task.y !== undefined) viewer.viewbox({ x: task.x + (task.width ?? 0) / 2 - container.clientWidth / 2, y: task.y + (task.height ?? 0) / 2 - container.clientHeight / 2, width: container.clientWidth, height: container.clientHeight });
              else viewer.zoom(1);
            }}>{t(locale, "bpmn.readable")}</button>
          </div>
        ) : null}
        {legend && view !== "table" ? (
          <div className="wf-bpmn__panel wf-bpmn__panel--bottom-right">
            <Legend scales={scales} legend={scene.legend} locale={locale} chips={legendMarks.length ? legendMarks.map((m) => <MarkFigure key={m.id} mark={m} />) : undefined} />
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
export const BpmnView = createBpmnView(connectBpmnJs);
