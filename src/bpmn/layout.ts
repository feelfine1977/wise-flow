/**
 * Layout for BPMN diagrams: ELK layered decides the order along the flow, lanes
 * become horizontal bands stacked inside one pool (the core's lane model),
 * sequence flows are routed orthogonally. Without lanes the ELK positions are
 * used as they are.
 */
import {
  type Box,
  type EdgeRoute,
  type FlowGraph,
  type FlowNode,
  type LayoutOptions,
  type NodeSize,
  type Positions,
  type XY,
  type LaneModelOptions,
  layout,
  laneModel,
  laneRoutes,
  createPositions,
  spanLanes,
  stackLanes,
  straightRoute,
} from "../core/index.js";

/** BPMN lanes: nested lanes spanned by their parents; every sequence flow is routed around the shapes. */
const BPMN_LANES: LaneModelOptions = { lanes: "nested", crossLaneEdges: "routed" };

/** BPMN shape sizes as drawn by bpmn-js and Camunda Modeler. */
export const BPMN_SIZES: Record<FlowNode["kind"], NodeSize> = {
  activity: { width: 100, height: 80 },
  stage: { width: 100, height: 80 },
  gateway: { width: 50, height: 50 },
  event: { width: 36, height: 36 },
  note: { width: 100, height: 30 },
};

export function bpmnNodeSize(node: FlowNode): NodeSize {
  return BPMN_SIZES[node.kind] ?? BPMN_SIZES.activity;
}

export interface BpmnLayoutOptions extends Omit<LayoutOptions, "direction" | "groups"> {
  /** Lanes as stacked bands (default when lane groups exist), as ELK compounds, or ignored. */
  lanes?: "bands" | "compound" | "ignore";
  /** Vertical distance between rows inside a lane. Default 56. */
  rowGap?: number;
  /** Padding inside a lane above the first and below the last row. Default 48. */
  lanePadding?: number;
  /** Width of the label strip on the left of pool and lanes. Default 30. */
  labelWidth?: number;
  /** Horizontal margin inside the pool before the first and after the last shape. Default 40. */
  poolPadding?: number;
}

/** Id of the pool box in `Positions.groups` when the graph has lanes but no pool group. */
export const POOL_ID = "__pool";

const width = (b: Box) => b.x + b.width;

/**
 * @deprecated No layout uses it; route with `routeSequenceFlows` from the core.
 *
 * Orthogonal route between two boxes: straight when aligned, one bend pair when
 * the target lies to the right, a loop below both when it lies to the left.
 * Gateways leave and enter through their tips.
 */
export function manhattanRoute(s: Box, t: Box, kinds: { source: FlowNode["kind"]; target: FlowNode["kind"] }, gap = 20): EdgeRoute {
  const sc = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const tc = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  const pts: XY[] = [];
  const sameRow = Math.abs(sc.y - tc.y) < 1;
  if (t.x >= width(s) + gap) {
    if (sameRow) {
      pts.push({ x: width(s), y: sc.y }, { x: t.x, y: tc.y });
    } else if (kinds.source === "gateway") {
      const y = tc.y > sc.y ? s.y + s.height : s.y;
      pts.push({ x: sc.x, y }, { x: sc.x, y: tc.y }, { x: t.x, y: tc.y });
    } else if (kinds.target === "gateway") {
      const y = sc.y > tc.y ? t.y + t.height : t.y;
      pts.push({ x: width(s), y: sc.y }, { x: tc.x, y: sc.y }, { x: tc.x, y });
    } else {
      const mid = (width(s) + t.x) / 2;
      pts.push({ x: width(s), y: sc.y }, { x: mid, y: sc.y }, { x: mid, y: tc.y }, { x: t.x, y: tc.y });
    }
  } else if (width(t) + gap <= s.x) {
    // Back edge: leave through the bottom, run below both shapes, enter through the bottom.
    const below = Math.max(s.y + s.height, t.y + t.height) + gap;
    pts.push({ x: sc.x, y: s.y + s.height }, { x: sc.x, y: below }, { x: tc.x, y: below }, { x: tc.x, y: t.y + t.height });
  } else if (!sameRow) {
    // Same column: vertical.
    const down = tc.y > sc.y;
    pts.push({ x: sc.x, y: down ? s.y + s.height : s.y }, { x: sc.x, y: down ? t.y : t.y + t.height });
    if (Math.abs(sc.x - tc.x) >= 1) {
      const midY = (pts[0].y + pts[1].y) / 2;
      pts.splice(1, 1, { x: sc.x, y: midY }, { x: tc.x, y: midY }, { x: tc.x, y: down ? t.y : t.y + t.height });
    }
  } else {
    return straightRoute(s, t);
  }
  return { points: pts };
}

/**
 * Lay out a BPMN-lite graph. Lane groups become full-width bands stacked in one
 * pool (`POOL_ID` unless the graph has a pool group); every node keeps the x of
 * the ELK layering and gets a row inside its lane so that no two shapes overlap;
 * sequence flows are routed orthogonally. Nested lanes span their children.
 */
export async function layoutBpmn(graph: FlowGraph, options: BpmnLayoutOptions = {}): Promise<Positions> {
  const { lanes: laneMode, rowGap = 56, lanePadding = 48, labelWidth = 30, poolPadding = 40, ...rest } = options;
  const base: LayoutOptions = { ...rest, direction: "RIGHT", nodeSize: rest.nodeSize ?? bpmnNodeSize, spacing: { node: 56, layer: 80, ...(rest.spacing ?? {}) } };
  const model = laneModel(graph, BPMN_LANES);
  const mode = laneMode ?? (model.lanes.length ? "bands" : "ignore");
  if (mode === "compound") return layout(graph, { ...base, groups: "compound" });
  const elk = await layout(graph, { ...base, groups: "ignore" });
  if (mode === "ignore" || model.lanes.length === 0) return elk;

  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  let tallest = 80;
  let minX = Infinity;
  for (const b of Object.values(elk.nodes)) {
    tallest = Math.max(tallest, b.height);
    minX = Math.min(minX, b.x);
  }
  const rowHeight = tallest + rowGap;
  const x0 = labelWidth * 2 + poolPadding;
  let contentRight = 0;
  const { slots, end } = stackLanes(graph, model, 0, 0, (_lane, laneMembers, y) => {
    const members = laneMembers.filter((n) => elk.nodes[n.id]).sort((a, b) => elk.nodes[a.id].x - elk.nodes[b.id].x || elk.nodes[a.id].y - elk.nodes[b.id].y || (a.id < b.id ? -1 : 1));
    // Interval scheduling: a node takes the first row whose last shape ends before it starts.
    const rowEnd: number[] = [];
    const rowOf = new Map<string, number>();
    for (const n of members) {
      const b = elk.nodes[n.id];
      let row = rowEnd.findIndex((end) => end + rowGap <= b.x);
      if (row < 0) {
        row = rowEnd.length;
        rowEnd.push(-Infinity);
      }
      rowEnd[row] = b.x + b.width;
      rowOf.set(n.id, row);
    }
    for (const n of members) {
      const b = elk.nodes[n.id];
      const centre = y + lanePadding + rowOf.get(n.id)! * rowHeight + (rowHeight - rowGap) / 2;
      nodes[n.id] = { x: x0 + (b.x - minX), y: centre - b.height / 2, width: b.width, height: b.height };
      contentRight = Math.max(contentRight, nodes[n.id].x + b.width);
    }
    return Math.max(1, rowEnd.length) * rowHeight - rowGap + 2 * lanePadding;
  });
  const poolWidth = contentRight + poolPadding;
  for (const { lane, start, size } of slots) groups[lane.id] = { x: labelWidth, y: start, width: poolWidth - labelWidth, height: size };
  Object.assign(groups, spanLanes(graph, model, groups, { main: "x", labelSpace: labelWidth }));
  if (!(graph.groups ?? []).some((g) => g.kind === "pool" && !g.parent)) groups[POOL_ID] = { x: 0, y: 0, width: poolWidth, height: end };

  const edges = laneRoutes(graph, model, nodes);
  return createPositions({ nodes, groups, edges }, elk.engine, "RIGHT");
}
