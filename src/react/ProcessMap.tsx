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
  type OverlayShape,
  type Positions,
  type StringKey,
  MAP_TARGET,
  RECONNECTED_TAG,
  addClause,
  asFilter,
  buildScales,
  canonicalOverlays,
  coversGraph,
  defaultActions,
  defaultStyle,
  describeClause,
  describeOverlay,
  describeSelection,
  filterPositions,
  focusHighlight,
  formatCompact,
  hasTag,
  hashKey,
  laneBands,
  lodAt,
  lodForSize,
  menuTargetFor,
  menuTitle,
  metric,
  overlayGeometry,
  relatedToSelection,
  selectElement,
  t,
} from "../core/index";
import { type DrawState, type PreparedScene, prepareScene } from "../canvas/index";
import { AbstractionControls } from "./AbstractionControls";
import { CanvasMap, type CanvasMapHandle } from "./CanvasMap";
import { ContextMenu } from "./ContextMenu";
import { describeEdge, describeGroup, describeMap, describeNode } from "./describe";
import { edgeTypes } from "./edges";
import { FilterChips } from "./FilterChips";
import { useFlowGraph, usePrefersReducedMotion, useStableLayout } from "./hooks";
import { Legend } from "./Legend";
import { Chip, nodeTypes, tintFor } from "./nodes";
import { OverlayLayer } from "./OverlayLayer";
import { PathList } from "./PathList";
import { TableAlternative } from "./TableAlternative";
import { type ProcessMapProps, type Selection, type WfEdge, type WfGroupNode, type WfNode, emptySelection } from "./types";

const GROUP_PREFIX = "group:";
const DEFAULT_CANVAS_THRESHOLD = 2000;

function selfLoopOverlays(graph: FlowGraph): Overlay[] {
  const out: Overlay[] = [];
  const maxCount = Math.max(1, ...graph.edges.filter((e) => e.kind === "follows").map((e) => metric(e, "count", 0)));
  for (const e of graph.edges) {
    if (e.kind !== "follows" || e.source !== e.target) continue;
    const count = metric(e, "count", NaN);
    const cases = metric(e, "cases", NaN);
    const nodeCases = metric(graph.nodes.find((n) => n.id === e.source), "cases", NaN);
    const share = Number.isFinite(cases) && Number.isFinite(nodeCases) && nodeCases > 0 ? cases / nodeCases : Number.isFinite(count) ? count / maxCount : undefined;
    out.push({
      kind: "selfLoop",
      target: e.source,
      payload: { label: e.id, value: share, text: Number.isFinite(count) ? `${formatCompact(count)} ×` : undefined, edgeId: e.id },
    });
  }
  return out;
}

interface MenuState {
  target: MenuTarget;
  actions: MenuAction[];
  x: number;
  y: number;
  title: string;
  subtitle?: string;
  note?: string;
}

function toggleCollapse(current: AbstractOptions["collapse"], groupId: string, allStages: string[], collapse: boolean): AbstractOptions["collapse"] {
  const list = current === "all" ? allStages : Array.isArray(current) ? current : [];
  const next = collapse ? (list.includes(groupId) ? list : [...list, groupId]) : list.filter((id) => id !== groupId);
  return next.length === 0 ? false : next;
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
    onSelect,
    onHover,
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
    canvasThreshold = DEFAULT_CANVAS_THRESHOLD,
    onContextMenu: onContextMenuProp,
    children,
  } = props;

  // Abstraction (controlled or internal)
  const [innerAbstraction, setInnerAbstraction] = useState<AbstractOptions>(props.defaultAbstraction ?? {});
  const abstraction = props.abstraction ?? innerAbstraction;
  const setAbstraction = useCallback(
    (a: AbstractOptions) => {
      if (props.abstraction === undefined) setInnerAbstraction(a);
      props.onAbstractionChange?.(a);
    },
    [props.abstraction, props.onAbstractionChange], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [innerView, setInnerView] = useState<"map" | "table">("map");
  const view = props.view ?? innerView;
  const setView = (v: "map" | "table") => {
    if (props.view === undefined) setInnerView(v);
    props.onViewChange?.(v);
  };

  // Graph pipeline: collapse first (own layout), then thresholds (filter positions).
  const collapseOnly = useMemo<AbstractOptions | undefined>(
    () => (abstraction.collapse ? { collapse: abstraction.collapse, keepConnected: false } : undefined),
    [abstraction.collapse],
  );
  const baseGraph = useFlowGraph(graph, collapseOnly);
  const shown = useFlowGraph(baseGraph, { ...abstraction, collapse: false });
  const useCanvas = renderer === "canvas" || (renderer === "auto" && shown.nodes.length + shown.edges.length > canvasThreshold);

  // Positions: given (stable layout across scenes) when they cover the shown graph,
  // otherwise computed for the shown graph and cached by its element ids. Lane
  // bands replace the group boxes (and move nodes into role lanes) afterwards.
  const needsOwnLayout = !givenPositions || !coversGraph(givenPositions, shown);
  const ownLayoutOptions = useMemo(
    () => ({ ...(layoutOptions ?? {}), cacheKey: layoutOptions?.cacheKey ?? `wf:${hashKey(shown.nodes.map((n) => n.id).join("|") + "#" + shown.edges.map((e) => e.id).join("|"))}` }),
    [layoutOptions, shown],
  );
  const own = useStableLayout(needsOwnLayout ? shown : undefined, ownLayoutOptions);
  const laid = useMemo(() => {
    const source = needsOwnLayout ? own.positions : givenPositions;
    if (!source) return undefined;
    return laneBands(shown, filterPositions(source, shown), { lanes });
  }, [needsOwnLayout, own.positions, givenPositions, shown, lanes]);
  const positions: Positions | undefined = laid?.positions;
  const bands = useMemo(() => new Map((laid?.bands ?? []).map((b) => [b.id, b])), [laid]);

  const scales = useMemo(() => buildScales(shown, style), [shown, style]);
  const overlays = useMemo(() => {
    const known = new Set([...shown.nodes.map((n) => n.id), ...(shown.groups ?? []).map((g) => g.id), MAP_TARGET]);
    const list = [...(shown.overlays ?? []), ...(extraOverlays ?? [])].filter(
      (o) => known.has(o.target) || (o.kind === "arc" && known.has(String(o.payload?.source)) && known.has(String(o.payload?.target))),
    );
    return canonicalOverlays(selfLoops ? [...list, ...selfLoopOverlays(shown)] : list);
  }, [shown, extraOverlays, selfLoops]);

  const lodRules = useMemo(() => lodForSize(shown.nodes.length, { ...(style.lod ?? {}), ...(props.lod ?? {}) }), [shown.nodes.length, style.lod, props.lod]);
  const geometry = useMemo(() => (positions ? overlayGeometry(overlays, positions, { lod: lodRules }) : undefined), [overlays, positions, lodRules]);

  // Selection, hover, keyboard focus, paths focus
  const [innerSelection, setInnerSelection] = useState<Selection>(emptySelection);
  const selection = props.selection ?? innerSelection;
  const select = useCallback(
    (s: Selection) => {
      if (props.selection === undefined) setInnerSelection(s);
      onSelect?.(s);
    },
    [props.selection, onSelect],
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const hover = useCallback(
    (id: string | null) => {
      setHovered(id);
      onHover?.(id);
    },
    [onHover],
  );
  const [focused, setFocused] = useState<string | null>(null);
  const [innerFocus, setInnerFocus] = useState<Focus | undefined>(props.defaultFocus);
  const explicitFocus: Focus | undefined = props.focus === undefined ? innerFocus : (props.focus ?? undefined);
  const setFocus = useCallback(
    (f: Focus | undefined) => {
      if (props.focus === undefined) setInnerFocus(f);
      props.onFocusChange?.(f);
    },
    [props.focus, props.onFocusChange], // eslint-disable-line react-hooks/exhaustive-deps
  );
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
  const { zoom: rfZoom } = useViewport();
  const [canvasZoom, setCanvasZoom] = useState(1);
  const zoom = useCanvas ? canvasZoom : rfZoom;
  const lod = lodAt(zoom, lodRules);
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<CanvasMapHandle>(null);

  // Live region
  const [live, setLive] = useState("");
  const announce = useCallback((text: string) => setLive(text), []);
  const selectionKey = JSON.stringify(selection);
  const firstSelection = useRef(true);
  const menuRef = useRef<MenuState | null>(null);
  useEffect(() => {
    if (firstSelection.current) {
      firstSelection.current = false;
      return;
    }
    // A menu that opened in the same step has announced the selection already.
    if (menuRef.current) return;
    setLive(describeSelection(shown, selection, locale));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);
  useEffect(() => {
    if (props.announce) setLive(props.announce);
  }, [props.announce]);
  const labelOf = useCallback((id: string) => shown.nodes.find((n) => n.id === id)?.label ?? (shown.groups ?? []).find((g) => g.id === id)?.label ?? id, [shown]);
  const explicitFocusKey = JSON.stringify(explicitFocus ?? null);
  useEffect(() => {
    if (!explicitFocus) return;
    setLive(typeof explicitFocus === "string" ? t(locale, "map.focus", { label: labelOf(explicitFocus) }) : t(locale, "map.focusPair", { a: labelOf(explicitFocus[0]), b: labelOf(explicitFocus[1]) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explicitFocusKey]);

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
        return n ? describeNode(n, overlaysByTarget.get(n.id) ?? [], locale, n.group ? groupIndex.get(n.group)?.label : undefined) : ref.id;
      }
      if (ref.kind === "edge") {
        const e = shown.edges.find((x) => x.id === ref.id);
        return e ? describeEdge(e, shown, locale) : ref.id;
      }
      const g = groupIndex.get(ref.id);
      return g ? describeGroup(g, memberCount.get(g.id) ?? 0, overlaysByTarget.get(g.id) ?? [], locale) : ref.id;
    },
    [shown, overlaysByTarget, groupIndex, memberCount, locale],
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
  const [menu, setMenu] = useState<MenuState | null>(null);
  menuRef.current = menu;
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
            return {
              ...a,
              run: () => {
                if (target.kind === "pair") setFocus([target.ids[0], target.ids[1]]);
                else if (target.kind === "edge") {
                  const e = shown.edges.find((x) => x.id === target.id);
                  if (e) setFocus([e.source, e.target]);
                } else setFocus(target.id);
                return undefined;
              },
            };
          case "collapse":
            return { ...a, run: () => void setAbstraction({ ...abstraction, collapse: toggleCollapse(abstraction.collapse, target.id, allStages, true) }) };
          case "expand":
            return { ...a, run: () => void setAbstraction({ ...abstraction, collapse: toggleCollapse(abstraction.collapse, target.id, allStages, false) }) };
          case "clear-focus":
            return { ...a, run: () => void setFocus(undefined) };
          default:
            return a;
        }
      }),
    [props.onFilterChange, props.filters, locale, labelOf, setFocus, shown, setAbstraction, abstraction, allStages],
  );
  const openMenu = useCallback(
    (ref: ElementRef, at: { x: number; y: number }) => {
      if (!contextMenu) return;
      // The element joins the selection unless it is part of the multi-selection already.
      const inSelection = ref.kind === "node" ? selection.nodes.includes(ref.id) : ref.kind === "edge" ? selection.edges.includes(ref.id) : selection.groups.includes(ref.id);
      const effective = inSelection ? selection : selectElement(emptySelection, ref, "add");
      if (!inSelection) select(effective);
      const target = menuTargetFor(shown, ref, effective);
      const collapsed = ref.kind === "group" && (abstraction.collapse === "all" || (Array.isArray(abstraction.collapse) && abstraction.collapse.includes(ref.id)));
      let actions = attachRuns(defaultActions(shown, target, locale, { collapsed, hasFocus: explicitFocus !== undefined }), target);
      const custom = onContextMenuProp?.(target, actions);
      if (custom === false) return;
      if (Array.isArray(custom)) actions = custom;
      if (actions.length === 0) return;
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
      setMenu({ target, actions, x: at.x, y: at.y, title: menuTitle(target, shown, locale), subtitle, note: worstOverlay(target.ids) });
      const opened = t(locale, "menu.opened", { label: target.label, count: actions.length });
      setLive(inSelection ? opened : `${describeSelection(shown, effective, locale)} ${opened}`);
    },
    [contextMenu, selection, select, shown, abstraction.collapse, attachRuns, locale, explicitFocus, onContextMenuProp, groupIndex, worstOverlay],
  );
  const closeMenu = useCallback(() => {
    setMenu(null);
    setLive(t(locale, "menu.closed"));
  }, [locale]);
  const runAction = useCallback(
    (action: MenuAction) => {
      if (!menu) return;
      const fromRun = action.run?.(menu.target);
      const fromHost = props.onAction?.(action, menu.target);
      setMenu(null);
      setLive(typeof fromHost === "string" ? fromHost : typeof fromRun === "string" ? fromRun : t(locale, "menu.announce", { action: action.label, target: menu.target.label }));
    },
    [menu, props.onAction, locale], // eslint-disable-line react-hooks/exhaustive-deps
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
      const tint = gOverlays.find((o) => o.kind === "tint");
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
          tint: tintFor(tint?.payload?.value),
          chips: gOverlays.filter((o) => o.kind === "chip"),
          description,
          band: bands.get(g.id),
        },
      });
    }
    for (const n of shown.nodes) {
      const box = positions.nodes[n.id];
      if (!box) continue;
      const parentGroup = n.group && groupIndex.has(n.group) && groupBox(n.group) ? n.group : undefined;
      const off = absOffset(parentGroup);
      const nOverlays = overlaysByTarget.get(n.id) ?? [];
      const description = describeNode(n, nOverlays, locale, n.group ? groupIndex.get(n.group)?.label : undefined);
      out.push({
        id: n.id,
        type: n.kind,
        position: { x: box.x - off.x, y: box.y - off.y },
        parentId: parentGroup ? GROUP_PREFIX + parentGroup : undefined,
        width: box.width,
        height: box.height,
        draggable: false,
        selected: selection.nodes.includes(n.id),
        ariaLabel: description,
        data: {
          node: n,
          color: scales.nodeColor(n),
          pattern: scales.nodePattern(n),
          badges: nOverlays.filter((o) => o.kind === "badge"),
          hatched: nOverlays.some((o) => o.kind === "hatch"),
          direction: positions.direction,
          focused: focused === n.id,
          hovered: hovered === n.id,
          dimmed: !!bright && !bright.nodes.has(n.id),
          locale,
          description,
        },
      });
    }
    return out;
  }, [positions, useCanvas, shown, overlaysByTarget, scales, selection, hovered, focused, locale, bright, bands, groupIndex, memberCount]);

  const rfEdges = useMemo<WfEdge[]>(() => {
    if (!positions || useCanvas) return [];
    return shown.edges
      .filter((e) => e.source !== e.target && positions.nodes[e.source] && positions.nodes[e.target])
      .map((e) => {
        const color = e.kind === "constraint" ? "#0072B2" : scales.edgeColor(e);
        const count = metric(e, "count", NaN);
        const description = describeEdge(e, shown, locale);
        return {
          id: e.id,
          type: e.kind,
          source: e.source,
          target: e.target,
          selected: selection.edges.includes(e.id),
          ariaLabel: description,
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12, markerUnits: "userSpaceOnUse" },
          zIndex: hovered === e.id || focused === e.id ? 5 : 0,
          data: {
            edge: e,
            route: positions.edges[e.id],
            width: scales.edgeWidth(e),
            color,
            label: Number.isFinite(count) ? formatCompact(count, locale) : undefined,
            reconnected: hasTag(e, RECONNECTED_TAG),
            hovered: hovered === e.id,
            dimmed: !!bright && !bright.edges.has(e.id),
            focused: focused === e.id,
            description,
          },
        };
      });
  }, [positions, useCanvas, shown, scales, selection, hovered, focused, locale, bright]);

  // Canvas scene and its callbacks
  const canvasScene = useMemo<PreparedScene | undefined>(() => {
    if (!useCanvas || !positions) return undefined;
    return prepareScene(shown, positions, { style, overlays, selfLoops: false, lod: props.lod, locale, bands: laid?.bands ?? [] });
  }, [useCanvas, positions, shown, style, overlays, props.lod, locale, laid]);
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
      if (hit.kind === "overlay") {
        const shape = canvasScene?.shapeById.get(hit.shapeId ?? "");
        if (!shape) return undefined;
        const p = shape.overlay.payload;
        return [p?.label, p?.text].filter(Boolean).join(" — ") || describeOverlay(shape.overlay, locale);
      }
      return describeElement({ kind: hit.kind, id: hit.id });
    },
    [canvasScene, describeElement, locale],
  );
  const onCanvasHover = useCallback((hit: HitItem | null) => hover(hit ? (hit.kind === "overlay" ? (hit.shapeId ?? hit.id) : hit.id) : null), [hover]);
  const onCanvasClick = useCallback(
    (hit: HitItem | undefined, mod: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => {
      if (menu) setMenu(null);
      const shape = hit?.kind === "overlay" ? canvasScene?.shapeById.get(hit.shapeId ?? "") : undefined;
      if (shape) {
        const src = shape.overlay.payload?.source;
        const tgt = shape.overlay.payload?.target;
        if (typeof src === "string" && typeof tgt === "string") select({ nodes: [src, tgt], edges: [], groups: [] });
        else select({ nodes: [shape.overlay.target], edges: [], groups: [] });
        return;
      }
      const ref = hitToRef(hit);
      if (!ref) {
        select(emptySelection);
        return;
      }
      const multi = mod.shiftKey || mod.metaKey || mod.ctrlKey;
      select(selectElement(selection, ref, multi ? "toggle" : "replace"));
      if (ref.kind === "node") setFocused(ref.id);
    },
    [menu, canvasScene, select, hitToRef, selection],
  );
  const onCanvasContextMenu = useCallback(
    (hit: HitItem | undefined, at: { x: number; y: number }) => {
      const ref = hitToRef(hit);
      if (!ref) {
        setMenu(null);
        return;
      }
      openMenu(ref, at);
    },
    [hitToRef, openMenu],
  );

  // Fit the view when a new layout arrives: once right after the nodes render and
  // once more after React Flow has measured them (a fit before measurement is a no-op).
  const nodesInitialized = useNodesInitialized();
  const showPaths = pathList && !!focus && focusValid && view === "map";
  const fitKey = positions ? `${positions.engine}:${Object.keys(positions.nodes).length}:${Math.round(positions.bounds.width)}:${Math.round(positions.bounds.height)}:${lanes}:${showPaths ? "side" : "full"}` : "";
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
      if (menu) setMenu(null);
      if (node.id.startsWith(GROUP_PREFIX)) {
        select(selectElement(selection, { kind: "group", id: node.id.slice(GROUP_PREFIX.length) }, "replace"));
        return;
      }
      const multi = event.shiftKey || event.metaKey || event.ctrlKey;
      select(selectElement(selection, { kind: "node", id: node.id }, multi ? "toggle" : "replace"));
      setFocused(node.id);
    },
    [select, selection, menu],
  );
  const onEdgeClick = useCallback<EdgeMouseHandler<WfEdge>>(
    (event, edge) => {
      if (menu) setMenu(null);
      const multi = event.shiftKey || event.metaKey || event.ctrlKey;
      select(selectElement(selection, { kind: "edge", id: edge.id }, multi ? "toggle" : "replace"));
    },
    [select, selection, menu],
  );
  const onPaneClick = useCallback(() => {
    setMenu(null);
    select(emptySelection);
  }, [select]);
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
    setMenu(null);
  }, []);

  const orderedNodeIds = useMemo(() => {
    if (!positions) return [] as string[];
    return shown.nodes
      .filter((n) => positions.nodes[n.id])
      .sort((a, b) => positions.nodes[a.id].x - positions.nodes[b.id].x || positions.nodes[a.id].y - positions.nodes[b.id].y)
      .map((n) => n.id);
  }, [positions, shown]);
  const edgeIndex = useMemo(() => new Map(shown.edges.map((e) => [e.id, e])), [shown]);

  const focusNode = useCallback(
    (id: string) => {
      setFocused(id);
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
  const edgeCycle = useRef(new Map<string, number>());

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (menu) return;
      if (!positions || orderedNodeIds.length === 0) return;
      const focusedEdge = focused && edgeIndex.has(focused) ? edgeIndex.get(focused) : undefined;
      const current = focusedEdge ? null : (focused ?? selection.nodes[0] ?? null);
      const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
      if (dir && e.altKey) {
        // Along the paths: from a node to one of its paths, from a path to its other end.
        e.preventDefault();
        const forward = dir[0] > 0 || dir[1] > 0;
        if (focusedEdge) {
          focusNode(forward ? focusedEdge.target : focusedEdge.source);
          return;
        }
        if (!current) {
          focusNode(orderedNodeIds[0]);
          return;
        }
        const list = shown.edges.filter((x) => x.kind !== "constraint" && x.source !== x.target && positions.nodes[x.source] && positions.nodes[x.target] && (forward ? x.source === current : x.target === current));
        if (!list.length) return;
        const key = `${current}:${forward ? "out" : "in"}`;
        const index = ((edgeCycle.current.get(key) ?? -1) + 1) % list.length;
        edgeCycle.current.set(key, index);
        setFocused(list[index].id);
        setLive(t(locale, "map.focused", { label: describeEdge(list[index], shown, locale) }));
        return;
      }
      if (dir) {
        e.preventDefault();
        const start = current ?? focusedEdge?.target ?? null;
        const from = start ? positions.nodes[start] : undefined;
        if (!start || !from) {
          focusNode(orderedNodeIds[0]);
          return;
        }
        const cx = from.x + from.width / 2;
        const cy = from.y + from.height / 2;
        let best: string | null = null;
        let bestScore = Infinity;
        for (const id of orderedNodeIds) {
          if (id === start) continue;
          const b = positions.nodes[id];
          const dx = b.x + b.width / 2 - cx;
          const dy = b.y + b.height / 2 - cy;
          const along = dx * dir[0] + dy * dir[1];
          if (along <= 0) continue;
          const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
          const score = along + 2 * across;
          if (score < bestScore) {
            bestScore = score;
            best = id;
          }
        }
        if (best) {
          focusNode(best);
          if (e.shiftKey) select(selectElement(selection, { kind: "node", id: best }, "add"));
        }
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        focusNode(orderedNodeIds[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        focusNode(orderedNodeIds[orderedNodeIds.length - 1]);
      } else if (e.key === " " && (current || focusedEdge)) {
        e.preventDefault();
        const ref: ElementRef = focusedEdge ? { kind: "edge", id: focusedEdge.id } : { kind: "node", id: current! };
        select(selectElement(selection, ref, "toggle"));
      } else if (e.key === "Enter" && (current || focusedEdge)) {
        e.preventDefault();
        const ref: ElementRef = focusedEdge ? { kind: "edge", id: focusedEdge.id } : { kind: "node", id: current! };
        if (!contextMenu) {
          select(selectElement(selection, ref, "toggle"));
          return;
        }
        openMenu(ref, elementScreenPoint(ref));
      } else if (e.key === "Escape") {
        e.preventDefault();
        select(emptySelection);
        setFocused(null);
        if (explicitFocus !== undefined) setFocus(undefined);
      }
    },
    [menu, positions, orderedNodeIds, focused, edgeIndex, selection, focusNode, select, shown, locale, contextMenu, openMenu, elementScreenPoint, explicitFocus, setFocus],
  );

  const descId = useId();
  const liveId = useId();
  const description = useMemo(() => describeMap(shown, overlays, locale), [shown, overlays, locale]);
  const mapChips = overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET);
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
    <ContextMenu x={menu.x} y={menu.y} title={menu.title} subtitle={menu.subtitle} note={menu.note} actions={menu.actions} locale={locale} onAction={runAction} onClose={closeMenu} returnFocusTo={containerRef.current} boundsRef={bodyRef} />
  ) : null;
  const legendElement = legend ? (
    <Legend scales={scales} overlays={overlays} locale={locale} chips={mapChips.length ? mapChips.map((c, i) => <Chip key={`${c.payload?.constraintId ?? "chip"}-${i}`} chip={c} locale={locale} />) : undefined} />
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
        {live}
      </p>
      {showFilters ? <FilterChips filter={props.filters} preview={props.filterPreview} locale={locale} labelOf={labelOf} onFilterChange={props.onFilterChange} onAnnounce={announce} /> : null}
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
                onViewportChange={(v) => setCanvasZoom(v.zoom)}
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
                nodesDraggable={false}
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
                <Controls showInteractive={false} />
                {minimap ? <MiniMap pannable zoomable nodeStrokeWidth={2} /> : null}
                {geometry ? (
                  <OverlayLayer
                    shapes={geometry.shapes}
                    locale={locale}
                    showArcs={lod.arcs}
                    showSelfLoops={lod.selfLoops}
                    hoveredId={hovered}
                    onHover={hover}
                    onSelect={(s: OverlayShape) => {
                      const src = s.overlay.payload?.source;
                      const tgt = s.overlay.payload?.target;
                      if (typeof src === "string" && typeof tgt === "string") select({ nodes: [src, tgt], edges: [], groups: [] });
                      else select({ nodes: [s.overlay.target], edges: [], groups: [] });
                    }}
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
