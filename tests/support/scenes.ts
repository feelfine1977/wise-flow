/**
 * Seeded positions and viewports for a graph. Positions are built by hand
 * here (boxes per node kind, group boxes around their members, straight or
 * bent routes, bounds as the union of everything), not by the layout engines, so
 * a test can drive the scene, hit-testing and export with a known arrangement.
 */
import type { Box, EdgeRoute, FlowGraph, FlowNode, Positions } from "../../src/index";
import type { View } from "../../src/canvas/index";
import { type Random, createRandom } from "./random";

export type PositionKind = "grid" | "layered" | "overlapping" | "extreme";
export const POSITION_KINDS: readonly PositionKind[] = ["grid", "layered", "overlapping", "extreme"];

export interface PositionOptions {
  /** Routes from centre to centre for every edge that is not a self-loop: straight (`true`), or with one or two right-angled corners (`"bent"`). Default false: no routes. */
  routes?: boolean | "bent";
}

/** The box each node kind gets (the library's default node sizes). */
const SIZE: Record<FlowNode["kind"], { width: number; height: number }> = {
  activity: { width: 180, height: 48 },
  stage: { width: 200, height: 56 },
  gateway: { width: 44, height: 44 },
  event: { width: 36, height: 36 },
  note: { width: 160, height: 60 },
};

const GROUP_PAD = { top: 44, left: 20, bottom: 20, right: 20 };

function sizeOf(node: FlowNode): { width: number; height: number } {
  return SIZE[node.kind] ?? SIZE.activity;
}

function union(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** A route from the centre of `s` to the centre of `t`: straight, or (`bent`) through one corner (an L) or two (a Z, its upright drawn from the stream); a segment may have no length. */
function routeOf(rng: Random, s: Box, t: Box, bent: boolean): EdgeRoute {
  const a = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  const b = { x: t.x + t.width / 2, y: t.y + t.height / 2 };
  if (!bent) return { points: [a, b] };
  if (rng.chance()) return { points: [a, { x: b.x, y: a.y }, b] };
  const mx = a.x + (b.x - a.x) * rng.float(0.2, 0.8);
  return { points: [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b] };
}

/**
 * Column of each node: the longest path from a node without predecessors
 * (Kahn's order), nodes a cycle keeps from the order joining after their
 * ordered predecessors, or starting a column of their own.
 */
export function depthsOf(graph: FlowGraph): Map<string, number> {
  const indeg = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const n of graph.nodes) {
    indeg.set(n.id, 0);
    outgoing.set(n.id, []);
  }
  for (const e of graph.edges) {
    if (e.source === e.target || !indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, indeg.get(e.target)! + 1);
    outgoing.get(e.source)!.push(e.target);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  const settle = (id: string, d: number) => {
    depth.set(id, Math.max(depth.get(id) ?? 0, d));
    for (const next of outgoing.get(id)!) {
      depth.set(next, Math.max(depth.get(next) ?? 0, depth.get(id)! + 1));
      indeg.set(next, indeg.get(next)! - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  };
  const ordered = new Set<string>();
  for (const n of graph.nodes) if (indeg.get(n.id) === 0) queue.push(n.id);
  const drain = () => {
    while (queue.length) {
      const id = queue.shift()!;
      ordered.add(id);
      settle(id, depth.get(id) ?? 0);
    }
  };
  drain();
  for (const n of graph.nodes) {
    if (ordered.has(n.id)) continue;
    // A node on a cycle: take the column its settled predecessors give it and let the rest follow.
    queue.push(n.id);
    drain();
  }
  return depth;
}

/**
 * Positions of a graph: `grid` in id order, `layered` by depth, `overlapping`
 * at random in an area too small for the nodes, `extreme` on a grid that
 * starts a thousand million units from the origin and grows away from it,
 * a thousand times wider than the ordinary grid. Groups wrap their members and nested groups with padding.
 */
export function positionsOf(graph: FlowGraph, kind: PositionKind, seed: number, options: PositionOptions = {}): Positions {
  const rng = createRandom(seed);
  const nodes: Record<string, Box> = {};
  const n = graph.nodes.length;
  const columns = Math.max(1, Math.ceil(Math.sqrt(n)));
  const cellW = 180 + 60;
  const cellH = 60 + 40;
  if (kind === "grid" || kind === "extreme") {
    // Extreme: the grid grows away from the origin, so every coordinate is at least 10⁹ in magnitude.
    const sx = kind === "extreme" ? rng.pick([-1, 1]) : 1;
    const sy = kind === "extreme" ? rng.pick([-1, 1]) : 1;
    const off = kind === "extreme" ? 1e9 : 0;
    const step = kind === "extreme" ? 1000 : 1;
    graph.nodes.forEach((node, i) => {
      nodes[node.id] = { x: sx * (off + (i % columns) * cellW * step), y: sy * (off + Math.floor(i / columns) * cellH * step), ...sizeOf(node) };
    });
  } else if (kind === "layered") {
    const depth = depthsOf(graph);
    const rows = new Map<number, number>();
    for (const node of graph.nodes) {
      const d = depth.get(node.id)!;
      const row = rows.get(d) ?? 0;
      rows.set(d, row + 1);
      nodes[node.id] = { x: d * 280, y: row * cellH, ...sizeOf(node) };
    }
  } else {
    const side = Math.max(60, Math.ceil(Math.sqrt(n)) * 60);
    for (const node of graph.nodes) nodes[node.id] = { x: rng.int(0, side), y: rng.int(0, side), ...sizeOf(node) };
  }
  const groups: Record<string, Box> = {};
  const byId = new Map((graph.groups ?? []).map((g) => [g.id, g]));
  const children = new Map<string, string[]>();
  for (const g of graph.groups ?? []) if (g.parent && byId.has(g.parent)) (children.get(g.parent) ?? children.set(g.parent, []).get(g.parent)!).push(g.id);
  const members = new Map<string, Box[]>();
  for (const node of graph.nodes) if (node.group && byId.has(node.group)) (members.get(node.group) ?? members.set(node.group, []).get(node.group)!).push(nodes[node.id]);
  const boxOf = (id: string, seen: Set<string>): Box => {
    if (groups[id]) return groups[id];
    if (seen.has(id)) return { x: 0, y: 0, width: 0, height: 0 };
    seen.add(id);
    const inner = [...(members.get(id) ?? []), ...(children.get(id) ?? []).map((c) => boxOf(c, seen))].filter((b) => b.width > 0 || b.height > 0);
    const u = union(inner);
    const box = inner.length ? { x: u.x - GROUP_PAD.left, y: u.y - GROUP_PAD.top, width: u.width + GROUP_PAD.left + GROUP_PAD.right, height: u.height + GROUP_PAD.top + GROUP_PAD.bottom } : { x: 0, y: 0, width: 0, height: 0 };
    groups[id] = box;
    return box;
  };
  for (const g of graph.groups ?? []) boxOf(g.id, new Set());
  const edges: Record<string, EdgeRoute> = {};
  if (options.routes) {
    for (const e of graph.edges) {
      const s = nodes[e.source];
      const t = nodes[e.target];
      if (!s || !t || e.source === e.target) continue;
      edges[e.id] = routeOf(rng, s, t, options.routes === "bent");
    }
  }
  const all = [...Object.values(nodes), ...Object.values(groups).filter((b) => b.width > 0 || b.height > 0)];
  for (const r of Object.values(edges)) for (const p of r.points) all.push({ x: p.x, y: p.y, width: 0, height: 0 });
  return { nodes, groups, edges, bounds: union(all), engine: "given", direction: "RIGHT" };
}

export type BrokenPositionKind = "missing" | "nonFinite";

/**
 * Positions with planted faults: `missing` leaves a third of the nodes without
 * a box, `nonFinite` puts `NaN` or an infinity into a coordinate or size of a
 * third of them. The bounds are those of the sound boxes.
 */
export function brokenPositionsOf(graph: FlowGraph, kind: BrokenPositionKind, seed: number): { positions: Positions; broken: string[] } {
  const rng = createRandom(seed + 500_009);
  const positions = positionsOf(graph, "grid", seed);
  const broken = rng.sample(graph.nodes.map((n) => n.id), Math.max(1, Math.floor(graph.nodes.length / 3)));
  for (const id of broken) {
    if (kind === "missing") delete positions.nodes[id];
    else {
      const box = positions.nodes[id];
      if (box) box[rng.pick(["x", "y", "width", "height"] as const)] = rng.pick([NaN, Infinity, -Infinity]);
    }
  }
  const sound = Object.values(positions.nodes).filter((b) => [b.x, b.y, b.width, b.height].every(Number.isFinite));
  positions.bounds = union([...sound, ...Object.values(positions.groups)]);
  return { positions, broken };
}

export type ViewportKind = "ordinary" | "tiny" | "huge" | "farAway" | "extremeZoom";
export const VIEWPORT_KINDS: readonly ViewportKind[] = ["ordinary", "tiny", "huge", "farAway", "extremeZoom"];

/**
 * A viewport over the bounds: `ordinary` shows the bounds fitted into a
 * desktop-sized window; `tiny` is at most 40 px on a side around a point of
 * the bounds; `huge` is 10,000 to 30,000 px on a side; `farAway` is ordinary
 * in size but a million to a hundred million units from the bounds; and
 * `extremeZoom` is ordinary in size at a zoom of 10⁻⁶ to 10⁶ about the centre.
 */
export function viewportOf(kind: ViewportKind, bounds: Box, seed: number): View {
  const rng = createRandom(seed);
  const width = kind === "tiny" ? rng.int(1, 40) : kind === "huge" ? rng.int(10_000, 30_000) : rng.int(800, 1600);
  const height = kind === "tiny" ? rng.int(1, 40) : kind === "huge" ? rng.int(10_000, 30_000) : rng.int(600, 1000);
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const centreOn = (zoom: number, fx: number, fy: number): View => ({ x: width / 2 - fx * zoom, y: height / 2 - fy * zoom, zoom, width, height });
  switch (kind) {
    case "ordinary": {
      const fit = Math.min(width / Math.max(1, bounds.width), height / Math.max(1, bounds.height));
      return centreOn(Math.min(2, Math.max(0.1, fit * 0.9)), cx, cy);
    }
    case "tiny":
      return centreOn(1, bounds.x + rng.float(0, bounds.width), bounds.y + rng.float(0, bounds.height));
    case "huge":
      return centreOn(1, cx, cy);
    case "farAway": {
      const away = rng.pick([1e6, 1e7, 1e8]);
      return centreOn(1, cx + rng.pick([-1, 1]) * (away + bounds.width), cy + rng.pick([-1, 1]) * (away + bounds.height));
    }
    case "extremeZoom":
      return centreOn(rng.pick([1e-6, 1e-4, 1e4, 1e6]), cx, cy);
  }
}

/** One viewport of every kind over the bounds, each from the seed. */
export function viewportsOf(bounds: Box, seed: number): Record<ViewportKind, View> {
  return Object.fromEntries(VIEWPORT_KINDS.map((kind, i) => [kind, viewportOf(kind, bounds, seed + i)])) as Record<ViewportKind, View>;
}

export type OddNode = "point" | "huge" | "twin";
export const ODD_NODES: readonly OddNode[] = ["point", "huge", "twin"];

/**
 * Grid positions with three nodes a layout never produces, each drawn from the
 * seed: `point` has no width and no height, `huge` is 20,000 by 12,000, and
 * `twin` has exactly the box of another node, so a straight route between the
 * two has no length. Group boxes stay as the grid gave them, so they may no
 * longer contain these nodes; the bounds are recomputed. A graph of fewer than
 * four nodes gets as many oddities as it has nodes beyond the first.
 */
export function oddPositionsOf(graph: FlowGraph, seed: number, options: PositionOptions = {}): { positions: Positions; odd: Partial<Record<OddNode, string>> } {
  const rng = createRandom(seed + 600_013);
  const positions = positionsOf(graph, "grid", seed, options);
  const ids = graph.nodes.map((n) => n.id).filter((id) => positions.nodes[id]);
  const odd: Partial<Record<OddNode, string>> = {};
  const chosen = rng.sample(ids, Math.min(3, Math.max(0, ids.length - 1)));
  ODD_NODES.forEach((kind, i) => {
    const id = chosen[i];
    if (id === undefined) return;
    odd[kind] = id;
    const box = positions.nodes[id];
    if (kind === "point") Object.assign(box, { width: 0, height: 0 });
    else if (kind === "huge") Object.assign(box, { width: 20_000, height: 12_000 });
    else Object.assign(box, positions.nodes[rng.pick(ids.filter((other) => !chosen.includes(other)))]);
  });
  if (options.routes) {
    for (const e of graph.edges) {
      const s = positions.nodes[e.source];
      const t = positions.nodes[e.target];
      if (s && t && e.source !== e.target) positions.edges[e.id] = routeOf(rng, s, t, options.routes === "bent");
    }
  }
  const all = [...Object.values(positions.nodes), ...Object.values(positions.groups).filter((b) => b.width > 0 || b.height > 0)];
  for (const r of Object.values(positions.edges)) for (const p of r.points) all.push({ x: p.x, y: p.y, width: 0, height: 0 });
  positions.bounds = union(all);
  return { positions, odd };
}

export type Side = "left" | "right" | "top" | "bottom";
export const SIDES: readonly Side[] = ["left", "right", "top", "bottom"];

/**
 * An ordinary-sized viewport at a zoom of 0.5 to 2 whose `side` edge cuts
 * the box: the box's far edge (its right edge for the left side, and so on)
 * lies `offset` screen pixels inside the view, or outside it when `offset` is
 * negative. Across the other axis the box is centred.
 */
export function viewportAtSide(box: Box, side: Side, offset: number, seed: number): View {
  const rng = createRandom(seed);
  const width = rng.int(800, 1600);
  const height = rng.int(600, 1000);
  const zoom = rng.pick([0.5, 0.75, 1, 1.5, 2]);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = side === "left" ? offset - (box.x + box.width) * zoom : side === "right" ? width - offset - box.x * zoom : width / 2 - cx * zoom;
  const y = side === "top" ? offset - (box.y + box.height) * zoom : side === "bottom" ? height - offset - box.y * zoom : height / 2 - cy * zoom;
  return { x, y, zoom, width, height };
}
