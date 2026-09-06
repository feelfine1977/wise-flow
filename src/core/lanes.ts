/**
 * Lanes: the map's groups as bands. Stage groups become ordered bands along
 * the flow direction (the order the ELK partitioning produced); lane groups
 * (roles) become bands stacked across the flow, and their members move into
 * their band. Positions of the nodes are otherwise untouched, so a map keeps
 * its layout when the lane mode changes.
 */
import { type Box, type EdgeRoute, type Positions, positionsBounds } from "./layout";
import { type FlowGraph, type FlowGroup, type FlowNode, indexGraph } from "./model";

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
  const groups = new Map((graph.groups ?? []).map((g) => [g.id, g]));
  const onChain = (groupId: string | undefined): string | undefined => {
    let cur = groupId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (laneIds.has(cur)) return cur;
      seen.add(cur);
      cur = groups.get(cur)?.parent;
    }
    return undefined;
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
  const laneOf = new Map<string, string>();
  for (const n of graph.nodes) {
    const lane = onChain(n.group) ?? fromTag(n);
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

function membersOf(graph: FlowGraph, groupId: string): FlowNode[] {
  // Members of the group and of every group nested under it.
  const groups = new Map((graph.groups ?? []).map((g) => [g.id, g]));
  const under = (id: string | undefined): boolean => {
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      if (cur === groupId) return true;
      seen.add(cur);
      cur = groups.get(cur)?.parent;
    }
    return false;
  };
  return graph.nodes.filter((n) => under(n.group));
}

function stageBands(graph: FlowGraph, positions: Positions, options: LaneOptions): LaneResult {
  const pad = options.padding ?? 24;
  const label = options.labelSpace ?? 32;
  const ax = axes(positions);
  const content = contentBounds(positions);
  const items = laneGroups(graph, "stages")
    .map((g, order) => {
      const boxes = membersOf(graph, g.id)
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
  const partial = { nodes: positions.nodes, groups, edges: positions.edges };
  return { positions: { ...partial, bounds: positionsBounds(partial), engine: positions.engine, direction: positions.direction }, bands, mode: "stages" };
}

function roleBands(graph: FlowGraph, positions: Positions, options: LaneOptions): LaneResult {
  const pad = options.padding ?? 24;
  const label = options.labelSpace ?? 32;
  const gap = options.gap ?? 8;
  const ax = axes(positions);
  const lanes = laneGroups(graph, "roles");
  if (lanes.length === 0) return { positions, bands: [], mode: "roles" };
  const laneOf = laneAssignment(graph, lanes);
  const content = contentBounds(positions);
  const nodes: Record<string, Box> = {};
  const offsets = new Map<string, number>();
  const groups: Record<string, Box> = {};
  const bands: LaneBand[] = [];
  let cursor = content[ax.cross];
  const mainStart = content[ax.main] - pad;
  const mainSize = content[ax.mainSize] + 2 * pad;
  lanes.forEach((lane, i) => {
    const members = graph.nodes.filter((n) => laneOf.get(n.id) === lane.id && positions.nodes[n.id]);
    const ext = extent(members.map((n) => positions.nodes[n.id]), ax.cross, ax.crossSize);
    const inner = ext ? ext[1] - ext[0] : 0;
    const height = label + 2 * pad + inner;
    const innerStart = cursor + label + pad;
    const offset = ext ? innerStart - ext[0] : 0;
    for (const n of members) {
      const b = positions.nodes[n.id];
      const moved = { ...b };
      moved[ax.cross] = b[ax.cross] + offset;
      nodes[n.id] = moved;
      offsets.set(n.id, offset);
    }
    const box = { x: 0, y: 0, width: 0, height: 0 } as Box;
    box[ax.main] = mainStart;
    box[ax.mainSize] = mainSize;
    box[ax.cross] = cursor;
    box[ax.crossSize] = height;
    groups[lane.id] = box;
    bands.push({ id: lane.id, index: i, axis: "cross", box });
    cursor += height + gap;
  });
  for (const [id, b] of Object.entries(positions.nodes)) if (!nodes[id]) nodes[id] = b;
  // Pools span their lanes; other groups are not drawn in this mode.
  const byId = new Map((graph.groups ?? []).map((g) => [g.id, g]));
  for (const g of graph.groups ?? []) {
    if (g.kind !== "pool") continue;
    const children = lanes.filter((l) => l.parent === g.id || (!l.parent && !byId.get(l.id)?.parent));
    const boxes = children.map((l) => groups[l.id]).filter(Boolean);
    if (boxes.length) groups[g.id] = positionsBounds({ nodes: Object.fromEntries(boxes.map((b, i) => [String(i), b])), groups: {}, edges: {} });
  }
  const edges: Record<string, EdgeRoute> = {};
  const edgeIndex = indexGraph(graph).edges;
  for (const [id, route] of Object.entries(positions.edges)) {
    const e = edgeIndex.get(id);
    if (!e) continue;
    const a = offsets.get(e.source) ?? 0;
    const b = offsets.get(e.target) ?? 0;
    if (a !== b) continue;
    edges[id] = a === 0 ? route : { ...route, points: route.points.map((p) => ({ ...p, [ax.cross]: p[ax.cross] + a })) };
  }
  const partial = { nodes, groups, edges };
  return { positions: { ...partial, bounds: positionsBounds(partial), engine: positions.engine, direction: positions.direction }, bands, mode: "roles" };
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
