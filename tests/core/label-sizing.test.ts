import { describe, expect, it } from "vitest";
import { LABEL_PX, MIN_LABEL_PX, MAX_LABEL_PX, MAX_LABEL_UNITS, MIN_READABLE_ZOOM, labelUnitsAt, smallLabelUnitsAt, mapScaleAt, labelScreenPx } from "../../src/index";

describe("map label sizing", () => {
  it("keeps primary and secondary text readable at different fitted zooms", () => {
    for (const zoom of [0.25, 0.395, 0.5, 0.913]) {
      expect(labelScreenPx(labelUnitsAt(zoom), zoom)).toBeCloseTo(12, 12);
      expect(labelScreenPx(smallLabelUnitsAt(zoom), zoom)).toBeCloseTo(11, 12);
      expect(mapScaleAt(zoom) * zoom).toBeCloseTo(1, 12);
    }
  });

  it("keeps base text and marker sizes when zooming in", () => {
    for (const zoom of [1, 1.25, 3]) {
      expect(labelUnitsAt(zoom)).toBe(12);
      expect(smallLabelUnitsAt(zoom)).toBe(11);
      expect(mapScaleAt(zoom)).toBe(1);
    }
    expect(labelScreenPx(labelUnitsAt(1.25), 1.25)).toBe(15);
  });

  it("caps layout-unit size rather than claiming readability at arbitrarily small zooms", () => {
    expect(labelUnitsAt(0.05)).toBe(64);
    expect(smallLabelUnitsAt(0.05)).toBe(64);
    expect(labelScreenPx(labelUnitsAt(0.05), 0.05)).toBeCloseTo(3.2);
    expect(labelScreenPx(smallLabelUnitsAt(MIN_READABLE_ZOOM), MIN_READABLE_ZOOM)).toBe(11);
  });

  it("preserves the base-size fallback for invalid and nonpositive zooms", () => {
    for (const zoom of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(labelUnitsAt(zoom)).toBe(12);
      expect(labelUnitsAt(zoom, 20)).toBe(20);
      expect(smallLabelUnitsAt(zoom)).toBe(11);
      expect(mapScaleAt(zoom)).toBe(1);
    }
  });

  it("retains custom base-size floors and the counter-scaling limits", () => {
    for (const [zoom, target, expected] of [[0.5, 5, 22], [0.5, 14, 28], [0.5, 20, 28], [1, 20, 20], [0.5, 100, 64]]) {
      expect(labelUnitsAt(zoom, target)).toBe(expected);
    }
  });

  it("exports the sizing contract and leaves pixel conversion unrounded", () => {
    expect([LABEL_PX, MIN_LABEL_PX, MAX_LABEL_PX, MAX_LABEL_UNITS, MIN_READABLE_ZOOM]).toEqual([12, 11, 14, 64, 0.171875]);
    expect(labelScreenPx(12.345, 0.4)).toBe(4.938000000000001);
  });
});
