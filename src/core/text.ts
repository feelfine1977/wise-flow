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

/** How a text is shortened: with `words`, only after whole words where one fits. */
export interface TruncateOptions {
  words?: boolean;
}

/**
 * The longest start of `text` that fits `maxWidth` with an ellipsis, at least
 * one character; the text itself when it fits. With `words` the start ends
 * after a whole word ("Vendor…", never "Vendor cr…"), and only where no whole
 * word fits is the first cut between characters. A width that exceeds
 * `maxWidth` by less than a millionth (rounding) fits.
 */
export function truncateText(text: string, maxWidth: number, font: { size: number; weight?: number }, measure: TextMeasure = estimateTextWidth, options: TruncateOptions = {}): string {
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
  if (options.words) {
    // The last space at or before the cut ends the last whole word that fits (a shorter start fits too).
    let space = Math.min(lo, chars.length - 1);
    while (space > 0 && !/\s/u.test(chars[space])) space--;
    const start = chars.slice(0, space).join("").trimEnd();
    if (start) return `${start}…`;
  }
  return `${chars.slice(0, Math.max(1, lo)).join("")}…`;
}

/** Where a line may break: a run of white space other than the no-break spaces (U+00A0, U+202F), which keep a number with its unit. */
const BREAKS = /[^\S\u00a0\u202f]+/u;

/**
 * Lines of `text` at most `width` wide (at least the font's size): words in
 * order, a word wider than a line broken between characters. The measure is
 * taken to grow with the text, as `truncateText` takes it: the words that
 * still fit on a line, and where a word breaks the characters that still fit,
 * are found by doubling and halving, so a text costs about as many measures
 * of a line as it has lines, times the logarithm of its length.
 */
export function wrapText(text: string, width: number, font: { size: number; weight?: number }, measure: TextMeasure = estimateTextWidth): string[] {
  const limit = Math.max(font.size, width);
  const fits = (s: string) => measure(s, font) <= limit;
  /** The most of `count` items whose text `of(n)` fits: `fit` do, `over` do not (or run past the items). */
  const most = (count: number, of: (n: number) => string) => {
    let fit = 0;
    let over = 1;
    while (over <= count && fits(of(over))) [fit, over] = [over, over * 2];
    over = Math.min(over, count + 1);
    while (over - fit > 1) {
      const mid = (fit + over) >> 1;
      if (fits(of(mid))) fit = mid;
      else over = mid;
    }
    return fit;
  };
  const words = text.trim().split(BREAKS);
  const lines: string[] = [];
  let line = "";
  for (let w = 0; w < words.length; w++) {
    if (line) {
      // The words that follow the line on it; the next one starts a line.
      const joined = most(words.length - w, (n) => `${line} ${words.slice(w, w + n).join(" ")}`);
      if (joined) line = `${line} ${words.slice(w, w + joined).join(" ")}`;
      w += joined;
      if (w === words.length) break;
      lines.push(line);
      line = "";
    }
    const chars = Array.from(words[w]);
    for (let at = 0; at < chars.length; ) {
      // An empty line takes a character even where none fits.
      const taken = Math.max(1, most(chars.length - at, (n) => chars.slice(at, at + n).join("")));
      line = chars.slice(at, at + taken).join("");
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
 * ellipsis (`truncateText`, after whole words with `words`).
 */
export function wrapLines(text: string, width: number, font: { size: number; weight?: number }, max: number, measure: TextMeasure = estimateTextWidth, options: TruncateOptions = {}): string[] {
  const lines = wrapText(text, width, font, measure);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max - 1);
  // An ellipsis follows the last character it shortens to, not a space.
  return [...kept, truncateText(restOf(text, kept), Math.max(font.size, width), font, measure, options).replace(/\s+…$/u, "…")];
}

/** The rest of `text`, its spaces made single, after the `kept` lines that start it (the lines before the last of `wrapLines`). */
export function restOf(text: string, kept: readonly string[]): string {
  const words = text.trim().split(BREAKS).join(" ");
  return words.slice(kept.reduce((at, line) => words.indexOf(line, at) + line.length, 0)).trimStart();
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
