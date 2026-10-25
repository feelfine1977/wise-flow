/** Overlay marks: what each placed overlay looks like, resolved once for every renderer. */
import { type Locale, formatCount, formatShare } from "./format.js";
import type { Box } from "./layout.js";
import { type Overlay, type OverlayKind, MAP_TARGET } from "./model.js";
import type { OverlayShape } from "./overlay-geometry.js";
import { contrastText, hexToRgb } from "./style.js";
import { type StringKey, t } from "./strings.js";
import { type TextMeasure, estimateTextWidth, fitMarkText } from "./text.js";
import { ruleDash, ruleRadius, ruleSet, ruleText, ruleWidth, rulePaint } from "./rules.js";
import { type Theme, defaultTheme } from "./theme.js";
import { type Arrowhead, arrowheadTokens, dashTokens, opacityTokens } from "./tokens.js";

/**
 * A colour by role. `ink`, `inkMuted`, `paper`, `surface`, `line`,
 * `lineStrong`, `cueStripe`, `cueFoot` and `outOfScope` are tokens the
 * renderer resolves (and may theme); `value` is the mark's `color` and
 * `onValue` the text colour on it. A colour a theme's rule sets is a literal
 * `#rrggbb` (`#rrggbbaa` below full alpha), drawn as it is.
 */
export type MarkPaint = "ink" | "inkMuted" | "paper" | "surface" | "line" | "lineStrong" | "cueStripe" | "cueFoot" | "outOfScope" | "value" | "onValue" | `#${string}`;

export interface MarkFill {
  paint: MarkPaint;
  /** Fill with the out-of-scope hatching; `paint` is the plain fallback. */
  pattern?: "outOfScope";
  opacity?: number;
}

export interface MarkStroke {
  paint: MarkPaint;
  width: number;
  opacity?: number;
  dash?: number[];
}

export interface MarkText {
  text: string;
  x: number;
  y: number;
  size: number;
  weight?: number;
  anchor: "start" | "middle" | "end";
  /** `middle`: `y` is the middle of the text; `alphabetic`: `y` is its baseline. */
  baseline: "middle" | "alphabetic";
  paint: MarkPaint;
  /** Outline in the paper colour so that the text stays readable over lines. */
  halo: boolean;
  /** Width the text is limited to; `text` (with `lead`) is already shortened to it by the scene's measure. */
  maxWidth?: number;
  /** Bold run printed before `text` in start-anchored text (a chip's label); `maxWidth` limits both together. */
  lead?: string;
}

/** A track `width` long with its first `value` share filled and a tick at the `threshold` share (both 0–1). */
export interface MarkGauge {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  threshold: number;
}

export interface OverlayMark {
  /** The id of the overlay shape the mark draws. */
  id: string;
  kind: OverlayKind;
  overlay: Overlay;
  /** Extent of the mark in scene coordinates. */
  box: Box;
  /**
   * Drawn below the edges (tints), between the edges and the nodes (arcs, so that
   * a node and its badges stay readable where an arc crosses it) or above the nodes.
   */
  layer: "below" | "between" | "above";
  /** Drawn on the map; map-level chips are listed with the legend instead. */
  inMap: boolean;
  /** Zoom from which the mark is drawn. */
  minZoom: number;
  /** Colour of the overlay's value (`overlayColor`). */
  color: string;
  /** Text colour with enough contrast on `color`. */
  onColor: string;
  /** Label and text of the overlay, for tooltips. */
  title: string;
  /** Corner radius of the rounded box; marks with a `path` draw the path instead. */
  radius: number;
  /** SVG path data (M, L, C) in scene coordinates. */
  path?: string;
  fill?: MarkFill;
  stroke?: MarkStroke;
  /** Arrowhead at the end of the path (`overlayArrow`). */
  arrow?: { size: number; overhang: number };
  texts: MarkText[];
  /** Gauge drawn in the line colour, filled in the value colour, with an ink tick. */
  gauge?: MarkGauge;
  /** The rounded box the mark's label is written in (an arc's), drawn over the path and under the texts. */
  pill?: { box: Box; radius: number; fill: MarkFill; stroke: MarkStroke };
  /** The follows edge the overlay stands for. */
  edgeId?: string;
  /** The whole mark's opacity, where a theme's rule sets one. */
  opacity?: number;
}

/** Colour of an overlay: the theme's accent, the one hue of deviations, whatever its value. */
export function overlayColor(_overlay: Overlay, theme: Theme = defaultTheme): string {
  return theme.color.accent;
}

/** Opacity of a tint over its element. */
export const TINT_OPACITY = opacityTokens.tint;

/** The accent at the theme's tint opacity (`TINT_OPACITY` in the default theme) as CSS; none without a value. */
export function tintColor(overlay: Overlay, theme: Theme = defaultTheme): string | undefined {
  const v = overlay.payload?.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const [r, g, b] = hexToRgb(overlayColor(overlay, theme));
  return `rgba(${r}, ${g}, ${b}, ${theme.opacity.tint})`;
}

/** Stroke width of an arc: the theme's `arc` stroke, the same for every arc; its coverage is not drawn. */
export function arcWidth(_overlay: Overlay, theme: Theme = defaultTheme): number {
  return theme.stroke.arc;
}

/** Arrowhead of arcs and self-loops: a triangle `size` long and wide, its tip `overhang` × `size` beyond the path (`arrowheadTokens.overlay`). */
export const overlayArrow: { readonly size: number; readonly overhang: number } = {
  size: arrowheadTokens.overlay.size,
  overhang: arrowheadTokens.overlay.overhang / arrowheadTokens.overlay.box,
};

/** The arrowhead rule (`Arrowhead`) of a mark's arrow. */
export function markArrowhead(arrow: { size: number; overhang: number }): Arrowhead {
  const box = arrowheadTokens.overlay.box;
  return { ...arrowheadTokens.overlay, size: arrow.size, overhang: arrow.overhang * box };
}

/**
 * A chip's padding, the advance of its glyph and of its gauge with the gap
 * after it; its text is as wide as the scene's measure finds it.
 * `char` (deprecated) is read by nothing.
 */
export const chipLayout = { padding: 8, glyph: 12.4, gauge: 46, gaugeWidth: 40, gaugeHeight: 6, char: 6.2 } as const;

/** What a chip prints after its glyph: its label as a bold lead and its text, or its share without one. */
export function chipText(overlay: Overlay, locale: Locale = "en"): { lead?: string; text: string } {
  const p = overlay.payload ?? {};
  const text = p.text ?? (typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "");
  return p.label ? { lead: `${p.label}: `, text } : { text };
}

/**
 * The pill a label is written in: its text `padding` in from either end and
 * `height` tall, its ends half circles.
 */
export const pillLayout = { padding: 6, height: 18 } as const;

const shareOf = (overlay: Overlay, locale: Locale) => {
  const v = overlay.payload?.value;
  return typeof v === "number" && Number.isFinite(v) ? formatShare(v, locale) : "";
};

/** The kind of constraint an arc's label names: a lag (`⏱`) or a precedence (`⇒`), from its type or its glyph. */
const ARC_WORDS: Record<string, StringKey> = { lag: "arc.lag", "⏱": "arc.lag", precedence: "arc.precedence", "⇒": "arc.precedence" };

/**
 * What an arc prints: the share first and its base second ("late 35 % of
 * 820", "order 14 % of 820"); a reverse-order arc the sign ⇐ before them
 * ("⇐ 14 % of 820"). An arc of another kind writes its glyph before them; a
 * display label replaces all of it (after the sign of a reverse-order arc).
 */
export function arcLabel(overlay: Overlay, locale: Locale = "en"): string {
  const p = overlay.payload ?? {};
  if (typeof p.displayLabel === "string") return p.reverse && !p.displayLabel.startsWith("⇐") ? `⇐ ${p.displayLabel}` : p.displayLabel;
  const share = shareOf(overlay, locale);
  const based = share && typeof p.evaluated === "number" && Number.isFinite(p.evaluated) ? t(locale, "arc.base", { share, base: formatCount(p.evaluated, locale) }) : share;
  const word = p.reverse ? "arc.reverse" : ARC_WORDS[String(p.constraintType)] ?? ARC_WORDS[String(p.glyph)];
  return (word ? t(locale, word, { share: based }) : `${p.glyph ?? ""} ${based}`).trim();
}

/** What a self-loop writes beside it: its display label, or ↻ and its share. */
export function selfLoopLabel(overlay: Overlay, locale: Locale = "en"): string {
  const p = overlay.payload ?? {};
  const share = shareOf(overlay, locale);
  return typeof p.displayLabel === "string" ? p.displayLabel : share ? `↻ ${share}` : "";
}

/** The layer a kind of overlay is drawn in: tints below the edges, arcs between the edges and the nodes, the rest above the nodes. */
export function markLayer(kind: OverlayKind): OverlayMark["layer"] {
  return kind === "tint" ? "below" : kind === "arc" ? "between" : "above";
}

/** What a badge writes in its pill: its glyph (● without one) and its share. */
export function badgeLabel(overlay: Overlay, locale: Locale = "en"): string {
  const glyph = overlay.payload?.glyph ?? "●";
  const share = shareOf(overlay, locale);
  return share ? `${glyph} · ${share}` : glyph;
}

/** What the marks take from the elements they stand for or cover. */
export interface OverlayMarkContext {
  /** The colour of a path a self-loop stands for (`edgeId` without a constraint), as the path is drawn. */
  pathColor?: (edgeId: string) => string | undefined;
  /** The corner radius of a node or group a tint covers, so that the tint follows its corners. */
  radius?: (target: string) => number | undefined;
}

/** One mark per shape, in the shapes' order, with the sizes and colours of a theme and texts fitted by a measure. */
export function overlayMarks(shapes: OverlayShape[], locale: Locale = "en", theme: Theme = defaultTheme, measure: TextMeasure = estimateTextWidth, context: OverlayMarkContext = {}): OverlayMark[] {
  return shapes.map((s) => ruled(overlayMark(s, locale, theme, measure, context), theme));
}

/**
 * A mark with what the theme's rules set on its kind: its fill (a hatch keeps
 * its pattern), outline, corners (a tint follows what it covers), opacity and
 * the colour of its texts.
 */
function ruled(m: OverlayMark, theme: Theme): OverlayMark {
  const set = ruleSet(theme, "mark", m.kind, undefined, []);
  if (!set) return m;
  const colors = theme.color;
  const { fill, stroke } = m;
  const filled = set.fill !== undefined || set.fillOpacity !== undefined;
  return {
    ...m,
    ...(fill && !fill.pattern && filled && { fill: { paint: rulePaint(set.fill, undefined, fill.paint, colors, m.color), opacity: set.fillOpacity ?? (set.fill === undefined ? fill.opacity : undefined) } }),
    ...(stroke && { stroke: { ...stroke, paint: rulePaint(set.stroke, undefined, stroke.paint, colors, m.color), width: ruleWidth(set, stroke.width), dash: ruleDash(set, stroke.dash, dashTokens.reconnectedNode) } }),
    radius: m.kind === "tint" || m.path !== undefined ? m.radius : ruleRadius(set, m.radius, m.box),
    opacity: set.opacity,
    texts: m.texts.map((t) => ruleText(t, set, "label", colors, m.color)),
  };
}

function overlayMark(s: OverlayShape, locale: Locale, theme: Theme, measure: TextMeasure, context: OverlayMarkContext): OverlayMark {
  const { text: textTokens, radius: radiusTokens, stroke: strokeTokens, opacity } = theme;
  const o = s.overlay;
  const p = o.payload ?? {};
  // A self-loop that stands for a path is drawn as the path is; every deviation in the accent.
  const path = typeof p.edgeId === "string" && !p.constraintId ? context.pathColor?.(p.edgeId) : undefined;
  const color = path ?? overlayColor(o, theme);
  const mark: OverlayMark = {
    id: s.id,
    kind: s.kind,
    overlay: o,
    box: { x: s.x, y: s.y, width: s.width, height: s.height },
    layer: markLayer(s.kind),
    inMap: !(s.kind === "chip" && o.target === MAP_TARGET),
    minZoom: p.observed ? 0 : s.minZoom,
    color,
    onColor: contrastText(color),
    title: [p.label, p.text].filter(Boolean).join(" — "),
    radius: 0,
    texts: [],
    ...(typeof p.edgeId === "string" ? { edgeId: p.edgeId } : {}),
  };
  const middle = s.y + s.height / 2 + 0.5;
  const halo = (text: string, x: number, y: number, size: number, anchor: MarkText["anchor"]): MarkText => ({ text, x, y, size, anchor, baseline: "alphabetic", paint: "ink", halo: true });
  switch (s.kind) {
    case "tint":
      return { ...mark, radius: context.radius?.(o.target) ?? radiusTokens.tint, fill: { paint: "value", opacity: opacity.tint } };
    case "hatch":
      return { ...mark, radius: radiusTokens.hatch, fill: { paint: "outOfScope", pattern: "outOfScope", opacity: opacity.hatch } };
    case "arc": {
      // Solid, one width; the label in the accent on a pill of paper over the path, where the geometry put it (or
      // centred on the label's point of a shape placed elsewhere).
      const label = arcLabel(o, locale);
      const width = measure(label, textTokens.arcLabel) + 2 * pillLayout.padding;
      const at = s.label ?? (s.labelX !== undefined && s.labelY !== undefined ? { x: s.labelX - width / 2, y: s.labelY - pillLayout.height / 2, width, height: pillLayout.height } : undefined);
      return {
        ...mark,
        path: s.path,
        stroke: { paint: "value", width: arcWidth(o, theme), opacity: opacity.arc },
        arrow: overlayArrow,
        ...(at && label ? { pill: { box: at, radius: at.height / 2, fill: { paint: "paper" }, stroke: { paint: "value", width: strokeTokens.pill } } } : {}),
        texts: at && label ? [{ text: label, x: at.x + at.width / 2, y: at.y + at.height / 2 + 0.5, size: textTokens.arcLabel.size, anchor: "middle", baseline: "middle", paint: "value", halo: false }] : [],
      };
    }
    case "selfLoop": {
      const label = selfLoopLabel(o, locale);
      // A pill (`OverlayGeometryOptions.selfLoop`): paper outlined by a hairline in the strong line colour, "↻ 17 %" in the ink.
      if (s.pill) return {
        ...mark,
        radius: s.height / 2,
        fill: { paint: "paper" },
        stroke: { paint: "lineStrong", width: strokeTokens.badge },
        texts: label ? [{ text: label, x: s.x + s.width / 2, y: middle, size: textTokens.badge.size, weight: textTokens.badge.weight, anchor: "middle", baseline: "middle", paint: "ink", halo: false }] : [],
      };
      return {
        ...mark,
        path: s.path,
        stroke: { paint: "value", width: strokeTokens.selfLoop },
        arrow: overlayArrow,
        // A repetition's label in the accent; a path's in the ink, as the path's count is.
        texts: s.labelX !== undefined && s.labelY !== undefined && label ? [{ ...halo(label, s.labelX, s.labelY, textTokens.selfLoopLabel.size, "start"), paint: path ? "ink" : "value" }] : [],
      };
    }
    case "badge":
      // A pill of paper outlined in the accent, with the glyph and the share in it.
      return {
        ...mark,
        radius: s.height / 2,
        fill: { paint: "paper" },
        stroke: { paint: "value", width: strokeTokens.badge },
        texts: [{ text: badgeLabel(o, locale), x: s.x + s.width / 2, y: middle, size: textTokens.badge.size, weight: textTokens.badge.weight, anchor: "middle", baseline: "middle", paint: "value", halo: false }],
      };
    case "chip": {
      // Glyph, gauge and text in a row, as the live map lays them out.
      const { padding, glyph, gauge, gaugeWidth, gaugeHeight } = chipLayout;
      const plain = (text: string, x: number): MarkText => ({ text, x, y: middle, size: textTokens.chip.size, anchor: "start", baseline: "middle", paint: "ink", halo: false });
      const gaugeX = s.x + padding + (p.glyph ? glyph : 0);
      const textX = gaugeX + (p.gauge ? gauge : 0);
      const g = p.gauge;
      const span = g ? Math.max(g.threshold + (g.width ?? g.threshold), 1e-9) : 1;
      const share = (v: number) => Math.max(0, Math.min(1, v / span));
      return {
        ...mark,
        // A full radius is half the chip's height.
        radius: Math.min(radiusTokens.chip, s.height / 2),
        fill: { paint: "paper" },
        stroke: { paint: "value", width: strokeTokens.chip },
        texts: [...(p.glyph ? [plain(p.glyph, s.x + padding)] : []), fitMarkText({ ...plain("", textX), ...chipText(o, locale), maxWidth: s.width - 2 * padding - (p.glyph ? glyph : 0) - (g ? gauge : 0) }, textTokens.chipLead.weight, measure)],
        ...(g ? { gauge: { x: gaugeX, y: s.y + (s.height - gaugeHeight) / 2, width: gaugeWidth, height: gaugeHeight, value: share(g.value), threshold: share(g.threshold) } } : {}),
      };
    }
  }
}
