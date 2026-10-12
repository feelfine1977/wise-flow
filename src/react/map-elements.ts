/**
 * What the two map renderers are given to draw: React Flow nodes and edges
 * from the scene's marks, or the Canvas map's retained scene with its state
 * and the element list for assistive technology; and the descriptions both
 * read. Rendering only: the interaction state comes from the controller.
 */
import { MarkerType } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { type ActivityLabelOptions, type EdgeBudget, type ElementRef, type FlowGraph, type FlowScene, type GraphIndex, type HitItem, type Locale, type Overlay, type OverlayMark, type Positions, type Selection, arrowheadTokens, budgetEdges, describeOverlay, indexGraph } from "../core/index.js";
import type { DrawState, PreparedScene } from "../canvas/index.js";
import { retainScene } from "../canvas/scene.js";
import { describeIndexedEdge } from "../core/describe.js";
import { FIRST_STEP } from "../core/edge-budget.js";
import { describeGroup, describeNode } from "./describe.js";
import { coverBackground } from "./marks.js";
import { GROUP_PREFIX } from "./map-pointer.js";
import type { WfEdge, WfGroupNode, WfNode } from "./types.js";

type Bright = { nodes: Set<string>; edges: Set<string> } | undefined;

/** ARIA descriptions of the shown elements, read through one index of the shown graph. */
export function useElementDescriptions(shown: FlowGraph, overlays: Overlay[], locale: Locale, activityLabels: ActivityLabelOptions | undefined) {
  // Descriptions
  const overlaysByTarget = useMemo(() => {
    const m = new Map<string, Overlay[]>();
    for (const o of overlays) {
      if (!m.has(o.target)) m.set(o.target, []);
      m.get(o.target)!.push(o);
    }
    return m;
  }, [overlays]);
  const index = useMemo(() => indexGraph(shown), [shown]);
  const groupIndex = index.groups;
  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of shown.nodes) if (n.group) m.set(n.group, (m.get(n.group) ?? 0) + 1);
    return m;
  }, [shown]);
  const describeElement = useCallback(
    (ref: ElementRef): string => {
      if (ref.kind === "node") {
        const n = index.nodes.get(ref.id);
        return n ? describeNode(n, overlaysByTarget.get(n.id) ?? [], locale, n.group ? groupIndex.get(n.group)?.label : undefined, n.kind === "activity" ? activityLabels : undefined) : ref.id;
      }
      if (ref.kind === "edge") {
        const e = index.edges.get(ref.id);
        return e ? describeIndexedEdge(e, index, locale) : ref.id;
      }
      const g = groupIndex.get(ref.id);
      return g ? describeGroup(g, memberCount.get(g.id) ?? 0, overlaysByTarget.get(g.id) ?? [], locale) : ref.id;
    },
    [index, overlaysByTarget, groupIndex, memberCount, locale, activityLabels],
  );
  return { describeElement, index, overlaysByTarget, groupIndex, memberCount };
}

type ElementDescriptions = ReturnType<typeof useElementDescriptions>;

interface FlowInput {
  /** React Flow draws the map; otherwise nothing is built. */
  enabled: boolean;
  scene: FlowScene;
  graph: FlowGraph;
  positions: Positions | undefined;
  descriptions: ElementDescriptions;
  selection: Selection;
  hovered: string | null;
  focused: string | null;
  bright: Bright;
  locale: Locale;
  activityLabels: ActivityLabelOptions | undefined;
  nodesDraggable: boolean;
  edgeBudget?: EdgeBudget | "adaptive";
  /** Edges on a highlighted path. */
  highlighted?: ReadonlySet<string>;
}

/** React Flow nodes (groups first, as parents) and edges, and the overlay marks drawn between elements. */
export function useFlowElements(input: FlowInput) {
  const { enabled, scene, graph: shown, positions, descriptions, selection, hovered, focused, bright, locale, activityLabels, nodesDraggable, edgeBudget, highlighted } = input;
  const { overlaysByTarget, groupIndex, memberCount, describeElement, index } = descriptions;
  const { scales } = scene;
  const bands = useMemo(() => new Map(scene.bands.map((b) => [b.id, b])), [scene.bands]);
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

  const rfNodes = useMemo<(WfNode | WfGroupNode)[]>(() => {
    if (!positions || !enabled) return [];
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
  }, [positions, enabled, shown, scene, overlaysByTarget, covers, carried, scales, selection, hovered, focused, locale, bright, bands, groupIndex, memberCount, activityLabels, describeElement, nodesDraggable]);

  // Every edge of the scene is in view of React Flow; with no frame to time, adaptive keeps its first step.
  const withheld = useMemo(() => (enabled ? budgetEdges(scene, edgeBudget === "adaptive" ? FIRST_STEP : edgeBudget, { selection, focused, highlighted }) : undefined), [enabled, scene, edgeBudget, selection, focused, highlighted]);
  const rfEdges = useMemo<WfEdge[]>(() => {
    if (!positions || !enabled) return [];
    return (withheld ? scene.edgeMarks.filter((_, i) => withheld.drawn.has(i)) : scene.edgeMarks).map((mark) => {
      const e = mark.edge;
      const description = describeIndexedEdge(e, index, locale);
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
  }, [positions, enabled, scene, index, selection, hovered, focused, locale, bright, withheld]);
  return { nodes: rfNodes, edges: rfEdges, between, withheld };
}

interface CanvasInput {
  /** The Canvas map draws the map; otherwise nothing is built. */
  enabled: boolean;
  scene: FlowScene;
  graph: FlowGraph;
  positions: Positions | undefined;
  descriptions: Pick<ElementDescriptions, "describeElement" | "index">;
  selection: Selection;
  hovered: string | null;
  focused: string | null;
  bright: Bright;
  locale: Locale;
  activityLabels: ActivityLabelOptions | undefined;
  /** Edges on a highlighted path. */
  highlighted?: ReadonlySet<string>;
  /** Activities plus groups above which the element list holds only the neighbourhood of the keyboard position. */
  limit?: number;
}

/**
 * The elements listed around `at` (a node or an edge), at most `limit`: an
 * edge, its ends, or the node; their groups; then the predecessors and
 * successors of the node or the ends, in the order of their paths.
 */
function neighbourhood(index: GraphIndex, at: string, limit: number): ElementRef[] {
  const out: ElementRef[] = [];
  const seen = new Set<string>();
  const add = (kind: ElementRef["kind"], id: string) => {
    const key = `${kind}:${id}`;
    if (out.length < limit && !seen.has(key)) {
      seen.add(key);
      out.push({ kind, id });
    }
  };
  const edge = index.edges.get(at);
  const centres = (edge ? [edge.source, edge.target] : [at]).filter((id) => index.nodes.has(id));
  if (edge) add("edge", edge.id);
  for (const id of centres) add("node", id);
  for (const id of centres) {
    const group = index.nodes.get(id)!.group;
    if (group && index.groups.has(group)) add("group", group);
  }
  for (const id of centres) {
    for (const e of index.incoming.get(id) ?? []) if (index.nodes.has(e.source)) add("node", e.source);
    for (const e of index.outgoing.get(id) ?? []) if (index.nodes.has(e.target)) add("node", e.target);
  }
  return out;
}

/** The activity Home goes to: the first node with a box, left to right and top to bottom. */
export function firstInReadingOrder(graph: FlowGraph, positions: Positions | undefined): string | undefined {
  let first: string | undefined;
  for (const n of graph.nodes) {
    const b = positions?.nodes[n.id];
    const f = first === undefined ? undefined : positions!.nodes[first];
    if (b && (!f || b.x < f.x || (b.x === f.x && b.y < f.y))) first = n.id;
  }
  return first;
}

/** The elements listed for assistive technology: all nodes, groups and the focused edge, or above the limit a neighbourhood. */
export function listedElements(shown: FlowGraph, index: GraphIndex, focused: string | null, selected: string | undefined, limit: number, home: string | undefined): ElementRef[] {
  if (shown.nodes.length + (shown.groups?.length ?? 0) > limit) {
    const centre = [focused, selected, home].find((id): id is string => id != null && (index.nodes.has(id) || index.edges.has(id)));
    return centre === undefined ? [] : neighbourhood(index, centre, limit);
  }
  const list: ElementRef[] = shown.nodes.map((n) => ({ kind: "node", id: n.id }));
  for (const g of shown.groups ?? []) list.push({ kind: "group", id: g.id });
  if (focused && index.edges.has(focused)) list.push({ kind: "edge", id: focused });
  return list;
}

/** The Canvas map's retained scene, its draw state, its element list and its tooltip texts. */
export function useCanvasElements(input: CanvasInput) {
  const { enabled, scene, graph: shown, positions, descriptions, selection, hovered, focused, bright, locale, activityLabels, highlighted, limit = Infinity } = input;
  const { describeElement, index } = descriptions;
  const canvasScene = useMemo<PreparedScene | undefined>(() => (enabled && positions ? retainScene(scene) : undefined), [enabled, positions, scene]);
  const canvasState = useMemo<DrawState>(() => ({ selection, hovered, focused, bright, highlighted }), [selection, hovered, focused, bright, highlighted]);
  const bounded = enabled && shown.nodes.length + (shown.groups?.length ?? 0) > limit;
  // Above the limit the list follows the keyboard: its element, else the activity it starts from.
  const home = useMemo(() => (bounded ? firstInReadingOrder(shown, positions) : undefined), [bounded, shown, positions]);
  const at = bounded || (focused && index.edges.has(focused)) ? focused : null;
  const selected = bounded ? selection.nodes[0] : undefined;
  const canvasDescendants = useMemo(
    () => (enabled ? listedElements(shown, index, at, selected, limit, home).map((ref) => ({ ...ref, description: describeElement(ref) })) : undefined),
    [enabled, shown, index, at, selected, limit, home, describeElement],
  );
  const describeHit = useCallback(
    (hit: HitItem): string | undefined => {
      if (activityLabels && hit.kind === "node" && index.nodes.get(hit.id)?.kind === "activity") return undefined;
      if (hit.kind === "overlay") {
        const shape = canvasScene?.shapeById.get(hit.shapeId ?? "");
        if (!shape) return undefined;
        const p = shape.overlay.payload;
        return [p?.label, p?.text].filter(Boolean).join(" — ") || describeOverlay(shape.overlay, locale);
      }
      return describeElement({ kind: hit.kind, id: hit.id });
    },
    [canvasScene, describeElement, locale, activityLabels, index],
  );
  return { scene: canvasScene, state: canvasState, descendants: canvasDescendants, describe: describeHit, bounded };
}
