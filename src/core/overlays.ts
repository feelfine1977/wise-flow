/**
 * Constraint overlay grammar: presets that turn a constraint description and
 * its statistics into overlays, and the geometry renderers draw from.
 */
import { type Locale, formatDays, formatNumber, formatShare } from "./format.js";
import type { Box, Positions, XY } from "./layout.js";
import { type FlowGraph, type Overlay, type OverlayKind, type OverlayPayload, MAP_TARGET } from "./model.js";
import { type LodRules, defaultLod } from "./style.js";
import { type StringKey, t } from "./strings.js";

export type ConstraintType =
  | "presence"
  | "singularity"
  | "exclusion"
  | "lag"
  | "precedence"
  | "balance"
  | "metric"
  | "applicability";

/** What a constraint says; ids refer to node and group ids of the graph. */
export interface ConstraintDescription {
  id: string;
  type: ConstraintType;
  label?: string;
  layer?: string;
  /** Activities the constraint refers to (presence, singularity, exclusion). */
  activities?: string[];
  /** Endpoints of lag and precedence constraints; alternatives are listed. */
  a?: string[];
  b?: string[];
  /** Group the constraint is attached to (balance, applicability). */
  group?: string;
  params?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  description?: string;
}

/** Numbers computed by the analysis for one scene. All fields are optional. */
export interface ConstraintStats {
  cases?: number;
  evaluated?: number;
  violations?: number;
  violationShare?: number;
  coverage?: number;
  repeatShare?: number;
  meanCount?: number;
  maxCount?: number;
  medianDays?: number | null;
  p90Days?: number | null;
  unit?: string;
  reverseShare?: number;
  mean?: number | null;
  median?: number | null;
  p90?: number | null;
  threshold?: number;
  width?: number;
  casesInScope?: number;
  inScopeShare?: number;
  /** Per node: share of the node's events that fall inside the scope. */
  nodeShareInScope?: Record<string, number>;
  [key: string]: unknown;
}

export interface OverlayPresetOptions {
  locale?: Locale;
  /** Nodes with an in-scope share below this are hatched (applicability). Default 0.01. */
  outOfScopeMinShare?: number;
  /** When given, arcs are only emitted between endpoints present in the graph. */
  graph?: FlowGraph;
}

function base(c: ConstraintDescription, extra: OverlayPayload = {}): OverlayPayload {
  return {
    constraintId: c.id,
    constraintType: c.type,
    layer: c.layer,
    label: c.label ?? c.id,
    description: c.description,
    ...extra,
  };
}

function present(graph: FlowGraph | undefined, ids: string[]): string[] {
  if (!graph) return ids;
  const known = new Set(graph.nodes.map((n) => n.id));
  return ids.filter((id) => known.has(id));
}

/**
 * Overlay preset per constraint type:
 * - presence: badge per activity with the missing share;
 * - singularity: badge "≤ k" and a self-loop tinted by the repeat share;
 * - exclusion: badge "∅" with the occurrence share;
 * - lag: arc a → b above the map, width = coverage, colour = late share;
 * - precedence: arc with an order glyph, plus a reverse arc for violations;
 * - balance / metric: chip with the gauge, tint on the group when attached to one;
 * - applicability: hatch on nodes outside the scope, chip with the in-scope share.
 */
export function constraintOverlays(
  c: ConstraintDescription,
  stats: ConstraintStats = {},
  options: OverlayPresetOptions = {},
): Overlay[] {
  const locale = options.locale ?? "en";
  const share = stats.violationShare ?? 0;
  const applicable = (stats.evaluated ?? stats.cases ?? 1) > 0;
  const na = applicable ? undefined : t(locale, "constraint.notApplicable");
  const out: Overlay[] = [];

  switch (c.type) {
    case "presence": {
      const m = Number(c.params?.m ?? 1);
      for (const id of present(options.graph, c.activities ?? [])) {
        out.push({
          kind: "badge",
          target: id,
          payload: base(c, { glyph: m <= 1 ? "≥1" : `≥${m}`, value: share, text: na ?? t(locale, "constraint.missing", { share: formatShare(share, locale) }) }),
        });
      }
      break;
    }
    case "singularity": {
      const k = Number(c.params?.k ?? 1);
      const repeat = stats.repeatShare ?? share;
      for (const id of present(options.graph, c.activities ?? [])) {
        out.push({
          kind: "badge",
          target: id,
          payload: base(c, { glyph: `≤${k}`, value: share, text: na ?? t(locale, "constraint.repeated", { share: formatShare(repeat, locale) }) }),
        });
        out.push({
          kind: "selfLoop",
          target: id,
          payload: base(c, {
            value: repeat,
            text: na ?? t(locale, "constraint.repeated", { share: formatShare(repeat, locale) }),
            maxCount: stats.maxCount,
          }),
        });
      }
      break;
    }
    case "exclusion": {
      for (const id of present(options.graph, c.activities ?? [])) {
        out.push({
          kind: "badge",
          target: id,
          payload: base(c, { glyph: "∅", value: share, text: na ?? t(locale, "constraint.occurs", { share: formatShare(share, locale) }) }),
        });
      }
      break;
    }
    case "lag": {
      const as = present(options.graph, c.a ?? []);
      const bs = present(options.graph, c.b ?? []);
      const delta = typeof c.params?.delta === "number" ? c.params.delta : undefined;
      const width = typeof c.params?.width === "number" ? c.params.width : undefined;
      const unit = String(c.params?.unit ?? stats.unit ?? "D");
      const median = stats.medianDays ?? null;
      const parts = [
        na ?? t(locale, "constraint.late", { share: formatShare(share, locale) }),
        median !== null && applicable ? t(locale, "constraint.median", { value: formatDays(median, locale) }) : undefined,
        delta !== undefined ? t(locale, "constraint.threshold", { value: `${formatNumber(delta, 0, locale)} ${unit.toLowerCase()}` }) : undefined,
        stats.coverage !== undefined && applicable ? t(locale, "constraint.coverage", { share: formatShare(stats.coverage, locale) }) : undefined,
      ].filter(Boolean);
      const pairs = arcPairs(as, bs, options.graph);
      for (const [s, tgt] of pairs) {
        out.push({
          kind: "arc",
          target: `${s}->${tgt}`,
          payload: base(c, { source: s, target: tgt, value: share, coverage: stats.coverage ?? 1, threshold: delta, width, unit, glyph: "⏱", text: parts.join(" · ") }),
        });
      }
      break;
    }
    case "precedence": {
      const as = present(options.graph, c.a ?? []);
      const bs = present(options.graph, c.b ?? []);
      const reverse = stats.reverseShare ?? share;
      const pairs = arcPairs(as, bs, options.graph);
      for (const [s, tgt] of pairs) {
        out.push({
          kind: "arc",
          target: `${s}->${tgt}`,
          payload: base(c, {
            source: s,
            target: tgt,
            value: share,
            coverage: stats.coverage ?? 1,
            glyph: "⇒",
            text: [na ?? t(locale, "constraint.reverse", { share: formatShare(reverse, locale) }), stats.coverage !== undefined && applicable ? t(locale, "constraint.coverage", { share: formatShare(stats.coverage, locale) }) : undefined].filter(Boolean).join(" · "),
          }),
        });
        if (reverse > 0 && applicable) {
          out.push({
            kind: "arc",
            target: `${tgt}->${s}`,
            payload: base(c, { source: tgt, target: s, value: reverse, coverage: reverse, reverse: true, glyph: "⇐", text: t(locale, "constraint.reverse", { share: formatShare(reverse, locale) }) }),
          });
        }
      }
      break;
    }
    case "balance":
    case "metric": {
      const threshold = stats.threshold ?? (typeof c.params?.threshold === "number" ? c.params.threshold : undefined);
      const width = stats.width ?? (typeof c.params?.width === "number" ? c.params.width : undefined);
      const direction = (c.params?.direction as "high" | "low" | undefined) ?? "high";
      const mean = stats.mean ?? null;
      const gauge = mean !== null && threshold !== undefined ? { value: mean, threshold, width, direction } : undefined;
      const text = [
        mean !== null && applicable ? `${formatNumber(mean, 1, locale)} ⌀` : undefined,
        threshold !== undefined ? t(locale, "constraint.threshold", { value: formatNumber(threshold, 0, locale) }) : undefined,
        na ?? t(locale, "constraint.above", { share: formatShare(share, locale) }),
      ]
        .filter(Boolean)
        .join(" · ");
      out.push({ kind: "chip", target: c.group ?? MAP_TARGET, payload: base(c, { value: share, gauge, text, glyph: "◔" }) });
      if (c.group) out.push({ kind: "tint", target: c.group, payload: base(c, { value: share, text }) });
      break;
    }
    case "applicability": {
      const minShare = options.outOfScopeMinShare ?? 0.01;
      // When no case of the scene is in scope, the chip says so and nothing is hatched.
      const nothingInScope = stats.casesInScope === 0 || stats.inScopeShare === 0;
      const shares = nothingInScope ? {} : (stats.nodeShareInScope ?? {});
      const known = options.graph ? new Set(options.graph.nodes.map((n) => n.id)) : undefined;
      for (const id of Object.keys(shares).sort()) {
        if (known && !known.has(id)) continue;
        if ((shares[id] ?? 0) < minShare) {
          out.push({ kind: "hatch", target: id, payload: base(c, { value: shares[id], text: t(locale, "constraint.outOfScope") }) });
        }
      }
      const inScope = stats.inScopeShare;
      const text = nothingInScope
        ? t(locale, "constraint.notApplicable")
        : inScope !== undefined
          ? t(locale, "constraint.scope", { share: formatShare(inScope, locale) })
          : (c.label ?? c.id);
      out.push({ kind: "chip", target: c.group ?? MAP_TARGET, payload: base(c, { value: inScope, text, glyph: "⊂", casesInScope: stats.casesInScope }) });
      break;
    }
  }
  return out;
}

function arcPairs(as: string[], bs: string[], graph?: FlowGraph): [string, string][] {
  if (as.length === 0 || bs.length === 0) return [];
  if (!graph) return [[as[0], bs[0]]];
  const pairs: [string, string][] = [];
  for (const a of as) for (const b of bs) if (a !== b) pairs.push([a, b]);
  return pairs;
}

const KIND_ORDER: Record<OverlayKind, number> = { tint: 0, hatch: 1, arc: 2, selfLoop: 3, badge: 4, chip: 5 };

/**
 * Canonical order of overlays (kind, target, constraint, endpoints), so that
 * badge slots, drawing order and exports do not depend on the input order.
 */
export function canonicalOverlays(overlays: Overlay[]): Overlay[] {
  const key = (o: Overlay) =>
    [KIND_ORDER[o.kind], o.target, o.payload?.constraintId ?? "", String(o.payload?.source ?? ""), String(o.payload?.target ?? ""), o.payload?.reverse ? 1 : 0, o.payload?.label ?? ""].join("\u0000");
  return overlays
    .map((o, i) => ({ o, k: key(o), i }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i))
    .map((x) => x.o);
}

/** Overlays for a list of constraints with their statistics. */
export function overlaysFor(
  items: { description: ConstraintDescription; stats?: ConstraintStats }[],
  options: OverlayPresetOptions = {},
): Overlay[] {
  return items.flatMap((it) => constraintOverlays(it.description, it.stats ?? {}, options));
}

/** Text of an overlay for tables and ARIA descriptions. */
export function describeOverlay(o: Overlay, locale: Locale = "en"): string {
  const kind = t(locale, `overlay.${o.kind}` as StringKey);
  const p = o.payload ?? {};
  const parts = [p.label, p.text].filter((x): x is string => typeof x === "string" && x.length > 0);
  return `${kind}: ${parts.join(" — ")}`;
}

// ---------------------------------------------------------------------------
// Geometry

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

function union(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function chipWidth(text: string | undefined, glyph: string | undefined): number {
  const len = (text?.length ?? 0) + (glyph ? 2 : 0);
  return Math.min(260, Math.max(60, 16 + len * 6.2));
}

const fmt = (n: number) => Number(n.toFixed(2)).toString();

/**
 * Geometry of overlays on a laid-out scene: badge slots along the top edge of the
 * node, arcs as cubic curves above (or, for reverse arcs, below) the map, self-loops
 * at the top-right corner, hatch and tint over the element's box, chips inside groups.
 * Shapes never extend beyond `overlayMargin` around the positions' bounds.
 */
export function overlayGeometry(
  overlays: Overlay[],
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

  canonicalOverlays(overlays).forEach((o, index) => {
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
        const x0 = Math.min(sx, tx);
        const x1 = Math.max(sx, tx);
        const y0 = Math.min(sy, ty, apexY);
        const y1 = Math.max(sy, ty, apexY);
        const b = clampBox({ x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) });
        shapes.push({ id, overlay: o, kind: o.kind, ...b, path, labelX: (sx + tx) / 2, labelY: apexY + (reverse ? 14 : -8), minZoom: lod.arcs });
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
  return { shapes, bounds: union(shapes), margin };
}

/** Anchor point of a shape for tooltips. */
export function shapeAnchor(s: OverlayShape): XY {
  return { x: s.labelX ?? s.x + s.width / 2, y: s.labelY ?? s.y };
}
