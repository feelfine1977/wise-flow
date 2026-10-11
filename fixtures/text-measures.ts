import { type TextMeasure, estimateTextWidth } from "../src/index";

/**
 * A text measure other than the core's estimate: 0.7 em per character. The
 * parity stories give it to the map and the browser lane to the exports, so
 * that they compare the lines a measure fits rather than the default's.
 */
export const wideTextMeasure: TextMeasure = (text, font) => Array.from(text).length * 0.7 * font.size;

/** The measures a parity story can name in the scene it writes; without a name it measures by the estimate, as the exports do by default. */
export const textMeasures: Record<string, TextMeasure> = { estimate: estimateTextWidth, wide: wideTextMeasure };
