import { type CSSProperties, type ReactNode, forwardRef, useCallback, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { type Box, type FlowGraph, type Insets, type Locale, type LodRules, type Overlay, createPositions, fitViewport, t } from "../core/index.js";
import { connectBpmnJs } from "../bpmn/bpmn-js.js";
import { type BpmnExport, exportBpmn } from "../bpmn/export.js";
import { createIdResolver, renameToActivities } from "../bpmn/ids.js";
import { type BpmnImport, type MappingRow, applyRenaming, importBpmn } from "../bpmn/import.js";
import type { BpmnLayoutOptions } from "../bpmn/layout.js";
import { projectMarks } from "../bpmn/projection.js";
import { type DiagramPositions, type RegistryElement, diagramScene, registryPositions } from "../bpmn/scene.js";
import { type BpmnSelection, type BpmnViewer, type ConnectViewer, elementsNamed, hoverOf, isTask, selectionOf } from "../bpmn/viewer.js";
import type { ActivityRenaming } from "../bpmn/ids.js";
import { useMapController } from "./controller.js";
import { Legend } from "./Legend.js";
import { type MarkIds, MarkFigure, domMark, markDefs, svgDom } from "./marks.js";
import { Button, Panel, ZoomControl, clearOfPanels } from "./primitives.js";
import { TableAlternative } from "./TableAlternative.js";
import type { Selection } from "./types.js";

export type { BpmnSelection } from "../bpmn/viewer.js";

export const emptyBpmnSelection: BpmnSelection = { tasks: [], flows: [], lanes: [] };

export interface BpmnViewHandle {
  /** The bpmn-js instance (viewer or modeler) once created. */
  viewer(): unknown;
  saveXML(): Promise<string | undefined>;
  saveSVG(): Promise<string | undefined>;
  /**
   * Fit the diagram into the view less `insets` (screen pixels kept clear
   * along each side); without them, clear of the panels over the diagram.
   */
  fit(insets?: Partial<Insets>): void;
}

/** The room the fitted diagram leaves around it on each side, relative to its size, and the largest zoom a fit takes (the viewer's own fit stops at 1). */
const BPMN_FIT = { padding: 0.02, maxZoom: 1 };

/** The box of the diagram's shapes and labels in the viewer's registry, if it has any. */
function diagramBounds(elements: RegistryElement[]): Box | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of elements) {
    if (e.waypoints || e.x === undefined || e.y === undefined || !e.width || !e.height) continue;
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + e.width);
    y1 = Math.max(y1, e.y + e.height);
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
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

// The table and the controller name mapped tasks by activity id; selections leave the view in FlowGraph ids.
const toTable = (s: BpmnSelection, renaming: ActivityRenaming | undefined): Selection => ({ nodes: s.tasks.map((id) => renaming?.toMapped(id) ?? id), edges: s.flows, groups: s.lanes });
const toBpmn = (s: Selection, renaming: ActivityRenaming | undefined): BpmnSelection => ({ tasks: s.nodes.map((id) => renaming?.toFlow(id) ?? id), flows: s.edges, lanes: s.groups });

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
    const rootRef = useRef<HTMLDivElement>(null);
    // The diagram fitted inside the view less the insets that keep it clear of the panels over it; with none in the way, the viewer's own fit.
    const fitDiagram = (current: BpmnViewer, insets?: Partial<Insets>) => {
      const container = containerRef.current;
      const root = rootRef.current;
      const bounds = diagramBounds(current.elements());
      const width = container?.clientWidth ?? 0;
      const height = container?.clientHeight ?? 0;
      const clear = container && root && bounds && width > 0 && height > 0 ? (insets ?? clearOfPanels(container, bounds, BPMN_FIT.padding, BPMN_FIT, root)) : undefined;
      if (!clear || !bounds || Object.values(clear).every((v) => !v)) {
        current.zoom("fit-viewport");
        return;
      }
      const v = fitViewport(bounds, { width, height }, { ...BPMN_FIT, insets: clear });
      current.viewbox({ x: -v.x / v.zoom, y: -v.y / v.zoom, width: width / v.zoom, height: height / v.zoom });
    };
    const fitDiagramRef = useRef(fitDiagram);
    fitDiagramRef.current = fitDiagram;
    // The zoom the control shows, read again whenever the viewport changes.
    const [zoomLevel, setZoomLevel] = useState<number>();
    useEffect(() => {
      if (!viewer || status !== "ready") return;
      const read = () => setZoomLevel(viewer.zoom());
      read();
      return viewer.on("viewbox", read);
    }, [viewer, status]);
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
          if (fitRef.current && importedRef.current && !manualNavigation.current) fitDiagramRef.current(current);
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
          if (fitView) fitDiagramRef.current(viewer);
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
    const report = useCallback((s: Selection) => {
      const next = toBpmn(s, renamingRef.current);
      setInnerSelection(next);
      callbacks.current.onSelect?.(next);
    }, []);
    const controller = useMapController({ selection: tableSelection, onSelect: report });
    controller.context.current = { graph: tableGraph ?? NO_GRAPH, locale };
    const { dispatch } = controller;
    diagramSelect.current = (s) => void dispatch({ type: "select", selection: toTable(s, renamingRef.current) });
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
        fit: (insets) => {
          const current = viewerRef.current;
          if (current) fitDiagramRef.current(current, insets);
        },
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
        dispatch({ type: "select", selection: s });
      },
      [dispatch],
    );

    return (
      <div
        ref={rootRef}
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
              <Button pressed={view === "table"} onClick={() => setView(view === "table" ? "diagram" : "table")}>
                {view === "table" ? t(locale, "bpmn.diagram") : t(locale, "bpmn.table")}
              </Button>
            </div>
          </div>
        ) : null}
        {navigation && view !== "table" ? (
          <ZoomControl
            className="wf-bpmn__navigation"
            label={t(locale, "bpmn.navigation")}
            zoom={status === "ready" ? zoomLevel : undefined}
            locale={locale}
            disabled={status !== "ready"}
            onZoomIn={() => {
              if (viewer) { manualNavigation.current = true; viewer.zoom(Math.min(4, viewer.zoom() * 1.25)); }
            }}
            onZoomOut={() => {
              if (viewer) { manualNavigation.current = true; viewer.zoom(Math.max(0.05, viewer.zoom() / 1.25)); }
            }}
            fitLabel={t(locale, "bpmn.fit")}
            onFit={() => {
              manualNavigation.current = true;
              if (viewer) fitDiagram(viewer);
            }}
          >
            <Button icon="readable" label={t(locale, "bpmn.readable")} disabled={status !== "ready"} onClick={() => {
              const container = containerRef.current;
              if (!viewer || !container) return;
              manualNavigation.current = true;
              const selected = viewer.selected().find((e) => isTask(e.businessObject));
              const task = selected ?? viewer.elements().find((e) => !e.labelTarget && isTask(e.businessObject));
              if (task && task.x !== undefined && task.y !== undefined) viewer.viewbox({ x: task.x + (task.width ?? 0) / 2 - container.clientWidth / 2, y: task.y + (task.height ?? 0) / 2 - container.clientHeight / 2, width: container.clientWidth, height: container.clientHeight });
              else viewer.zoom(1);
            }} />
          </ZoomControl>
        ) : null}
        {legend && view !== "table" ? (
          <div className="wf-bpmn__panel wf-bpmn__panel--bottom-right">
            <Legend scales={scales} legend={scene.legend} locale={locale} onAnnounce={controller.announce} chips={legendMarks.length ? legendMarks.map((m) => <MarkFigure key={m.id} mark={m} />) : undefined} />
          </div>
        ) : null}
        {status === "loading" || (status === "idle" && (xml || graph)) ? (
          <Panel part="status" className="wf-bpmn__panel wf-bpmn__panel--top-right" role="status">
            {t(locale, "bpmn.loading")}
          </Panel>
        ) : null}
        {status === "error" ? (
          <Panel part="status" className="wf-bpmn__panel wf-bpmn__panel--top-right" role="alert">
            {t(locale, "bpmn.error")}
          </Panel>
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
