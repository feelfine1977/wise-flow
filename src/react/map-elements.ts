/** What the two map renderers draw: React Flow elements or the Canvas map's retained scene, and their descriptions; the browser's text measure. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ActivityLabelOptions, type Arrowhead, type EdgeBudget, type ElementRef, type FlowGraph, type FlowScene, type GraphIndex, type HitItem, type Locale, type Overlay, type OverlayMark, type Positions, type Readable, type ReadableRules, type Selection, type TextMeasure, budgetEdges, describeOverlay, indexGraph, markInState, readableTokens, stateStyle, zTokens } from "../core/index.js";
import { type DrawState, type PreparedScene, canvasTextMeasure } from "../canvas/index.js";
import { retainScene } from "../canvas/scene.js";
import { LABELS } from "../core/readable.js";
import { describeIndexedEdge } from "../core/describe.js";
import { FIRST_STEP, mapEdges } from "../core/edge-budget.js";
import { describeGroup, describeNode } from "./describe.js";
import { coverBackground } from "./marks.js";
import { GROUP_PREFIX } from "./map-pointer.js";
import type { WfEdge, WfGroupNode, WfNode } from "./types.js";

type Bright = { nodes: Set<string>; edges: Set<string> } | undefined;

/**
 * The classes the interactive map writes on its root for what its texts show
 * (`readableAt`): the level (`wf-text--plain` for the cards as they are, at a
 * boost of 1), the rung of the floor, which `tokens.css` turns into
 * `--wf-text-floor`, `wf-text-grow` where titles and pills are scaled at the
 * plain level (past `grown`), and each kind of label shed. One string, so that a zoom writes
 * the root once.
 */
export function readableClasses(r: Readable, grown = Infinity): string {
  const plain = r.level === "full" && r.boost === 1;
  const out = [`wf-text--${plain ? "plain" : r.level}`];
  if (r.step !== undefined && r.step <= readableTokens.last) out.push(`wf-text-f${r.step}`);
  if (plain && r.floor > grown) out.push("wf-text-grow");
  for (const k of LABELS) if (!r.labels[k]) out.push(`wf-text-hide-${k}`);
  if (!r.pills) out.push("wf-text-hide-pills");
  return out.join(" ");
}

/** The smallest text of the pills and the groups' titles. */
export const grownTextSize = ({ readable, groupMarks }: Pick<FlowScene, "readable" | "groupMarks">): number => groupMarks.reduce((s, g) => g.texts.reduce((m, t) => Math.min(m, t.size), s), readable.pills);

/** The smallest text of each level of the cards and of the pills, which the stylesheet divides the floor by: written once per scene. */
export function readableSizes({ levels, pills }: ReadableRules): Record<string, number> {
  const sizes = { "--wf-text-s-full": levels.full.size, "--wf-text-s-name": levels.name.size, "--wf-text-s-line": levels.line.size, "--wf-pill-size": pills };
  return Object.fromEntries(Object.entries(sizes).filter(([, size]) => Number.isFinite(size)));
}

/**
 * The text measure of a live map: the given one, or the browser's in the
 * font family (Canvas `measureText`, the estimate without a 2D canvas),
 * created again once the page's fonts have loaded.
 */
export function useTextMeasure(given: TextMeasure | undefined, family: string): TextMeasure {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  const [loaded, setLoaded] = useState(() => !fonts || fonts.status === "loaded");
  useEffect(() => {
    let live = true;
    if (!loaded) void fonts?.ready.then(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [fonts, loaded]);
  return useMemo(() => given ?? canvasTextMeasure(family), [given, family, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** ARIA descriptions of the shown elements, read through one index of the shown graph; `notes` adds to an element's, by id (`detailNotes`). */
export function useElementDescriptions(shown: FlowGraph, overlays: Overlay[], locale: Locale, activityLabels: ActivityLabelOptions | undefined, notes?: ReadonlyMap<string, string>) {
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
  // The nodes inside each group at any depth.
  const memberCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of shown.nodes) {
      const group = n.group === undefined ? undefined : groupIndex.get(n.group);
      if (group) for (const g of [group, ...index.ancestors(group.id, "group")]) m.set(g.id, (m.get(g.id) ?? 0) + 1);
    }
    return m;
  }, [shown, index, groupIndex]);
  const describeOwn = useCallback(
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
  const describeElement = useCallback(
    (ref: ElementRef): string => {
      const note = ref.kind === "group" ? undefined : notes?.get(ref.id);
      return note ? `${describeOwn(ref)} ${note}` : describeOwn(ref);
    },
    [describeOwn, notes],
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
  /** Edges on a highlighted path, drawn first within the budget. */
  highlighted?: ReadonlySet<string>;
  /** The paths drawn at a small zoom (`pathsAtZoom`): the narrowest line on the screen and the zoom the view rested at. */
  pathRule?: { minPx: number; zoom: number };
}

/** The id of the marker of an edge's arrowhead in the map (`MarkDefs`), by its size. */
export const edgeArrowId = (a: Arrowhead) => `wf-edge-arrow-${a.size}`;

/** React Flow nodes (groups first, as parents) and edges, and the overlay marks drawn between elements. */
export function useFlowElements(input: FlowInput) {
  const { enabled, scene, graph: shown, positions, descriptions, selection, hovered, focused, bright, locale, activityLabels, nodesDraggable, edgeBudget, highlighted, pathRule } = input;
  const { overlaysByTarget, groupIndex, memberCount, describeElement } = descriptions;
  const { scales } = scene;
  const groupMarks = useMemo(() => new Map(scene.groupMarks.map((m) => [m.id, m])), [scene.groupMarks]);
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
  // A hovered mark as the theme's rules for the state draw it.
  const inHover = useCallback((m: OverlayMark) => (m.id === hovered ? markInState(m, stateStyle(scene, "mark", m, { hovered: true })) : m), [scene, hovered]);

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
      const mark = groupMarks.get(g.id);
      const state = mark && stateStyle(scene, "group", mark, { selected: selection.groups.includes(g.id) });
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
          marks: carried.get(g.id)?.map(inHover),
          origin: { x: box.x, y: box.y },
          description,
          band: mark?.band,
          mark: mark && markInState(mark, state),
          state,
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
      const states = { selected: selection.nodes.includes(n.id), focused: focused === n.id, hovered: hovered === n.id, dimmed: !(activityLabels && n.kind === "activity") && !!bright && !bright.nodes.has(n.id) };
      // The theme's rules for these states, drawn over the mark.
      const state = stateStyle(scene, "node", mark, states);
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
        zIndex: activityLabels ? zTokens.activityLabels : undefined,
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
          marks: carried.get(n.id)?.map(inHover),
          origin: { x: box.x, y: box.y },
          direction: positions.direction,
          focused: states.focused,
          hovered: states.hovered,
          dimmed: states.dimmed,
          locale,
          description,
          mark: markInState(mark, state),
          state,
        },
      });
    }
    return out;
  }, [positions, enabled, shown, scene, overlaysByTarget, covers, carried, inHover, scales, selection, hovered, focused, locale, bright, groupMarks, groupIndex, memberCount, activityLabels, describeElement, nodesDraggable]);

  // Every edge of the scene is in view of React Flow; with no frame to time, adaptive keeps its first step. At a small zoom
  // the budget chooses among the paths the rule lets through.
  const withheld = useMemo(() => {
    if (!enabled) return undefined;
    const budget = edgeBudget === "adaptive" ? FIRST_STEP : edgeBudget;
    const protection = { selection, focused, highlighted };
    return pathRule ? mapEdges(scene, budget, protection, pathRule.zoom, pathRule.minPx) : budgetEdges(scene, budget, protection);
  }, [enabled, scene, edgeBudget, selection, focused, highlighted, pathRule]);
  const rfEdges = useMemo<WfEdge[]>(() => {
    if (!positions || !enabled) return [];
    return (withheld ? scene.edgeMarks.filter((_, i) => withheld.drawn.has(i)) : scene.edgeMarks).map((mark) => {
      const e = mark.edge;
      const description = describeElement({ kind: "edge", id: e.id });
      const states = { selected: selection.edges.includes(e.id), focused: focused === e.id, hovered: hovered === e.id, dimmed: !!bright && !bright.edges.has(e.id) };
      const state = stateStyle(scene, "edge", mark, states);
      return {
        id: e.id,
        type: e.kind,
        source: e.source,
        target: e.target,
        selected: selection.edges.includes(e.id),
        ariaLabel: description,
        // The head the map defines for its size (`MarkDefs`), as the SVG export does; it takes the colour of the path's stroke.
        markerEnd: edgeArrowId(mark.arrow),
        zIndex: hovered === e.id || focused === e.id ? zTokens.pathHovered : 0,
        data: {
          edge: e,
          route: positions.edges[e.id],
          width: mark.width,
          color: mark.color,
          label: mark.texts[0]?.text,
          reconnected: mark.reconnected,
          hovered: states.hovered,
          dimmed: states.dimmed,
          focused: states.focused,
          description,
          mark,
          state,
        },
      };
    });
  }, [positions, enabled, scene, describeElement, selection, hovered, focused, bright, withheld]);
  const shownBetween = useMemo(() => between.map(inHover), [between, inHover]);
  // The heads the edges end in, one per size.
  const arrows = useMemo(() => [...new Map(rfEdges.map((e) => [e.data!.mark!.arrow.size, e.data!.mark!.arrow])).values()].sort((a, b) => a.size - b.size), [rfEdges]);
  return { nodes: rfNodes, edges: rfEdges, between: shownBetween, withheld, arrows };
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
