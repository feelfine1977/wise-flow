/**
 * Overlay geometry: where badges, arcs, self-loops, hatching, tints and chips
 * sit on a laid-out scene.
 */
import RBush from "rbush";
import type { Locale } from "./format.js";
import { type Box, type Positions, type XY, unionBoxes } from "./layout.js";
import { type FlowGroup, type Overlay, type OverlayKind, MAP_TARGET } from "./model.js";
import { arcLabel, arcWidth, badgeLabel, chipLayout, chipText, pillLayout, selfLoopLabel } from "./overlay-marks.js";
import { type LodRules, defaultLod } from "./style.js";
import { type TextMeasure, estimateTextWidth, leadMeasure } from "./text.js";
import type { Theme } from "./theme.js";
import { textTokens } from "./tokens.js";

/** The text styles the labels a placement keeps apart are measured in. */
type LabelFonts = Pick<Theme["text"], "chip" | "chipLead" | "badge" | "arcLabel" | "selfLoopLabel">;

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
  /** The box the shape's label takes: an arc's pill, a self-loop's text. */
  label?: Box;
  /** Minimum zoom at which the shape is visible. */
  minZoom: number;
}

export interface OverlayGeometryOptions {
  lod?: Partial<LodRules>;
  /** Height of a badge's pill. Default 18. */
  badgeSize?: number;
  /** Default arc height above the nodes, clamped to this range; an arc that crosses other nodes may rise further within the margin. */
  arcHeight?: [number, number];
  chipHeight?: number;
  /** The language the labels are written in, which their boxes are measured in. Default `en`. */
  locale?: Locale;
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
  const badge = options.badgeSize ?? pillLayout.height;
  const arc = options.arcHeight ?? [40, 140];
  return Math.max(arc[1] + 24, badge + 8, (options.chipHeight ?? 24) + 8);
}

/** A chip's width: padding, glyph, gauge and its text as the measure finds it in its styles, from 60 to 260. */
function chipWidth(o: Overlay, measure: TextMeasure, { chip, chipLead }: LabelFonts): number {
  const { lead = "", text } = chipText(o);
  const { padding, glyph, gauge } = chipLayout;
  return Math.min(260, Math.max(60, 2 * padding + (o.payload?.glyph ? glyph : 0) + (o.payload?.gauge ? gauge : 0) + leadMeasure(measure, lead, chipLead.weight)(lead + text, chip)));
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();

type Item = { id: string; minX: number; minY: number; maxX: number; maxY: number };

const meets = (a: Box, b: Box) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** Whether the segment from `a` to `b` meets the box `it` grown by `r` (Liang–Barsky). */
function segmentMeets(a: XY, b: XY, it: Item, r: number): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[a.x - b.x, a.x - it.minX + r], [b.x - a.x, it.maxX + r - a.x], [a.y - b.y, a.y - it.minY + r], [b.y - a.y, it.maxY + r - a.y]]) {
    if (p < 0) t0 = Math.max(t0, q / p);
    else if (p > 0) t1 = Math.min(t1, q / p);
    else if (q < 0) return false;
  }
  return t0 <= t1;
}

/** Where the chips inside a box are placed from: their right end 8 in from its right edge, the first 6 below its top. */
export function chipAnchor(box: Box): XY {
  return { x: box.x + box.width - 8, y: box.y + 6 };
}

/**
 * Where the renderers write each group's title: 12 in from the left edge of its
 * box, on a baseline 22 below its top, at 14 px (about 0.6 em per character).
 */
export function groupTitles(groups: readonly FlowGroup[], positions: Positions): Box[] {
  return groups.flatMap((g) => {
    const b = positions.groups[g.id];
    return b ? [{ x: b.x + 12, y: b.y + 8, width: Array.from(g.label).length * 8.4, height: 18 }] : [];
  });
}

/**
 * Geometry of overlays that are already in canonical order (see
 * `canonicalOverlays`); shape ids carry the position in that order. Badges as
 * pills in a row wholly above the node from its top-right corner (left of a
 * self-loop), arcs as cubic curves above (or, for reverse arcs, below) the map,
 * self-loops at the top-right corner, hatch and tint over the element's box,
 * chips inside groups. An arc takes another height or side only where that
 * crosses fewer other nodes. The labels are placed last: an arc's pill sits on
 * the arc nearest its middle where it covers no node, badge, chip, self-loop
 * label, earlier arc label or title. Shapes never extend beyond
 * `overlayMargin` around the positions' bounds.
 */
export function placeOverlays(
  ordered: Overlay[],
  positions: Positions,
  options: OverlayGeometryOptions = {},
  /** Boxes that arc labels keep clear of besides the nodes and the other labels (`groupTitles`). */
  titles: readonly Box[] = [],
  /** What labels and chips are measured by, in the styles the marks draw them in. */
  measure: TextMeasure = estimateTextWidth,
  fonts: LabelFonts = textTokens,
): OverlayGeometry {
  const lod = { ...defaultLod, ...(options.lod ?? {}) };
  const locale = options.locale ?? "en";
  const badge = options.badgeSize ?? pillLayout.height;
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
  const placed: (OverlayShape | undefined)[] = [];
  // Where the next badge on a node ends on the right, and how many chips a group holds so far.
  const badgeEnd = new Map<string, number>();
  const arcCount = new Map<string, number>();
  const chipCount = new Map<string, number>();
  const boxOf = (id: string): Box | undefined => positions.nodes[id] ?? positions.groups[id];
  const looped = new Set(ordered.filter((o) => o.kind === "selfLoop").map((o) => o.target));
  // The nodes in an R-tree, built for the first arc; the labels on the map placed so far.
  let tree: RBush<Item> | undefined;
  const within = (b: Box): Item[] =>
    (tree ??= new RBush<Item>().load(Object.entries(positions.nodes).map(([id, n]) => ({ id, minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height })))).search({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height });
  const labels: Box[] = [];
  const arcs: number[] = [];
  const loops: number[] = [];

  ordered.forEach((o, index) => {
    const id = `${o.kind}:${o.target}:${index}`;
    switch (o.kind) {
      case "badge": {
        const box = boxOf(o.target);
        if (!box) return;
        // From the top-right corner leftwards, 2 above the box; left of the self-loop where the node has one.
        const end = badgeEnd.get(o.target) ?? box.x + box.width - (looped.has(o.target) ? 22 : 0);
        const width = Math.max(badge, measure(badgeLabel(o, locale), fonts.badge) + 2 * pillLayout.padding);
        badgeEnd.set(o.target, end - width - 4);
        const b = clampBox({ x: end - width, y: box.y - badge - 2, width, height: badge });
        labels.push(b);
        placed[index] = { id, overlay: o, kind: o.kind, ...b, minZoom: lod.badges };
        return;
      }
      case "arc":
        arcs.push(index);
        return;
      case "selfLoop": {
        const box = boxOf(o.target);
        if (!box) return;
        const r = 14;
        const ax = box.x + box.width - 18;
        const ay = box.y + 12;
        const path = `M${fmt(ax)} ${fmt(box.y)} C${fmt(ax)} ${fmt(box.y - 2 * r)} ${fmt(box.x + box.width + 2 * r)} ${fmt(ay)} ${fmt(box.x + box.width)} ${fmt(ay)}`;
        const b = clampBox({ x: ax - 2, y: box.y - 1.5 * r - 2, width: box.x + box.width + 1.5 * r + 4 - (ax - 2), height: ay - (box.y - 1.5 * r - 2) + 2 });
        loops.push(index);
        placed[index] = { id, overlay: o, kind: o.kind, ...b, path, minZoom: lod.selfLoops };
        return;
      }
      case "hatch":
      case "tint": {
        const box = boxOf(o.target);
        if (!box) return;
        placed[index] = { id, overlay: o, kind: o.kind, ...box, minZoom: o.kind === "hatch" ? lod.hatch : 0 };
        return;
      }
      case "chip": {
        const width = chipWidth(o, measure, fonts);
        if (o.target === MAP_TARGET) {
          const slot = chipCount.get(MAP_TARGET) ?? 0;
          chipCount.set(MAP_TARGET, slot + 1);
          const b = clampBox({ x: positions.bounds.x, y: positions.bounds.y - margin + 4 + slot * (chipH + 4), width, height: chipH });
          placed[index] = { id, overlay: o, kind: o.kind, ...b, minZoom: lod.chips };
          return;
        }
        const box = boxOf(o.target);
        if (!box) return;
        const slot = chipCount.get(o.target) ?? 0;
        chipCount.set(o.target, slot + 1);
        const at = chipAnchor(box);
        const b = clampBox({ x: at.x - width, y: at.y + slot * (chipH + 4), width, height: chipH });
        labels.push(b);
        placed[index] = { id, overlay: o, kind: o.kind, ...b, minZoom: lod.chips };
        return;
      }
    }
  });

  /** Of the boxes, the first that covers no node, label or title; otherwise the one that covers fewest. */
  const clearest = (boxes: Box[]): Box => {
    let best = boxes[0];
    let least = Infinity;
    for (const r of boxes) {
      const count = within(r).length + [...labels, ...titles].filter((b) => meets(b, r)).length;
      if (count < least) [best, least] = [r, count];
      if (!least) break;
    }
    labels.push(best);
    return best;
  };

  // A self-loop's label right of its corner, or above the loop, or left of it, each a step higher where that is taken.
  for (const index of loops) {
    const shape = placed[index]!;
    const box = boxOf(shape.overlay.target)!;
    const text = selfLoopLabel(shape.overlay, locale);
    if (!text) continue;
    const font = fonts.selfLoopLabel;
    const width = measure(text, font);
    const ax = box.x + box.width - 18;
    // The text from its baseline up a full size and down a quarter.
    const at = (x: number, baseline: number): Box => ({ x, y: baseline - font.size, width, height: 1.25 * font.size });
    const label = clearest([0, 21, 34, 47].flatMap((lift) => [at(box.x + box.width + 6, box.y - 6 - lift), at(ax, box.y - 27 - lift), at(ax - 4 - width, box.y - 6 - lift)]));
    const b = clampBox(unionBoxes([shape, label]));
    placed[index] = { ...shape, ...b, labelX: label.x, labelY: label.y + font.size, label };
  }

  for (const index of arcs) {
    const o = ordered[index];
    const id = `${o.kind}:${o.target}:${index}`;
    const p = o.payload ?? {};
    const s = boxOf(String(p.source ?? ""));
    const tg = boxOf(String(p.target ?? ""));
    if (!s || !tg) continue;
    const key = [p.source, p.target].sort().join("|");
    const n = arcCount.get(key) ?? 0;
    arcCount.set(key, n + 1);
    const reverse = !!p.reverse;
    const sx = s.x + s.width / 2;
    const tx = tg.x + tg.width / 2;
    // Half the arc's width and 4 of paper between it and any other node.
    const half = arcWidth(o) / 2 + 4;
    const h0 = Math.min(arcMax, Math.max(arcMin, Math.abs(tx - sx) * 0.22) + n * 14);
    // A course from the tops (or bottoms) of the ends, and the other nodes it crosses (up to `bound`).
    const course = (below: boolean, h: number, bound = Infinity) => {
      const sy = below ? s.y + s.height : s.y;
      const ty = below ? tg.y + tg.height : tg.y;
      const dy = below ? h : -h;
      const at = (t: number): XY => {
        const u = 1 - t;
        const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        return { x: t === 0.5 ? (sx + tx) / 2 : (w0 + w1) * sx + (w2 + w3) * tx, y: w0 * sy + w1 * (sy + dy) + w2 * (ty + dy) + w3 * ty };
      };
      const hit = new Set<string>();
      for (let i = 0, a = at(0); i < 32 && hit.size < bound; i++) {
        const b = at((i + 1) / 32);
        for (const it of within({ x: Math.min(a.x, b.x) - half, y: Math.min(a.y, b.y) - half, width: Math.abs(b.x - a.x) + 2 * half, height: Math.abs(b.y - a.y) + 2 * half })) {
          if (it.id !== p.source && it.id !== p.target && segmentMeets(a, b, it, half)) hit.add(it.id);
        }
        a = b;
      }
      return { below, sy, ty, dy, at, crossed: hit.size };
    };
    // Own side first, nearest height first (further out on a tie), up to 32 steps of 14, within
    // the margin.
    let best = course(reverse, h0);
    for (const below of [reverse, !reverse]) {
      const mid = below ? (s.y + s.height + tg.y + tg.height) / 2 : (s.y + tg.y) / 2;
      const room = below ? limit.y + limit.height - 18 - mid : mid - 22 - limit.y;
      for (let k = below === reverse ? 1 : 0; k <= 32 && best.crossed; k++) {
        for (const h of k ? [h0 + k * 14, h0 - k * 14] : [h0]) {
          if (h >= arcMin && 0.75 * h <= room && best.crossed) {
            const c = course(below, h, best.crossed);
            if (c.crossed < best.crossed) best = c;
          }
        }
      }
    }
    const { sy, ty, dy, at } = best;
    const path = `M${fmt(sx)} ${fmt(sy)} C${fmt(sx)} ${fmt(sy + dy)} ${fmt(tx)} ${fmt(ty + dy)} ${fmt(tx)} ${fmt(ty)}`;
    const apexY = at(0.5).y;
    // The pill on the arc, centred on it nearest its middle where it covers the fewest nodes, labels and titles.
    const text = arcLabel(o, locale);
    let label: Box | undefined;
    if (text) {
      const width = measure(text, fonts.arcLabel) + 2 * pillLayout.padding;
      const pill = (c: XY): Box => ({ x: c.x - width / 2, y: c.y - pillLayout.height / 2, width, height: pillLayout.height });
      label = clearest(Array.from({ length: 29 }, (_, k) => pill(at(0.5 + ((k % 2 ? -1 : 1) * Math.ceil(k / 2)) / 32))));
    }
    const x0 = Math.min(sx, tx, label?.x ?? sx);
    const x1 = Math.max(sx, tx, label ? label.x + label.width : sx);
    const y0 = Math.min(sy, ty, apexY, label?.y ?? sy);
    const y1 = Math.max(sy, ty, apexY, label ? label.y + label.height : sy);
    const extent = { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
    const b = typeof p.displayLabel === "string" ? extent : clampBox(extent);
    placed[index] = { id, overlay: o, kind: o.kind, ...b, path, labelX: label && label.x + label.width / 2, labelY: label && label.y + label.height / 2, label, minZoom: lod.arcs };
  }
  const shapes = placed.filter((x): x is OverlayShape => x !== undefined);
  return { shapes, bounds: unionBoxes(shapes), margin };
}
