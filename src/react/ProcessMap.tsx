import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  useViewport,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type OnNodesChange,
} from "@xyflow/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type AbstractOptions,
  type ElementRef,
  type FlowGraph,
  type Focus,
  type HitItem,
  type MenuAction,
  type MenuTarget,
  type Overlay,
  type OverlayMark,
  type OverlayShape,
  type XY,
  type StringKey,
  activityNodeSize,
  activityReferences,
  addClause,
  arrowheadTokens,
  asFilter,
  coversGraph,
  defaultStyle,
  describeClause,
  describeOverlay,
  focusHighlight,
  lodAt,
  menuTitle,
  relatedToSelection,
  t,
} from "../core/index.js";
import type { MapContext } from "../core/map-controller.js";
import type { DrawState, PreparedScene } from "../canvas/index.js";
import { retainScene } from "../canvas/scene.js";
import { ActivityTooltip } from "./ActivityTooltip.js";
import { AbstractionControls } from "./AbstractionControls.js";
import { CanvasMap, type CanvasMapHandle } from "./CanvasMap.js";
import { ContextMenu } from "./ContextMenu.js";
import { type DispatchedStep, useMapController } from "./controller.js";
import { describeEdge, describeGroup, describeMap, describeNode } from "./describe.js";
import { edgeTypes } from "./edges.js";
import { FilterChips } from "./FilterChips.js";
import { useFlowGraph, useMapScene, usePrefersReducedMotion, useStableLayout } from "./hooks.js";
import { Legend } from "./Legend.js";
import { coverBackground, MarkDefs, MarkFigure } from "./marks.js";
import { nodeTypes } from "./nodes.js";
import { OverlayLayer } from "./OverlayLayer.js";
import { PathList } from "./PathList.js";
import { TableAlternative } from "./TableAlternative.js";
import { type ProcessMapProps, type Selection, type WfEdge, type WfGroupNode, type WfNode } from "./types.js";

const GROUP_PREFIX = "group:";
const DEFAULT_CANVAS_THRESHOLD = 2000;

const NO_MOVES: Readonly<Record<string, XY>> = {};

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
    onContextMenu: onContextMenuProp,
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
  const [manual, setManual] = useState<{ key: ProcessMapProps["layoutResetKey"]; points: Record<string, XY> }>({ key: layoutResetKey, points: {} });
  // Graph overlays and the given ones; the scene keeps those it can place and adds the follows self-loops.
  const sceneOverlays = useMemo(() => (extraOverlays ? [...(shown.overlays ?? []), ...extraOverlays] : undefined), [shown, extraOverlays]);
  const { scene, positions, laidPositions } = useMapScene(shown, needsOwnLayout ? own.positions : givenPositions, manual.key === layoutResetKey ? manual.points : NO_MOVES, {
    overlays: sceneOverlays, style, locale, lanes, activityLabels, selfLoops, lod: props.lod,
  });
  const onNodesChange = useCallback<OnNodesChange<WfNode | WfGroupNode>>((changes) => {
    if (!nodesDraggable || !positions) return;
    const points: Record<string, XY> = {};
    for (const change of changes) {
      if (change.type !== "position" || !change.position) continue;
      const node = shown.nodes.find((n) => n.id === change.id && n.kind === "activity");
      if (!node) continue;
      const parent = node.group ? positions.groups[node.group] : undefined;
      points[node.id] = { x: change.position.x + (parent?.x ?? 0), y: change.position.y + (parent?.y ?? 0) };
    }
    if (!Object.keys(points).length) return;
    if (onNodeMove) for (const [id, point] of Object.entries(points)) onNodeMove(id, point);
    else setManual((previous) => ({ key: layoutResetKey, points: { ...(previous.key === layoutResetKey ? previous.points : {}), ...points } }));
  }, [nodesDraggable, onNodeMove, layoutResetKey, positions, shown]);
  const bands = useMemo(() => new Map(scene.bands.map((b) => [b.id, b])), [scene.bands]);
  const { scales, overlays, geometry } = scene;
  // Marks below the edges are drawn by the element they cover, as its background; boxes above it by the
  // element too, so that they follow it; marks with a path run between elements in the overlay layer.
  const { covers, carried, between } = useMemo(() => {
    const covers = new Map<string, OverlayMark[]>();
    const carried = new Map<string, OverlayMark[]>();
    const between: OverlayMark[] = [];
    const add = (to: Map<string, OverlayMark[]>, m: OverlayMark) => to.set(m.overlay.target, [...(to.get(m.overlay.target) ?? []), m]);
    const known = (id: string) => !!(scene.positions.nodes[id] ?? scene.positions.groups[id]);
    for (const m of scene.marks) {
      if (!m.inMap) continue;
      if (m.path === undefined && known(m.overlay.target)) add(m.layer === "below" ? covers : carried, m);
      else between.push(m);
    }
    return { covers, carried, between };
  }, [scene]);

  const select = useCallback((s: Selection) => void dispatch({ type: "select", selection: s }), [dispatch]);
  const hover = useCallback((id: string | null) => void dispatch({ type: "hover", id }), [dispatch]);
  const setFocus = useCallback((f: Focus | undefined) => dispatch({ type: "setFocus", focus: f }), [dispatch]);
  // An arc selects the pair it joins, any other overlay its target.
  const selectShape = useCallback(
    (shape: OverlayShape) => {
      const { source, target } = shape.overlay.payload ?? {};
      select({ nodes: typeof source === "string" && typeof target === "string" ? [source, target] : [shape.overlay.target], edges: [], groups: [] });
    },
    [select],
  );
  const tooltipId = useId();
  const nodeKinds = useMemo(() => new Map(shown.nodes.map((n) => [n.id, n.kind])), [shown]);
  const pairFromSelection = useMemo<Focus | undefined>(() => {
    if (selection.nodes.length !== 2 || selection.edges.length || selection.groups.length) return undefined;
    const [a, b] = selection.nodes;
    const ok = (id: string) => nodeKinds.get(id) === "activity" || nodeKinds.get(id) === "stage";
    return ok(a) && ok(b) ? [a, b] : undefined;
  }, [selection, nodeKinds]);
  const focus: Focus | undefined = explicitFocus ?? pairFromSelection;
  const focusValid = useMemo(() => {
    if (!focus) return false;
    const has = (id: string) => shown.nodes.some((n) => n.id === id) || (shown.groups ?? []).some((g) => g.id === id);
    return typeof focus === "string" ? has(focus) : has(focus[0]) && has(focus[1]);
  }, [focus, shown]);
  const bright = useMemo(() => {
    if (focus && focusValid) return focusHighlight(shown, focus);
    if (selection.nodes.length || selection.edges.length || selection.groups.length) return relatedToSelection(shown, selection);
    return undefined;
  }, [shown, focus, focusValid, selection]);

  const reducedMotion = usePrefersReducedMotion();
  const rf = useReactFlow();
  const { zoom: rfZoom, x: rfX, y: rfY } = useViewport();
  const [canvasViewport, setCanvasViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const zoom = useCanvas ? canvasViewport.zoom : rfZoom;
  const lod = lodAt(zoom, scene.lod);
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasMapHandle>(null);

  const labelOf = useCallback((id: string) => shown.nodes.find((n) => n.id === id)?.label ?? (shown.groups ?? []).find((g) => g.id === id)?.label ?? id, [shown]);

  // Descriptions
  const overlaysByTarget = useMemo(() => {
    const m = new Map<string, Overlay[]>();
    for (const o of overlays) {
      if (!m.has(o.target)) m.set(o.target, []);
      m.get(o.target)!.push(o);
    }
    return m;
  }, [overlays]);
  const groupIndex = useMemo(() => new Map((shown.groups ?? []).map((g) => [g.id, g])), [shown]);
  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of shown.nodes) if (n.group) m.set(n.group, (m.get(n.group) ?? 0) + 1);
    return m;
  }, [shown]);
  const describeElement = useCallback(
    (ref: ElementRef): string => {
      if (ref.kind === "node") {
        const n = shown.nodes.find((x) => x.id === ref.id);
        return n ? describeNode(n, overlaysByTarget.get(n.id) ?? [], locale, n.group ? groupIndex.get(n.group)?.label : undefined, n.kind === "activity" ? activityLabels : undefined) : ref.id;
      }
      if (ref.kind === "edge") {
        const e = shown.edges.find((x) => x.id === ref.id);
        return e ? describeEdge(e, shown, locale) : ref.id;
      }
      const g = groupIndex.get(ref.id);
      return g ? describeGroup(g, memberCount.get(g.id) ?? 0, overlaysByTarget.get(g.id) ?? [], locale) : ref.id;
    },
    [shown, overlaysByTarget, groupIndex, memberCount, locale, activityLabels],
  );
  const worstOverlay = useCallback(
    (ids: string[]): string | undefined => {
      let best: Overlay | undefined;
      for (const o of overlays) {
        const touches = ids.includes(o.target) || (o.kind === "arc" && (ids.includes(String(o.payload?.source)) || ids.includes(String(o.payload?.target))));
        if (!touches || !o.payload?.constraintId) continue;
        const v = o.payload?.value;
        if (typeof v !== "number") continue;
        if (!best || v > (best.payload?.value as number)) best = o;
      }
      return best ? t(locale, "menu.worst", { text: describeOverlay(best, locale) }) : undefined;
    },
    [overlays, locale],
  );

  // Actions menu
  const allStages = useMemo(() => (graph.groups ?? []).filter((g) => g.kind === "stage" && !g.parent).map((g) => g.id), [graph]);
  const attachRuns = useCallback(
    (actions: MenuAction[], target: MenuTarget): MenuAction[] =>
      actions.map((a) => {
        if (a.run) return a;
        switch (a.id) {
          case "filter-to":
          case "exclude": {
            if (!props.onFilterChange || !a.clause) return a;
            const clauses = Array.isArray(a.clause) ? a.clause : [a.clause];
            return {
              ...a,
              run: () => {
                let f = asFilter(props.filters);
                for (const c of clauses) f = addClause(f, c);
                props.onFilterChange!(f);
                return t(locale, "filters.added", { clause: clauses.map((c) => describeClause(c, locale, labelOf)).join("; ") });
              },
            };
          }
          case "paths":
            // The action announces the sentence for the new focus; while a controlling host has not taken
            // it, the action's own sentence, and the focus sentence follows when the host takes it.
            return {
              ...a,
              run: () => {
                const said = (step: DispatchedStep) => (step.waiting ? undefined : step.announcement);
                if (target.kind === "pair") return said(setFocus([target.ids[0], target.ids[1]]));
                if (target.kind !== "edge") return said(setFocus(target.id));
                const e = shown.edges.find((x) => x.id === target.id);
                return e ? said(setFocus([e.source, e.target])) : undefined;
              },
            };
          case "collapse":
          case "expand":
            return { ...a, run: () => void dispatch({ type: "collapse", group: target.id, collapsed: a.id === "collapse" }) };
          case "clear-focus":
            return { ...a, run: () => void setFocus(undefined) };
          default:
            return a;
        }
      }),
    [props.onFilterChange, props.filters, locale, labelOf, setFocus, shown, dispatch],
  );
  // The host may replace the actions with runs attached, or suppress the menu.
  const menuActions = useCallback(
    (target: MenuTarget, defaults: MenuAction[]): MenuAction[] | false => {
      const actions = attachRuns(defaults, target);
      const custom = onContextMenuProp?.(target, actions);
      return custom === false ? false : Array.isArray(custom) ? custom : actions;
    },
    [attachRuns, onContextMenuProp],
  );
  controller.context.current = { graph: shown, positions, locale, contextMenu, stages: allStages, actions: menuActions } satisfies MapContext;
  const openMenu = useCallback((ref: ElementRef, at: { x: number; y: number }) => void dispatch({ type: "openMenu", element: ref, at }), [dispatch]);
  const menuText = useMemo(() => {
    if (!menu) return undefined;
    const { target } = menu;
    const kindText =
      target.kind === "node"
        ? t(locale, `kind.${target.nodeKind ?? "activity"}` as StringKey)
        : target.kind === "edge"
          ? t(locale, `kind.${target.edgeKind ?? "follows"}` as StringKey)
          : target.kind === "group"
            ? t(locale, `group.${target.groupKind ?? "stage"}` as StringKey)
            : t(locale, "kind.activity");
    const groupId = target.kind === "node" ? shown.nodes.find((n) => n.id === target.id)?.group : undefined;
    const subtitle = `${kindText}${groupId ? ` (${groupIndex.get(groupId)?.label ?? groupId})` : ""}`;
    return { title: menuTitle(target, shown, locale), subtitle, note: worstOverlay(target.ids) };
  }, [menu, shown, locale, groupIndex, worstOverlay]);
  const closeMenu = useCallback(() => void dispatch({ type: "closeMenu" }), [dispatch]);
  const runAction = useCallback(
    (action: MenuAction) => {
      if (!menu) return;
      const fromRun = action.run?.(menu.target);
      const fromHost = props.onAction?.(action, menu.target);
      dispatch({ type: "actionDone", action, text: typeof fromHost === "string" ? fromHost : typeof fromRun === "string" ? fromRun : undefined });
    },
    [menu, props.onAction, dispatch], // eslint-disable-line react-hooks/exhaustive-deps
  );

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

  // React Flow nodes and edges
  const rfNodes = useMemo<(WfNode | WfGroupNode)[]>(() => {
    if (!positions || useCanvas) return [];
    const groups = shown.groups ?? [];
    const groupBox = (id: string) => positions.groups[id];
    const absOffset = (groupId: string | undefined): { x: number; y: number } => {
      const box = groupId ? groupBox(groupId) : undefined;
      return box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
    };
    const out: (WfNode | WfGroupNode)[] = [];
    // Parents first, in nesting order.
    const ordered = [...groups].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
    for (const g of ordered) {
      const box = groupBox(g.id);
      if (!box) continue;
      const parentBox = g.parent ? groupBox(g.parent) : undefined;
      const gOverlays = overlaysByTarget.get(g.id) ?? [];
      const description = describeGroup(g, memberCount.get(g.id) ?? 0, gOverlays, locale);
      out.push({
        id: GROUP_PREFIX + g.id,
        type: "wfGroup",
        position: { x: box.x - (parentBox?.x ?? 0), y: box.y - (parentBox?.y ?? 0) },
        parentId: g.parent && parentBox ? GROUP_PREFIX + g.parent : undefined,
        width: box.width,
        height: box.height,
        draggable: false,
        selectable: true,
        focusable: false,
        selected: selection.groups.includes(g.id),
        zIndex: -1,
        ariaLabel: description,
        data: {
          group: g,
          color: scales.categorical(g.id).color,
          tint: coverBackground(covers.get(g.id) ?? []),
          marks: carried.get(g.id),
          origin: { x: box.x, y: box.y },
          chips: gOverlays.filter((o) => o.kind === "chip"),
          description,
          band: bands.get(g.id),
        },
      });
    }
    for (const mark of scene.nodeMarks) {
      const n = mark.node;
      const box = mark.box;
      const parentGroup = n.group && groupIndex.has(n.group) && groupBox(n.group) ? n.group : undefined;
      const off = absOffset(parentGroup);
      const nOverlays = overlaysByTarget.get(n.id) ?? [];
      const description = describeElement({ kind: "node", id: n.id });
      out.push({
        id: n.id,
        type: n.kind,
        position: { x: box.x - off.x, y: box.y - off.y },
        parentId: parentGroup ? GROUP_PREFIX + parentGroup : undefined,
        width: box.width,
        height: box.height,
        draggable: nodesDraggable === true && n.kind === "activity",
        selected: selection.nodes.includes(n.id),
        // Keep activity copy above ordinary and hovered routes, including grouped graphs.
        zIndex: activityLabels ? 10 : undefined,
        ariaLabel: description,
        data: {
          node: n,
          activityLabels: n.kind === "activity" ? activityLabels : undefined,
          labelWidth: box.width,
          labelHeight: box.height,
          color: mark.color,
          pattern: mark.pattern,
          badges: nOverlays.filter((o) => o.kind === "badge"),
          hatched: nOverlays.some((o) => o.kind === "hatch"),
          tint: coverBackground(covers.get(n.id) ?? []),
          marks: carried.get(n.id),
          origin: { x: box.x, y: box.y },
          direction: positions.direction,
          focused: focused === n.id,
          hovered: hovered === n.id,
          dimmed: !(activityLabels && n.kind === "activity") && !!bright && !bright.nodes.has(n.id),
          locale,
          description,
          mark,
        },
      });
    }
    return out;
  }, [positions, useCanvas, shown, scene, overlaysByTarget, covers, carried, scales, selection, hovered, focused, locale, bright, bands, groupIndex, memberCount, activityLabels, describeElement, nodesDraggable]);

  const rfEdges = useMemo<WfEdge[]>(() => {
    if (!positions || useCanvas) return [];
    return scene.edgeMarks.map((mark) => {
      const e = mark.edge;
      const description = describeEdge(e, shown, locale);
      return {
        id: e.id,
        type: e.kind,
        source: e.source,
        target: e.target,
        selected: selection.edges.includes(e.id),
        ariaLabel: description,
        markerEnd: { type: MarkerType.ArrowClosed, color: mark.color, width: arrowheadTokens.edge.size, height: arrowheadTokens.edge.size, markerUnits: "userSpaceOnUse" },
        zIndex: hovered === e.id || focused === e.id ? 5 : 0,
        data: {
          edge: e,
          route: positions.edges[e.id],
          width: mark.width,
          color: mark.color,
          label: mark.texts[0]?.text,
          reconnected: mark.reconnected,
          hovered: hovered === e.id,
          dimmed: !!bright && !bright.edges.has(e.id),
          focused: focused === e.id,
          description,
          mark,
        },
      };
    });
  }, [positions, useCanvas, shown, scene, selection, hovered, focused, locale, bright]);

  // Canvas scene and its callbacks
  const canvasScene = useMemo<PreparedScene | undefined>(() => (useCanvas && positions ? retainScene(scene) : undefined), [useCanvas, positions, scene]);
  const canvasState = useMemo<DrawState>(() => ({ selection, hovered, focused, bright }), [selection, hovered, focused, bright]);
  const canvasDescendants = useMemo(() => {
    if (!useCanvas) return undefined;
    const list: { id: string; kind: ElementRef["kind"]; description: string }[] = shown.nodes.map((n) => ({ id: n.id, kind: "node" as const, description: describeElement({ kind: "node", id: n.id }) }));
    for (const g of shown.groups ?? []) list.push({ id: g.id, kind: "group" as const, description: describeElement({ kind: "group", id: g.id }) });
    if (focused && shown.edges.some((e) => e.id === focused)) list.push({ id: focused, kind: "edge" as const, description: describeElement({ kind: "edge", id: focused }) });
    return list;
  }, [useCanvas, shown, focused, describeElement]);
  const hitToRef = useCallback(
    (hit: HitItem | undefined): ElementRef | undefined => {
      if (!hit) return undefined;
      if (hit.kind === "overlay") {
        const shape = canvasScene?.shapeById.get(hit.shapeId ?? "");
        const id = shape?.overlay.target ?? hit.id;
        return shown.nodes.some((n) => n.id === id) ? { kind: "node", id } : groupIndex.has(id) ? { kind: "group", id } : undefined;
      }
      return { kind: hit.kind, id: hit.id };
    },
    [canvasScene, shown, groupIndex],
  );
  const describeHit = useCallback(
    (hit: HitItem): string | undefined => {
      if (activityLabels && hit.kind === "node" && nodeKinds.get(hit.id) === "activity") return undefined;
      if (hit.kind === "overlay") {
        const shape = canvasScene?.shapeById.get(hit.shapeId ?? "");
        if (!shape) return undefined;
        const p = shape.overlay.payload;
        return [p?.label, p?.text].filter(Boolean).join(" — ") || describeOverlay(shape.overlay, locale);
      }
      return describeElement({ kind: hit.kind, id: hit.id });
    },
    [canvasScene, describeElement, locale, activityLabels, nodeKinds],
  );
  const onCanvasHover = useCallback((hit: HitItem | null) => hover(hit ? (hit.kind === "overlay" ? (hit.shapeId ?? hit.id) : hit.id) : null), [hover]);
  const onCanvasClick = useCallback(
    (hit: HitItem | undefined, mod: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      const shape = hit?.kind === "overlay" ? canvasScene?.shapeById.get(hit.shapeId ?? "") : undefined;
      if (shape) {
        dispatch({ type: "dismissMenu" });
        selectShape(shape);
        return;
      }
      dispatch({ type: "click", element: hitToRef(hit) ?? null, multi: mod.shiftKey || mod.metaKey || mod.ctrlKey });
    },
    [canvasScene, dispatch, selectShape, hitToRef],
  );
  const onCanvasContextMenu = useCallback(
    (hit: HitItem | undefined, at: { x: number; y: number }) => {
      const ref = hitToRef(hit);
      if (ref) openMenu(ref, at);
      else dispatch({ type: "dismissMenu" });
    },
    [hitToRef, openMenu, dispatch],
  );

  // Fit the view when a new layout arrives: once right after the nodes render and
  // once more after React Flow has measured them (a fit before measurement is a no-op).
  const nodesInitialized = useNodesInitialized();
  const showPaths = pathList && !!focus && focusValid && view === "map";
  const fitPositions = laidPositions;
  const fitKey = fitPositions ? `${fitPositions.engine}:${Object.keys(fitPositions.nodes).length}:${Math.round(fitPositions.bounds.width)}:${Math.round(fitPositions.bounds.height)}:${lanes}:${showPaths ? "side" : "full"}` : "";
  useEffect(() => {
    if (!fitView || !positions || useCanvas) return;
    const options = { padding: 0.08, duration: reducedMotion ? 0 : 200 };
    const handles = [50, 400].map((ms) => window.setTimeout(() => void rf.fitView(options), ms));
    return () => handles.forEach((h) => window.clearTimeout(h));
  }, [fitKey, fitView, nodesInitialized, useCanvas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Interaction (React Flow)
  const bodyPoint = (event: { clientX: number; clientY: number }) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const onNodeClick = useCallback<NodeMouseHandler<WfNode | WfGroupNode>>(
    (event, node) => {
      const element: ElementRef = node.id.startsWith(GROUP_PREFIX) ? { kind: "group", id: node.id.slice(GROUP_PREFIX.length) } : { kind: "node", id: node.id };
      dispatch({ type: "click", element, multi: event.shiftKey || event.metaKey || event.ctrlKey });
    },
    [dispatch],
  );
  const onEdgeClick = useCallback<EdgeMouseHandler<WfEdge>>(
    (event, edge) => void dispatch({ type: "click", element: { kind: "edge", id: edge.id }, multi: event.shiftKey || event.metaKey || event.ctrlKey }),
    [dispatch],
  );
  const onPaneClick = useCallback(() => void dispatch({ type: "click", element: null }), [dispatch]);
  const onNodeContextMenu = useCallback<NodeMouseHandler<WfNode | WfGroupNode>>(
    (event, node) => {
      event.preventDefault();
      const ref: ElementRef = node.id.startsWith(GROUP_PREFIX) ? { kind: "group", id: node.id.slice(GROUP_PREFIX.length) } : { kind: "node", id: node.id };
      openMenu(ref, bodyPoint(event));
    },
    [openMenu],
  );
  const onEdgeContextMenu = useCallback<EdgeMouseHandler<WfEdge>>(
    (event, edge) => {
      event.preventDefault();
      openMenu({ kind: "edge", id: edge.id }, bodyPoint(event));
    },
    [openMenu],
  );
  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    dispatch({ type: "dismissMenu" });
  }, [dispatch]);

  const edgeIndex = useMemo(() => new Map(shown.edges.map((e) => [e.id, e])), [shown]);

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
      rf.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: current, duration: reducedMotion ? 0 : 150 });
    },
    [positions, rf, reducedMotion, useCanvas],
  );
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const step = dispatch({ type: "key", key: e.key, shiftKey: e.shiftKey, altKey: e.altKey });
      if (!step.handled) return;
      e.preventDefault();
      for (const intent of step.intents) {
        if (intent.kind === "reveal") reveal(intent.id);
        else if (intent.kind === "menu") openMenu(intent.element, elementScreenPoint(intent.element));
      }
    },
    [dispatch, reveal, openMenu, elementScreenPoint],
  );

  const tooltipNode = activityLabels && view === "map" ? shown.nodes.find((n) => n.kind === "activity" && n.id === (hovered ?? (hasFocus ? focused : null))) : undefined;
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
  const layoutPending = needsOwnLayout && own.status === "pending";
  const showFilters = props.filters !== undefined || props.onFilterChange !== undefined;
  const activeDescendant = focused ? (edgeIndex.has(focused) ? `wf-edge-${focused}` : `wf-node-${focused}`) : undefined;

  const sidePanel = showPaths ? (
    <div className="wf-process-map__side">
      <PathList graph={shown} focus={focus!} paths={props.paths ?? graph.paths} locale={locale} selection={selection} onSelect={select} onHover={hover} onClose={explicitFocus !== undefined ? () => setFocus(undefined) : undefined} />
    </div>
  ) : null;
  const menuElement = menu ? (
    <ContextMenu x={menu.at.x} y={menu.at.y} title={menuText?.title ?? ""} subtitle={menuText?.subtitle} note={menuText?.note} actions={menu.actions} locale={locale} onAction={runAction} onClose={closeMenu} returnFocusTo={containerRef.current} boundsRef={bodyRef} />
  ) : null;
  const legendElement = legend ? (
    <Legend scales={scales} legend={scene.legend} locale={locale} chips={legendMarks.length ? legendMarks.map((m) => <MarkFigure key={m.id} mark={m} />) : undefined} />
  ) : null;
  const controlsElement = controls ? <AbstractionControls value={abstraction} onChange={setAbstraction} locale={locale} hasStages={hasStages} view={view} onViewChange={setView} /> : null;
  const statusElement = layoutPending ? (
    <div className="wf-panel" role="status">
      …
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
      data-layout-status={needsOwnLayout ? own.status : "given"}
      data-engine={positions?.engine}
      data-renderer={view === "table" ? "table" : useCanvas ? "canvas" : "svg"}
      data-lanes={lanes}
      data-focus={focus ? (typeof focus === "string" ? focus : focus.join("|")) : undefined}
    >
      <p id={descId} className="wf-sr-only">
        {description}
        {useCanvas ? ` ${t(locale, "map.renderer.canvas", { nodes: shown.nodes.length, edges: shown.edges.length })}` : ""}
      </p>
      <p id={liveId} className="wf-sr-only" aria-live="polite" data-testid="wf-live">
        {controller.live}
      </p>
      {showFilters ? <FilterChips filter={props.filters} preview={props.filterPreview} locale={locale} labelOf={labelOf} onFilterChange={props.onFilterChange} onAnnounce={controller.announce} /> : null}
      <div ref={bodyRef} className="wf-process-map__body">
        {view === "table" ? (
          <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 12 }}>
            {controlsElement}
            <TableAlternative graph={shown} overlays={overlays} scales={scales} locale={locale} selection={selection} onSelect={select} />
          </div>
        ) : useCanvas ? (
          <>
            <div className="wf-process-map__main">
              <CanvasMap
                ref={canvasRef}
                scene={canvasScene}
                state={canvasState}
                locale={locale}
                fitKey={fitKey}
                fitView={fitView}
                describe={describeHit}
                onHover={onCanvasHover}
                onClick={onCanvasClick}
                onContextMenu={onCanvasContextMenu}
                onViewportChange={setCanvasViewport}
                descendants={canvasDescendants}
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
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={nodesDraggable === true}
                onNodesChange={onNodesChange}
                nodesConnectable={false}
                elementsSelectable
                selectNodesOnDrag={false}
                onNodeClick={onNodeClick}
                onEdgeClick={onEdgeClick}
                onPaneClick={onPaneClick}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={onEdgeContextMenu}
                onPaneContextMenu={onPaneContextMenu}
                onNodeMouseEnter={(_, n) => hover(n.id.startsWith(GROUP_PREFIX) ? n.id.slice(GROUP_PREFIX.length) : n.id)}
                onNodeMouseLeave={() => hover(null)}
                onEdgeMouseEnter={(_, e) => hover(e.id)}
                onEdgeMouseLeave={() => hover(null)}
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
                <Controls showInteractive={false} />
                {minimap ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}
                {positions ? (
                  <OverlayLayer
                    marks={between}
                    shapes={geometry.shapes}
                    locale={locale}
                    zoom={zoom}
                    hoveredId={hovered}
                    onHover={hover}
                    onSelect={selectShape}
                  />
                ) : null}
                {controlsElement ? <Panel position="top-left">{controlsElement}</Panel> : null}
                {legendElement ? <Panel position="bottom-right">{legendElement}</Panel> : null}
                {statusElement ? <Panel position="top-right">{statusElement}</Panel> : null}
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
