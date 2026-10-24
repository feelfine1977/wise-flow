/**
 * The fitted view of a map: its bounds whole inside the area it is drawn in,
 * less insets, so that the panels over the map (the abstraction panel, the
 * legend, the zoom control, notes) cover none of what the view was fitted to.
 * Every renderer fits with these two functions: the React Flow map, the Canvas
 * map and the BPMN view. The view a map opens at (`openingView`) is the fitted
 * one where that is readable, and otherwise a readable zoom on the start of
 * the process with an overview in a free corner. `partInView` says how much of
 * a map a view shows, and `elementPoint` where a view centres to bring an
 * element into it.
 */
import { isPath } from "./detail.js";
import type { EdgeMark, NodeMark } from "./element-marks.js";
import { type Locale, formatCount } from "./format.js";
import type { Box, LayoutDirection, Positions, XY } from "./layout.js";
import { type FlowEdge, type FlowNode, hasTag } from "./model.js";
import type { ElementRef } from "./selection.js";
import { t } from "./strings.js";
import { viewTokens } from "./tokens.js";

/** Room kept clear along each side of the area, in screen pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A view: a layout point `p` is drawn at `p * zoom + (x, y)`. */
export interface FitView {
  x: number;
  y: number;
  zoom: number;
}

export interface FitOptions {
  /** Room kept clear along each side; missing sides are 0. */
  insets?: Partial<Insets>;
  /** Room around the bounds, relative to their size on each side. Default 0.08. */
  padding?: number;
  minZoom?: number;
  maxZoom?: number;
}

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
/** The most panels whose ways of being kept clear are tried one by one (2 ** 12 combinations). */
const MAX_TRIED = 12;

/** The larger inset of each side of either. */
const merged = (a: Partial<Insets>, b: Partial<Insets>): Partial<Insets> => {
  const out = { ...a };
  for (const [side, value] of Object.entries(b) as [keyof Insets, number][]) out[side] = Math.max(out[side] ?? 0, value);
  return out;
};

/**
 * The view that shows `bounds` whole and centred in the area of `width` by
 * `height` less `insets`, with `padding` of the bounds' size around them on
 * each side, at a zoom clamped to `minZoom` and `maxZoom`. Insets that leave no
 * room are ignored.
 */
export function fitViewport(bounds: Box, area: { width: number; height: number }, options: FitOptions = {}): FitView {
  const { padding = 0.08, minZoom = 0, maxZoom = Infinity } = options;
  let inset = { ...NO_INSETS, ...options.insets };
  if (area.width - inset.left - inset.right <= 0 || area.height - inset.top - inset.bottom <= 0) inset = NO_INSETS;
  const width = area.width - inset.left - inset.right;
  const height = area.height - inset.top - inset.bottom;
  const fitted = Math.min(width / (Math.max(bounds.width, 1) * (1 + 2 * padding)), height / (Math.max(bounds.height, 1) * (1 + 2 * padding)));
  const zoom = Math.min(maxZoom, Math.max(minZoom, fitted));
  return {
    zoom,
    x: inset.left + width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: inset.top + height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

/**
 * Each panel kept clear either across the area, by an inset on the side it is
 * nearer (left or right of its centre), or along it, by an inset at the top or
 * the bottom, `gap` added; above 12 panels those of one corner together.
 */
function clearings(panels: readonly Box[], area: { width: number; height: number }, gap: number): Partial<Insets>[][] {
  const choices = panels.map((p) => [
    p.y + p.height / 2 < area.height / 2 ? { top: p.y + p.height + gap } : { bottom: area.height - p.y + gap },
    p.x + p.width / 2 < area.width / 2 ? { left: p.x + p.width + gap } : { right: area.width - p.x + gap },
  ]);
  if (choices.length <= MAX_TRIED) return choices;
  // More panels than a map carries (a host's own): the panels of a corner are kept clear together, the same way.
  const corners = new Map<string, Partial<Insets>[]>();
  for (const [v, h] of choices) {
    const key = `${Object.keys(v)}${Object.keys(h)}`;
    const [cv, ch] = corners.get(key) ?? [{}, {}];
    corners.set(key, [merged(cv, v), merged(ch, h)]);
  }
  return [...corners.values()];
}

/** Each way of keeping every panel clear one way or the other (2 ** panels; the maps carry a handful) over `base`, that leaves room. */
function eachWay(choices: Partial<Insets>[][], area: { width: number; height: number }, base: Partial<Insets>, visit: (insets: Insets) => void) {
  for (let mask = 0; mask < 2 ** choices.length; mask++) {
    const insets = { ...NO_INSETS, ...base };
    choices.forEach((c, i) => {
      for (const [side, value] of Object.entries(c[(mask >> i) & 1]) as [keyof Insets, number][]) insets[side] = Math.max(insets[side], value);
    });
    if (area.width - insets.left - insets.right > 0 && area.height - insets.top - insets.bottom > 0) visit(insets);
  }
}

/**
 * The insets that keep `bounds`, fitted, clear of `panels` (boxes in the
 * area's pixels): each panel is kept clear either across the area, by an inset
 * on the side it is nearer (left or right of its centre), or along it, by an
 * inset at the top or the bottom; of all these choices the one with the
 * largest fitted zoom wins (the first of equals: insets along the area before
 * insets across it). Above 12 panels, those of one corner are kept clear
 * together, the same way. `gap` is added to each inset. Panels without a size
 * and choices that leave no room are left out.
 */
export function panelInsets(panels: readonly Box[], area: { width: number; height: number }, bounds: Box, options: Omit<FitOptions, "insets"> & { gap?: number } = {}): Insets {
  const { gap = 0, ...fit } = options;
  let best: Insets = { ...NO_INSETS };
  let bestZoom = -Infinity;
  eachWay(clearings(panels.filter((p) => p.width > 0 && p.height > 0), area, gap), area, {}, (insets) => {
    const { zoom } = fitViewport(bounds, area, { ...fit, insets });
    if (zoom > bestZoom) {
      bestZoom = zoom;
      best = insets;
    }
  });
  return best;
}

/** What a map opens at: a view, whether it is the fitted one, and where the overview goes when it is not. */
export interface OpeningView extends FitView {
  /** True when the map opens fitted: the whole map at a zoom of at least the readable one. */
  fitted: boolean;
  /** The overview's box in the area's pixels, in a corner no panel occupies; only when the map opens on its start. */
  overview?: Box;
}

export interface OpeningOptions extends Omit<FitOptions, "insets"> {
  /** The panels over the map: boxes in the area's pixels, kept clear as `panelInsets` keeps them. */
  panels?: readonly Box[];
  /** Room kept clear along each side instead of the panels' insets (a host's own). */
  insets?: Partial<Insets>;
  /** Added to each panel's inset, kept between the start and the edge of the free area and between the overview and the area's edges. */
  gap?: number;
  /** The zoom a map opens at fitted from, and on its start below it. Default `viewTokens.openingZoom` (0.75). */
  readable?: number;
  /** The box of the start of the process (`processStart`); without one the map opens fitted. */
  start?: Box;
  /** The reading direction: the start is placed at the free area's edge it starts from. Default `RIGHT`. */
  direction?: LayoutDirection;
  /** The boxes no panel may cover when the map opens on its start: the activities'. */
  boxes?: readonly Box[];
  /** The size of the overview, shown when the map opens on its start. */
  overview?: { width: number; height: number };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The view a map opens at. Where the map fitted inside the insets of the
 * panels (`panelInsets`) has a zoom of at least `readable`, that view.
 * Otherwise the zoom `readable` with the start of the process at the edge of
 * the free area the reading direction starts from (`gap` inside it) and
 * centred on the start across it, and an overview in the first corner no
 * panel occupies (`gap` around it) of top right, bottom right, top left and
 * bottom left. Each panel and the overview is then kept clear across or along
 * the area as `panelInsets` would; of these choices the one under whose
 * panels the fewest `boxes` lie wins, then the one with the largest free
 * area, then the first.
 */
export function openingView(bounds: Box, area: { width: number; height: number }, options: OpeningOptions = {}): OpeningView {
  const { panels = [], gap = 0, readable = viewTokens.openingZoom, start, direction = "RIGHT", boxes = [], overview, insets: given, ...fit } = options;
  const shown = panels.filter((p) => p.width > 0 && p.height > 0);
  // Whether the whole map is readable is judged by the zoom it fits at, before the smallest zoom (which may be the readable one) clamps it.
  const free = { ...fit, minZoom: 0 };
  const insets = given ?? panelInsets(shown, area, bounds, { ...free, gap });
  const fitted = fitViewport(bounds, area, { ...fit, insets });
  if (fitViewport(bounds, area, { ...free, insets }).zoom >= readable || !start) return { ...fitted, fitted: true };
  const zoom = Math.min(fit.maxZoom ?? Infinity, Math.max(fit.minZoom ?? 0, readable));
  const corner = overview && [0, 1, 2, 3]
    .map((k) => ({ x: k < 2 ? area.width - gap - overview.width : gap, y: k % 2 ? area.height - gap - overview.height : gap, ...overview }))
    .find((b) => !shown.some((p) => overlaps({ x: b.x - gap, y: b.y - gap, width: b.width + 2 * gap, height: b.height + 2 * gap }, p)));
  const kept = corner ? [...shown, corner] : shown;
  const across = direction === "RIGHT" || direction === "LEFT";
  let best = { view: { ...fitted, zoom }, covered: Infinity, room: 0 };
  eachWay(clearings(kept, area, gap), area, given ?? {}, (inset) => {
    const width = area.width - inset.left - inset.right;
    const height = area.height - inset.top - inset.bottom;
    // The start at the free area's edge where reading starts, centred on it across the reading direction.
    const view = {
      zoom,
      x: across ? (direction === "RIGHT" ? inset.left + gap - start.x * zoom : area.width - inset.right - gap - (start.x + start.width) * zoom) : inset.left + width / 2 - (start.x + start.width / 2) * zoom,
      y: across ? inset.top + height / 2 - (start.y + start.height / 2) * zoom : direction === "DOWN" ? inset.top + gap - start.y * zoom : area.height - inset.bottom - gap - (start.y + start.height) * zoom,
    };
    const covered = boxes.filter((b) => kept.some((p) => overlaps({ x: b.x * zoom + view.x, y: b.y * zoom + view.y, width: b.width * zoom, height: b.height * zoom }, p))).length;
    if (covered < best.covered || (covered === best.covered && width * height > best.room)) best = { view, covered, room: width * height };
  });
  return { ...best.view, fitted: false, ...(corner && { overview: corner }) };
}

/** How much of a map a view shows (`partInView`). */
export interface PartInView {
  /** The cards (activities and stage nodes) whose box reaches into the view, and all of them. */
  nodes: number;
  ofNodes: number;
  /** The paths (`isPath`: not constraints, not the dashed stand-ins for ways through activities not shown) whose line reaches into the view, and all of them. */
  edges: number;
  ofEdges: number;
  /** Every card and every path is in view. */
  whole: boolean;
}

/** Whether the segment from `a` to `b` reaches into the box (Liang–Barsky). */
function reaches(a: XY, b: XY, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  for (const [p, q] of [[-dx, a.x - box.x], [dx, box.x + box.width - a.x], [-dy, a.y - box.y], [dy, box.y + box.height - a.y]]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const at = q / p;
    if (p < 0) {
      if (at > leave) return false;
      if (at > enter) enter = at;
    } else {
      if (at < enter) return false;
      if (at < leave) leave = at;
    }
  }
  // A segment that only touches the box's edge does not reach into it.
  return enter < leave;
}

/**
 * How much of a map a view shows: the cards whose box reaches into the area
 * less `insets` at the view, the paths whose routed line does, and all of
 * each. A view without a zoom shows nothing.
 */
export function partInView(scene: { nodeMarks: readonly Pick<NodeMark, "kind" | "box">[]; edgeMarks: readonly Pick<EdgeMark, "edge" | "points">[] }, view: FitView, area: { width: number; height: number }, insets: Partial<Insets> = {}): PartInView {
  const inset = { ...NO_INSETS, ...insets };
  const cards = scene.nodeMarks.filter((m) => m.kind === "activity" || m.kind === "stage");
  const paths = scene.edgeMarks.filter((m) => isPath(m.edge));
  const zoomed = view.zoom > 0 && Number.isFinite(view.x) && Number.isFinite(view.y);
  const seen: Box = { x: (inset.left - view.x) / view.zoom, y: (inset.top - view.y) / view.zoom, width: (area.width - inset.left - inset.right) / view.zoom, height: (area.height - inset.top - inset.bottom) / view.zoom };
  const nodes = zoomed ? cards.filter((m) => overlaps(m.box, seen)).length : 0;
  const edges = zoomed ? paths.filter((m) => m.points.some((p, i) => (i > 0 ? reaches(m.points[i - 1], p, seen) : m.points.length === 1 && overlaps({ ...p, width: 0, height: 0 }, seen)))).length : 0;
  return { nodes, ofNodes: cards.length, edges, ofEdges: paths.length, whole: nodes === cards.length && edges === paths.length };
}

/** What a view shows of the map, in words: the cards and the paths in view, of all ("17 of 42 activities and 23 of 60 paths in view"). */
export function inViewText(shown: PartInView, locale: Locale = "en"): string {
  return t(locale, "detail.inView", { nodes: formatCount(shown.nodes, locale), ofNodes: formatCount(shown.ofNodes, locale), edges: formatCount(shown.edges, locale), ofEdges: formatCount(shown.ofEdges, locale) });
}

/**
 * The point a view centres on to bring an element into it: the centre of a
 * node's or a group's box, the middle of an edge's route or, without one,
 * the midpoint between its ends' boxes; none for an element without a box.
 */
export function elementPoint(element: ElementRef, positions: Pick<Positions, "nodes" | "groups" | "edges">, edges: readonly FlowEdge[] = []): XY | undefined {
  const centre = (b: Box): XY => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  if (element.kind === "node") return positions.nodes[element.id] && centre(positions.nodes[element.id]);
  if (element.kind === "group") return positions.groups[element.id] && centre(positions.groups[element.id]);
  const route = positions.edges[element.id]?.points;
  if (route?.length) {
    const i = route.length / 2;
    return route.length % 2 ? route[Math.floor(i)] : { x: (route[i - 1].x + route[i].x) / 2, y: (route[i - 1].y + route[i].y) / 2 };
  }
  const edge = edges.find((e) => e.id === element.id);
  const ends = edge && [positions.nodes[edge.source], positions.nodes[edge.target]];
  return ends && ends[0] && ends[1] ? { x: (centre(ends[0]).x + centre(ends[1]).x) / 2, y: (centre(ends[0]).y + centre(ends[1]).y) / 2 } : undefined;
}

/**
 * The start of the process on a map: of the start events (events tagged
 * `start`) with a box, else of the nodes with a box, the first in the reading
 * direction, ties by the smaller coordinate across it, then by their order.
 */
export function processStart(nodes: readonly FlowNode[], positions: Pick<Positions, "nodes" | "direction">): Box | undefined {
  const d = positions.direction;
  const back = d === "LEFT" || d === "UP" ? -1 : 1;
  const key = (b: Box) => (d === "DOWN" || d === "UP" ? [back * (b.y + (back < 0 ? b.height : 0)), b.x] : [back * (b.x + (back < 0 ? b.width : 0)), b.y]);
  const placed = nodes.filter((n) => positions.nodes[n.id]);
  const starts = placed.filter((n) => n.kind === "event" && hasTag(n, "start"));
  return (starts.length ? starts : placed).map((n) => positions.nodes[n.id]).sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1])[0];
}
