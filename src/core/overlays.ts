/**
 * Constraint overlay grammar: presets that turn a constraint description and
 * its statistics into overlays, and the geometry renderers draw from.
 */
import { type Locale, formatDays, formatNumber, formatShare } from "./format.js";
import type { Positions } from "./layout.js";
import { type OverlayGeometry, type OverlayGeometryOptions, placeOverlays } from "./overlay-geometry.js";
import { type FlowGraph, type Overlay, type OverlayKind, type OverlayPayload, MAP_TARGET } from "./model.js";
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

export { type OverlayShape, type OverlayGeometryOptions, type OverlayGeometry, overlayMargin, shapeAnchor } from "./overlay-geometry.js";

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
  return placeOverlays(canonicalOverlays(overlays), positions, options);
}
