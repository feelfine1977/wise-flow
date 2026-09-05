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
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  type AbstractOptions,
  type FlowGraph,
  type Overlay,
  type OverlayShape,
  type Positions,
  MAP_TARGET,
  RECONNECTED_TAG,
  buildScales,
  canonicalOverlays,
  coversGraph,
  defaultStyle,
  filterPositions,
  formatCompact,
  hasTag,
  hashKey,
  lodAt,
  lodForSize,
  metric,
  overlayGeometry,
  t,
} from "../core/index";
import { AbstractionControls } from "./AbstractionControls";
import { describeEdge, describeGroup, describeMap, describeNode } from "./describe";
import { edgeTypes } from "./edges";
import { useFlowGraph, usePrefersReducedMotion, useStableLayout } from "./hooks";
import { Legend } from "./Legend";
import { Chip, nodeTypes, tintFor } from "./nodes";
import { OverlayLayer } from "./OverlayLayer";
import { TableAlternative } from "./TableAlternative";
import { type ProcessMapProps, type Selection, type WfEdge, type WfGroupNode, type WfNode, emptySelection } from "./types";

const GROUP_PREFIX = "group:";

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

  // Positions: given (stable layout across scenes) when they cover the shown graph,
  // otherwise computed for the shown graph and cached by its element ids.
  const needsOwnLayout = !givenPositions || !coversGraph(givenPositions, shown);
  const ownLayoutOptions = useMemo(
    () => ({ ...(layoutOptions ?? {}), cacheKey: layoutOptions?.cacheKey ?? `wf:${hashKey(shown.nodes.map((n) => n.id).join("|") + "#" + shown.edges.map((e) => e.id).join("|"))}` }),
    [layoutOptions, shown],
  );
  const own = useStableLayout(needsOwnLayout ? shown : undefined, ownLayoutOptions);
  const positions: Positions | undefined = useMemo(() => {
    const source = needsOwnLayout ? own.positions : givenPositions;
    return source ? filterPositions(source, shown) : undefined;
  }, [needsOwnLayout, own.positions, givenPositions, shown]);

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

  // Selection, hover, focus
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
  const reducedMotion = usePrefersReducedMotion();
  const rf = useReactFlow();
  const { zoom } = useViewport();
  const lod = lodAt(zoom, lodRules);

  // React Flow nodes and edges
  const overlaysByTarget = useMemo(() => {
    const m = new Map<string, Overlay[]>();
    for (const o of overlays) {
      if (!m.has(o.target)) m.set(o.target, []);
      m.get(o.target)!.push(o);
    }
    return m;
  }, [overlays]);

  const rfNodes = useMemo<(WfNode | WfGroupNode)[]>(() => {
    if (!positions) return [];
    const groups = shown.groups ?? [];
    const groupBox = (id: string) => positions.groups[id];
    const groupIndex = new Map(groups.map((g) => [g.id, g]));
    const memberCount = new Map<string, number>();
    for (const n of shown.nodes) if (n.group) memberCount.set(n.group, (memberCount.get(n.group) ?? 0) + 1);
    const absOffset = (groupId: string | undefined): { x: number; y: number } => {
      const box = groupId ? groupBox(groupId) : undefined;
      return box ? { x: box.x, y: box.y } : { x: 0, y: 0 };
    };
    const hasSelection = selection.nodes.length > 0 || selection.edges.length > 0;
    const out: (WfNode | WfGroupNode)[] = [];
    // Parents first, in nesting order.
    const ordered = [...groups].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
    for (const g of ordered) {
      const box = groupBox(g.id);
      if (!box) continue;
      const parentBox = g.parent ? groupBox(g.parent) : undefined;
      const gOverlays = overlaysByTarget.get(g.id) ?? [];
      const tint = gOverlays.find((o) => o.kind === "tint");
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
        zIndex: -1,
        ariaLabel: describeGroup(g, memberCount.get(g.id) ?? 0, gOverlays, locale),
        data: {
          group: g,
          color: scales.categorical(g.id).color,
          tint: tintFor(tint?.payload?.value),
          chips: gOverlays.filter((o) => o.kind === "chip"),
          description: describeGroup(g, memberCount.get(g.id) ?? 0, gOverlays, locale),
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
          dimmed: hasSelection && !selection.nodes.includes(n.id) && !selection.edges.some((eid) => shown.edges.find((e) => e.id === eid && (e.source === n.id || e.target === n.id))),
          locale,
          description,
        },
      });
    }
    return out;
  }, [positions, shown, overlaysByTarget, scales, selection, hovered, focused, locale]);

  const rfEdges = useMemo<WfEdge[]>(() => {
    if (!positions) return [];
    const hasSelection = selection.nodes.length > 0 || selection.edges.length > 0;
    return shown.edges
      .filter((e) => e.source !== e.target && positions.nodes[e.source] && positions.nodes[e.target])
      .map((e) => {
        const color = e.kind === "follows" ? scales.edgeColor(e) : "#0072B2";
        const count = metric(e, "count", NaN);
        const related = selection.nodes.includes(e.source) || selection.nodes.includes(e.target) || selection.edges.includes(e.id);
        return {
          id: e.id,
          type: e.kind,
          source: e.source,
          target: e.target,
          selected: selection.edges.includes(e.id),
          ariaLabel: describeEdge(e, shown, locale),
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12, markerUnits: "userSpaceOnUse" },
          zIndex: hovered === e.id ? 5 : 0,
          data: {
            edge: e,
            route: positions.edges[e.id],
            width: scales.edgeWidth(e),
            color,
            label: Number.isFinite(count) ? formatCompact(count, locale) : undefined,
            reconnected: hasTag(e, RECONNECTED_TAG),
            hovered: hovered === e.id,
            dimmed: hasSelection && !related,
            description: describeEdge(e, shown, locale),
          },
        };
      });
  }, [positions, shown, scales, selection, hovered, locale]);

  // Fit the view when a new layout arrives: once right after the nodes render and
  // once more after React Flow has measured them (a fit before measurement is a no-op).
  const nodesInitialized = useNodesInitialized();
  const fitKey = positions ? `${positions.engine}:${Object.keys(positions.nodes).length}:${Math.round(positions.bounds.width)}:${Math.round(positions.bounds.height)}` : "";
  useEffect(() => {
    if (!fitView || !positions) return;
    const options = { padding: 0.08, duration: reducedMotion ? 0 : 200 };
    const handles = [50, 400].map((ms) => window.setTimeout(() => void rf.fitView(options), ms));
    return () => handles.forEach((h) => window.clearTimeout(h));
  }, [fitKey, fitView, nodesInitialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // Interaction
  const onNodeClick = useCallback<NodeMouseHandler<WfNode | WfGroupNode>>(
    (event, node) => {
      if (node.id.startsWith(GROUP_PREFIX)) {
        select({ nodes: [], edges: [], groups: [node.id.slice(GROUP_PREFIX.length)] });
        return;
      }
      const multi = event.shiftKey || event.metaKey || event.ctrlKey;
      const already = selection.nodes.includes(node.id);
      const nodes = multi ? (already ? selection.nodes.filter((id) => id !== node.id) : [...selection.nodes, node.id]) : already && selection.nodes.length === 1 ? [] : [node.id];
      select({ nodes, edges: multi ? selection.edges : [], groups: [] });
      setFocused(node.id);
    },
    [select, selection],
  );
  const onEdgeClick = useCallback<EdgeMouseHandler<WfEdge>>(
    (_event, edge) => {
      const already = selection.edges.includes(edge.id);
      select({ nodes: [], edges: already ? [] : [edge.id], groups: [] });
    },
    [select, selection.edges],
  );
  const onPaneClick = useCallback(() => select(emptySelection), [select]);

  const orderedNodeIds = useMemo(() => {
    if (!positions) return [] as string[];
    return shown.nodes
      .filter((n) => positions.nodes[n.id])
      .sort((a, b) => positions.nodes[a.id].x - positions.nodes[b.id].x || positions.nodes[a.id].y - positions.nodes[b.id].y)
      .map((n) => n.id);
  }, [positions, shown]);

  const focusNode = useCallback(
    (id: string) => {
      setFocused(id);
      const box = positions?.nodes[id];
      if (box) {
        const current = rf.getViewport().zoom;
        rf.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: current, duration: reducedMotion ? 0 : 150 });
      }
    },
    [positions, rf, reducedMotion],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!positions || orderedNodeIds.length === 0) return;
      const current = focused ?? selection.nodes[0] ?? null;
      const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
      if (dir) {
        e.preventDefault();
        if (!current) {
          focusNode(orderedNodeIds[0]);
          return;
        }
        const from = positions.nodes[current];
        const cx = from.x + from.width / 2;
        const cy = from.y + from.height / 2;
        let best: string | null = null;
        let bestScore = Infinity;
        for (const id of orderedNodeIds) {
          if (id === current) continue;
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
        if (best) focusNode(best);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        focusNode(orderedNodeIds[0]);
      } else if (e.key === "End") {
        e.preventDefault();
        focusNode(orderedNodeIds[orderedNodeIds.length - 1]);
      } else if ((e.key === "Enter" || e.key === " ") && current) {
        e.preventDefault();
        const already = selection.nodes.includes(current);
        select({ nodes: already ? [] : [current], edges: [], groups: [] });
      } else if (e.key === "Escape") {
        e.preventDefault();
        select(emptySelection);
        setFocused(null);
      }
    },
    [positions, orderedNodeIds, focused, selection, focusNode, select],
  );

  const descId = useId();
  const liveId = useId();
  const description = useMemo(() => describeMap(shown, overlays, locale), [shown, overlays, locale]);
  const mapChips = overlays.filter((o) => o.kind === "chip" && o.target === MAP_TARGET);
  const selectedLabel = selection.nodes.length === 1 ? shown.nodes.find((n) => n.id === selection.nodes[0])?.label : undefined;
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

  return (
    <div
      className={`wf-process-map ${lodClasses}${className ? ` ${className}` : ""}`}
      style={{ width: "100%", height: "100%", ...containerStyle }}
      role="group"
      aria-label={ariaLabel ?? t(locale, "map.description", { nodes: shown.nodes.length, edges: shown.edges.length, groups: shown.groups?.length ?? 0 })}
      aria-describedby={descId}
      aria-activedescendant={focused ? `wf-node-${focused}` : undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-layout-status={needsOwnLayout ? own.status : "given"}
      data-engine={positions?.engine}
    >
      <p id={descId} className="wf-sr-only">
        {description}
      </p>
      <p id={liveId} className="wf-sr-only" aria-live="polite">
        {selectedLabel ? t(locale, "map.selected", { label: selectedLabel }) : ""}
      </p>
      {view === "table" ? (
        <div style={{ position: "absolute", inset: 0, overflow: "auto", padding: 12 }}>
          {controls ? (
            <AbstractionControls value={abstraction} onChange={setAbstraction} locale={locale} hasStages={hasStages} view={view} onViewChange={setView} />
          ) : null}
          <TableAlternative graph={shown} overlays={overlays} scales={scales} locale={locale} selection={selection} onSelect={select} />
        </div>
      ) : (
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
          {controls ? (
            <Panel position="top-left">
              <AbstractionControls value={abstraction} onChange={setAbstraction} locale={locale} hasStages={hasStages} view={view} onViewChange={setView} />
            </Panel>
          ) : null}
          {legend ? (
            <Panel position="bottom-right">
              <Legend
                scales={scales}
                overlays={overlays}
                locale={locale}
                chips={mapChips.length ? mapChips.map((c, i) => <Chip key={`${c.payload?.constraintId ?? "chip"}-${i}`} chip={c} locale={locale} />) : undefined}
              />
            </Panel>
          ) : null}
          {layoutPending ? (
            <Panel position="top-right">
              <div className="wf-panel" role="status">
                …
              </div>
            </Panel>
          ) : null}
          {own.status === "error" ? (
            <Panel position="top-right">
              <div className="wf-panel" role="alert">
                {own.error?.message}
              </div>
            </Panel>
          ) : null}
          {children}
        </ReactFlow>
      )}
    </div>
  );
}

/**
 * Interactive process map on React Flow: custom nodes per kind, follows and
 * constraint edges, overlay layers, abstraction controls, selection and hover
 * callbacks, keyboard navigation, ARIA descriptions and a table alternative.
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
