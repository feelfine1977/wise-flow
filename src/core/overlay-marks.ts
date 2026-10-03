/** Overlay marks: what each placed overlay looks like, resolved once for every renderer. */
import { type Locale, formatShare } from "./format.js";
import type { Box } from "./layout.js";
import { type Overlay, type OverlayKind, MAP_TARGET } from "./model.js";
import type { OverlayShape } from "./overlay-geometry.js";
import { colorOn, contrastText, fixedColors, hexToRgb } from "./style.js";

/**
 * A colour by role. `ink`, `paper` and `outOfScope` are tokens the renderer
 * resolves (and may theme); `value` is the mark's `color` and `onValue` the
 * text colour on it.
 */
export type MarkPaint = "ink" | "paper" | "outOfScope" | "value" | "onValue";

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
  anchor: "start" | "middle";
  /** `middle`: `y` is the middle of the text; `alphabetic`: `y` is its baseline. */
  baseline: "middle" | "alphabetic";
  paint: MarkPaint;
  /** Outline in the paper colour so that the text stays readable over lines. */
  halo: boolean;
  /** Width the text is truncated to, when it is limited. */
  maxWidth?: number;
}

export interface OverlayMark {
  /** The id of the overlay shape the mark draws. */
  id: string;
  kind: OverlayKind;
  overlay: Overlay;
  /** Extent of the mark in scene coordinates. */
  box: Box;
  /** Drawn below the edges (tints) or above the nodes. */
  layer: "below" | "above";
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
  /** The follows edge the overlay stands for. */
  edgeId?: string;
}

/** Colour of an overlay's value (a share) on the sequential palette; neutral without one. */
export function overlayColor(overlay: Overlay): string {
  const v = overlay.payload?.value;
  return typeof v === "number" && Number.isFinite(v) ? colorOn(v, "sequential", [0, 1]) : fixedColors.neutral;
}

/** Opacity of a tint over its element. */
export const TINT_OPACITY = 0.18;

/** The value colour at `TINT_OPACITY` as CSS; none without a value. */
export function tintColor(overlay: Overlay): string | undefined {
  const v = overlay.payload?.value;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  const [r, g, b] = hexToRgb(overlayColor(overlay));
  return `rgba(${r}, ${g}, ${b}, ${TINT_OPACITY})`;
}

/** Stroke width of an arc: 2 plus 8 times its coverage (default 1). */
export function arcWidth(overlay: Overlay): number {
  const c = overlay.payload?.coverage;
  return 2 + 8 * (typeof c === "number" ? Math.max(0, Math.min(1, c)) : 1);
}

/** Arrowhead of arcs and self-loops: a triangle `size` long and wide, its tip `overhang` × `size` beyond the path. */
export const overlayArrow = { size: 12, overhang: 0.1 } as const;

/** One mark per shape, in the shapes' order. */
export function overlayMarks(shapes: OverlayShape[], locale: Locale = "en"): OverlayMark[] {
  return shapes.map((s) => overlayMark(s, locale));
}

function overlayMark(s: OverlayShape, locale: Locale): OverlayMark {
  const o = s.overlay;
  const p = o.payload ?? {};
  const color = overlayColor(o);
  const share = typeof p.value === "number" && Number.isFinite(p.value) ? formatShare(p.value, locale) : "";
  const mark: OverlayMark = {
    id: s.id,
    kind: s.kind,
    overlay: o,
    box: { x: s.x, y: s.y, width: s.width, height: s.height },
    layer: s.kind === "tint" ? "below" : "above",
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
      return { ...mark, radius: 10, fill: { paint: "value", opacity: TINT_OPACITY } };
    case "hatch":
      return { ...mark, radius: 6, fill: { paint: "outOfScope", pattern: "outOfScope", opacity: 0.55 } };
    case "arc": {
      const label = typeof p.displayLabel === "string" ? p.displayLabel : `${p.glyph ?? ""} ${share}`.trim();
      return {
        ...mark,
        path: s.path,
        stroke: { paint: "value", width: arcWidth(o), opacity: 0.9, ...(p.reverse ? { dash: [6, 4] } : {}) },
        arrow: overlayArrow,
        texts: s.labelX !== undefined && s.labelY !== undefined ? [halo(label, s.labelX, s.labelY, 11, "middle")] : [],
      };
    }
    case "selfLoop": {
      const label = typeof p.displayLabel === "string" ? p.displayLabel : share ? `↻ ${share}` : "";
      return {
        ...mark,
        path: s.path,
        stroke: { paint: "value", width: 2.5 },
        arrow: overlayArrow,
        texts: s.labelX !== undefined && s.labelY !== undefined && (p.displayLabel || share) ? [halo(label, s.labelX, s.labelY, 10, "start")] : [],
      };
    }
    case "badge":
      return {
        ...mark,
        radius: s.height / 2,
        fill: { paint: "value" },
        stroke: { paint: "paper", width: 1.5 },
        texts: [
          { text: p.glyph ?? "●", x: s.x + s.width / 2, y: middle, size: 10, weight: 700, anchor: "middle", baseline: "middle", paint: "onValue", halo: false },
          ...(share ? [{ ...halo(share, s.x + s.width + 4, middle, 10, "start"), baseline: "middle" as const }] : []),
        ],
      };
    case "chip":
      return {
        ...mark,
        radius: 12,
        fill: { paint: "paper" },
        stroke: { paint: "value", width: 2 },
        texts: [{ text: `${p.glyph ?? ""} ${p.text ?? p.label ?? ""}`.trim(), x: s.x + 8, y: middle, size: 10, anchor: "start", baseline: "middle", paint: "ink", halo: false, maxWidth: s.width - 16 }],
      };
  }
}
