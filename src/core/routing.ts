/** Orthogonal visibility-grid routing after swimlane placement. */
import { straightRoute, type Box, type EdgeRoute, type Positions, type XY, createPositions, finiteBox } from "./layout.js";
import type { FlowGraph } from "./model.js";

type Port = { point: XY; outside: XY; direction: number };
const CLEARANCE = 12;
const STEPS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
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

/** Binary min-heap on the estimate; the popped entry is read from `state` and `cost`. */
class Queue {
  private states = new Int32Array(1024);
  private costs = new Float64Array(1024);
  private estimates = new Float64Array(1024);
  private length = 0;
  state = -1;
  cost = 0;
  push(state: number, cost: number, estimate: number) {
    if (this.length === this.states.length) this.grow();
    const { states, costs, estimates } = this;
    let i = this.length++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (estimates[parent] <= estimate) break;
      states[i] = states[parent]; costs[i] = costs[parent]; estimates[i] = estimates[parent]; i = parent;
    }
    states[i] = state; costs[i] = cost; estimates[i] = estimate;
  }
  clear() {
    this.length = 0;
  }
  pop(): boolean {
    if (!this.length) return false;
    const { states, costs, estimates } = this;
    this.state = states[0]; this.cost = costs[0];
    const n = --this.length;
    if (n) {
      const state = states[n], cost = costs[n], estimate = estimates[n];
      let i = 0;
      while (i * 2 + 1 < n) {
        let child = i * 2 + 1;
        if (child + 1 < n && estimates[child + 1] < estimates[child]) child++;
        if (estimates[child] >= estimate) break;
        states[i] = states[child]; costs[i] = costs[child]; estimates[i] = estimates[child]; i = child;
      }
      states[i] = state; costs[i] = cost; estimates[i] = estimate;
    }
    return true;
  }
  private grow() {
    const states = new Int32Array(this.states.length * 2), costs = new Float64Array(states.length), estimates = new Float64Array(states.length);
    states.set(this.states); costs.set(this.costs); estimates.set(this.estimates);
    this.states = states; this.costs = costs; this.estimates = estimates;
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
export function routeSequenceFlows(graph: FlowGraph, given: Record<string, Box>, options: { allowOverlap?: boolean } = {}): Record<string, EdgeRoute> {
  // A box with a number that is not finite is left out as if missing: no search can end on it.
  const nodes = Object.fromEntries(Object.entries(given).filter(([, b]) => finiteBox(b)));
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
  const px = Float64Array.from(points, (p) => p.x), py = Float64Array.from(points, (p) => p.y);
  // Index range of the grid lines strictly between lo and hi.
  const strictly = (lines: number[], lo: number, hi: number): [number, number] => {
    let first = 0;
    while (first < lines.length && lines[first] <= lo) first++;
    let last = first;
    while (last < lines.length && lines[last] < hi) last++;
    return [first, last];
  };
  const free = new Uint8Array(size).fill(1);
  // Bit 1 blocks the step to the right of a grid point, bit 2 the step below it.
  const blocked = new Uint8Array(size);
  for (const b of obstacles) {
    const [x0, x1] = strictly(x, b.x, b.x + b.width), [y0, y1] = strictly(y, b.y, b.y + b.height);
    for (let iy = y0; iy < y1; iy++) for (let ix = x0; ix < x1; ix++) free[iy * nx + ix] = 0;
    // A horizontal step crosses when its row is inside and its span overlaps; likewise vertically.
    for (let iy = y0; iy < y1; iy++) for (let ix = Math.max(0, x0 - 1); ix < x1 && ix + 1 < nx; ix++) blocked[iy * nx + ix] |= 1;
    for (let ix = x0; ix < x1; ix++) for (let iy = Math.max(0, y0 - 1); iy < y1 && iy + 1 < y.length; iy++) blocked[iy * nx + ix] |= 2;
  }
  const links = new Int32Array(size * 4).fill(-1);
  for (let id = 0; id < size; id++) {
    if (!free[id]) continue;
    const ix = id % nx, iy = Math.floor(id / nx);
    for (const dir of [0, 1]) {
      const next = dir === 0 ? (ix + 1 < nx ? id + 1 : -1) : (iy + 1 < y.length ? id + nx : -1);
      if (next < 0 || !free[next] || blocked[id] & (dir + 1)) continue;
      links[id * 4 + dir] = next; links[next * 4 + dir + 2] = id;
    }
  }
  const used = new Uint16Array(size * 4);
  // Search state is reset per edge by a generation stamp rather than by refilling.
  const costs = new Float64Array(size * 4), previous = new Int32Array(size * 4), origins = new Int8Array(size * 4);
  const reached = new Uint32Array(size * 4), estimated = new Uint32Array(size), estimates = new Float64Array(size);
  let generation = 0;
  // A search for a goal in another part of the grid than every start went over the grid many times.
  // The parts are labelled once: a walk per edge doubled the time of ordinary routing.
  const part = new Int32Array(size).fill(-1), stack = new Int32Array(size);
  for (let first = 0; first < size; first++) {
    if (part[first] >= 0) continue;
    part[first] = first;
    for (let top = 0, id = first; ; id = stack[--top]) {
      for (let d = 0; d < 4; d++) {
        const next = links[id * 4 + d];
        if (next < 0 || part[next] >= 0) continue;
        part[next] = first;
        stack[top++] = next;
      }
      if (!top) break;
    }
  }
  const reaches = (starts: number[], goals: Map<number, unknown>) => starts.some((s) => [...goals.keys()].some((g) => part[g] === part[s]));
  const queue = new Queue();
  const result: Record<string, EdgeRoute> = {};
  // Local connections take the direct tracks first; long returns use the gutters.
  const edges = graph.edges.filter((e) => nodes[e.source] && nodes[e.target]).slice().sort((a, b) => distance(nodes[a.source], nodes[a.target]) - distance(nodes[b.source], nodes[b.target]) || String(a.id).localeCompare(String(b.id)));
  for (const edge of edges) {
    const source = ports(nodes[edge.source]), target = ports(nodes[edge.target]);
    const goals = new Map(target.filter((p) => free[index(p.outside)]).map((p) => [index(p.outside), p]));
    generation++;
    queue.clear();
    const goalPoints = [...goals.values()].map((g) => g.outside);
    const heuristic = (id: number) => {
      if (estimated[id] !== generation) {
        estimated[id] = generation;
        let best = Infinity;
        for (const p of goalPoints) best = Math.min(best, Math.abs(px[id] - p.x) + Math.abs(py[id] - p.y));
        // A modest directional bias bounds exploration in very dense models.
        // Routing guarantees obstacle clearance, not a globally shortest diagram.
        estimates[id] = best * 1.5;
      }
      return estimates[id];
    };
    const starts: number[] = [];
    source.forEach((p, i) => {
      const id = index(p.outside);
      if (!free[id] || boxes.some((b) => b !== nodes[edge.source] && crossesBox(p.point, p.outside, b))) return;
      starts.push(id);
      const state = id * 4 + p.direction;
      reached[state] = generation; costs[state] = p.direction === 0 ? 0 : 16; previous[state] = -1; origins[state] = i;
      queue.push(state, costs[state], costs[state] + heuristic(id));
    });
    let end: number | undefined;
    if (reaches(starts, goals)) while (queue.pop()) {
      const state = queue.state, cost = queue.cost;
      if (cost !== costs[state]) continue;
      const id = state >> 2, dir = state & 3;
      const goal = goals.get(id);
      // Reach the target from outside, never by turning back through its body.
      if (goal && dir === (goal.direction + 2) % 4 && !(edge.source === edge.target && previous[state] === -1)) { end = state; break; }
      for (let nextDir = 0; nextDir < 4; nextDir++) {
        if (nextDir === ((dir + 2) & 3)) continue;
        const next = links[id * 4 + nextDir];
        if (next < 0) continue;
        const length = Math.abs(px[id] - px[next]) + Math.abs(py[id] - py[next]);
        const crossing = used[next * 4 + ((nextDir + 1) & 3)] + used[next * 4 + ((nextDir + 3) & 3)];
        const nextCost = cost + length * (1 + 5 * Math.min(2, used[id * 4 + nextDir])) + (nextDir === dir ? 0 : 32) + 10 * Math.min(2, crossing);
        const nextState = next * 4 + nextDir;
        if (reached[nextState] === generation && nextCost >= costs[nextState]) continue;
        reached[nextState] = generation; costs[nextState] = nextCost; previous[nextState] = state; origins[nextState] = origins[state];
        queue.push(nextState, nextCost, nextCost + heuristic(next));
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
  return createPositions({ nodes, groups: positions.groups, edges }, positions.engine, positions.direction);
}
