/**
 * R-tree hit index over rendered geometry for hover and click on Canvas and
 * in exports. Items are nodes, groups, edge segments and overlay shapes.
 */
import RBush from "rbush";
import type { Box, EdgeRoute, Positions, XY } from "./layout.js";
import type { OverlayGeometry } from "./overlays.js";

export type HitKind = "node" | "edge" | "group" | "overlay";

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
}

const PRIORITY: Record<HitKind, number> = { overlay: 0, node: 1, edge: 2, group: 3 };

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

function area(it: HitItem): number {
  return (it.maxX - it.minX) * (it.maxY - it.minY);
}

export class HitIndex {
  private tree = new RBush<HitItem>();

  /** Build an index from a layout (nodes, groups, edge routes) and optional overlay geometry. */
  static fromScene(positions: Positions, geometry?: OverlayGeometry, edgeTolerance = 4): HitIndex {
    const index = new HitIndex();
    const items: HitItem[] = [];
    for (const [id, b] of Object.entries(positions.groups)) items.push(boxItem(id, "group", b));
    for (const [id, b] of Object.entries(positions.nodes)) items.push(boxItem(id, "node", b));
    for (const [id, r] of Object.entries(positions.edges)) items.push(...edgeItems(id, r, edgeTolerance));
    for (const s of geometry?.shapes ?? []) {
      items.push({ ...boxItem(s.overlay.target, "overlay", s), shapeId: s.id });
    }
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

  /** Items under a point, best first (overlays, nodes, edges, groups; smaller first). */
  at(x: number, y: number, tolerance = 4): HitItem[] {
    const hits = this.tree.search({ minX: x - tolerance, minY: y - tolerance, maxX: x + tolerance, maxY: y + tolerance });
    return hits
      .filter((it) => (it.segment ? distanceToSegment({ x, y }, it.segment) <= tolerance : true))
      .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || area(a) - area(b) || (a.id < b.id ? -1 : 1));
  }

  /** Items intersecting a box. */
  within(box: Box): HitItem[] {
    return this.tree.search({ minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height });
  }

  get size(): number {
    return this.tree.all().length;
  }
}

function boxItem(id: string, kind: HitKind, b: Box): HitItem {
  return { id, kind, minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
}

function edgeItems(id: string, route: EdgeRoute, tolerance: number): HitItem[] {
  const out: HitItem[] = [];
  for (let i = 0; i + 1 < route.points.length; i++) {
    const a = route.points[i];
    const b = route.points[i + 1];
    out.push({
      id,
      kind: "edge",
      minX: Math.min(a.x, b.x) - tolerance,
      minY: Math.min(a.y, b.y) - tolerance,
      maxX: Math.max(a.x, b.x) + tolerance,
      maxY: Math.max(a.y, b.y) + tolerance,
      segment: [a, b],
    });
  }
  return out;
}
