/**
 * Lanes: the map's groups as bands. Stage groups become ordered bands along
 * the flow direction (the order the ELK partitioning produced); lane groups
 * (roles) become bands stacked across the flow, and their members move into
 * their band. Positions of the nodes are otherwise untouched, so a map keeps
 * its layout when the lane mode changes. The lane model (`laneModel`,
 * `stackLanes`, `spanLanes`, `laneRoutes`) is shared with the BPMN layout.
 */
import { type Box, type EdgeRoute, type Positions, createPositions, positionsBounds, unionBoxes } from "./layout.js";
import { type FlowGraph, type FlowGroup, type FlowNode, indexGraph } from "./model.js";
import { routeSequenceFlows } from "./routing.js";

export type LaneMode = "stages" | "roles" | "none";

export interface LaneOptions {
  lanes: LaneMode;
  /** Space around the members inside a band. Default 24. */
  padding?: number;
  /** Space for the band label. Default 32. */
  labelSpace?: number;
  /** Distance between stacked role lanes. Default 8. */
  gap?: number;
}

export interface LaneBand {
  id: string;
  index: number;
  /** Bands along the flow (stages) or across it (roles). */
  axis: "main" | "cross";
  box: Box;
}

export interface LaneResult {
  positions: Positions;
  bands: LaneBand[];
  mode: LaneMode;
}

const isPool = (g: FlowGroup | undefined) => g?.kind === "pool";

/** The groups that become bands in a lane mode, in their array order. */
export function laneGroups(graph: FlowGraph, mode: LaneMode): FlowGroup[] {
  const groups = graph.groups ?? [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  const topLevel = (g: FlowGroup) => !g.parent || isPool(byId.get(g.parent));
  if (mode === "stages") return groups.filter((g) => g.kind === "stage" && topLevel(g));
  if (mode === "roles") return groups.filter((g) => g.kind === "lane" && topLevel(g));
  return [];
}

/**
 * The lane of every node for the role mode: the first band on the node's
 * group chain, else a `lane:` or `role:` tag naming a band by id or label,
 * else the predecessor's lane, the successor's lane, and finally the first band.
 */
export function laneAssignment(graph: FlowGraph, lanes: FlowGroup[]): Map<string, string> {
  const laneIds = new Set(lanes.map((l) => l.id));
  const byLabel = new Map(lanes.map((l) => [l.label.toLowerCase(), l.id]));
  const idx = indexGraph(graph);
  // The group, its ancestors and the parent the chain ends at: a given lane need not be one of the graph's groups.
  const onChain = (n: FlowNode): string | undefined => {
    if (!n.group) return undefined;
    const own = idx.groups.get(n.group);
    const chain = own ? [own, ...idx.ancestors(own.id, "group")] : [];
    return [n.group, ...chain.map((g) => g.parent)].find((id) => id !== undefined && laneIds.has(id));
  };
  const fromTag = (n: FlowNode): string | undefined => {
    for (const tag of n.tags ?? []) {
      const m = /^(?:lane|role):(.+)$/.exec(tag);
      if (!m) continue;
      if (laneIds.has(m[1])) return m[1];
      const byL = byLabel.get(m[1].toLowerCase());
      if (byL) return byL;
    }
    return undefined;
  };
  return assign(graph, lanes, (n) => onChain(n) ?? fromTag(n));
}

/** Nodes the own rule leaves without a lane follow their predecessor, then their successor, then the first lane. */
function assign(graph: FlowGraph, lanes: FlowGroup[], own: (n: FlowNode) => string | undefined): Map<string, string> {
  const laneOf = new Map<string, string>();
  for (const n of graph.nodes) {
    const lane = own(n);
    if (lane) laneOf.set(n.id, lane);
  }
  if (lanes.length === 0) return laneOf;
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of graph.nodes) {
      if (laneOf.has(n.id)) continue;
      const pred = graph.edges.find((e) => e.target === n.id && e.source !== n.id && laneOf.has(e.source));
      const succ = graph.edges.find((e) => e.source === n.id && e.target !== n.id && laneOf.has(e.target));
      const lane = pred ? laneOf.get(pred.source) : succ ? laneOf.get(succ.target) : undefined;
      if (lane) {
        laneOf.set(n.id, lane);
        changed = true;
      }
    }
  }
  for (const n of graph.nodes) if (!laneOf.has(n.id)) laneOf.set(n.id, lanes[0].id);
  return laneOf;
}

/** The leaves of the group tree in a depth-first walk of the array order; pools without children are left out. */
function nestedLanes(graph: FlowGraph): { lanes: FlowGroup[]; laneOf: Map<string, string> } {
  const groups = graph.groups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const hasChildren = new Set(groups.filter((g) => g.parent && groupIds.has(g.parent)).map((g) => g.parent!));
  const lanes: FlowGroup[] = [];
  const walk = (parent: string | undefined) => {
    for (const g of groups) {
      if ((g.parent && groupIds.has(g.parent) ? g.parent : undefined) !== parent) continue;
      if (g.kind === "pool" && !hasChildren.has(g.id)) continue;
      if (hasChildren.has(g.id)) walk(g.id);
      else if (g.kind !== "pool") lanes.push(g);
    }
  };
  walk(undefined);
  const laneIds = new Set(lanes.map((l) => l.id));
  // At most one step per group, also on a cycle of parents.
  const firstLeafUnder = (id: string): string | undefined => {
    for (let cur: string | undefined = id, n = groups.length; cur !== undefined && n-- >= 0; cur = groups.find((g) => g.parent === cur)?.id) if (laneIds.has(cur)) return cur;
    return undefined;
  };
  return { lanes, laneOf: assign(graph, lanes, (n) => (n.group ? firstLeafUnder(n.group) : undefined)) };
}

/**
 * How groups become lanes stacked across the flow and what happens to the
 * edges once the nodes moved into their lane. The map's role bands and the
 * BPMN layout each choose their behaviour here.
 */
export interface LaneModelOptions {
  /**
   * `roles`: the top-level lane groups (no parent, or a pool) in array order
   * (`laneGroups(graph, "roles")`, `laneAssignment`); a pool spans its lanes
   * and the lanes without a parent. `nested`: the leaves of the group tree
   * (any kind but pools without children) in a depth-first walk of the array
   * order; a node of a parent group belongs to the first leaf under it; every
   * group above the lanes spans its children and a top-level pool spans all
   * lanes. In both, a node without a lane follows its predecessor, then its
   * successor, then the first lane.
   */
  lanes: "roles" | "nested";
  /**
   * `direct`: a route moves with its ends when both moved by the same amount,
   * otherwise (an edge across lanes) it is dropped and the renderer draws the
   * edge directly between the shapes. `routed`: every edge is routed again
   * orthogonally around the shapes in their new places (`routeSequenceFlows`).
   */
  crossLaneEdges: "direct" | "routed";
}

export interface LaneModel {
  options: LaneModelOptions;
  /** The lanes in stacking order. */
  lanes: FlowGroup[];
  /** The lane of every node. */
  laneOf: Map<string, string>;
}

/** The lanes of a graph and the lane of every node. */
export function laneModel(graph: FlowGraph, options: LaneModelOptions): LaneModel {
  if (options.lanes === "nested") return { options, ...nestedLanes(graph) };
  const lanes = laneGroups(graph, "roles");
  return { options, lanes, laneOf: laneAssignment(graph, lanes) };
}

export interface LaneSlot {
  lane: FlowGroup;
  /** Start and size across the flow. */
  start: number;
  size: number;
}

/**
 * Stacks the lanes across the flow from `start`, `gap` apart. `place` puts the
 * lane's members (graph order) into the lane starting at the given position and
 * returns the lane's size; `end` is where the last lane ends.
 */
export function stackLanes(graph: FlowGraph, model: LaneModel, start: number, gap: number, place: (lane: FlowGroup, members: FlowNode[], start: number) => number): { slots: LaneSlot[]; end: number } {
  const slots: LaneSlot[] = [];
  let cursor = start;
  let end = start;
  for (const lane of model.lanes) {
    const members = graph.nodes.filter((n) => model.laneOf.get(n.id) === lane.id);
    const size = place(lane, members, cursor);
    slots.push({ lane, start: cursor, size });
    end = cursor + size;
    cursor += size + gap;
  }
  return { slots, end };
}

/**
 * Boxes of the groups that hold lanes (see `LaneModelOptions.lanes`), from the
 * lane boxes. A spanning box reaches from its first to its last child across
 * the flow; along the flow it starts `labelSpace` before its children for its
 * own label and ends where they end.
 */
export function spanLanes(graph: FlowGraph, model: LaneModel, laneBoxes: Readonly<Record<string, Box>>, options: { main: "x" | "y"; labelSpace?: number }): Record<string, Box> {
  const all = graph.groups ?? [];
  const labelSpace = options.labelSpace ?? 0;
  const mainSize = options.main === "x" ? "width" : "height";
  const span = (boxes: Box[]): Box => {
    const box = unionBoxes(boxes);
    box[options.main] -= labelSpace;
    box[mainSize] += labelSpace;
    return box;
  };
  const spans: Record<string, Box> = {};
  if (model.options.lanes === "roles") {
    for (const g of all) {
      if (g.kind !== "pool") continue;
      const boxes = model.lanes.filter((l) => l.parent === g.id || !l.parent).map((l) => laneBoxes[l.id]).filter(Boolean);
      if (boxes.length) spans[g.id] = span(boxes);
    }
    return spans;
  }
  // A cycle of parents stops where it returns.
  const path = new Set<string>();
  const boxOf = (id: string): Box | undefined => {
    const own = laneBoxes[id] ?? spans[id];
    if (own || path.has(id)) return own;
    path.add(id);
    const children = all.filter((g) => g.parent === id).map((g) => boxOf(g.id)).filter((b): b is Box => !!b);
    path.delete(id);
    return children.length ? span(children) : undefined;
  };
  for (const g of all) {
    if (laneBoxes[g.id] || spans[g.id]) continue;
    const b = boxOf(g.id);
    if (b) spans[g.id] = b;
  }
  const lanes = model.lanes.map((l) => laneBoxes[l.id]).filter(Boolean);
  if (lanes.length) for (const g of all) if (g.kind === "pool" && !g.parent) spans[g.id] = span(lanes);
  return spans;
}

/**
 * The routes once the nodes moved into their lanes, as the model's
 * `crossLaneEdges` says. For `direct`, `before.offsets` holds how far each node
 * moved along `before.axis`; nodes without an offset did not move.
 */
export function laneRoutes(
  graph: FlowGraph,
  model: LaneModel,
  nodes: Record<string, Box>,
  before?: { routes: Readonly<Record<string, EdgeRoute>>; axis: "x" | "y"; offsets: ReadonlyMap<string, number> },
): Record<string, EdgeRoute> {
  if (model.options.crossLaneEdges === "routed") return routeSequenceFlows(graph, nodes);
  if (!before) return {};
  const { axis, offsets } = before;
  const edges: Record<string, EdgeRoute> = {};
  const edgeIndex = indexGraph(graph).edges;
  for (const [id, route] of Object.entries(before.routes)) {
    const e = edgeIndex.get(id);
    if (!e) continue;
    const a = offsets.get(e.source) ?? 0;
    const b = offsets.get(e.target) ?? 0;
    if (a !== b) continue;
    edges[id] = a === 0 ? route : { ...route, points: route.points.map((p) => ({ ...p, [axis]: p[axis] + a })) };
  }
  return edges;
}

interface Axes {
  main: "x" | "y";
  cross: "x" | "y";
  mainSize: "width" | "height";
  crossSize: "width" | "height";
}

function axes(positions: Positions): Axes {
  const horizontal = positions.direction === "RIGHT" || positions.direction === "LEFT";
  return horizontal ? { main: "x", cross: "y", mainSize: "width", crossSize: "height" } : { main: "y", cross: "x", mainSize: "height", crossSize: "width" };
}

function extent(boxes: Box[], axis: "x" | "y", size: "width" | "height"): [number, number] | undefined {
  if (!boxes.length) return undefined;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of boxes) {
    lo = Math.min(lo, b[axis]);
    hi = Math.max(hi, b[axis] + b[size]);
  }
  return [lo, hi];
}

function contentBounds(positions: Positions): Box {
  return positionsBounds({ nodes: positions.nodes, groups: {}, edges: positions.edges });
}

function stageBands(graph: FlowGraph, positions: Positions, options: LaneOptions): LaneResult {
  const pad = options.padding ?? 24;
  const label = options.labelSpace ?? 32;
  const ax = axes(positions);
  const content = contentBounds(positions);
  const idx = indexGraph(graph);
  const items = laneGroups(graph, "stages")
    .map((g, order) => {
      const boxes = idx.allMembers(g.id)
        .map((n) => positions.nodes[n.id])
        .filter((b): b is Box => !!b);
      const ext = extent(boxes, ax.main, ax.mainSize);
      return ext ? { g, order, lo: ext[0], hi: ext[1], centre: (ext[0] + ext[1]) / 2 } : undefined;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.centre - b.centre || a.order - b.order);
  const groups: Record<string, Box> = { ...positions.groups };
  const bands: LaneBand[] = [];
  const mainStart = content[ax.main] - pad;
  const mainEnd = content[ax.main] + content[ax.mainSize] + pad;
  const crossStart = content[ax.cross] - pad - label;
  const crossSize = content[ax.crossSize] + 2 * pad + label;
  items.forEach((it, i) => {
    const start = i === 0 ? mainStart : (items[i - 1].hi + it.lo) / 2;
    const end = i === items.length - 1 ? mainEnd : (it.hi + items[i + 1].lo) / 2;
    const box = { x: 0, y: 0, width: 0, height: 0 } as Box;
    box[ax.main] = start;
    box[ax.mainSize] = Math.max(1, end - start);
    box[ax.cross] = crossStart;
    box[ax.crossSize] = crossSize;
    groups[it.g.id] = box;
    bands.push({ id: it.g.id, index: i, axis: "main", box });
  });
  return { positions: createPositions({ nodes: positions.nodes, groups, edges: positions.edges }, positions.engine, positions.direction), bands, mode: "stages" };
}

/** Role bands: lanes stacked in their array order; routes across lanes are left to the renderer. */
const ROLE_LANES: LaneModelOptions = { lanes: "roles", crossLaneEdges: "direct" };

function roleBands(graph: FlowGraph, positions: Positions, options: LaneOptions): LaneResult {
  const pad = options.padding ?? 24;
  const label = options.labelSpace ?? 32;
  const gap = options.gap ?? 8;
  const ax = axes(positions);
  const model = laneModel(graph, ROLE_LANES);
  if (model.lanes.length === 0) return { positions, bands: [], mode: "roles" };
  const content = contentBounds(positions);
  const nodes: Record<string, Box> = {};
  const offsets = new Map<string, number>();
  const groups: Record<string, Box> = {};
  const bands: LaneBand[] = [];
  const mainStart = content[ax.main] - pad;
  const mainSize = content[ax.mainSize] + 2 * pad;
  const { slots } = stackLanes(graph, model, content[ax.cross], gap, (_lane, laneMembers, start) => {
    const members = laneMembers.filter((n) => positions.nodes[n.id]);
    const ext = extent(members.map((n) => positions.nodes[n.id]), ax.cross, ax.crossSize);
    const inner = ext ? ext[1] - ext[0] : 0;
    const offset = ext ? start + label + pad - ext[0] : 0;
    for (const n of members) {
      const b = positions.nodes[n.id];
      const moved = { ...b };
      moved[ax.cross] = b[ax.cross] + offset;
      nodes[n.id] = moved;
      offsets.set(n.id, offset);
    }
    return label + 2 * pad + inner;
  });
  slots.forEach(({ lane, start, size }, i) => {
    const box = { x: 0, y: 0, width: 0, height: 0 } as Box;
    box[ax.main] = mainStart;
    box[ax.mainSize] = mainSize;
    box[ax.cross] = start;
    box[ax.crossSize] = size;
    groups[lane.id] = box;
    bands.push({ id: lane.id, index: i, axis: "cross", box });
  });
  for (const [id, b] of Object.entries(positions.nodes)) if (!nodes[id]) nodes[id] = b;
  // Pools span their lanes; other groups are not drawn in this mode.
  Object.assign(groups, spanLanes(graph, model, groups, { main: ax.main }));
  const edges = laneRoutes(graph, model, nodes, { routes: positions.edges, axis: ax.cross, offsets });
  return { positions: createPositions({ nodes, groups, edges }, positions.engine, positions.direction), bands, mode: "roles" };
}

/**
 * Positions with the groups of the chosen mode as bands. `stages`: top-level
 * stage groups become consecutive bands along the flow, split half-way between
 * neighbouring stages and spanning the whole map across the flow; nodes and
 * routes stay where they are. `roles`: top-level lane groups become bands
 * stacked across the flow in their array order; every node moves into its
 * lane, routes that stay inside one lane move with it, others are dropped so
 * the renderer draws them directly. `none`: the positions are returned as is.
 */
export function laneBands(graph: FlowGraph, positions: Positions, options: LaneOptions): LaneResult {
  if (options.lanes === "stages") return stageBands(graph, positions, options);
  if (options.lanes === "roles") return roleBands(graph, positions, options);
  return { positions, bands: [], mode: "none" };
}
