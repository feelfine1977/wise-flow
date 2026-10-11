/**
 * The fitted view of a map: its bounds whole inside the area it is drawn in,
 * less insets, so that the panels over the map (the abstraction panel, the
 * legend, the zoom control, notes) cover none of what the view was fitted to.
 * Every renderer fits with these two functions: the React Flow map, the Canvas
 * map and the BPMN view.
 */
import type { Box } from "./layout.js";

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
 * insets across it). `gap` is added to each inset. Panels without a size and
 * choices that leave no room are left out.
 */
export function panelInsets(panels: readonly Box[], area: { width: number; height: number }, bounds: Box, options: Omit<FitOptions, "insets"> & { gap?: number } = {}): Insets {
  const { gap = 0, ...fit } = options;
  const shown = panels.filter((p) => p.width > 0 && p.height > 0);
  const choices = shown.map((p) => {
    const vertical = p.y + p.height / 2 < area.height / 2 ? { top: p.y + p.height + gap } : { bottom: area.height - p.y + gap };
    const horizontal = p.x + p.width / 2 < area.width / 2 ? { left: p.x + p.width + gap } : { right: area.width - p.x + gap };
    return [vertical, horizontal] as Partial<Insets>[];
  });
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
