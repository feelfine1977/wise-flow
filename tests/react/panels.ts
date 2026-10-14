/**
 * The boxes a browser gives a map and the panels over it, which jsdom does
 * not: every element is as large as the map's area, its offset size too (so
 * React Flow and the Canvas map take that size), except the panels, each of
 * its size in its corner `MARGIN` from the area's edges, and an element
 * placed by its inline style (the overview), at its place.
 */
import type { Box } from "../../src/index";

export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "bottom-center";
export type PanelSizes = Partial<Record<Corner, { width: number; height: number }>>;

/** The room between a panel and the area's edges. */
export const MARGIN = 12;

/** The corner of a React Flow panel (`top left`) or an overlay panel of the Canvas map (`wf-overlay-panel--top-left`). */
function cornerOf(el: Element): Corner | undefined {
  if (el.classList.contains("wf-overview")) return undefined;
  const own = [...el.classList].find((c) => c.startsWith("wf-overlay-panel--"))?.slice("wf-overlay-panel--".length);
  if (own) return own as Corner;
  if (!el.classList.contains("react-flow__panel")) return undefined;
  const v = el.classList.contains("top") ? "top" : "bottom";
  const h = el.classList.contains("left") ? "left" : el.classList.contains("right") ? "right" : "center";
  return `${v}-${h}` as Corner;
}

/** Where a panel of `size` in `corner` lies in an area. */
export function panelBox(corner: Corner, size: { width: number; height: number }, area: { width: number; height: number }): Box {
  const x = corner.endsWith("left") ? MARGIN : corner.endsWith("right") ? area.width - MARGIN - size.width : (area.width - size.width) / 2;
  const y = corner.startsWith("top") ? MARGIN : area.height - MARGIN - size.height;
  return { x, y, ...size };
}

const px = (v: string | undefined) => (v && /^-?[\d.]+px$/.test(v) ? parseFloat(v) : undefined);

/** Installs the boxes; returns what restores jsdom's. A panel in a corner without a size has none. */
export function browserBoxes(area: { width: number; height: number }, panels: PanelSizes): () => void {
  const proto = window.HTMLElement.prototype;
  const saved = {
    offsetWidth: Object.getOwnPropertyDescriptor(proto, "offsetWidth")!,
    offsetHeight: Object.getOwnPropertyDescriptor(proto, "offsetHeight")!,
    rect: proto.getBoundingClientRect,
  };
  Object.defineProperties(proto, {
    offsetWidth: { configurable: true, get() { return px((this as HTMLElement).style.width) ?? area.width; } },
    offsetHeight: { configurable: true, get() { return px((this as HTMLElement).style.height) ?? area.height; } },
  });
  proto.getBoundingClientRect = function (this: HTMLElement) {
    const corner = cornerOf(this);
    const size = corner && panels[corner];
    const placed = { x: px(this.style.left), y: px(this.style.top), width: px(this.style.width), height: px(this.style.height) };
    const box: Box = corner
      ? size ? panelBox(corner, size, area) : { x: 0, y: 0, width: 0, height: 0 }
      : placed.x !== undefined && placed.y !== undefined ? { x: placed.x, y: placed.y, width: placed.width ?? 0, height: placed.height ?? 0 } : { x: 0, y: 0, ...area };
    return { ...box, left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    Object.defineProperties(proto, { offsetWidth: saved.offsetWidth, offsetHeight: saved.offsetHeight });
    proto.getBoundingClientRect = saved.rect;
  };
}
