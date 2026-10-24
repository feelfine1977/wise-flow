/**
 * The courses of paths that a layout draws as something else: a path against
 * the reading direction runs as its own line below the flow it returns over
 * (a layout draws it as a frame around the groups between its ends), and two
 * paths in opposite directions between the same two nodes run side by side
 * (a layout draws them as one line).
 */
import { edgePoints } from "./element-marks.js";
import { type Box, type Positions, type XY, createPositions } from "./layout.js";
import type { FlowEdge, FlowGraph } from "./model.js";
import { routeSequenceFlows } from "./routing.js";

/** Where a path's label goes: beside `at` on its course, on the side `side` points to (a unit vector). */
export interface CourseLabel {
  at: XY;
  side: XY;
}

export interface PathCourses {
  /** The positions with the new courses in `edges` (the given positions where no course changed). */
  positions: Positions;
  /** The paths that run against the reading direction, drawn below the flow they return over. */
  backward: ReadonlySet<string>;
  /** Where the label of a path with a new course goes. */
  labels: ReadonlyMap<string, CourseLabel>;
}

/** Above this many paths between placed nodes the layout's routes are kept: the courses are for maps a reader follows path by path. */
export const COURSE_LIMIT = 5000;
/** Paper between the lowest box a backward path returns over and its line. */
const BELOW = 20;
/** Paper between two backward paths' lines, besides their half widths. */
const APART = 6;
/** Paper between two opposite paths drawn side by side. */
const BESIDE = 4;
/** How far a backward path's leg steps aside, into the gap beside its node's column, where a box lies below the node. */
const ASIDE = 12;

const unit = (x: number, y: number): XY => {
  const l = Math.hypot(x, y);
  return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
};

/** The right-hand normal of the segment from `a` to `b` (on screen, y down). */
const right = (a: XY, b: XY): XY => unit(-(b.y - a.y), b.x - a.x);

/** A polyline moved `d` to the right of its direction, each corner along the bisector of its two segments. */
export function offsetCourse(points: readonly XY[], d: number): XY[] {
  const normals = points.slice(1).map((p, i) => right(points[i], p));
  return points.map((p, i) => {
    const a = normals[i - 1];
    const b = normals[i];
    const n = !a ? b : !b ? a : unit(a.x + b.x, a.y + b.y);
    // A corner moves so that both segments keep their distance: 1 / cos of half the angle between them.
    const cos = a && b ? n.x * a.x + n.y * a.y : 1;
    const k = cos > 0.2 ? d / cos : d;
    return { x: p.x + n.x * k, y: p.y + n.y * k };
  });
}

/** The point at half a polyline's length and the right-hand normal of the segment it lies on. */
function halfway(points: readonly XY[]): CourseLabel {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let rest = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i] || i === lengths.length - 1) {
      const [a, b] = [points[i], points[i + 1]];
      const f = lengths[i] ? Math.min(1, rest / lengths[i]) : 0;
      return { at: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, side: right(a, b) };
    }
    rest -= lengths[i];
  }
  return { at: points[0], side: { x: 0, y: -1 } };
}

/** A polyline without repeated points and without points in the middle of a straight run. */
function simplified(points: XY[]): XY[] {
  const out: XY[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const before = out[out.length - 2];
    if (before && last && ((before.x === last.x && last.x === p.x) || (before.y === last.y && last.y === p.y))) out.pop();
    out.push(p);
  }
  return out;
}

/**
 * The courses of a scene's paths (follows edges between two different placed
 * nodes), as wide as `width` gives them:
 *
 * - A path whose target's middle lies before its source's start in the
 *   reading direction (`positions.direction`) runs against it. It leaves its
 *   source from the side away from the flow (below, for a flow to the right or
 *   the left; right of it, for a flow down or up), runs below every node and
 *   group of the graph between its two ends (groups drawn as `bands`, and
 *   positions given for elements the graph does not have, are not in its way)
 *   and enters its target from that side, so its head points against the flow
 *   and never along a group's frame. Backward paths over the same stretch lie
 *   one below the other, shorter ones nearer the flow; the ends of several on
 *   one node are spread along its side. Where a box lies below a node, the
 *   path steps aside into the gap beside the node's column first.
 * - Two paths in opposite directions between the same two nodes, neither
 *   against the reading direction, are each moved to their own right, so that
 *   they run side by side with their own heads and labels.
 *
 * Above `COURSE_LIMIT` paths, or without such paths, the positions are
 * returned as given.
 */
export function pathCourses(graph: FlowGraph, positions: Positions, options: { width: (edge: FlowEdge) => number; bands?: ReadonlySet<string> }): PathCourses {
  // A supplied model loop keeps its course; missing courses use the sequence-flow router, including its obstacle clearance.
  const loops = graph.edges.filter((e) => e.kind === "flow" && e.source === e.target && !(positions.edges[e.id]?.points.length >= 2));
  if (loops.length) positions = createPositions({ ...positions, edges: { ...positions.edges, ...routeSequenceFlows({ ...graph, edges: loops }, positions.nodes, { allowOverlap: true }) } }, positions.engine, positions.direction);
  const unchanged: PathCourses = { positions, backward: new Set(), labels: new Map() };
  const nodes = positions.nodes;
  const paths = graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target && nodes[e.source] && nodes[e.target]);
  if (!paths.length || paths.length > COURSE_LIMIT) return unchanged;
  const along = positions.direction === "RIGHT" || positions.direction === "LEFT";
  const sign = positions.direction === "RIGHT" || positions.direction === "DOWN" ? 1 : -1;
  // A box along the flow (m) and across it (c, growing away from the flow's side the backward paths take).
  const span = (b: Box) => (along ? { m0: b.x, m1: b.x + b.width, c0: b.y, c1: b.y + b.height } : { m0: b.y, m1: b.y + b.height, c0: b.x, c1: b.x + b.width });
  const at = (m: number, c: number): XY => (along ? { x: m, y: c } : { x: c, y: m });
  const middle = (b: Box) => (along ? b.x + b.width / 2 : b.y + b.height / 2);
  const start = (b: Box) => (sign > 0 ? span(b).m0 : span(b).m1);
  const backward = paths.filter((e) => sign * middle(nodes[e.target]) < sign * start(nodes[e.source]));
  // Opposite paths of which neither runs backward: a backward one has a course of its own already.
  const isBackward = new Set(backward.map((e) => e.id));
  const forward = new Set(paths.filter((e) => !isBackward.has(e.id)).map((e) => `${e.source}\u0000${e.target}`));
  const opposite = paths.filter((e) => !isBackward.has(e.id) && forward.has(`${e.target}\u0000${e.source}`));
  if (!backward.length && !opposite.length) return unchanged;

  const edges = { ...positions.edges };
  const labels = new Map<string, CourseLabel>();
  // The graph's own nodes and groups: positions given for elements it does not have are no obstacle.
  const nodeSpans = graph.nodes.flatMap((n) => (nodes[n.id] ? [{ id: n.id, ...span(nodes[n.id]) }] : []));
  const groupSpans = (graph.groups ?? []).flatMap((g) => (positions.groups[g.id] && !options.bands?.has(g.id) ? [{ id: g.id, ...span(positions.groups[g.id]) }] : []));
  const obstacles = [...nodeSpans, ...groupSpans];

  // Backward paths: their stretch along the flow, then their line's depth, shorter ones first and so nearer the flow.
  const lines = backward
    .map((e) => {
      const [a, b] = [middle(nodes[e.source]), middle(nodes[e.target])];
      return { edge: e, lo: Math.min(a, b), hi: Math.max(a, b), width: options.width(e), depth: 0 };
    })
    .sort((p, q) => p.hi - p.lo - (q.hi - q.lo) || (p.edge.id < q.edge.id ? -1 : 1));
  const laid: typeof lines = [];
  for (const line of lines) {
    let depth = -Infinity;
    for (const o of obstacles) if (o.m0 < line.hi && line.lo < o.m1) depth = Math.max(depth, o.c1 + BELOW + line.width / 2);
    for (const other of laid) if (other.lo < line.hi && line.lo < other.hi) depth = Math.max(depth, other.depth + other.width / 2 + APART + line.width / 2);
    line.depth = depth;
    laid.push(line);
  }

  // The ends on each node, spread along its far side in reading order: a deeper line's end lies further from the stretch it returns over.
  const ends = new Map<string, { line: (typeof lines)[number]; role: "source" | "target" }[]>();
  for (const line of lines) {
    for (const role of ["source", "target"] as const) {
      const id = line.edge[role];
      ends.set(id, [...(ends.get(id) ?? []), { line, role }]);
    }
  }
  const ports = new Map<string, number>();
  for (const [id, list] of ends) {
    const s = span(nodes[id]);
    list.sort((p, q) => (p.role === "source" ? p.line.depth : -p.line.depth) - (q.role === "source" ? q.line.depth : -q.line.depth) || (p.line.edge.id < q.line.edge.id ? -1 : 1));
    list.forEach((end, k) => {
      const f = (k + 1) / (list.length + 1);
      ports.set(`${end.line.edge.id} ${end.role}`, sign > 0 ? s.m0 + f * (s.m1 - s.m0) : s.m1 - f * (s.m1 - s.m0));
    });
  }

  // A leg from a node's far side down to the line's depth, stepping aside where a box lies below the node.
  const leg = (node: string, m: number, depth: number, role: "source" | "target"): XY[] => {
    const s = span(nodes[node]);
    // Nodes and groups below the node (a group around it starts above its far side).
    const below = obstacles.filter((o) => o.id !== node && o.m0 < m && m < o.m1 && o.c0 >= s.c1 && o.c0 < depth);
    if (!below.length) return [at(m, s.c1), at(m, depth)];
    const step = s.c1 + Math.min(ASIDE, (below.reduce((v, o) => Math.min(v, o.c0), Infinity) - s.c1) / 2);
    // The node's column: the nodes beside it across the flow and the groups below it. A source steps back towards its
    // target, a target ahead towards its source.
    const column = obstacles.filter((o, i) => o.m0 < s.m1 && s.m0 < o.m1 && (i < nodeSpans.length || (o.c0 >= s.c1 && o.c0 < depth)));
    const back = (role === "source") === sign > 0;
    const aside = back ? column.reduce((v, o) => Math.min(v, o.m0), s.m0) - ASIDE : column.reduce((v, o) => Math.max(v, o.m1), s.m1) + ASIDE;
    return [at(m, s.c1), at(m, step), at(aside, step), at(aside, depth)];
  };
  for (const line of lines) {
    const e = line.edge;
    const out = leg(e.source, ports.get(`${e.id} source`)!, line.depth, "source");
    const into = leg(e.target, ports.get(`${e.id} target`)!, line.depth, "target").reverse();
    edges[e.id] = { points: simplified([...out, ...into]) };
    // The label on the line's middle, on the side of the flow.
    labels.set(e.id, { at: at((out[out.length - 1][along ? "x" : "y"] + into[0][along ? "x" : "y"]) / 2, line.depth), side: at(0, -1) });
  }

  // Opposite paths: each to its own right, so that the two lie side by side.
  for (const e of opposite) {
    const points = edgePoints(positions, e)!;
    const course = offsetCourse(points, options.width(e) / 2 + BESIDE / 2);
    edges[e.id] = { points: course };
    // The label beside the course's middle, on the path's own side.
    labels.set(e.id, halfway(course));
  }
  return { positions: createPositions({ nodes, groups: positions.groups, edges }, positions.engine, positions.direction), backward: new Set(backward.map((e) => e.id)), labels };
}
