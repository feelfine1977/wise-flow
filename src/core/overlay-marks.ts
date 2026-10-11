/** Overlay marks: what each placed overlay looks like, resolved once for every renderer. */
import { type Locale, formatShare } from "./format.js";
import type { Box } from "./layout.js";
import { type Overlay, type OverlayKind, MAP_TARGET } from "./model.js";
import type { OverlayShape } from "./overlay-geometry.js";
import { colorOn, contrastText, hexToRgb } from "./style.js";
import { type Theme, defaultTheme } from "./theme.js";
import { type Arrowhead, arrowheadTokens, dashTokens, opacityTokens } from "./tokens.js";

/**
 * A colour by role. `ink`, `inkMuted`, `paper`, `surface`, `line` and
 * `outOfScope` are tokens the renderer resolves (and may theme); `value` is
 * the mark's `color` and `onValue` the text colour on it.
 */
export type MarkPaint = "ink" | "inkMuted" | "paper" | "surface" | "line" | "outOfScope" | "value" | "onValue";

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
  /** Width the text is truncated to, when it is limited. */
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
  /** The follows edge the overlay stands for. */
  edgeId?: string;
}

/** Colour of an overlay's value (a share) on the theme's shortfall palette; neutral without one. */
export function overlayColor(overlay: Overlay, theme: Theme = defaultTheme): string {
  const v = overlay.payload?.value;
  return typeof v === "number" && Number.isFinite(v) ? colorOn(v, "shortfall", [0, 1], theme) : theme.color.neutral;
}

/** Opacity of a tint over its element. */
export const TINT_OPACITY = opacityTokens.tint;

/** The value colour at the theme's tint opacity (`TINT_OPACITY` in the default theme) as CSS; none without a value. */
export function tintColor(overlay: Overlay, theme: Theme = defaultTheme): string | undefined {
  const v = overlay.payload?.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const [r, g, b] = hexToRgb(overlayColor(overlay, theme));
  return `rgba(${r}, ${g}, ${b}, ${theme.opacity.tint})`;
}

/** Stroke width of an arc: the theme's `arc` stroke (2) plus `arcCoverage` (8) times its coverage (default 1). */
export function arcWidth(overlay: Overlay, theme: Theme = defaultTheme): number {
  const c = overlay.payload?.coverage;
  return theme.stroke.arc + theme.stroke.arcCoverage * (typeof c === "number" ? Math.max(0, Math.min(1, c)) : 1);
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

/** A chip's padding, the advance of its glyph and of its gauge with the gap after it, and characters at 6.2 px. */
export const chipLayout = { padding: 8, glyph: 12.4, gauge: 46, gaugeWidth: 40, gaugeHeight: 6, char: 6.2 } as const;

/** What a chip prints after its glyph: its label as a bold lead and its text, or its share without one. */
export function chipText(overlay: Overlay, locale: Locale = "en"): { lead?: string; text: string } {
  const p = overlay.payload ?? {};
  const text = p.text ?? (typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "");
  return p.label ? { lead: `${p.label}: `, text } : { text };
}

/** What an arc prints: its display label, or its glyph and share. */
export function arcLabel(overlay: Overlay, locale: Locale = "en"): string {
  const p = overlay.payload ?? {};
  if (typeof p.displayLabel === "string") return p.displayLabel;
  return `${p.glyph ?? ""} ${typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : ""}`.trim();
}

/** One mark per shape, in the shapes' order, with the sizes and colours of a theme. */
export function overlayMarks(shapes: OverlayShape[], locale: Locale = "en", theme: Theme = defaultTheme): OverlayMark[] {
  return shapes.map((s) => overlayMark(s, locale, theme));
}

function overlayMark(s: OverlayShape, locale: Locale, theme: Theme): OverlayMark {
  const { text: textTokens, radius: radiusTokens, stroke: strokeTokens, opacity } = theme;
  const o = s.overlay;
  const p = o.payload ?? {};
  const color = overlayColor(o, theme);
  const share = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "";
  const mark: OverlayMark = {
    id: s.id,
    kind: s.kind,
    overlay: o,
    box: { x: s.x, y: s.y, width: s.width, height: s.height },
    layer: s.kind === "tint" ? "below" : s.kind === "arc" ? "between" : "above",
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
      return { ...mark, radius: radiusTokens.tint, fill: { paint: "value", opacity: opacity.tint } };
    case "hatch":
      return { ...mark, radius: radiusTokens.hatch, fill: { paint: "outOfScope", pattern: "outOfScope", opacity: opacity.hatch } };
    case "arc": {
      const label = arcLabel(o, locale);
      return {
        ...mark,
        path: s.path,
        stroke: { paint: "value", width: arcWidth(o, theme), opacity: opacity.arc, ...(p.reverse ? { dash: [...dashTokens.reverseArc] } : {}) },
        arrow: overlayArrow,
        texts: s.labelX !== undefined && s.labelY !== undefined ? [halo(label, s.labelX, s.labelY, textTokens.arcLabel.size, "middle")] : [],
      };
    }
    case "selfLoop": {
      const label = typeof p.displayLabel === "string" ? p.displayLabel : share ? `↻ ${share}` : "";
      return {
        ...mark,
        path: s.path,
        stroke: { paint: "value", width: strokeTokens.selfLoop },
        arrow: overlayArrow,
        texts: s.labelX !== undefined && s.labelY !== undefined && (p.displayLabel || share) ? [halo(label, s.labelX, s.labelY, textTokens.selfLoopLabel.size, "start")] : [],
      };
    }
    case "badge":
      return {
        ...mark,
        radius: s.height / 2,
        fill: { paint: "value" },
        stroke: { paint: "paper", width: strokeTokens.badge },
        texts: [
          { text: p.glyph ?? "●", x: s.x + s.width / 2, y: middle, size: textTokens.badge.size, weight: textTokens.badge.weight, anchor: "middle", baseline: "middle", paint: "onValue", halo: false },
          ...(share ? [{ ...halo(share, s.x + s.width + 4, middle, textTokens.badgeValue.size, "start"), baseline: "middle" as const }] : []),
        ],
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
        radius: radiusTokens.chip,
        fill: { paint: "paper" },
        stroke: { paint: "value", width: strokeTokens.chip },
        texts: [...(p.glyph ? [plain(p.glyph, s.x + padding)] : []), { ...plain("", textX), ...chipText(o, locale), maxWidth: s.width - 2 * padding - (p.glyph ? glyph : 0) - (g ? gauge : 0) }],
        ...(g ? { gauge: { x: gaugeX, y: s.y + (s.height - gaugeHeight) / 2, width: gaugeWidth, height: gaugeHeight, value: share(g.value), threshold: share(g.threshold) } } : {}),
      };
    }
  }
}
