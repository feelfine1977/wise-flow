/** Pure text counter-scaling for hosts that keep map labels readable while zoomed out. */
export const LABEL_PX = 12;
export const MIN_LABEL_PX = 11;
export const MAX_LABEL_PX = 14;
/** Maximum text size in layout units; very small zooms can still produce unreadable text. */
export const MAX_LABEL_UNITS = 64;
/** Below this zoom, even the maximum size cannot reach MIN_LABEL_PX on screen. */
export const MIN_READABLE_ZOOM = MIN_LABEL_PX / MAX_LABEL_UNITS;

/**
 * Activity-name size in layout units. The inverse-zoom contribution targets 11–14 screen
 * pixels, with the requested base size as a floor and MAX_LABEL_UNITS as a ceiling.
 * Zooming in keeps the base size, so screen text can exceed 14 pixels. Invalid or
 * nonpositive zooms return the requested base size unchanged. No layout or DOM is read.
 */
export function labelUnitsAt(zoom: number, target = LABEL_PX): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return target;
  const wanted = Math.min(MAX_LABEL_PX, Math.max(MIN_LABEL_PX, target));
  // A map drawn larger than life keeps its base size rather than shrinking its text.
  return Math.min(MAX_LABEL_UNITS, Math.max(target, wanted / zoom));
}

/** Secondary text size in layout units, targeting 11 screen pixels while zoomed out. */
export function smallLabelUnitsAt(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return MIN_LABEL_PX;
  return Math.min(MAX_LABEL_UNITS, Math.max(MIN_LABEL_PX, MIN_LABEL_PX / zoom));
}

/** Scale factor for the badge, marker or chip that contains secondary text. */
export const mapScaleAt = (zoom: number) => smallLabelUnitsAt(zoom) / MIN_LABEL_PX;

/** Convert layout-unit text size to its screen size; no clamping or rounding is applied. */
export const labelScreenPx = (units: number, zoom: number) => units * zoom;
