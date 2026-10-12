/**
 * How a map reads, measured without looking. A `Reading` is what one renderer
 * drew at one view, in map units: the cards, every text with its box and font
 * size, the badges, the path lines with their width and colour, the self-loops,
 * and, where the renderer shows them, the note on withheld paths and the
 * legend's printed end values. `readCanvas` records a Canvas draw of a
 * prepared scene; the React map's reader is in `tests/react/map-reading.ts`.
 * `checkReading` holds a reading against what the scene says the map must
 * show and returns every property that fails, with the boxes involved, and
 * `pictureOf` draws a rung with those boxes marked.
 *
 * Texts are measured as the library estimates them, 0.55 em per character,
 * from an alphabetic baseline 0.8 em above to 0.25 em below it, from a middle
 * baseline half an em each way. A box meets another only where they share an
 * area wider and taller than `TOUCH` (touching edges do not count).
 */
import type { DrawContext, PreparedScene, View } from "../../src/canvas/index";
import { drawScene } from "../../src/canvas/index";
import { type Box, type FlowEdge, type FlowGraph, type FlowNode, type FlowScene, type Locale, type NodeKind, type Positions } from "../../src/index";
import { type ListName, watch } from "./ink";
import type { Rung } from "./ladder";

/** The smallest text on screen the map should draw, in pixels: the minimum the look of the map sets (9 px). */
export const MIN_TEXT_PX = 9;
/** Overlap below this many map units in either direction is touching, not covering. */
export const TOUCH = 0.5;

export type TextRole = "node" | "path" | "arc" | "loop" | "badge" | "chip" | "group";

export interface Card {
  id: string;
  kind: NodeKind;
  box: Box;
}

export interface DrawnText {
  /** The element that drew it: a node, an edge, or an overlay mark's id. */
  owner: string;
  role: TextRole;
  text: string;
  box: Box;
  /** Font size in map units; on screen it is this times the zoom. */
  size: number;
}

export interface DrawnPath {
  id: string;
  width: number;
  color: string;
}

export interface Reading {
  renderer: "react" | "canvas";
  /** Zoom of the view the reading was taken at. */
  zoom: number;
  cards: Card[];
  texts: DrawnText[];
  /** Badge shapes with the card they sit on. */
  badges: { id: string; owner: string; box: Box }[];
  /** Lines between two activities; self-loops are in `loops`. */
  paths: DrawnPath[];
  /** Edge ids of the self-loops drawn. */
  loops: string[];
  /** The note on withheld paths as printed, or the counts a draw reported. */
  note?: string | { shown: number; total: number };
  /** The path width row of the legend: the low and high end of its scale, written out; its one sample twice where every path has one count. */
  widthEnds?: [string, string];
  /** The path colour row of the legend: the metric, its domain and colour stops, and whether values are placed by their square root. */
  colorScale?: { metric: string; domain: number[]; stops: string[]; sqrt?: boolean };
}

// ---------------------------------------------------------------------------
// Geometry

export const estimate = (text: string, size: number): number => Array.from(text).length * 0.55 * size;

export function textBox(text: string, x: number, y: number, size: number, align: "start" | "middle" | "end", baseline: "alphabetic" | "middle"): Box {
  const width = estimate(text, size);
  const x0 = align === "end" ? x - width : align === "middle" ? x - width / 2 : x;
  const [up, down] = baseline === "middle" ? [size / 2, size / 2] : [0.8 * size, 0.25 * size];
  return { x: x0, y: y - up, width, height: up + down };
}

/** Whether two boxes share an area larger than touching. */
export function covers(a: Box, b: Box): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > TOUCH && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > TOUCH;
}

/** The view that fits a box into a canvas, as the Canvas map fits its scene (8 % padding on each side, zoom 0.05 … 3). */
export function fitView(bounds: Box, width: number, height: number, padding = 0.08): View {
  const zoom = Math.min(3, Math.max(0.05, Math.min(width / (bounds.width * (1 + 2 * padding)), height / (bounds.height * (1 + 2 * padding)))));
  return { zoom, x: width / 2 - (bounds.x + bounds.width / 2) * zoom, y: height / 2 - (bounds.y + bounds.height / 2) * zoom, width, height };
}

// ---------------------------------------------------------------------------
// Recording a Canvas draw

interface Op {
  kind: "fill" | "stroke" | "text";
  /** Box in map units: the path's bounds, or the text's box. */
  box: Box;
  lineWidth: number;
  style: string;
  text?: string;
  size?: number;
}

interface Visit {
  list: ListName;
  index: number;
  id: string;
  ops: Op[];
}

/**
 * A 2D context that records, per element read from the scene's lists, what
 * was filled, stroked and written, in map units: the view's translation and
 * scale are undone.
 */
function recorder(view: View) {
  const visits: Visit[] = [];
  let current: Visit | undefined;
  let t = { sx: 1, sy: 1, tx: 0, ty: 0 };
  const stack: (typeof t)[] = [];
  let path: Box | undefined;
  let pen: [number, number] = [0, 0];
  const own = { fillStyle: "" as unknown, strokeStyle: "" as unknown, lineWidth: 1, font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic", globalAlpha: 1, lineJoin: "miter", lineCap: "butt" };
  // Device pixels back to map units.
  const map = (x: number, y: number): [number, number] => [(x * t.sx + t.tx - view.x) / view.zoom, (y * t.sy + t.ty - view.y) / view.zoom];
  const grow = (x: number, y: number) => {
    const [mx, my] = map(x, y);
    path = path ? { x: Math.min(path.x, mx), y: Math.min(path.y, my), width: Math.max(path.x + path.width, mx) - Math.min(path.x, mx), height: Math.max(path.y + path.height, my) - Math.min(path.y, my) } : { x: mx, y: my, width: 0, height: 0 };
  };
  const scaleNow = () => t.sx / view.zoom;
  const push = (op: Omit<Op, "lineWidth" | "style">, style: unknown) => current?.ops.push({ ...op, lineWidth: own.lineWidth * scaleNow(), style: typeof style === "string" ? style : "pattern" });
  const size = () => Number(/(\d+(?:\.\d+)?)px/.exec(own.font)?.[1] ?? 10);
  const write = (text: string, x: number, y: number) => {
    const s = size() * scaleNow();
    const align = own.textAlign === "right" || own.textAlign === "end" ? "end" : own.textAlign === "center" ? "middle" : "start";
    const [mx, my] = map(x, y);
    push({ kind: "text", box: textBox(text, mx, my, s, align, own.textBaseline === "middle" ? "middle" : "alphabetic"), text, size: s }, own.fillStyle);
  };
  const methods: Record<string, (...a: never[]) => unknown> = {
    save: () => void stack.push({ ...t }),
    restore: () => {
      current = undefined;
      t = stack.pop() ?? t;
    },
    translate: (x: number, y: number) => void (t = { ...t, tx: t.tx + x * t.sx, ty: t.ty + y * t.sy }),
    scale: (x: number, y: number) => void (t = { ...t, sx: t.sx * x, sy: t.sy * y }),
    beginPath: () => void (path = undefined),
    closePath: () => {},
    moveTo: (x: number, y: number) => {
      grow(x, y);
      pen = [x, y];
    },
    lineTo: (x: number, y: number) => {
      grow(x, y);
      pen = [x, y];
    },
    bezierCurveTo: (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
      // The control points bound the curve; enough for the boxes compared here.
      for (const [px, py] of [pen, [x1, y1], [x2, y2], [x, y]]) grow(px, py);
      pen = [x, y];
    },
    arc: (cx: number, cy: number, r: number) => {
      grow(cx - r, cy - r);
      grow(cx + r, cy + r);
    },
    rect: (x: number, y: number, w: number, h: number) => {
      grow(x, y);
      grow(x + w, y + h);
    },
    fill: () => path && push({ kind: "fill", box: path }, own.fillStyle),
    stroke: () => path && push({ kind: "stroke", box: path }, own.strokeStyle),
    fillRect: () => {},
    clearRect: () => {},
    fillText: (text: string, x: number, y: number) => write(text, x, y),
    strokeText: () => {},
    measureText: (text: string) => ({ width: estimate(text, size()) }),
    setLineDash: () => {},
  };
  const ctx = new Proxy(own as unknown as Record<string, unknown>, {
    get: (target, key: string) => methods[key] ?? target[key],
    set: (target, key: string, value) => {
      target[key] = value;
      return true;
    },
  }) as unknown as DrawContext;
  return {
    ctx,
    visits,
    begin: (list: ListName, index: number, id: string) => {
      current = { list, index, id, ops: [] };
      visits.push(current);
    },
  };
}

export interface CanvasReadOptions {
  /** Zoom at which the level of detail is decided; default the view's. */
  lodZoom?: number;
  edgeBudget?: number | "all";
}

/** What a Canvas draw of the scene at a view put where, element by element. */
export function readCanvas(scene: PreparedScene, view: View, options: CanvasReadOptions = {}): Reading {
  const rec = recorder(view);
  const drawn = drawScene(rec.ctx, watch(scene, rec.begin), view, undefined, { cull: false, background: false, createCanvas: () => null, lodZoom: options.lodZoom, edgeBudget: options.edgeBudget ?? "all" });
  const reading: Reading = { renderer: "canvas", zoom: view.zoom, cards: [], texts: [], badges: [], paths: [], loops: [] };
  if (drawn.withheld) reading.note = { shown: drawn.withheld.shown, total: drawn.withheld.total };
  for (const v of rec.visits) {
    if (!v.ops.length) continue;
    const texts = (role: TextRole) => v.ops.filter((o) => o.kind === "text").forEach((o) => reading.texts.push({ owner: v.id, role, text: o.text!, box: o.box, size: o.size! }));
    if (v.list === "nodes") {
      const n = scene.nodes[v.index];
      // The outline is the first fill; a diamond's box is the node's.
      const outline = v.ops.find((o) => o.kind === "fill");
      if (outline) reading.cards.push({ id: v.id, kind: n.node.kind, box: outline.box });
      texts("node");
    } else if (v.list === "edges") {
      const line = v.ops.find((o) => o.kind === "stroke");
      if (line && !reading.paths.some((p) => p.id === v.id)) reading.paths.push({ id: v.id, width: line.lineWidth, color: line.style });
      texts("path");
    } else if (v.list === "marks") {
      const m = scene.marks[v.index];
      if (m.kind === "badge") {
        const shape = v.ops.find((o) => o.kind === "fill");
        if (shape) reading.badges.push({ id: m.id, owner: m.overlay.target, box: shape.box });
        texts("badge");
      } else if (m.kind === "arc") texts("arc");
      else if (m.kind === "selfLoop") {
        if (m.edgeId && v.ops.some((o) => o.kind === "stroke")) reading.loops.push(m.edgeId);
        texts("loop");
      } else if (m.kind === "chip") texts("chip");
    } else texts("group");
  }
  return reading;
}

// ---------------------------------------------------------------------------
// Numbers as printed

/**
 * A printed count read back: its value and half the unit of its last digit.
 * "40", "1,234" (en) or "1.234" (de), "195k", "1.6M" (en) or "1,6M" (de).
 */
export function parsePrinted(text: string, locale: Locale): { value: number; half: number } | undefined {
  const m = /^(-?)([\d.,]+)(k|M)?$/.exec(text.trim());
  if (!m) return undefined;
  const [group, decimal] = locale === "de" ? [".", ","] : [",", "."];
  const digits = m[2].split(group).join("");
  const [int, frac = ""] = digits.split(decimal);
  if (!/^\d+$/.test(int) || !/^\d*$/.test(frac)) return undefined;
  const unit = m[3] === "M" ? 1e6 : m[3] === "k" ? 1e3 : 1;
  const value = Number(`${int}.${frac || "0"}`) * unit * (m[1] ? -1 : 1);
  return { value, half: (unit / 10 ** frac.length) / 2 };
}

/** Whether a printed count stands for a value within its printed precision. */
export function roundTrips(text: string, value: number, locale: Locale): boolean {
  const p = parsePrinted(text, locale);
  return !!p && Math.abs(p.value - value) <= p.half * (1 + 1e-9);
}

// ---------------------------------------------------------------------------
// Properties

export type PropertyId =
  | "empty"
  | "reach"
  | "counts"
  | "cards overlap"
  | "label covers card"
  | "label covers label"
  | "text too small"
  | "shedding order"
  | "width order"
  | "width scale"
  | "legend ends"
  | "colour scale"
  | "numbers"
  | "note";

export interface Failure {
  property: PropertyId;
  detail: string;
  /** Boxes involved, in map units, for the picture. */
  boxes: Box[];
}

export interface Expectation {
  /** The scene's graph before any abstraction. */
  graph: FlowGraph;
  /** What `abstract` returns for the rung's settings in one call. */
  abstraction: FlowGraph;
  rung: Rung;
  locale: Locale;
  /** The scene's positions, for the cards an element must keep clear of. */
  positions?: Positions;
}

const isLoop = (e: FlowEdge) => e.source === e.target;
const isFlow = (e: FlowEdge) => e.kind === "follows" || e.kind === "flow";
const card = (n: FlowNode) => n.kind === "activity" || n.kind === "stage";

/** Nodes reached from `from` along the edges, forwards or backwards. */
function reached(graph: FlowGraph, from: string[], forward: boolean): Set<string> {
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!isFlow(e)) continue;
    const [a, b] = forward ? [e.source, e.target] : [e.target, e.source];
    next.set(a, [...(next.get(a) ?? []), b]);
  }
  const seen = new Set(from);
  const queue = [...from];
  while (queue.length) for (const b of next.get(queue.shift()!) ?? []) if (!seen.has(b)) seen.add(b), queue.push(b);
  return seen;
}

/** The colour a value has on the legend's scale, interpolated between its stops by hand; by the square root where the scale says so. */
export function legendColor(value: number, domain: number[], stops: readonly string[], sqrt = false): string {
  const [lo, hi] = sqrt && domain[0] === domain[domain.length - 1] ? [0, domain[0] || 1] : [domain[0], domain[domain.length - 1]];
  const at = sqrt ? (Math.sqrt(value) - Math.sqrt(lo)) / (Math.sqrt(hi) - Math.sqrt(lo)) : hi === lo ? 0 : (value - lo) / (hi - lo);
  const f = Math.max(0, Math.min(1, at)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(f));
  const rgb = (s: string) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
  const [a, b] = [rgb(stops[i]), rgb(stops[i + 1])];
  return `#${a.map((c, k) => Math.max(0, Math.min(255, Math.round(c + (b[k] - c) * (f - i)))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The width the legend promises a path's value: one square-root scale from 0 to the strongest path of the graph before
 * abstraction (`hi`) onto 0 to 8, every width under the thinnest line drawn at it, 1.
 */
export function legendWidth(value: number, hi: number): number {
  return Math.max(1, 8 * Math.sqrt(Math.max(0, Math.min(1, value / (hi || 1)))));
}

/** What paths are counted in, as the width reads them: cases, or their transitions (count) where no path of the graph gives cases. */
export function pathMetricOf(graph: FlowGraph): "cases" | "count" {
  const has = (name: string) => graph.edges.some((e) => isFlow(e) && Number.isFinite(e.metrics?.[name]));
  return !has("cases") && has("count") ? "count" : "cases";
}

/** The roles the level of detail sheds as the map zooms out, first to last. */
export const SHEDDING_ORDER: readonly (readonly TextRole[])[] = [["path"], ["loop"], ["badge", "arc", "chip"], ["node"]];

export interface CheckOptions {
  /** The reading at the view a person first sees (the fitted map): the texts drawn there and their size on screen. */
  fitted: Reading;
  /** The reading with every element and text any zoom draws: overlaps. */
  full: Reading;
  /** A reading drawn under a path budget, for the note on withheld paths; without it, `full`'s note. */
  budgeted?: Reading;
  expect: Expectation;
}

/** Whether the graph is in one piece, edges taken in either direction. */
export function weaklyConnected(graph: FlowGraph): boolean {
  const ids = graph.nodes.filter((n) => n.kind !== "note").map((n) => n.id);
  if (ids.length < 2) return true;
  const both: FlowGraph = { nodes: graph.nodes, edges: graph.edges.flatMap((e) => [e, { ...e, source: e.target, target: e.source }]) };
  return reached(both, [ids[0]], true).size >= ids.length;
}

/** Every property the readings fail. */
export function checkReading({ fitted, full, budgeted, expect }: CheckOptions): Failure[] {
  const out: Failure[] = [];
  const fail = (property: PropertyId, detail: string, boxes: Box[] = []) => out.push({ property, detail, boxes });
  const shown = expect.abstraction;
  const nodes = new Map(shown.nodes.map((n) => [n.id, n]));
  const edges = new Map(shown.edges.map((e) => [e.id, e]));
  const reading = full;

  // Not empty while an activity is above the threshold: the strongest always is.
  if (expect.graph.nodes.some(card) && !reading.cards.some((c) => c.kind === "activity" || c.kind === "stage")) fail("empty", "the map shows no activity");

  // With keep connected, every activity on a path from the start and to the end.
  if (expect.rung.keepConnected) {
    const starts = shown.nodes.filter((n) => n.kind === "event" && n.tags?.includes("start")).map((n) => n.id);
    const ends = shown.nodes.filter((n) => n.kind === "event" && n.tags?.includes("end")).map((n) => n.id);
    if (starts.length && ends.length) {
      const fromStart = reached(shown, starts, true);
      const toEnd = reached(shown, ends, false);
      for (const n of shown.nodes.filter(card)) {
        const box = expect.positions?.nodes[n.id];
        if (!fromStart.has(n.id)) fail("reach", `${n.id} is not reachable from the start`, box ? [box] : []);
        if (!toEnd.has(n.id)) fail("reach", `${n.id} does not reach the end`, box ? [box] : []);
      }
    }
  }

  // The map shows what the abstraction returns: its activities and stages, its paths (drawn or withheld), its loops.
  const want = { cards: shown.nodes.map((n) => n.id).sort(), paths: shown.edges.filter((e) => !isLoop(e)).length, loops: shown.edges.filter(isLoop).map((e) => e.id).sort() };
  const drawnCards = reading.cards.map((c) => c.id).sort();
  if (drawnCards.join() !== want.cards.join()) fail("counts", `cards ${drawnCards.length}, abstraction ${want.cards.length}: ${diff(drawnCards, want.cards)}`);
  // Paths a budget withholds count as the note says, which counts the self-loops too.
  const total = noteCounts(reading.note, expect.locale)?.total ?? reading.paths.length + want.loops.length;
  if (total !== want.paths + want.loops.length) fail("counts", `paths ${total}, abstraction ${want.paths + want.loops.length}`);
  for (const p of reading.paths) if (!edges.has(p.id)) fail("counts", `path ${p.id} is not in the abstraction`);
  const loops = [...new Set(reading.loops)].sort();
  if (loops.join() !== want.loops.join()) fail("counts", `self-loops ${loops.length}, abstraction ${want.loops.length}: ${diff(loops, want.loops)}`);

  // No card covers another.
  for (let i = 0; i < reading.cards.length; i++) {
    for (let j = i + 1; j < reading.cards.length; j++) {
      const [a, b] = [reading.cards[i], reading.cards[j]];
      if (covers(a.box, b.box)) fail("cards overlap", `${a.id} and ${b.id}`, [a.box, b.box]);
    }
  }

  // No arc label, path label or badge covers a card (a badge sits on its own) or another of them.
  const labels = [
    ...reading.texts.filter((t) => t.role === "arc" || t.role === "path").map((t) => ({ name: `${t.role} label "${t.text}" of ${t.owner}`, owner: t.role === "path" ? "" : t.owner, box: t.box })),
    ...reading.badges.map((b) => ({ name: `badge ${b.id}`, owner: b.owner, box: b.box })),
  ];
  for (const l of labels) {
    // A badge's failure also carries the box of the card it sits on, which tells a row of badges wider than its card (`findingOf`).
    const own = l.name.startsWith("badge") ? reading.cards.find((c) => c.id === l.owner)?.box : undefined;
    for (const c of reading.cards) if ((!l.name.startsWith("badge") || c.id !== l.owner) && covers(l.box, c.box)) fail("label covers card", `${l.name} covers ${c.id}`, own ? [l.box, c.box, own] : [l.box, c.box]);
  }
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) if (covers(labels[i].box, labels[j].box)) fail("label covers label", `${labels[i].name} covers ${labels[j].name}`, [labels[i].box, labels[j].box]);
  }

  // At the fitted view every text drawn is at least the minimum on screen, and texts are shed in the documented order.
  for (const t of fitted.texts) {
    const px = t.size * fitted.zoom;
    if (px < MIN_TEXT_PX - 1e-9) fail("text too small", `${t.role} "${t.text}" of ${t.owner} at ${px.toFixed(1)} px (zoom ${fitted.zoom.toFixed(3)})`, [t.box]);
  }
  const roles = new Set(fitted.texts.map((t) => t.role));
  const presentInFull = new Set(full.texts.map((t) => t.role));
  for (let k = 0; k < SHEDDING_ORDER.length; k++) {
    const shed = SHEDDING_ORDER[k].filter((r) => presentInFull.has(r) && !roles.has(r));
    const kept = SHEDDING_ORDER.slice(0, k).flat().filter((r) => roles.has(r));
    if (shed.length && kept.length) fail("shedding order", `${kept.join(", ")} drawn while ${shed.join(", ")} shed`);
  }

  // Path widths follow the legend: one scale from 0 to the strongest path of the graph before abstraction (self-loops
  // included), whatever the setting; the widest is the most frequent, the square-root scale between them.
  const metricName = pathMetricOf(shown);
  const strongest = expect.graph.edges.filter((e) => e.kind !== "constraint" && Number.isFinite(e.metrics?.[metricName])).map((e) => e.metrics![metricName]);
  const hi = strongest.reduce((m, v) => Math.max(m, v), -Infinity);
  // Where every path shown has one count, the legend shows that one sample instead of the scale.
  const values = shown.edges.filter((e) => e.kind !== "constraint" && Number.isFinite(e.metrics?.[metricName])).map((e) => e.metrics![metricName]);
  const one = values.length && values.every((v) => v === values[0]) ? values[0] : undefined;
  if (reading.widthEnds) {
    const [low, high] = reading.widthEnds;
    if (!strongest.length) fail("legend ends", `the legend's path widths run ${low} … ${high} for a graph without measured paths`);
    else if (one !== undefined ? !roundTrips(low, one, expect.locale) || !roundTrips(high, one, expect.locale) : !roundTrips(low, 0, expect.locale) || !roundTrips(high, hi, expect.locale)) {
      fail("legend ends", `the legend's path widths run ${low} … ${high}, ${one !== undefined ? `where every path is ${one}` : `the graph's from 0 to ${hi}`}`);
    }
  }
  const drawnFlows = reading.paths.flatMap((p) => {
    const e = edges.get(p.id);
    return e && e.kind === "follows" && Number.isFinite(e.metrics?.[metricName]) ? [{ ...p, count: e.metrics![metricName], edge: e }] : [];
  });
  for (const p of drawnFlows) {
    const want = legendWidth(p.count, hi);
    if (!(Math.abs(p.width - want) <= 0.011)) fail("width scale", `${p.id} (${metricName} ${p.count}) is ${p.width} wide, the legend's scale gives ${want.toFixed(2)} for 0 … ${hi}`);
  }
  const byCount = [...drawnFlows].sort((a, b) => b.count - a.count);
  for (let i = 1; i < byCount.length; i++) {
    if (byCount[i].count < byCount[i - 1].count && byCount[i].width > byCount[i - 1].width + 1e-9) fail("width order", `${byCount[i].id} (count ${byCount[i].count}) is wider than ${byCount[i - 1].id} (count ${byCount[i - 1].count})`);
  }
  if (byCount.length && Math.max(...byCount.map((p) => p.width)) > byCount[0].width + 1e-9) fail("width order", `the widest path is not the most frequent, ${byCount[0].id}`);

  // Path colours follow the legend's scale.
  const scale = reading.colorScale;
  if (scale) {
    for (const p of drawnFlows) {
      const v = p.edge.metrics?.[scale.metric];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const want = legendColor(v, scale.domain, scale.stops, scale.sqrt);
      if (p.color.toLowerCase() !== want) fail("colour scale", `${p.id} (${v}) is drawn ${p.color}, the legend gives ${want}`);
    }
  }

  // Printed counts stand for the scene's numbers within their precision.
  for (const t of reading.texts) {
    if (t.role === "path") {
      // A path prints what the width reads; a merged path its lower bound after "≥"; one without a value "–".
      const e = edges.get(t.owner);
      const v = e?.metrics?.[metricName];
      if (typeof v === "number" && Number.isFinite(v) && !roundTrips(t.text.replace(/^≥/, ""), v, expect.locale)) fail("numbers", `path ${t.owner} prints "${t.text}" for ${v}`, [t.box]);
    }
    if (t.role === "node") {
      const n = nodes.get(t.owner);
      const v = n?.metrics?.cases;
      const printed = t.text.split(" · ").at(-1)!;
      if (n && typeof v === "number" && t.text !== n.label && /^[\d.,]+[kM]?$/.test(printed) && !roundTrips(printed, v, expect.locale)) fail("numbers", `${n.id} prints "${t.text}" for ${v} cases`, [t.box]);
    }
  }

  // A note says how many paths are shown of how many whenever some are left out, and only then.
  const noted = budgeted ?? full;
  const withheld = want.paths - noted.paths.length;
  const note = noted.note;
  if (withheld > 0 && !note) fail("note", `${noted.paths.length} of ${want.paths} paths drawn without a note`);
  if (withheld <= 0 && note) fail("note", `a note while every path is drawn: ${JSON.stringify(note)}`);
  if (withheld > 0 && note) {
    // The self-loops are never withheld and count in both numbers.
    const counts = noteCounts(note, expect.locale);
    const [shown, all] = [noted.paths.length + want.loops.length, want.paths + want.loops.length];
    if (counts?.shown !== shown || counts?.total !== all) fail("note", `the note says ${counts?.shown} of ${counts?.total}, the map draws ${shown} of ${all}`);
  }
  if (budgeted) for (const p of budgeted.paths) if (!edges.has(p.id)) fail("counts", `path ${p.id} is not in the abstraction`);
  return out;
}

/** The two numbers of a note on withheld paths, printed ("Showing 24 of 656 flows") or reported. */
export function noteCounts(note: Reading["note"], locale: Locale): { shown: number; total: number } | undefined {
  if (!note) return undefined;
  if (typeof note === "object") return note;
  const [shown, total] = /(\d[\d.,]*)\D+(\d[\d.,]*)/.exec(note)?.slice(1).map((s) => parsePrinted(s, locale)?.value) ?? [];
  return shown === undefined || total === undefined ? undefined : { shown, total };
}

/**
 * Whether each arc's label had a free place, by the documented rule: of the
 * 29 points nearest the middle of its curve, in steps of 1/32, one where its
 * pill centred on the curve (the label at 0.55 em per character in 11 px and 6
 * on either side, 18 high) meets no activity, badge, chip, self-loop label
 * (from a size above its baseline, 1.25 sizes high), group title (12 in from
 * the group's left, 8 below its top, 8.4 per character, 18 high), path count
 * (0.55 em per character, from one em above its baseline) or earlier arc
 * label. Written from the documentation, not from the geometry code; a place
 * that clears an obstacle by less than `TOUCH` does not count as free.
 */
export function arcLabelPlaces(scene: Pick<FlowScene, "graph" | "positions" | "marks" | "edgeMarks">): Map<string, boolean> {
  const near = (a: Box, b: Box) => a.x <= b.x + b.width + TOUCH && b.x <= a.x + a.width + TOUCH && a.y <= b.y + b.height + TOUCH && b.y <= a.y + a.height + TOUCH;
  const left = (t: { x: number; anchor: string }, width: number) => (t.anchor === "middle" ? t.x - width / 2 : t.anchor === "end" ? t.x - width : t.x);
  const fixed: Box[] = [
    ...Object.values(scene.positions.nodes),
    ...(scene.graph.groups ?? []).flatMap((g) => {
      const b = scene.positions.groups[g.id];
      return b ? [{ x: b.x + 12, y: b.y + 8, width: Array.from(g.label).length * 8.4, height: 18 }] : [];
    }),
    ...scene.marks.filter((m) => (m.kind === "badge" || m.kind === "chip") && m.inMap).map((m) => m.box),
    ...scene.marks.filter((m) => m.kind === "selfLoop").flatMap((m) => m.texts.map((t) => ({ x: left(t, estimate(t.text, t.size)), y: t.y - t.size, width: estimate(t.text, t.size), height: 1.25 * t.size }))),
    ...scene.edgeMarks.flatMap((e) => e.texts.map((t) => ({ x: left(t, estimate(t.text, t.size)), y: t.y - t.size, width: estimate(t.text, t.size), height: t.size }))),
  ];
  const placed: Box[] = [];
  const out = new Map<string, boolean>();
  for (const m of scene.marks) {
    const label = m.texts[0];
    if (m.kind !== "arc" || !m.path || !label) continue;
    const [sx, sy, , c1y, , , tx, ty] = (m.path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const dy = c1y - sy;
    const width = estimate(label.text, 11) + 12;
    const pill = (x: number, y: number): Box => ({ x: x - width / 2, y: y - 9, width, height: 18 });
    let free = false;
    for (let k = 0; k < 29 && !free; k++) {
      const t = 0.5 + ((k % 2 ? -1 : 1) * Math.ceil(k / 2)) / 32;
      const u = 1 - t;
      const x = (u * u * u + 3 * u * u * t) * sx + (3 * u * t * t + t * t * t) * tx;
      const y = u * u * u * sy + 3 * u * u * t * (sy + dy) + 3 * u * t * t * (ty + dy) + t * t * t * ty;
      free = ![...fixed, ...placed].some((b) => near(pill(x, y), b));
    }
    out.set(m.id, free);
    placed.push(pill(label.x, label.y));
  }
  return out;
}

/** The open decisions a failure can belong to (written up, pinned as findings), and the documented limit of keep connected ("reach"). */
export type Finding = "small text" | "path counts" | "reach" | "arc label without a place" | "badges wider than their card";

/**
 * The open decision a failure belongs to, or none: texts drawn below the
 * minimum; a path's count covering a card, a badge or another count (path
 * counts have no place of their own; an arc label on a count is the arc
 * label's, below); with keep connected, an activity without a path from
 * the start or to the end while the map is in one piece, which is all keep
 * connected promises, as documented: it restores flow context only from
 * activities still on the map (`base` is the graph the thresholds were applied to); an
 * arc label covering a card or a label where its arc had no free place
 * (`places`, from `arcLabelPlaces`); a badge beyond the sides of its own card
 * covering another card (a card's badges run leftwards from its top-right
 * corner in one row, which can be wider than the card).
 */
export function findingOf(f: Failure, shown: FlowGraph, base: FlowGraph, places?: ReadonlyMap<string, boolean>): Finding | undefined {
  if (f.property === "text too small") return "small text";
  const covering = f.property === "label covers card" || f.property === "label covers label";
  // An arc label keeps clear of cards, counts, badges and labels; where the rule found no free place on the arc, its label covers the fewest: the rule holds.
  const arcs = [...f.detail.matchAll(/arc label "[^"]*" of (\S+)/g)].map((m) => m[1]);
  if (covering && arcs.length) return arcs.some((id) => places?.get(id) === false) ? "arc label without a place" : undefined;
  if (covering && /\bpath label\b/.test(f.detail)) return "path counts";
  const [badge, , own] = f.boxes;
  if (f.property === "label covers card" && /^badge \S+ covers \S+$/.test(f.detail) && own && (badge.x < own.x - 1e-6 || badge.x + badge.width > own.x + own.width + 1e-6)) return "badges wider than their card";
  if (f.property === "reach" && (weaklyConnected(shown) || !weaklyConnected(base))) return "reach";
  return undefined;
}

function diff(a: string[], b: string[]): string {
  const sa = new Set(a);
  const sb = new Set(b);
  const extra = a.filter((x) => !sb.has(x));
  const missing = b.filter((x) => !sa.has(x));
  return [extra.length ? `extra ${extra.join(", ")}` : "", missing.length ? `missing ${missing.join(", ")}` : ""].filter(Boolean).join("; ");
}

// ---------------------------------------------------------------------------
// Pictures

/** An exported picture of a rung (SVG) with the boxes of its failures outlined in red and numbered, the list of failures under it. */
export function pictureOf(svg: string, failures: readonly Failure[], title: string): string {
  const offset = /<g class="wf-map" transform="translate\(([-\d.e]+) ([-\d.e]+)\)">/.exec(svg);
  const [dx, dy] = offset ? [Number(offset[1]), Number(offset[2])] : [0, 0];
  const size = /<svg [^>]*?width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  const [width, height] = size ? [Number(size[1]), Number(size[2])] : [800, 600];
  const line = (f: Failure, i: number) => escape(`${i + 1}. ${f.property}: ${f.detail}`);
  const boxes = failures.flatMap((f, i) => f.boxes.map((b) => `<rect x="${b.x}" y="${b.y}" width="${Math.max(b.width, 2)}" height="${Math.max(b.height, 2)}" fill="none" stroke="#d00" stroke-width="2"><title>${line(f, i)}</title></rect>`));
  const marked = svg.replace(/<\/svg>\s*$/, `<g class="wf-failure-boxes" transform="translate(${dx} ${dy})">${boxes.join("")}</g></svg>`);
  const shown = failures.slice(0, 60);
  const list = shown.map((f, i) => `<text x="8" y="${height + 40 + i * 14}" font-size="11" fill="#d00">${line(f, i)}</text>`);
  const more = failures.length > shown.length ? `<text x="8" y="${height + 40 + shown.length * 14}" font-size="11">… ${failures.length - shown.length} more</text>` : "";
  const total = height + 56 + (shown.length + 1) * 14;
  const outer = Math.max(width, 900);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outer}" height="${total}" viewBox="0 0 ${outer} ${total}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>${marked}<text x="8" y="${height + 22}" font-size="13" font-weight="700">${escape(title)}</text>${list.join("")}${more}</svg>`;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
