/**
 * Overlay geometry: where badges, arcs, self-loops, hatching, tints and chips
 * sit on a laid-out scene.
 */
import { type Box, type Positions, type XY, unionBoxes } from "./layout.js";
import { type Overlay, type OverlayKind, MAP_TARGET } from "./model.js";
import { type LodRules, defaultLod } from "./style.js";

export interface OverlayShape {
  id: string;
  overlay: Overlay;
  kind: OverlayKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** SVG path data in scene coordinates (arcs, self-loops). */
  path?: string;
  labelX?: number;
  labelY?: number;
  /** Minimum zoom at which the shape is visible. */
  minZoom: number;
}

export interface OverlayGeometryOptions {
  lod?: Partial<LodRules>;
  badgeSize?: number;
  /** Arc height above the nodes, clamped to this range. */
  arcHeight?: [number, number];
  chipHeight?: number;
}

export interface OverlayGeometry {
  shapes: OverlayShape[];
  /** Union of all shapes; empty box when there are none. */
  bounds: Box;
  /** Distance by which shapes may extend beyond the positions' bounds. */
  margin: number;
}

/** Margin that overlay geometry may add around a layout. */
export function overlayMargin(options: OverlayGeometryOptions = {}): number {
  const badge = options.badgeSize ?? 22;
  const arc = options.arcHeight ?? [40, 140];
  return Math.max(arc[1] + 24, badge + 8, (options.chipHeight ?? 24) + 8);
}

function chipWidth(text: string | undefined, glyph: string | undefined): number {
  const len = (text?.length ?? 0) + (glyph ? 2 : 0);
  return Math.min(260, Math.max(60, 16 + len * 6.2));
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();

/**
 * Geometry of overlays that are already in canonical order (see
 * `canonicalOverlays`); shape ids carry the position in that order. Badge slots along the top edge of the
 * node, arcs as cubic curves above (or, for reverse arcs, below) the map, self-loops
 * at the top-right corner, hatch and tint over the element's box, chips inside groups.
 * Shapes never extend beyond `overlayMargin` around the positions' bounds.
 */
export function placeOverlays(
  ordered: Overlay[],
  positions: Positions,
  options: OverlayGeometryOptions = {},
): OverlayGeometry {
  const lod = { ...defaultLod, ...(options.lod ?? {}) };
  const badge = options.badgeSize ?? 22;
  const [arcMin, arcMax] = options.arcHeight ?? [40, 140];
  const chipH = options.chipHeight ?? 24;
  const margin = overlayMargin(options);
  const limit: Box = {
    x: positions.bounds.x - margin,
    y: positions.bounds.y - margin,
    width: positions.bounds.width + 2 * margin,
    height: positions.bounds.height + 2 * margin,
  };
  const clampBox = (b: Box): Box => {
    const x = Math.max(limit.x, Math.min(b.x, limit.x + limit.width - b.width));
    const y = Math.max(limit.y, Math.min(b.y, limit.y + limit.height - b.height));
    return { x, y, width: Math.min(b.width, limit.width), height: Math.min(b.height, limit.height) };
  };
  const shapes: OverlayShape[] = [];
  const badgeCount = new Map<string, number>();
  const arcCount = new Map<string, number>();
  const chipCount = new Map<string, number>();
  const boxOf = (id: string): Box | undefined => positions.nodes[id] ?? positions.groups[id];

  ordered.forEach((o, index) => {
    const id = `${o.kind}:${o.target}:${index}`;
    const p = o.payload ?? {};
    switch (o.kind) {
      case "badge": {
        const box = boxOf(o.target);
        if (!box) return;
        const slot = badgeCount.get(o.target) ?? 0;
        badgeCount.set(o.target, slot + 1);
        const width = p.glyph ? Math.max(badge, 10 + p.glyph.length * 7) : badge;
        const b = clampBox({ x: box.x + box.width - (slot + 1) * (width + 4) + 2, y: box.y - badge / 2, width, height: badge });
        shapes.push({ id, overlay: o, kind: o.kind, ...b, minZoom: lod.badges });
        return;
      }
      case "arc": {
        const s = boxOf(String(p.source ?? ""));
        const tg = boxOf(String(p.target ?? ""));
        if (!s || !tg) return;
        const key = [p.source, p.target].sort().join("|");
        const n = arcCount.get(key) ?? 0;
        arcCount.set(key, n + 1);
        const reverse = !!p.reverse;
        const sx = s.x + s.width / 2;
        const tx = tg.x + tg.width / 2;
        const sy = reverse ? s.y + s.height : s.y;
        const ty = reverse ? tg.y + tg.height : tg.y;
        const span = Math.abs(tx - sx);
        const h = Math.min(arcMax, Math.max(arcMin, span * 0.22) + n * 14);
        const dir = reverse ? 1 : -1;
        const c1y = sy + dir * h;
        const c2y = ty + dir * h;
        const path = `M${fmt(sx)} ${fmt(sy)} C${fmt(sx)} ${fmt(c1y)} ${fmt(tx)} ${fmt(c2y)} ${fmt(tx)} ${fmt(ty)}`;
        const apexY = 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ty;
        const labelX = (sx + tx) / 2, labelY = apexY + (reverse ? 14 : -8);
        const labelHalfWidth = typeof p.displayLabel === "string" ? p.displayLabel.length * 11 / 2 + 4 : 0;
        const x0 = Math.min(sx, tx, labelX - labelHalfWidth);
        const x1 = Math.max(sx, tx, labelX + labelHalfWidth);
        const y0 = Math.min(sy, ty, apexY, labelY - 14);
        const y1 = Math.max(sy, ty, apexY, labelY + 4);
        const extent = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
        const b = typeof p.displayLabel === "string" ? extent : clampBox(extent);
        shapes.push({ id, overlay: o, kind: o.kind, ...b, path, labelX, labelY, minZoom: lod.arcs });
        return;
      }
      case "selfLoop": {
        const box = boxOf(o.target);
        if (!box) return;
        const r = 14;
        const ax = box.x + box.width - 18;
        const ay = box.y + 12;
        const path = `M${fmt(ax)} ${fmt(box.y)} C${fmt(ax)} ${fmt(box.y - 2 * r)} ${fmt(box.x + box.width + 2 * r)} ${fmt(ay)} ${fmt(box.x + box.width)} ${fmt(ay)}`;
        const b = clampBox({ x: ax - 2, y: box.y - 1.5 * r - 2, width: box.x + box.width + 1.5 * r + 4 - (ax - 2), height: ay - (box.y - 1.5 * r - 2) + 2 });
        if (o.payload?.observed && typeof o.payload.displayLabel === "string") b.width = Math.max(b.width, box.x + box.width + 6 + o.payload.displayLabel.length * 7 - b.x);
        shapes.push({ id, overlay: o, kind: o.kind, ...b, path, labelX: box.x + box.width + 6, labelY: box.y - 6, minZoom: lod.selfLoops });
        return;
      }
      case "hatch":
      case "tint": {
        const box = boxOf(o.target);
        if (!box) return;
        shapes.push({ id, overlay: o, kind: o.kind, ...box, minZoom: o.kind === "hatch" ? lod.hatch : 0 });
        return;
      }
      case "chip": {
        const width = chipWidth(p.text, p.glyph);
        if (o.target === MAP_TARGET) {
          const slot = chipCount.get(MAP_TARGET) ?? 0;
          chipCount.set(MAP_TARGET, slot + 1);
          const b = clampBox({ x: positions.bounds.x, y: positions.bounds.y - margin + 4 + slot * (chipH + 4), width, height: chipH });
          shapes.push({ id, overlay: o, kind: o.kind, ...b, minZoom: lod.chips });
          return;
        }
        const box = boxOf(o.target);
        if (!box) return;
        const slot = chipCount.get(o.target) ?? 0;
        chipCount.set(o.target, slot + 1);
        const b = clampBox({ x: box.x + box.width - width - 8, y: box.y + 6 + slot * (chipH + 4), width, height: chipH });
        shapes.push({ id, overlay: o, kind: o.kind, ...b, minZoom: lod.chips });
        return;
      }
    }
  });
  return { shapes, bounds: unionBoxes(shapes), margin };
}

/** Anchor point of a shape for tooltips. */
export function shapeAnchor(s: OverlayShape): XY {
  return { x: s.labelX ?? s.x + s.width / 2, y: s.labelY ?? s.y };
}
