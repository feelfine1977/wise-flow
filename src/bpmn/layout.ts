/**
 * Layout for BPMN diagrams: ELK layered decides the order along the flow, lanes
 * become horizontal bands stacked inside one pool, sequence flows are routed
 * orthogonally. Without lanes the ELK positions are used as they are.
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
  layout,
  positionsBounds,
  straightRoute,
} from "../core/index.js";

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
  /** Vertical distance between rows inside a lane. Default 24. */
  rowGap?: number;
  /** Padding inside a lane above the first and below the last row. Default 30. */
  lanePadding?: number;
  /** Width of the label strip on the left of pool and lanes. Default 30. */
  labelWidth?: number;
  /** Horizontal margin inside the pool before the first and after the last shape. Default 40. */
  poolPadding?: number;
}

/** Id of the pool box in `Positions.groups` when the graph has lanes but no pool group. */
export const POOL_ID = "__pool";

const width = (b: Box) => b.x + b.width;

function assignLanes(graph: FlowGraph): { lanes: string[]; laneOf: Map<string, string> } {
  const groups = graph.groups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const hasChildren = new Set(groups.filter((g) => g.parent && groupIds.has(g.parent)).map((g) => g.parent!));
  // Leaf lanes in a depth-first walk of the group array order (parents keep their children together).
  const lanes: string[] = [];
  const walk = (parent: string | undefined) => {
    for (const g of groups) {
      if ((g.parent && groupIds.has(g.parent) ? g.parent : undefined) !== parent) continue;
      if (g.kind === "pool" && !hasChildren.has(g.id)) continue;
      if (hasChildren.has(g.id)) walk(g.id);
      else if (g.kind !== "pool") lanes.push(g.id);
    }
  };
  walk(undefined);
  const firstLeafUnder = (id: string): string | undefined => {
    if (lanes.includes(id)) return id;
    for (const g of groups) if (g.parent === id) return firstLeafUnder(g.id);
    return undefined;
  };
  const laneOf = new Map<string, string>();
  for (const n of graph.nodes) {
    const lane = n.group ? firstLeafUnder(n.group) : undefined;
    if (lane) laneOf.set(n.id, lane);
  }
  // Nodes without a lane follow their predecessor, then their successor, then the first lane.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of graph.nodes) {
      if (laneOf.has(n.id)) continue;
      const pred = graph.edges.find((e) => e.target === n.id && laneOf.has(e.source));
      const succ = graph.edges.find((e) => e.source === n.id && laneOf.has(e.target));
      const lane = pred ? laneOf.get(pred.source) : succ ? laneOf.get(succ.target) : undefined;
      if (lane) {
        laneOf.set(n.id, lane);
        changed = true;
      }
    }
  }
  for (const n of graph.nodes) if (!laneOf.has(n.id) && lanes.length) laneOf.set(n.id, lanes[0]);
  return { lanes, laneOf };
}

/**
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
  const { lanes: laneMode, rowGap = 24, lanePadding = 30, labelWidth = 30, poolPadding = 40, ...rest } = options;
  const base: LayoutOptions = { ...rest, direction: "RIGHT", nodeSize: rest.nodeSize ?? bpmnNodeSize, spacing: { node: 24, layer: 60, ...(rest.spacing ?? {}) } };
  const { lanes, laneOf } = assignLanes(graph);
  const mode = laneMode ?? (lanes.length ? "bands" : "ignore");
  if (mode === "compound") return layout(graph, { ...base, groups: "compound" });
  const elk = await layout(graph, { ...base, groups: "ignore" });
  if (mode === "ignore" || lanes.length === 0) return elk;

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const nodes: Record<string, Box> = {};
  const groups: Record<string, Box> = {};
  const rowHeight = Math.max(...Object.values(BPMN_SIZES).map((s) => s.height)) + rowGap;
  const minX = Math.min(...Object.values(elk.nodes).map((b) => b.x));
  const x0 = labelWidth * 2 + poolPadding;
  let y = 0;
  let contentRight = 0;
  for (const lane of lanes) {
    const members = graph.nodes.filter((n) => laneOf.get(n.id) === lane && elk.nodes[n.id]).sort((a, b) => elk.nodes[a.id].x - elk.nodes[b.id].x || elk.nodes[a.id].y - elk.nodes[b.id].y || (a.id < b.id ? -1 : 1));
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
    const rows = Math.max(1, rowEnd.length);
    const height = rows * rowHeight - rowGap + 2 * lanePadding;
    for (const n of members) {
      const b = elk.nodes[n.id];
      const centre = y + lanePadding + rowOf.get(n.id)! * rowHeight + (rowHeight - rowGap) / 2;
      nodes[n.id] = { x: x0 + (b.x - minX), y: centre - b.height / 2, width: b.width, height: b.height };
      contentRight = Math.max(contentRight, nodes[n.id].x + b.width);
    }
    groups[lane] = { x: labelWidth, y, width: 0, height };
    y += height;
  }
  const poolWidth = contentRight + poolPadding;
  for (const lane of lanes) groups[lane].width = poolWidth - labelWidth;
  // Parent lanes span their children; a pool group takes the whole pool box.
  const all = graph.groups ?? [];
  const byId = new Map(all.map((g) => [g.id, g]));
  const span = (id: string): Box | undefined => {
    if (groups[id]) return groups[id];
    const children = all.filter((g) => g.parent === id).map((g) => span(g.id)).filter((b): b is Box => !!b);
    if (!children.length) return undefined;
    const top = Math.min(...children.map((b) => b.y));
    const bottom = Math.max(...children.map((b) => b.y + b.height));
    const left = Math.min(...children.map((b) => b.x)) - labelWidth;
    return { x: left, y: top, width: poolWidth - left, height: bottom - top };
  };
  for (const g of all) {
    if (groups[g.id]) continue;
    const b = span(g.id);
    if (b) groups[g.id] = b;
  }
  for (const g of all) {
    if (g.kind === "pool" && !g.parent && byId.has(g.id)) groups[g.id] = { x: 0, y: 0, width: poolWidth, height: y };
  }
  if (!all.some((g) => g.kind === "pool" && !g.parent)) groups[POOL_ID] = { x: 0, y: 0, width: poolWidth, height: y };

  const edges: Record<string, EdgeRoute> = {};
  for (const e of graph.edges) {
    const s = nodes[e.source];
    const t = nodes[e.target];
    if (!s || !t || e.source === e.target) continue;
    edges[e.id] = manhattanRoute(s, t, { source: nodeById.get(e.source)?.kind ?? "activity", target: nodeById.get(e.target)?.kind ?? "activity" });
  }
  const partial = { nodes, groups, edges };
  return { ...partial, bounds: positionsBounds(partial), engine: elk.engine, direction: "RIGHT" };
}
