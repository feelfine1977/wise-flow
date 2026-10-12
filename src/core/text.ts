/**
 * Text measured once: one measure of text widths, which the scene is built
 * with, and the rules that wrap and shorten text by it. Every renderer draws
 * the lines the scene fitted; none measures again.
 */
import type { MarkText } from "./overlay-marks.js";

/** Width of a text in a font, in the units it is drawn in. */
export type TextMeasure = (text: string, font: { size: number; weight?: number }) => number;

/** Characters of the East Asian wide scripts (CJK, kana, Hangul, full-width forms) and emoji. */
const WIDE = /[\u2e80-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;

/**
 * Width of a text without font metrics: 0.55 em per character, about the
 * average advance of the default sans-serif stack, and a full em for a
 * character of a wide script.
 */
export const estimateTextWidth: TextMeasure = (text, font) => {
  let narrow = 0;
  let wide = 0;
  for (const char of text) {
    if (WIDE.test(char)) wide++;
    else narrow++;
  }
  return (narrow * 0.55 + wide) * font.size;
};

/**
 * The longest start of `text` that fits `maxWidth` with an ellipsis, at least
 * one character; the text itself when it fits. A width that exceeds
 * `maxWidth` by less than a millionth (rounding) fits.
 */
export function truncateText(text: string, maxWidth: number, font: { size: number; weight?: number }, measure: TextMeasure = estimateTextWidth): string {
  const limit = maxWidth + 1e-6;
  if (measure(text, font) <= limit) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join("")}…`, font) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, Math.max(1, lo)).join("")}…`;
}

/**
 * Lines of `text` at most `width` wide (at least the font's size): words in
 * order, a word wider than a line broken between characters. The measure is
 * taken to grow with the text, as `truncateText` takes it: where a word breaks,
 * the characters that still fit are found by doubling and halving, so a long
 * word costs about as many measures as it has lines.
 */
export function wrapText(text: string, width: number, font: { size: number; weight?: number }, measure: TextMeasure = estimateTextWidth): string[] {
  const limit = Math.max(font.size, width);
  const fits = (s: string) => measure(s, font) <= limit;
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    if (line && !fits(`${line} ${word}`)) {
      lines.push(line);
      line = "";
    }
    if (line) line += " ";
    const chars = Array.from(word);
    for (let at = 0; at < chars.length; ) {
      const part = (n: number) => line + chars.slice(at, at + n).join("");
      // The most characters from `at` that fit: `fit` do, `over` do not (or run past the word).
      let fit = 0;
      let over = 1;
      while (at + over <= chars.length && fits(part(over))) [fit, over] = [over, over * 2];
      over = Math.min(over, chars.length - at + 1);
      while (over - fit > 1) {
        const mid = (fit + over) >> 1;
        if (fits(part(mid))) fit = mid;
        else over = mid;
      }
      // Not one more fits: a line with text ends; an empty one takes a character anyway.
      if (!fit && line) {
        lines.push(line);
        line = "";
        continue;
      }
      const taken = Math.max(1, fit);
      line = part(taken);
      at += taken;
      if (at < chars.length) {
        lines.push(line);
        line = "";
      }
    }
  }
  if (line) lines.push(line);
  return lines.length === 1 && lines[0] === text ? [text] : lines.length ? lines : [""];
}

/**
 * At most `max` lines of `text` at most `width` wide (`wrapText`); when more
 * would be needed, the last line holds the rest of the text shortened with an
 * ellipsis (`truncateText`).
 */
export function wrapLines(text: string, width: number, font: { size: number; weight?: number }, max: number, measure: TextMeasure = estimateTextWidth): string[] {
  const lines = wrapText(text, width, font, measure);
  if (lines.length <= max) return lines;
  // The lines before the last are a start of the text with its spaces made single.
  const words = text.trim().split(/\s+/u).join(" ");
  const kept = lines.slice(0, max - 1);
  const rest = words.slice(kept.reduce((at, line) => words.indexOf(line, at) + line.length, 0)).trimStart();
  // An ellipsis follows the last character it shortens to, not a space.
  return [...kept, truncateText(rest, Math.max(font.size, width), font, measure).replace(/\s+…$/u, "…")];
}

/** The text a mark text draws: shortened to its `maxWidth` when it has one. */
export function fitText(text: MarkText, measure: TextMeasure = estimateTextWidth): string {
  return text.maxWidth === undefined ? text.text : truncateText(text.text, text.maxWidth, { size: text.size, weight: text.weight }, measure);
}

/** A text's lead and remainder after fitting both into its `maxWidth` together. */
export function fitLead(m: MarkText, fit: (text: string) => string): { lead: string; text: string } {
  const lead = m.lead ?? "";
  const whole = fit(lead + m.text);
  // A cut inside the lead leaves only the (shortened) lead.
  return whole.length - (whole === lead + m.text ? 0 : 1) < lead.length ? { lead: whole, text: "" } : { lead, text: whole.slice(lead.length) };
}

/** Width of a text whose first `lead` characters are drawn in `weight`. */
export function leadMeasure(measure: TextMeasure, lead: string, weight: number): TextMeasure {
  const n = Array.from(lead).length;
  return n ? (s, font) => {
    const chars = Array.from(s);
    return measure(chars.slice(0, n).join(""), { size: font.size, weight }) + measure(chars.slice(n).join(""), font);
  } : measure;
}

/** A mark text with its lead in `leadWeight`, both shortened together to its `maxWidth` by the measure. */
export function fitMarkText(m: MarkText, leadWeight: number, measure: TextMeasure): MarkText {
  if (m.maxWidth === undefined) return m;
  const { lead, text } = fitLead(m, (s) => truncateText(s, m.maxWidth!, m, leadMeasure(measure, m.lead ?? "", leadWeight)));
  return m.lead === undefined ? { ...m, text } : { ...m, lead, text };
}
