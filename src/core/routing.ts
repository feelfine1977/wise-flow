/** Orthogonal visibility-grid routing after swimlane placement. */
import { straightRoute, type Box, type EdgeRoute, type Positions, type XY, positionsBounds } from "./layout.js";
import type { FlowGraph } from "./model.js";

type Port = { point: XY; outside: XY; direction: number };
const CLEARANCE = 12;
const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
const inside = (p: XY, b: Box) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;
const inflate = (b: Box): Box => ({ x: b.x - CLEARANCE, y: b.y - CLEARANCE, width: b.width + 2 * CLEARANCE, height: b.height + 2 * CLEARANCE });
const distance = (a: XY, b: XY) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const ports = (b: Box): Port[] => {
  const points = [{ x: b.x + b.width, y: b.y + b.height / 2 }, { x: b.x + b.width / 2, y: b.y + b.height }, { x: b.x, y: b.y + b.height / 2 }, { x: b.x + b.width / 2, y: b.y }];
  return points.map((point, direction) => ({ point, direction, outside: { x: point.x + CLEARANCE * STEPS[direction][0], y: point.y + CLEARANCE * STEPS[direction][1] } }));
};

/** Whether an axis-aligned segment crosses the open interior of a box. */
export function crossesBox(a: XY, b: XY, box: Box): boolean {
  return a.x === b.x
    ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height
    : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width;
}

class Queue {
  private heap: { state: number; cost: number; estimate: number }[] = [];
  push(item: { state: number; cost: number; estimate: number }) {
    let i = this.heap.length;
    this.heap.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].estimate <= item.estimate) break;
      this.heap[i] = this.heap[parent]; i = parent;
    }
    this.heap[i] = item;
  }
  pop() {
    const first = this.heap[0];
    const tail = this.heap.pop();
    if (this.heap.length && tail) {
      let i = 0;
      while (i * 2 + 1 < this.heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.heap.length && this.heap[child + 1].estimate < this.heap[child].estimate) child++;
        if (this.heap[child].estimate >= tail.estimate) break;
        this.heap[i] = this.heap[child]; i = child;
      }
      this.heap[i] = tail;
    }
    return first;
  }
}

function simplify(points: XY[]): XY[] {
  const result: XY[] = [];
  for (const p of points) {
    if (result.length && distance(result[result.length - 1], p) === 0) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) result.pop(); else break;
    }
    result.push(p);
  }
  return result;
}

/**
 * Keep every sequence flow, dock at shape sides (diamond tips for gateways),
 * and avoid every shape, including the source and target after docking. Costs
 * prefer short routes with few bends and discourage shared tracks/crossings.
 * Crossings remain possible in non-planar diagrams; they are not junctions.
 */
export function routeSequenceFlows(graph: FlowGraph, nodes: Record<string, Box>, options: { allowOverlap?: boolean } = {}): Record<string, EdgeRoute> {
  const boxes = Object.values(nodes);
  if (!boxes.length) return {};
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (!options.allowOverlap && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) throw new Error("Cannot route sequence flows around overlapping shapes. Increase the layout spacing.");
  }
  const obstacles = boxes.map(inflate);
  const xs = new Set<number>(), ys = new Set<number>();
  for (const b of boxes) {
    for (const offset of [CLEARANCE, CLEARANCE * 2]) {
      xs.add(b.x - offset); xs.add(b.x + b.width + offset);
      ys.add(b.y - offset); ys.add(b.y + b.height + offset);
    }
    xs.add(b.x + b.width / 2); ys.add(b.y + b.height / 2);
  }
  const x = [...xs].sort((a, b) => a - b), y = [...ys].sort((a, b) => a - b);
  const nx = x.length, size = nx * y.length;
  const xIndex = new Map(x.map((v, i) => [v, i])), yIndex = new Map(y.map((v, i) => [v, i]));
  const index = (p: XY) => yIndex.get(p.y)! * nx + xIndex.get(p.x)!;
  const points = Array.from({ length: size }, (_, id) => ({ x: x[id % nx], y: y[Math.floor(id / nx)] }));
  const point = (id: number): XY => points[id];
  const free = new Uint8Array(size);
  for (let id = 0; id < size; id++) free[id] = +!obstacles.some((b) => inside(point(id), b));
  const links = new Int32Array(size * 4).fill(-1);
  for (let id = 0; id < size; id++) {
    if (!free[id]) continue;
    const ix = id % nx, iy = Math.floor(id / nx);
    for (const dir of [0, 1]) {
      const next = dir === 0 ? (ix + 1 < nx ? id + 1 : -1) : (iy + 1 < y.length ? id + nx : -1);
      if (next < 0 || !free[next] || obstacles.some((b) => crossesBox(point(id), point(next), b))) continue;
      links[id * 4 + dir] = next; links[next * 4 + dir + 2] = id;
    }
  }
  const used = new Uint16Array(size * 4);
  const result: Record<string, EdgeRoute> = {};
  // Local connections take the direct tracks first; long returns use the gutters.
  const edges = graph.edges.filter((e) => nodes[e.source] && nodes[e.target]).slice().sort((a, b) => distance(nodes[a.source], nodes[a.target]) - distance(nodes[b.source], nodes[b.target]) || a.id.localeCompare(b.id));
  for (const edge of edges) {
    const source = ports(nodes[edge.source]), target = ports(nodes[edge.target]);
    const goals = new Map(target.filter((p) => free[index(p.outside)]).map((p) => [index(p.outside), p]));
    const costs = new Float64Array(size * 4).fill(Infinity);
    const previous = new Int32Array(size * 4).fill(-1);
    const origins = new Int8Array(size * 4).fill(-1);
    const queue = new Queue();
    const goalPoints = [...goals.values()].map((g) => g.outside);
    const estimates = new Float64Array(size).fill(-1);
    const heuristic = (id: number) => {
      if (estimates[id] < 0) {
        let best = Infinity;
        for (const p of goalPoints) best = Math.min(best, distance(point(id), p));
        // A modest directional bias bounds exploration in very dense models.
        // Routing guarantees obstacle clearance, not a globally shortest diagram.
        estimates[id] = best * 1.5;
      }
      return estimates[id];
    };
    source.forEach((p, i) => {
      const id = index(p.outside);
      if (!free[id] || boxes.some((b) => b !== nodes[edge.source] && crossesBox(p.point, p.outside, b))) return;
      const state = id * 4 + p.direction;
      costs[state] = p.direction === 0 ? 0 : 16;
      origins[state] = i;
      queue.push({ state, cost: costs[state], estimate: costs[state] + heuristic(id) });
    });
    let end: number | undefined;
    for (let item = queue.pop(); item; item = queue.pop()) {
      const { state, cost } = item;
      if (cost !== costs[state]) continue;
      const id = Math.floor(state / 4), dir = state % 4;
      const goal = goals.get(id);
      // Reach the target from outside, never by turning back through its body.
      if (goal && dir === (goal.direction + 2) % 4 && !(edge.source === edge.target && previous[state] === -1)) { end = state; break; }
      for (let nextDir = 0; nextDir < 4; nextDir++) {
        if (nextDir === (dir + 2) % 4) continue;
        const next = links[id * 4 + nextDir];
        if (next < 0) continue;
        const length = distance(point(id), point(next));
        const crossing = used[next * 4 + (nextDir + 1) % 4] + used[next * 4 + (nextDir + 3) % 4];
        const nextCost = cost + length * (1 + 5 * Math.min(2, used[id * 4 + nextDir])) + (nextDir === dir ? 0 : 32) + 10 * Math.min(2, crossing);
        const nextState = next * 4 + nextDir;
        if (nextCost >= costs[nextState]) continue;
        costs[nextState] = nextCost; previous[nextState] = state; origins[nextState] = origins[state];
        queue.push({ state: nextState, cost: nextCost, estimate: nextCost + heuristic(next) });
      }
    }
    if (end === undefined) {
      // A user can temporarily overlap boxes while dragging. Keep both endpoints
      // attached instead of throwing or retaining a route to the old position.
      if (options.allowOverlap) { result[edge.id] = straightRoute(nodes[edge.source], nodes[edge.target]); continue; }
      throw new Error(`Cannot route sequence flow '${edge.id}' without crossing a shape. Increase the layout spacing.`);
    }
    const route: XY[] = [goals.get(Math.floor(end / 4))!.point];
    let firstPort = source[origins[end]];
    for (let state = end; state >= 0; state = previous[state]) {
      const id = Math.floor(state / 4);
      route.push(point(id));
      if (previous[state] < 0) firstPort = source[origins[state]];
      if (previous[state] >= 0) {
        const before = Math.floor(previous[state] / 4), dir = state % 4;
        used[before * 4 + dir]++; used[id * 4 + (dir + 2) % 4]++;
      }
    }
    route.push(firstPort.point);
    result[edge.id] = { points: simplify(route.reverse()) };
  }
  return result;
}

/** Absolute manual positions; graph identity, observations and ordering are unchanged. */
export function repositionNodes(graph: FlowGraph, positions: Positions, overrides: Readonly<Record<string, XY>>): Positions {
  const nodes = { ...positions.nodes };
  let changed = false;
  for (const [id, point] of Object.entries(overrides)) {
    const box = nodes[id];
    if (!box || !Number.isFinite(point.x) || !Number.isFinite(point.y) || (point.x === box.x && point.y === box.y)) continue;
    nodes[id] = { ...box, ...point };
    changed = true;
  }
  if (!changed) return positions;
  // A moved activity can obstruct a nonincident edge, so route all supplied edges.
  // Self loops remain overlays anchored to their activity.
  const edges = routeSequenceFlows({ ...graph, edges: graph.edges.filter((e) => e.source !== e.target) }, nodes, { allowOverlap: true });
  const partial = { nodes, groups: positions.groups, edges };
  return { ...positions, ...partial, bounds: positionsBounds(partial) };
}
