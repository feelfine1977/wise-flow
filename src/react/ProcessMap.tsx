import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useStore,
  useStoreApi,
  useViewport,
  type OnNodesChange,
} from "@xyflow/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type AbstractOptions, type ElementRef, type FlowGraph, type Positions, type XY, LayoutUnavailableError, activityNodeSize, activityReferences, coversGraph, defaultStyle, formatCount, lodAt, t } from "../core/index.js";
import { type MapContext, mapEmphasis, menuHeading } from "../core/map-controller.js";
import { ActivityTooltip } from "./ActivityTooltip.js";
import { AbstractionControls } from "./AbstractionControls.js";
import { CanvasMap, type CanvasMapHandle, EdgeNote } from "./CanvasMap.js";
import { MenuView } from "./ContextMenu.js";
import { type MapScreen, useMapController } from "./controller.js";
import { describeMap } from "./describe.js";
import { edgeTypes } from "./edges.js";
import { FilterChips } from "./FilterChips.js";
import { useArrival, useEdgesShown, useEdgesShownAcross, useFlowGraph, useMapScene, usePrefersReducedMotion, useStableLayout } from "./hooks.js";
import { Legend } from "./Legend.js";
import { useMenuActions } from "./map-actions.js";
import { useCanvasElements, useElementDescriptions, useFlowElements } from "./map-elements.js";
import { GROUP_PREFIX, canvasPointer, flowPointer, overlayPointer } from "./map-pointer.js";
import { MarkDefs, MarkFigure } from "./marks.js";
import { nodeTypes } from "./nodes.js";
import { OverlayLayer } from "./OverlayLayer.js";
import { PathList } from "./PathList.js";
import { TableAlternative } from "./TableAlternative.js";
import { type ProcessMapProps, type Selection, type WfEdge, type WfGroupNode, type WfNode } from "./types.js";

const DEFAULT_CANVAS_THRESHOLD = 2000;
const DEFAULT_DESCRIBED_LIMIT = 500;
const TABLE_PAGE_SIZE = 100;

const NO_MOVES: Readonly<Record<string, XY>> = {};

interface View {
  x: number;
  y: number;
  zoom: number;
}

/** The node drawn nearest the centre of a view, with its centre and the view; `to` is the layout it holds the view for. */
interface Anchor {
  id: string;
  centre: XY;
  view: View;
  to?: Positions;
}

const centreOf = (b: { x: number; y: number; width: number; height: number }): XY => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

function anchorAt(drawn: Positions | undefined, view: View & { width: number; height: number }): Anchor | undefined {
  const middle = { x: (view.width / 2 - view.x) / view.zoom, y: (view.height / 2 - view.y) / view.zoom };
  let anchor: Anchor | undefined;
  let nearest = Infinity;
  for (const [id, box] of Object.entries(drawn?.nodes ?? {})) {
    const centre = centreOf(box);
    const d = (centre.x - middle.x) ** 2 + (centre.y - middle.y) ** 2;
    if (d >= nearest) continue;
    nearest = d;
    anchor = { id, centre, view: { x: view.x, y: view.y, zoom: view.zoom } };
  }
  return anchor;
}

/** Inner component; needs the React Flow provider for viewport hooks. */
function ProcessMapInner(props: ProcessMapProps) {
  const {
    graph,
    positions: givenPositions,
    overlays: extraOverlays,
    style = defaultStyle,
    controls = true,
    legend = true,
    minimap = false,
    locale = "en",
    layout: layoutOptions,
    selfLoops = true,
    ariaLabel,
    className,
    containerStyle,
    fitView = true,
    lanes = "none",
    pathList = true,
    contextMenu = true,
    renderer = "auto",
    nodesDraggable = false,
    onNodeMove,
    layoutResetKey,
    canvasThreshold = DEFAULT_CANVAS_THRESHOLD,
    describedLimit = DEFAULT_DESCRIBED_LIMIT,
    edgeBudget = "adaptive",
    children,
  } = props;

  const activityLabels = useMemo(() => props.activityLabels ? {
    ...props.activityLabels, references: activityReferences(graph, props.activityLabels.references),
  } : undefined, [graph, props.activityLabels]);
  const sizedLayoutOptions = useMemo(() => activityLabels && !layoutOptions?.nodeSize ? {
    ...layoutOptions, nodeSize: (node: FlowGraph["nodes"][number]) => activityNodeSize(node, activityLabels),
  } : layoutOptions, [layoutOptions, activityLabels]);

  // Selection, focus of paths, abstraction and view (each controlled or internal), keyboard position,
  // hover, the actions menu and the live region: the core's map controller.
  const controller = useMapController(props);
  const { dispatch } = controller;
  const { abstraction, view, selection, hovered, active: focused, focusWithin: hasFocus, menu, focus: explicitFocus } = controller.state;
  const setAbstraction = useCallback((a: AbstractOptions) => void dispatch({ type: "setAbstraction", abstraction: a }), [dispatch]);
  const setView = (v: "map" | "table") => void dispatch({ type: "setView", view: v });

  // Graph pipeline: collapse first (own layout), then thresholds (filter positions).
  const collapseOnly = useMemo<AbstractOptions | undefined>(
    () => (abstraction.collapse ? { collapse: abstraction.collapse, keepConnected: false } : undefined),
    [abstraction.collapse],
  );
  const baseGraph = useFlowGraph(graph, collapseOnly);
  const shown = useFlowGraph(baseGraph, { ...abstraction, collapse: false });
  const useCanvas = renderer === "canvas" || (renderer === "auto" && shown.nodes.length + shown.edges.length > canvasThreshold);

  // Positions: given (stable layout across scenes) when they cover the shown graph,
  // otherwise computed for the shown graph; the layout module keeps them by their
  // inputs for as long as the map is mounted. Lane bands replace the group boxes
  // (and move nodes into role lanes) afterwards.
  const needsOwnLayout = !givenPositions || !coversGraph(givenPositions, shown);
  const own = useStableLayout(needsOwnLayout ? shown : undefined, sizedLayoutOptions);
  // A provisional arrangement is drawn until the layout arrives (given positions from
  // `useStableLayout` say so too); the layout then moves into its place.
  const provisional = needsOwnLayout ? own.provisional : givenPositions?.engine === "provisional";
  const reducedMotion = usePrefersReducedMotion();
  const target = needsOwnLayout ? own.positions : givenPositions;
  const arrival = useArrival(target, provisional, reducedMotion);
  // Without a refined layout the provisional arrangement stays, and the map says so.
  const unavailable = needsOwnLayout && own.error instanceof LayoutUnavailableError;
  const arranging = (provisional && !unavailable) || arrival.moving;
  const notice = arranging ? t(locale, "map.arranging") : unavailable ? t(locale, "map.layoutUnavailable") : undefined;
  const [manual, setManual] = useState<{ key: ProcessMapProps["layoutResetKey"]; points: Record<string, XY> }>({ key: layoutResetKey, points: {} });
  // Graph overlays and the given ones; the scene keeps those it can place and adds the follows self-loops.
  const sceneOverlays = useMemo(() => (extraOverlays ? [...(shown.overlays ?? []), ...extraOverlays] : undefined), [shown, extraOverlays]);
  const { scene, positions, laidPositions } = useMapScene(shown, arrival.positions, manual.key === layoutResetKey ? manual.points : NO_MOVES, {
    overlays: sceneOverlays, style, locale, lanes, activityLabels, selfLoops, lod: props.lod,
  });
  const { scales, overlays, geometry } = scene;
  // One index of the shown graph: every description, label and lookup by id reads it.
  const descriptions = useElementDescriptions(shown, overlays, locale, activityLabels);
  const { describeElement, index } = descriptions;
  const labelOf = index.label;
  const onNodesChange = useCallback<OnNodesChange<WfNode | WfGroupNode>>((changes) => {
    if (!nodesDraggable || !positions) return;
    const points: Record<string, XY> = {};
    for (const change of changes) {
      if (change.type !== "position" || !change.position) continue;
      const node = index.nodes.get(change.id);
      if (node?.kind !== "activity") continue;
      const parent = node.group ? positions.groups[node.group] : undefined;
      points[node.id] = { x: change.position.x + (parent?.x ?? 0), y: change.position.y + (parent?.y ?? 0) };
    }
    if (!Object.keys(points).length) return;
    if (onNodeMove) for (const [id, point] of Object.entries(points)) onNodeMove(id, point);
    else setManual((previous) => ({ key: layoutResetKey, points: { ...(previous.key === layoutResetKey ? previous.points : {}), ...points } }));
  }, [nodesDraggable, onNodeMove, layoutResetKey, positions, index]);
  const select = useCallback((s: Selection) => void dispatch({ type: "select", selection: s }), [dispatch]);
  const hover = useCallback((id: string | null) => void dispatch({ type: "hover", id }), [dispatch]);
  const tooltipId = useId();
  // The focus of paths in effect and what stays bright: the controller's.
  const { focus, focusShown, bright } = useMemo(() => mapEmphasis({ selection, focus: explicitFocus }, shown), [selection, explicitFocus, shown]);
  // The edges of a focus of paths stay drawn under the edge budget.
  const highlighted = focusShown ? bright?.edges : undefined;

  const rf = useReactFlow();
  const flowStore = useStoreApi();
  const { zoom: rfZoom, x: rfX, y: rfY } = useViewport();
  const [canvasViewport, setCanvasViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const zoom = useCanvas ? canvasViewport.zoom : rfZoom;
  const lod = lodAt(zoom, scene.lod);
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasMapHandle>(null);

  // Actions menu
  const allStages = useMemo(() => (graph.groups ?? []).filter((g) => g.kind === "stage" && !g.parent).map((g) => g.id), [graph]);
  const menuActions = useMenuActions(props, shown, labelOf, dispatch);
  controller.context.current = { graph: shown, positions, locale, contextMenu, stages: allStages, actions: menuActions } satisfies MapContext;
  const menuText = useMemo(() => (menu ? menuHeading(menu.target, shown, overlays, locale) : undefined), [menu, shown, overlays, locale]);

  // Screen position of an element relative to the map body (for the keyboard-opened menu).
  const elementScreenPoint = useCallback(
    (ref: ElementRef): { x: number; y: number } => {
      const body = bodyRef.current?.getBoundingClientRect();
      const fallback = { x: (body?.width ?? 0) / 2, y: (body?.height ?? 0) / 2 };
      if (useCanvas) {
        const b = canvasRef.current?.screenBox(ref.id);
        return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : fallback;
      }
      const box = ref.kind === "edge" ? undefined : ref.kind === "group" ? positions?.groups[ref.id] : positions?.nodes[ref.id];
      const route = ref.kind === "edge" ? positions?.edges[ref.id]?.points : undefined;
      const centre = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : route && route.length ? route[Math.floor(route.length / 2)] : undefined;
      if (!centre) return fallback;
      const p = rf.flowToScreenPosition(centre);
      return { x: p.x - (body?.left ?? 0), y: p.y - (body?.top ?? 0) };
    },
    [useCanvas, positions, rf],
  );

  // React Flow nodes and edges, or the Canvas scene, its state and the elements listed for assistive technology.
  const flow = useFlowElements({ enabled: !useCanvas, scene, graph: shown, positions, descriptions, selection, hovered, focused, bright, locale, activityLabels, nodesDraggable, edgeBudget, highlighted });
  // The Canvas map reports the edges it draws itself.
  const tellShown = useEdgesShownAcross(props.onEdgesShown, useCanvas, view !== "table");
  const reportShown = useEdgesShown(useCanvas ? undefined : tellShown);
  // A host that starts listening is told what the map withholds.
  const listening = !!tellShown;
  useEffect(() => reportShown(flow.withheld, scene.edgeMarks), [flow.withheld, scene, reportShown, listening]);
  // React Flow draws new nodes a commit later; until then the layout is not in place.
  const laidBy = useRef(new WeakMap<object, Positions | undefined>()).current;
  laidBy.set(flow.nodes, laidPositions);
  const flowBehind = useStore((s) => view !== "table" && !useCanvas && laidBy.get(s.nodes) !== laidPositions);
  const canvas = useCanvasElements({ enabled: useCanvas, scene, graph: shown, positions, descriptions, selection, hovered, focused, bright, locale, activityLabels, highlighted, limit: describedLimit });
  const largeTable = shown.nodes.length + (shown.groups?.length ?? 0) > describedLimit;
  // A bounded element list says so, with the totals the table view lists.
  const bounded = canvas.bounded ? t(locale, "map.described.bounded", { nodes: formatCount(shown.nodes.length, locale), edges: formatCount(shown.edges.length, locale) }) : undefined;
  const { announce } = controller;
  useEffect(() => {
    if (bounded) announce(bounded);
  }, [bounded, announce]);
  const canvasScene = canvas.scene;
  const canvasHandlers = useMemo(() => canvasPointer(dispatch, canvasScene?.shapeById, shown), [dispatch, canvasScene, shown]);

  // Fit the view when a new layout arrives: once right after the nodes render and
  // once more after React Flow has measured them (a fit before measurement is a no-op).
  // A layout that replaces a provisional arrangement is fitted too, unless the user moved
  // the view since it was fitted (or `fitView` is off): then the zoom stays and so does the
  // node at the centre of the view while the layout moves in.
  const nodesInitialized = useNodesInitialized();
  const showPaths = pathList && !!focus && focusShown && view === "map";
  const laidKey = laidPositions ? `${laidPositions.engine}:${Object.keys(laidPositions.nodes).length}:${Math.round(laidPositions.bounds.width)}:${Math.round(laidPositions.bounds.height)}:${lanes}:${showPaths ? "side" : "full"}` : "";
  // The user moved the React Flow view since it was last fitted (the Canvas map knows this itself).
  const moved = useRef(false);
  const drawn = useRef(positions);
  useLayoutEffect(() => void (drawn.current = positions), [positions]);
  const [fit, setFit] = useState<{ key: string; laid: string; count: number; anchor?: Anchor; hold?: boolean }>({ key: laidKey, laid: laidKey, count: 0 });
  if (fit.count !== arrival.count) {
    const r = canvasRef.current?.renderer();
    const { transform: [x, y, zoom], width, height } = flowStore.getState();
    const rect = r?.canvas.getBoundingClientRect();
    const current = useCanvas ? r && { ...r.getViewport(), width: rect!.width, height: rect!.height } : { x, y, zoom, width, height };
    const keep = !fitView || (useCanvas ? canvasRef.current?.moved() : moved.current);
    const anchor = current && keep ? anchorAt(drawn.current, current) : undefined;
    setFit({ ...fit, count: arrival.count, anchor: anchor && { ...anchor, to: target }, hold: !!anchor });
  } else if (!arrival.moving && fit.laid !== laidKey) {
    setFit({ key: fit.hold ? fit.key : laidKey, laid: laidKey, count: fit.count, anchor: fit.hold ? fit.anchor : undefined });
  }
  const fitKey = fit.key;
  // A fit React Flow still holds queued would replace the view the user chose at its next node update.
  const userMove = () => {
    moved.current = true;
    flowStore.setState({ fitViewQueued: false });
  };
  const { anchor } = fit;
  useLayoutEffect(() => {
    const box = anchor && positions?.nodes[anchor.id];
    if (!anchor || !box || (!arrival.moving && arrival.positions !== anchor.to)) return;
    const { centre, view: v } = anchor;
    const next = { x: v.x + (centre.x - centreOf(box).x) * v.zoom, y: v.y + (centre.y - centreOf(box).y) * v.zoom, zoom: v.zoom };
    if (useCanvas) {
      canvasRef.current?.renderer()?.setViewport(next);
      return;
    }
    // A fit React Flow still holds queued would run on the moved nodes and replace this view.
    flowStore.setState({ fitViewQueued: false });
    void rf.setViewport(next);
  }, [anchor, arrival.positions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fitView || !positions || useCanvas || anchor) return;
    const options = { padding: 0.08, duration: reducedMotion ? 0 : 200 };
    const handles = [50, 400].map((ms) => window.setTimeout(() => {
      moved.current = false;
      void rf.fitView(options);
    }, ms));
    return () => handles.forEach((h) => window.clearTimeout(h));
  }, [fitKey, fitView, nodesInitialized, useCanvas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer interaction (React Flow); positions relative to the map body.
  const flowHandlers = useMemo(() => flowPointer(dispatch, (event) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }), [dispatch]);
  const overlayHandlers = useMemo(() => overlayPointer(dispatch), [dispatch]);

  // Bring a node the keyboard moved to into view.
  const reveal = useCallback(
    (id: string) => {
      const box = positions?.nodes[id];
      if (!box) return;
      if (useCanvas) {
        canvasRef.current?.centerOn(id);
        return;
      }
      const current = rf.getViewport().zoom;
      moved.current = true;
      rf.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: current, duration: reducedMotion ? 0 : 150 });
    },
    [positions, rf, reducedMotion, useCanvas],
  );
  controller.screen.current = { reveal, place: elementScreenPoint, focus: () => containerRef.current?.focus() } satisfies MapScreen;
  // Keys on the map and in its menu; Escape that closes the menu goes no further. The table view's keys are
  // the table's (its rows, search field and pages, where no menu is shown); Escape from a row clears, as on the map.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (view === "table" && (e.key !== "Escape" || (e.target as Element).tagName === "INPUT")) return;
      const step = dispatch({ type: "key", key: e.key, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey });
      if (step.handled) e.preventDefault();
      if (e.key === "Escape" && step.intents.some((i) => i.kind === "returnFocus")) e.stopPropagation();
    },
    [dispatch, view],
  );

  const tooltipTarget = hovered ?? (hasFocus ? focused : null);
  const tooltipHit = tooltipTarget === null ? undefined : index.nodes.get(tooltipTarget);
  const tooltipNode = activityLabels && view === "map" && tooltipHit?.kind === "activity" ? tooltipHit : undefined;
  const tooltipAnchor = useCallback((id: string) => {
    const viewport = useCanvas ? canvasViewport : { x: rfX, y: rfY, zoom: rfZoom };
    const box = positions?.nodes[id];
    // Both viewport transforms are relative to the map main area, whose top-left
    // coincides with the body. Do not mix page/client coordinates with CSS pixels.
    const point = box ? { x: viewport.x + (box.x + box.width / 2) * viewport.zoom, y: viewport.y + (box.y + box.height / 2) * viewport.zoom } : elementScreenPoint({ kind: "node", id });
    const height = (box?.height ?? 0) * viewport.zoom;
    return { x: point.x + 12, y: point.y + height / 2 + 8, above: point.y - height / 2 - 8 };
  }, [elementScreenPoint, useCanvas, positions, rfZoom, rfX, rfY, canvasViewport]);

  const descId = useId();
  const liveId = useId();
  const description = useMemo(() => describeMap(shown, overlays, locale), [shown, overlays, locale]);
  const legendMarks = scene.marks.filter((m) => !m.inMap);
  const lodClasses = [
    lod.labels ? "wf-lod--labels" : "",
    lod.edgeLabels ? "wf-lod--edge-labels" : "",
    lod.badges ? "wf-lod--badges" : "",
    lod.chips ? "wf-lod--chips" : "",
    lod.hatch ? "wf-lod--hatch" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const hasStages = (baseGraph.groups ?? []).some((g) => g.kind === "stage") || !!abstraction.collapse;
  const showFilters = props.filters !== undefined || props.onFilterChange !== undefined;
  const activeDescendant = focused ? (index.edges.has(focused) ? `wf-edge-${focused}` : `wf-node-${focused}`) : undefined;

  const sidePanel = showPaths ? (
    <div className="wf-process-map__side">
      <PathList graph={shown} focus={focus!} paths={props.paths ?? graph.paths} locale={locale} selection={selection} onSelect={select} onHover={hover} onClose={explicitFocus !== undefined ? () => void dispatch({ type: "setFocus", focus: undefined }) : undefined} />
    </div>
  ) : null;
  const menuElement = menu ? (
    <MenuView
      x={menu.at.x}
      y={menu.at.y}
      title={menuText?.title ?? ""}
      subtitle={menuText?.subtitle}
      note={menuText?.note}
      actions={menu.actions}
      active={menu.active}
      locale={locale}
      onPoint={(index) => void dispatch({ type: "pointMenu", index })}
      onChoose={(index) => void dispatch({ type: "chooseMenu", index })}
      onClose={() => void dispatch({ type: "closeMenu" })}
      boundsRef={bodyRef}
    />
  ) : null;
  const legendElement = legend ? (
    <Legend scales={scales} legend={scene.legend} locale={locale} chips={legendMarks.length ? legendMarks.map((m) => <MarkFigure key={m.id} mark={m} />) : undefined} />
  ) : null;
  const controlsElement = controls ? <AbstractionControls value={abstraction} onChange={setAbstraction} locale={locale} hasStages={hasStages} view={view} onViewChange={setView} /> : null;
  const statusElement = notice ? (
    <div className="wf-panel" role="status">
      {notice}
    </div>
  ) : own.status === "error" ? (
    <div className="wf-panel" role="alert">
      {own.error?.message}
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      className={`wf-process-map ${lodClasses}${showPaths ? " wf-process-map--side" : ""}${className ? ` ${className}` : ""}`}
      style={{ width: "100%", height: "100%", ...containerStyle }}
      role="group"
      aria-label={ariaLabel ?? t(locale, "map.description", { nodes: shown.nodes.length, edges: shown.edges.length, groups: shown.groups?.length ?? 0 })}
      aria-describedby={descId}
      aria-activedescendant={activeDescendant}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocusCapture={(event) => void dispatch({ type: "focusIn", id: (event.target as HTMLElement).closest?.(".react-flow__node")?.getAttribute("data-id") ?? undefined })}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dispatch({ type: "focusOut" }); }}
      data-activity-labels={activityLabels?.mode}
      data-layout-status={arranging || (needsOwnLayout && flowBehind) ? "pending" : needsOwnLayout ? own.status : "given"}
      data-engine={positions?.engine}
      data-renderer={view === "table" ? "table" : useCanvas ? "canvas" : "svg"}
      data-lanes={lanes}
      data-focus={focus ? (typeof focus === "string" ? focus : focus.join("|")) : undefined}
    >
      <p id={descId} className="wf-sr-only">
        {description}
        {useCanvas ? ` ${t(locale, "map.renderer.canvas", { nodes: shown.nodes.length, edges: shown.edges.length })}` : ""}
        {bounded ? ` ${bounded}` : ""}
        {notice ? ` ${notice}` : ""}
      </p>
      <p id={liveId} className="wf-sr-only" aria-live="polite" data-testid="wf-live">
        {controller.live}
      </p>
      {showFilters ? <FilterChips filter={props.filters} preview={props.filterPreview} locale={locale} labelOf={labelOf} onFilterChange={props.onFilterChange} onAnnounce={controller.announce} /> : null}
      <div ref={bodyRef} className="wf-process-map__body">
        {view === "table" ? (
          <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 12 }}>
            {controlsElement}
            <TableAlternative graph={shown} overlays={overlays} scales={scales} locale={locale} selection={selection} onSelect={select} pageSize={largeTable ? TABLE_PAGE_SIZE : undefined} />
          </div>
        ) : useCanvas ? (
          <>
            <div className="wf-process-map__main">
              <CanvasMap
                ref={canvasRef}
                scene={canvasScene}
                state={canvas.state}
                locale={locale}
                fitKey={fitKey}
                fitView={fitView}
                describe={canvas.describe}
                {...canvasHandlers}
                onViewportChange={setCanvasViewport}
                descendants={canvas.descendants}
                edgeBudget={edgeBudget}
                onAnnounce={announce}
                onEdgesShown={tellShown}
              >
                {controlsElement ? <div className="wf-overlay-panel wf-overlay-panel--top-left">{controlsElement}</div> : null}
                {legendElement ? <div className="wf-overlay-panel wf-overlay-panel--bottom-right">{legendElement}</div> : null}
                {statusElement ? <div className="wf-overlay-panel wf-overlay-panel--top-right">{statusElement}</div> : null}
                {children}
              </CanvasMap>
            </div>
            {sidePanel}
            {menuElement}
          </>
        ) : (
          <>
            <div className="wf-process-map__main">
              <ReactFlow<WfNode | WfGroupNode, WfEdge>
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={nodesDraggable === true}
                onNodesChange={onNodesChange}
                nodesConnectable={false}
                elementsSelectable
                selectNodesOnDrag={false}
                {...flowHandlers}
                onMoveStart={(event) => event && userMove()}
                minZoom={0.05}
                maxZoom={3}
                panOnScroll
                zoomOnScroll={false}
                zoomOnPinch
                fitView={false}
                proOptions={{ hideAttribution: false }}
                nodesFocusable
                edgesFocusable
                disableKeyboardA11y
                defaultEdgeOptions={{ type: "follows" }}
              >
                <Background gap={24} size={1} />
                <MarkDefs />
                <Controls showInteractive={false} onZoomIn={userMove} onZoomOut={userMove} onFitView={() => void (moved.current = false)} />
                {minimap ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}
                {positions ? (
                  <OverlayLayer
                    marks={flow.between}
                    shapes={geometry.shapes}
                    locale={locale}
                    zoom={zoom}
                    hoveredId={hovered}
                    {...overlayHandlers}
                  />
                ) : null}
                {controlsElement ? <Panel position="top-left">{controlsElement}</Panel> : null}
                {legendElement ? <Panel position="bottom-right">{legendElement}</Panel> : null}
                {statusElement ? <Panel position="top-right">{statusElement}</Panel> : null}
                {flow.withheld ? (
                  <Panel position="bottom-center">
                    <EdgeNote withheld={flow.withheld} locale={locale} onAnnounce={announce} />
                  </Panel>
                ) : null}
                {children}
              </ReactFlow>
            </div>
            {sidePanel}
            {menuElement}
          </>
        )}
        {activityLabels ? <ActivityTooltip id={tooltipId} node={tooltipNode} description={tooltipNode ? describeElement({ kind: "node", id: tooltipNode.id }) : ""} anchor={tooltipAnchor} /> : null}
      </div>
    </div>
  );
}

/**
 * Interactive process map: React Flow for maps of ordinary size, the Canvas
 * renderer above a threshold; custom nodes per kind, follows and constraint
 * edges, overlay layers, abstraction controls, legend, lanes, selection and
 * hover callbacks, an actions menu, paths of a focused activity with a side
 * list, filter chips, keyboard navigation, ARIA descriptions and a table
 * alternative.
 */
export function ProcessMap(props: ProcessMapProps) {
  return (
    <ReactFlowProvider>
      <ProcessMapInner {...props} />
    </ReactFlowProvider>
  );
}

/** The id React Flow uses for the compound node of a group. */
export function groupNodeId(groupId: string): string {
  return GROUP_PREFIX + groupId;
}
