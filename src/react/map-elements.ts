/**
 * What the two map renderers are given to draw: React Flow nodes and edges
 * from the scene's marks, or the Canvas map's retained scene with its state
 * and the element list for assistive technology; and the descriptions both
 * read. Rendering only: the interaction state comes from the controller.
 */
import { MarkerType } from "@xyflow/react";
import { useCallback, useMemo } from "react";
import { type ActivityLabelOptions, type ElementRef, type FlowGraph, type HitItem, type Locale, type Overlay, type OverlayMark, type Positions, type Selection, arrowheadTokens, describeOverlay } from "../core/index.js";
import type { FlowScene } from "../core/scene.js";
import type { DrawState, PreparedScene } from "../canvas/index.js";
import { retainScene } from "../canvas/scene.js";
import { describeEdge, describeGroup, describeNode } from "./describe.js";
import { coverBackground } from "./marks.js";
import { GROUP_PREFIX } from "./map-pointer.js";
import type { WfEdge, WfGroupNode, WfNode } from "./types.js";

type Bright = { nodes: Set<string>; edges: Set<string> } | undefined;

/** ARIA descriptions of the shown elements. */
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
  return { describeElement, overlaysByTarget, groupIndex, memberCount };
}

export type ElementDescriptions = ReturnType<typeof useElementDescriptions>;

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
}

/** React Flow nodes (groups first, as parents) and edges, and the overlay marks drawn between elements. */
export function useFlowElements(input: FlowInput) {
  const { enabled, scene, graph: shown, positions, descriptions, selection, hovered, focused, bright, locale, activityLabels, nodesDraggable } = input;
  const { overlaysByTarget, groupIndex, memberCount, describeElement } = descriptions;
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
  }, [positions, enabled, shown, scene, overlaysByTarget, covers, carried, scales, selection, hovered, focused, locale, bright, bands, groupIndex, memberCount, activityLabels, describeElement, nodesDraggable]);

  const rfEdges = useMemo<WfEdge[]>(() => {
    if (!positions || !enabled) return [];
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
  }, [positions, enabled, shown, scene, selection, hovered, focused, locale, bright]);
  return { nodes: rfNodes, edges: rfEdges, between };
}

interface CanvasInput {
  /** The Canvas map draws the map; otherwise nothing is built. */
  enabled: boolean;
  scene: FlowScene;
  graph: FlowGraph;
  positions: Positions | undefined;
  describeElement: (ref: ElementRef) => string;
  selection: Selection;
  hovered: string | null;
  focused: string | null;
  bright: Bright;
  locale: Locale;
  activityLabels: ActivityLabelOptions | undefined;
}

/** The Canvas map's retained scene, its draw state, its element list and its tooltip texts. */
export function useCanvasElements(input: CanvasInput) {
  const { enabled, scene, graph: shown, positions, describeElement, selection, hovered, focused, bright, locale, activityLabels } = input;
  const nodeKinds = useMemo(() => new Map(shown.nodes.map((n) => [n.id, n.kind])), [shown]);
  const canvasScene = useMemo<PreparedScene | undefined>(() => (enabled && positions ? retainScene(scene) : undefined), [enabled, positions, scene]);
  const canvasState = useMemo<DrawState>(() => ({ selection, hovered, focused, bright }), [selection, hovered, focused, bright]);
  const canvasDescendants = useMemo(() => {
    if (!enabled) return undefined;
    const list: { id: string; kind: ElementRef["kind"]; description: string }[] = shown.nodes.map((n) => ({ id: n.id, kind: "node" as const, description: describeElement({ kind: "node", id: n.id }) }));
    for (const g of shown.groups ?? []) list.push({ id: g.id, kind: "group" as const, description: describeElement({ kind: "group", id: g.id }) });
    if (focused && shown.edges.some((e) => e.id === focused)) list.push({ id: focused, kind: "edge" as const, description: describeElement({ kind: "edge", id: focused }) });
    return list;
  }, [enabled, shown, focused, describeElement]);
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
  return { scene: canvasScene, state: canvasState, descendants: canvasDescendants, describe: describeHit };
}
