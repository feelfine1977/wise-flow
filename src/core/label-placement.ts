import type { EdgeMark, ElementText } from "./element-marks.js";
import type { Box, XY } from "./layout.js";
import type { TextMeasure } from "./text.js";

/** What a path's label keeps clear of besides the other labels and paths: the cards and the groups' titles. */
export interface LabelObstacles {
  nodes: readonly Box[];
  titles: readonly Box[];
}

// What covering each thing costs a label; a path's segment costs more the wider it is.
const COST = { node: 60, label: 40, title: 40, segment: 10, perWidth: 4 };
// Along a segment from its middle, in steps; how far a label sits off its line, and how far more with a leader.
const STEP = 16;
const STEPS = [0, -1, 1, -2, 2];
const GAP = 4;
const FAR = 24;
// A label is clear under this cost; the four longest segments of a route carry candidates.
const CLEAR = COST.segment;
const SEGMENTS = 4;
const CELL = 64;

interface Segment { a: XY; b: XY; width: number; edge: number }

/**
 * Boxes and segments bucketed by the cells of a grid they touch, so a query
 * looks at its neighbourhood only; one wider or taller than `SPAN` cells is
 * kept apart and met by every query, one that is not finite by none.
 */
class Grid<T> {
  private cells = new Map<string, T[]>();
  private wide: T[] = [];
  add(box: Box, item: T): void {
    const keys = cellsOf(box);
    if (keys === "wide") this.wide.push(item);
    else for (const key of keys) {
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(item);
      else this.cells.set(key, [item]);
    }
  }
  near(box: Box): Set<T> {
    const out = new Set<T>(this.wide);
    const keys = cellsOf(box);
    if (keys !== "wide") for (const key of keys) for (const item of this.cells.get(key) ?? []) out.add(item);
    return out;
  }
}

const SPAN = 16;

function cellsOf(box: Box): string[] | "wide" {
  const [i0, j0, i1, j1] = [Math.floor(box.x / CELL), Math.floor(box.y / CELL), Math.floor((box.x + box.width) / CELL), Math.floor((box.y + box.height) / CELL)];
  if (![i0, j0, i1, j1].every(Number.isFinite)) return [];
  if (i1 - i0 > SPAN || j1 - j0 > SPAN) return "wide";
  const keys: string[] = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) keys.push(`${i},${j}`);
  return keys;
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function segmentBox(s: Segment): Box {
  const h = s.width / 2;
  return { x: Math.min(s.a.x, s.b.x) - h, y: Math.min(s.a.y, s.b.y) - h, width: Math.abs(s.a.x - s.b.x) + s.width, height: Math.abs(s.a.y - s.b.y) + s.width };
}

/** Whether a segment, as wide as its line, crosses a box (Liang–Barsky on the box grown by half the width). */
function crosses(s: Segment, box: Box): boolean {
  const h = s.width / 2;
  const [x0, y0, x1, y1] = [box.x - h, box.y - h, box.x + box.width + h, box.y + box.height + h];
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  let lo = 0, hi = 1;
  for (const [p, q] of [[-dx, s.a.x - x0], [dx, x1 - s.a.x], [-dy, s.a.y - y0], [dy, y1 - s.a.y]] as const) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) lo = Math.max(lo, r);
      else hi = Math.min(hi, r);
      if (lo > hi) return false;
    }
  }
  return true;
}

/** The box a label's text `width` wide covers, from its baseline up a full size and a fifth below. */
function textBox(text: ElementText, at: XY, width: number): Box {
  return { x: at.x - width / 2, y: at.y - text.size, width, height: text.size * 1.2 };
}

interface Candidate { at: XY; from: XY; penalty: number }

/**
 * Where a label may sit: beside the middle of each of the route's longest
 * segments and in steps of 16 along it, above or below a horizontal segment,
 * either side of a vertical one; `far` more off the line.
 */
function candidates(mark: EdgeMark, text: ElementText, width: number, far: number): Candidate[] {
  const out: Candidate[] = [];
  const segments = mark.points.slice(1).map((b, i) => ({ a: mark.points[i], b, i, length: Math.hypot(b.x - mark.points[i].x, b.y - mark.points[i].y) }));
  const longest = segments.filter((s) => s.length > 0).sort((p, q) => q.length - p.length || p.i - q.i).slice(0, SEGMENTS);
  const off = mark.width / 2 + GAP + far;
  for (const s of longest) {
    const ux = (s.b.x - s.a.x) / s.length, uy = (s.b.y - s.a.y) / s.length;
    for (const step of STEPS) {
      const t = s.length / 2 + step * STEP;
      if (t < 0 || t > s.length) continue;
      const p = { x: s.a.x + ux * t, y: s.a.y + uy * t };
      const sides: XY[] = Math.abs(ux) >= Math.abs(uy)
        ? [{ x: p.x, y: p.y - off }, { x: p.x, y: p.y + off + 0.8 * text.size }]
        : [{ x: p.x + off + width / 2, y: p.y + 0.35 * text.size }, { x: p.x - off - width / 2, y: p.y + 0.35 * text.size }];
      for (const at of sides) out.push({ at, from: p, penalty: 1 + Math.abs(step) * 0.1 + (far ? 1 : 0) });
    }
  }
  return out;
}

/**
 * Path labels moved clear of the cards, the groups' titles, the other labels
 * and the other paths (0.5, `FlowSceneOptions.labelPlacement: "clear"`): the
 * widest paths placed first (ties by id), each label where it stands when it
 * covers nothing, else at the cheapest candidate beside its route; when every
 * candidate beside the line covers something, one further off with a leader
 * back to the line (`EdgeMark.leader`), else the cheapest. Deterministic; a
 * path without a count label keeps its mark.
 */
export function placeEdgeLabels(edges: readonly EdgeMark[], obstacles: LabelObstacles, measure: TextMeasure): EdgeMark[] {
  const fixed = new Grid<{ box: Box; cost: number }>();
  for (const box of obstacles.nodes) fixed.add(box, { box, cost: COST.node });
  for (const box of obstacles.titles) fixed.add(box, { box, cost: COST.title });
  const lines = new Grid<Segment>();
  edges.forEach((m, edge) => m.points.slice(1).forEach((b, i) => {
    const s = { a: m.points[i], b, width: m.width, edge };
    lines.add(segmentBox(s), s);
  }));
  const placed = new Grid<Box>();
  const cost = (box: Box, edge: number) => {
    let sum = 0;
    for (const o of fixed.near(box)) if (overlap(o.box, box)) sum += o.cost;
    for (const b of placed.near(box)) if (overlap(b, box)) sum += COST.label;
    for (const s of lines.near(box)) if (s.edge !== edge && crosses(s, box)) sum += COST.segment + COST.perWidth * s.width;
    return sum;
  };
  const order = edges.map((_, i) => i).sort((a, b) => edges[b].width - edges[a].width || (edges[a].id < edges[b].id ? -1 : edges[a].id > edges[b].id ? 1 : 0));
  const out = [...edges];
  for (const i of order) {
    const mark = edges[i];
    const text = mark.texts.find((t) => t.role === "count");
    if (!text || mark.points.length < 2) continue;
    const here = { x: text.x, y: text.y };
    const width = measure(text.text, text);
    let best = { at: here, box: textBox(text, here, width), cost: 0, leader: undefined as [XY, XY] | undefined };
    best.cost = cost(best.box, i);
    if (best.cost >= CLEAR) {
      const score = (c: Candidate) => {
        const box = textBox(text, c.at, width);
        return { at: c.at, box, cost: cost(box, i) + c.penalty, from: c.from };
      };
      const near = candidates(mark, text, width, 0).map(score);
      const pick = (list: ReturnType<typeof score>[]) => list.reduce<ReturnType<typeof score> | undefined>((a, c) => (!a || c.cost < a.cost ? c : a), undefined);
      const close = pick(near);
      if (close && close.cost < best.cost) best = { at: close.at, box: close.box, cost: close.cost, leader: undefined };
      if (best.cost >= CLEAR) {
        const away = pick(candidates(mark, text, width, FAR).map(score));
        if (away && away.cost < CLEAR) best = { at: away.at, box: away.box, cost: away.cost, leader: [away.from, nearestOnBox(away.box, away.from)] };
      }
    }
    placed.add(best.box, best.box);
    if (best.at !== here) {
      out[i] = { ...mark, texts: mark.texts.map((t) => (t === text ? { ...t, x: round(best.at.x), y: round(best.at.y), anchor: "middle" } : t)), ...(best.leader && { leader: best.leader.map((p) => ({ x: round(p.x), y: round(p.y) })) as [XY, XY] }) };
    }
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The point of a box nearest to `p`. */
function nearestOnBox(box: Box, p: XY): XY {
  return { x: Math.min(Math.max(p.x, box.x), box.x + box.width), y: Math.min(Math.max(p.y, box.y), box.y + box.height) };
}
