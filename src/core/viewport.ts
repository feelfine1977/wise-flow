/**
 * The fitted view of a map: its bounds whole inside the area it is drawn in,
 * less insets, so that the panels over the map (the abstraction panel, the
 * legend, the zoom control, notes) cover none of what the view was fitted to.
 * Every renderer fits with these two functions: the React Flow map, the Canvas
 * map and the BPMN view. The view a map opens at (`openingView`) is the fitted
 * one where that is readable, and otherwise a readable zoom on the start of
 * the process with an overview in a free corner.
 */
import type { Box, LayoutDirection, Positions } from "./layout.js";
import { type FlowNode, hasTag } from "./model.js";
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
  const shown = panels.filter((p) => p.width > 0 && p.height > 0);
  let choices = shown.map((p) => {
    const vertical = p.y + p.height / 2 < area.height / 2 ? { top: p.y + p.height + gap } : { bottom: area.height - p.y + gap };
    const horizontal = p.x + p.width / 2 < area.width / 2 ? { left: p.x + p.width + gap } : { right: area.width - p.x + gap };
    return [vertical, horizontal] as Partial<Insets>[];
  });
  // More panels than a map carries (a host's own): the panels of a corner are kept clear together, the same way.
  if (choices.length > MAX_TRIED) {
    const corners = new Map<string, Partial<Insets>[]>();
    for (const [v, h] of choices) {
      const key = `${Object.keys(v)}${Object.keys(h)}`;
      const [cv, ch] = corners.get(key) ?? [{}, {}];
      corners.set(key, [merged(cv, v), merged(ch, h)]);
    }
    choices = [...corners.values()];
  }
  let best: Insets = { ...NO_INSETS };
  let bestZoom = -Infinity;
  // Each panel is kept clear one way or the other: 2 ** panels combinations (the maps carry at most a handful).
  for (let mask = 0; mask < 2 ** choices.length; mask++) {
    const insets = { ...NO_INSETS };
    choices.forEach((c, i) => {
      for (const [side, value] of Object.entries(c[(mask >> i) & 1]) as [keyof Insets, number][]) insets[side] = Math.max(insets[side], value);
    });
    if (area.width - insets.left - insets.right <= 0 || area.height - insets.top - insets.bottom <= 0) continue;
    const { zoom } = fitViewport(bounds, area, { ...fit, insets });
    if (zoom > bestZoom) {
      bestZoom = zoom;
      best = insets;
    }
  }
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

/** The corners an overview may take, the far end of the reading direction first, then its start; top before bottom, right before left. */
const CORNERS: Record<LayoutDirection, readonly (readonly ["top" | "bottom", "left" | "right"])[]> = {
  RIGHT: [["top", "right"], ["bottom", "right"], ["top", "left"], ["bottom", "left"]],
  LEFT: [["top", "left"], ["bottom", "left"], ["top", "right"], ["bottom", "right"]],
  DOWN: [["bottom", "right"], ["bottom", "left"], ["top", "right"], ["top", "left"]],
  UP: [["top", "right"], ["top", "left"], ["bottom", "right"], ["bottom", "left"]],
};

/**
 * The view a map opens at. Where the map fitted inside the insets of the
 * panels (`panelInsets`) has a zoom of at least `readable`, that view.
 * Otherwise the zoom `readable` with the start of the process at the edge of
 * the free area the reading direction starts from (`gap` inside it) and
 * centred on the start across it, and an overview in the first corner no
 * panel occupies (with `gap` around it). Each panel and the overview is then
 * kept clear across or along the area as `panelInsets` would; of these
 * choices the one under whose panels the fewest `boxes` lie wins, then the
 * one with the largest free area, then the first.
 */
export function openingView(bounds: Box, area: { width: number; height: number }, options: OpeningOptions = {}): OpeningView {
  const { panels = [], gap = 0, readable = viewTokens.openingZoom, start, direction = "RIGHT", boxes = [], overview, insets: given, ...fit } = options;
  const { minZoom = 0, maxZoom = Infinity } = fit;
  const shown = panels.filter((p) => p.width > 0 && p.height > 0);
  const fitted = fitViewport(bounds, area, { ...fit, insets: given ?? panelInsets(shown, area, bounds, { ...fit, gap }) });
  if (fitted.zoom >= readable || !start) return { ...fitted, fitted: true };
  const zoom = Math.min(maxZoom, Math.max(minZoom, readable));
  let corner: Box | undefined;
  for (const [v, h] of overview ? CORNERS[direction] : []) {
    const box = { x: h === "left" ? gap : area.width - gap - overview!.width, y: v === "top" ? gap : area.height - gap - overview!.height, ...overview! };
    const around = { x: box.x - gap, y: box.y - gap, width: box.width + 2 * gap, height: box.height + 2 * gap };
    if (shown.some((p) => overlaps(around, p))) continue;
    corner = box;
    break;
  }
  const kept = corner ? [...shown, corner] : shown;
  // Each panel kept clear across the area (left or right, on its side) or along it (top or bottom), as panelInsets does.
  const choices = kept.map((p) => [
    p.y + p.height / 2 < area.height / 2 ? { top: p.y + p.height + gap } : { bottom: area.height - p.y + gap },
    p.x + p.width / 2 < area.width / 2 ? { left: p.x + p.width + gap } : { right: area.width - p.x + gap },
  ]);
  const across = { x: start.x + start.width / 2, y: start.y + start.height / 2 };
  let best: { view: FitView; covered: number; room: number } | undefined;
  for (let mask = 0; mask < 2 ** Math.min(choices.length, MAX_TRIED); mask++) {
    const inset = { ...NO_INSETS, ...given };
    choices.forEach((c, i) => {
      for (const [side, value] of Object.entries(c[(mask >> i) & 1]) as [keyof Insets, number][]) inset[side] = Math.max(inset[side], value);
    });
    const width = area.width - inset.left - inset.right;
    const height = area.height - inset.top - inset.bottom;
    if (width <= 0 || height <= 0) continue;
    const view =
      direction === "RIGHT" || direction === "LEFT"
        ? { zoom, x: direction === "RIGHT" ? inset.left + gap - start.x * zoom : area.width - inset.right - gap - (start.x + start.width) * zoom, y: inset.top + height / 2 - across.y * zoom }
        : { zoom, x: inset.left + width / 2 - across.x * zoom, y: direction === "DOWN" ? inset.top + gap - start.y * zoom : area.height - inset.bottom - gap - (start.y + start.height) * zoom };
    let covered = 0;
    for (const b of boxes) {
      const screen = { x: b.x * zoom + view.x, y: b.y * zoom + view.y, width: b.width * zoom, height: b.height * zoom };
      if (kept.some((p) => overlaps(screen, p))) covered++;
    }
    const room = width * height;
    if (!best || covered < best.covered || (covered === best.covered && room > best.room)) best = { view, covered, room };
  }
  return { ...(best?.view ?? { ...fitted, zoom }), fitted: false, ...(corner && { overview: corner }) };
}

/**
 * The start of the process on a map: of the start events (events tagged
 * `start`) with a box the first in the reading direction, else the first node
 * with a box, ties across the direction by the smaller coordinate, then by id.
 */
export function processStart(nodes: readonly FlowNode[], positions: Pick<Positions, "nodes" | "direction">): Box | undefined {
  const along = (b: Box) => {
    switch (positions.direction) {
      case "LEFT":
        return [-(b.x + b.width), b.y];
      case "DOWN":
        return [b.y, b.x];
      case "UP":
        return [-(b.y + b.height), b.x];
      default:
        return [b.x, b.y];
    }
  };
  let best: { box: Box; key: number[]; id: string; start: boolean } | undefined;
  for (const n of nodes) {
    const box = positions.nodes[n.id];
    if (!box) continue;
    const start = n.kind === "event" && hasTag(n, "start");
    const key = along(box);
    const better = !best || (start && !best.start) || (start === best.start && (key[0] - best.key[0] || key[1] - best.key[1] || (n.id < best.id ? -1 : 1)) < 0);
    if (better) best = { box, key, id: n.id, start };
  }
  return best?.box;
}
