/**
 * R-tree hit index over rendered geometry for hover and click on Canvas and
 * in exports. Items are nodes, groups, edge segments and overlay shapes.
 */
import RBush from "rbush";
import type { Box, EdgeRoute, Positions, XY } from "./layout.js";
import { type OverlayMark, markLayer } from "./overlay-marks.js";
import type { OverlayGeometry } from "./overlays.js";

type HitKind = "node" | "edge" | "group" | "overlay";

export interface HitItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  kind: HitKind;
  /** Segment of an edge route (for distance tests). */
  segment?: [XY, XY];
  /** Overlay shape id. */
  shapeId?: string;
  /**
   * Position of the element in the list it is drawn from (groups, nodes,
   * edges or overlay shapes), when the index was built with one; a drawing
   * reads the elements an area query finds in this order.
   */
  index?: number;
  /** The box of a node, group or overlay shape: hit tests read it, area queries the bounds, which `extentOf` may have grown beyond it. */
  box?: Box;
  /** The layer of an overlay shape, for the order of hits; above the nodes when absent. */
  layer?: OverlayMark["layer"];
}

/** The order of hits: what is painted on top comes first. */
function rank(it: HitItem): number {
  switch (it.kind) {
    case "overlay":
      return it.layer === "below" ? 4 : it.layer === "between" ? 2 : 0;
    case "node":
      return 1;
    case "edge":
      return 3;
    default:
      return 5;
  }
}

function distanceToSegment(p: XY, [a, b]: [XY, XY]): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let tt = 0;
  if (len2 > 0) tt = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const cx = a.x + tt * dx;
  const cy = a.y + tt * dy;
  return Math.hypot(p.x - cx, p.y - cy);
}

const near = (b: Box, x: number, y: number, tolerance: number) => b.x - tolerance <= x && x <= b.x + b.width + tolerance && b.y - tolerance <= y && y <= b.y + b.height + tolerance;

export class HitIndex {
  private tree = new RBush<HitItem>();

  /** `tolerance`: what an edge segment's bounds were grown by, for comparing sizes. */
  constructor(private tolerance = 4) {}

  /** Build an index from a layout (nodes, groups, edge routes), optional overlay geometry, each element's `index` (by shape id for overlays) and a box each item's bounds also cover (`extentOf`). */
  static fromScene(positions: Positions, geometry?: OverlayGeometry, edgeTolerance = 4, indexOf?: (kind: HitKind, id: string) => number | undefined, extentOf?: (item: HitItem) => Box | undefined): HitIndex {
    const index = new HitIndex(edgeTolerance);
    const items: HitItem[] = [];
    const add = (item: HitItem) => {
      const e = extentOf?.(item);
      if (e) {
        item.minX = Math.min(item.minX, Math.floor(e.x));
        item.minY = Math.min(item.minY, Math.floor(e.y));
        item.maxX = Math.max(item.maxX, Math.ceil(e.x + e.width));
        item.maxY = Math.max(item.maxY, Math.ceil(e.y + e.height));
      }
      items.push(item);
    };
    for (const [id, b] of Object.entries(positions.groups)) add(boxItem(id, "group", b, indexOf?.("group", id)));
    for (const [id, b] of Object.entries(positions.nodes)) add(boxItem(id, "node", b, indexOf?.("node", id)));
    for (const [id, r] of Object.entries(positions.edges)) for (const item of edgeItems(id, r, edgeTolerance, indexOf?.("edge", id))) add(item);
    for (const s of geometry?.shapes ?? []) add({ ...boxItem(s.overlay.target, "overlay", s, indexOf?.("overlay", s.id)), shapeId: s.id, layer: markLayer(s.kind) });
    index.load(items);
    return index;
  }

  load(items: HitItem[]): this {
    this.tree.load(items);
    return this;
  }

  insert(item: HitItem): this {
    this.tree.insert(item);
    return this;
  }

  clear(): this {
    this.tree.clear();
    return this;
  }

  /** An element's size: its box, a segment with the tolerance around it, or the bounds of an item loaded without a box. */
  private area(it: HitItem): number {
    if (it.box) return it.box.width * it.box.height;
    if (it.segment) {
      const [a, b] = it.segment;
      return (Math.abs(b.x - a.x) + 2 * this.tolerance) * (Math.abs(b.y - a.y) + 2 * this.tolerance);
    }
    return (it.maxX - it.minX) * (it.maxY - it.minY);
  }

  /** Items within `tolerance` of a point, the one painted on top first (marks above the nodes, nodes, arcs, edges, tints, groups), smaller first, then by id. */
  at(x: number, y: number, tolerance = 4): HitItem[] {
    const hits = this.tree.search({ minX: x - tolerance, minY: y - tolerance, maxX: x + tolerance, maxY: y + tolerance });
    return hits
      .filter((it) => (it.segment ? distanceToSegment({ x, y }, it.segment) <= tolerance : !it.box || near(it.box, x, y, tolerance)))
      .sort((a, b) => rank(a) - rank(b) || this.area(a) - this.area(b) || (a.id < b.id ? -1 : 1));
  }

  /** Items whose bounds intersect a box. */
  within(box: Box): HitItem[] {
    return this.tree.search({ minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height });
  }

  get size(): number {
    return this.tree.all().length;
  }
}

function boxItem(id: string, kind: HitKind, b: Box, index: number | undefined): HitItem {
  return { id, kind, minX: Math.floor(b.x), minY: Math.floor(b.y), maxX: Math.ceil(b.x + b.width), maxY: Math.ceil(b.y + b.height), index, box: b };
}

function edgeItems(id: string, route: EdgeRoute, tolerance: number, index: number | undefined): HitItem[] {
  const out: HitItem[] = [];
  for (let i = 0; i + 1 < route.points.length; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];
    out.push({
      id,
      kind: "edge",
      minX: Math.floor(Math.min(a.x, b.x) - tolerance),
      minY: Math.floor(Math.min(a.y, b.y) - tolerance),
      maxX: Math.ceil(Math.max(a.x, b.x) + tolerance),
      maxY: Math.ceil(Math.max(a.y, b.y) + tolerance),
      segment: route.points.length === 2 ? (route.points as [XY, XY]) : [a, b],
      index,
    });
  }
  return out;
}
