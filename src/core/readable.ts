/**
 * Readable at every zoom: from the zoom, what the map's texts show and how
 * much they are scaled up, so that no text falls below the smallest size on
 * the screen (`Theme.text.minScreenPx`) while it still fits its card. One
 * function decides it (`readableAt`) for the DOM map, the Canvas map and the
 * exports; the scene carries the lines each level of a card writes, fitted
 * once when it is built (`NodeMark.levels`), and what decides the levels
 * (`FlowScene.readable`). Boxes and positions never change with the zoom.
 */
import { activityLabel, type ActivityLabelOptions } from "./activity-labels.js";
import type { EdgeBudget, ShownEdges } from "./edge-budget.js";
import type { ElementText, NodeMark } from "./element-marks.js";
import type { Box, XY } from "./layout.js";
import type { MarkText, OverlayMark } from "./overlay-marks.js";
import { type TextMeasure, estimateTextWidth, restOf, truncateText, wrapLines } from "./text.js";
import type { Theme } from "./theme.js";
import { dimensionTokens, readableTokens } from "./tokens.js";

/**
 * What an activity's or a stage's card shows, from the most to the least: its
 * name on up to two lines and its number line, its name on up to two lines,
 * its name on one line, nothing (a box labelled on hover and to assistive
 * technology). Zooming out sheds the number line, then the second line of the
 * name, then the name.
 */
export type ReadableLevel = "full" | "name" | "line" | "box";

/** Texts that are not scaled up: shed once they would fall below the floor. Path labels go first. */
export type ReadableLabel = "path" | "loop" | "event" | "glyph" | "note";

/** The texts a card writes at each level but `box`, at a boost of 1, fitted for the largest boost the level is drawn at. */
export interface CardLevels {
  /** The point the card's texts grow from: where they start, in the middle of the room above the frequency cue's foot. */
  origin: XY;
  /** The name on up to two lines and the number line; the card's `texts` where they are the same. */
  full: ElementText[];
  /** The name on up to two lines. */
  name: ElementText[];
  /** The name on one line. */
  line: ElementText[];
}

/** What decides the levels of a scene: for each level its smallest text and the largest floor it fits at; the size of each kind of label; the smallest text of its pills. */
export interface ReadableRules {
  levels: Readonly<Record<Exclude<ReadableLevel, "box">, { readonly size: number; readonly floor: number }>>;
  labels: Readonly<Record<ReadableLabel, number>>;
  /** The smallest text of the scene's deviation pills (badges, chips, arcs' labels): each is scaled up by the floor over it. */
  pills: number;
}

/** What the map's texts show at a zoom (`readableAt`). */
export interface Readable {
  level: ReadableLevel;
  /** How much the cards' texts are scaled up: the floor over the smallest text of the level, at least 1. */
  boost: number;
  /** The smallest text on the screen in layout units, rounded up to the ladder (`readableTokens`); 0 without a floor. */
  floor: number;
  /** The rung of the ladder the floor is on: the floor is `2 ** (step / readableTokens.steps)`. */
  step?: number;
  /** The kinds of label drawn. */
  labels: Readonly<Record<ReadableLabel, boolean>>;
  /** Deviation pills (badges, chips, arcs' labels) are drawn, scaled up to the floor; only beyond the ladder are they shed. */
  pills: boolean;
}

/** Every text at its size, every label and pill drawn: the state without a floor. */
export const FULL_DETAIL: Readable = Object.freeze({ level: "full", boost: 1, floor: 0, labels: Object.freeze({ path: true, loop: true, event: true, glyph: true, note: true }), pills: true });

const LEVELS = ["full", "name", "line"] as const;
/** The kinds of label, in the order paths' labels first. */
export const LABELS: readonly ReadableLabel[] = ["path", "loop", "event", "glyph", "note"];
/** The kind of label each kind of node writes; a card's texts are not labels. */
const NODE_LABELS: Readonly<Partial<Record<NodeMark["kind"], ReadableLabel>>> = { event: "event", gateway: "glyph", note: "note" };
const RANK: Record<ReadableLevel, number> = { full: 3, name: 2, line: 1, box: 0 };

/** The rung of the ladder a floor rounds up to, from the rung it was on: it comes down only once the floor is the hysteresis below the rung beneath. */
function rungOf(floor: number, previous: number | undefined): number {
  const { steps, first, hysteresis } = readableTokens;
  const up = Math.max(first, Math.ceil(steps * Math.log2(floor) - 1e-9));
  if (previous === undefined || up >= previous) return up;
  return floor > 2 ** ((previous - 1) / steps) / (1 + hysteresis) ? previous : up;
}

/** Whether a text of `limit` is drawn at the floor: while the floor stays at most the limit, and back once it is the hysteresis below it. */
const within = (floor: number, limit: number, was: boolean | undefined) => floor <= (was === false ? limit / (1 + readableTokens.hysteresis) : limit);

/**
 * What the texts show at a zoom: the smallest text on the screen
 * (`minScreenPx`, in CSS pixels) over the zoom is the floor in layout units,
 * rounded up to the ladder; each card shows the most of its texts that fits
 * scaled up to it, and the labels that would fall below it are shed. Given
 * the previous state, a level, a label or a rung that was shed comes back
 * only once the floor is `readableTokens.hysteresis` below where it went, so
 * that nothing flickers at a boundary. A floor of 0 keeps every text.
 */
export function readableAt(rules: ReadableRules, zoom: number, minScreenPx: number, previous?: Readable): Readable {
  const raw = minScreenPx > 0 && zoom > 0 ? minScreenPx / zoom : 0;
  if (!(raw > 0)) return FULL_DETAIL;
  const step = rungOf(raw, previous?.step);
  const beyond = step > readableTokens.last;
  const floor = 2 ** (step / readableTokens.steps);
  const was = previous ? RANK[previous.level] : undefined;
  const level = beyond ? "box" : (LEVELS.find((l) => within(floor, rules.levels[l].floor, was === undefined ? undefined : was >= RANK[l])) ?? "box");
  const labels = Object.fromEntries(LABELS.map((k) => [k, !beyond && within(floor, rules.labels[k], previous?.labels[k])])) as Record<ReadableLabel, boolean>;
  return { level, boost: level === "box" ? 1 : textBoost(floor, rules.levels[level].size), floor, step, labels, pills: !beyond };
}

/** The boost that takes a text of `size` to the floor: at least 1. */
export function textBoost(floor: number, size: number): number {
  return size > 0 && floor > size ? floor / size : 1;
}

/**
 * The smallest zoom at which every card still shows at least `level` of its
 * texts (`readableAt`): `minScreenPx` over the largest rung of the ladder
 * the level fits at. 0 without a floor or without a card, so that no zoom
 * is too small; Infinity where the level fits no rung, not even the first.
 */
export function readableZoom(rules: ReadableRules, minScreenPx: number, level: Exclude<ReadableLevel, "box"> = "line"): number {
  const limit = rules.levels[level].floor;
  if (!(minScreenPx > 0) || !Number.isFinite(limit)) return 0;
  const { steps, first, last } = readableTokens;
  const rung = Math.min(last, Math.floor(steps * Math.log2(limit) + 1e-9));
  return rung < first ? Infinity : minScreenPx / 2 ** (rung / steps);
}

/** A text scaled by `boost` about `origin`: its size and its distance from the origin. */
export function boostText<T extends MarkText>(t: T, boost: number, origin: XY): T {
  return boost === 1 ? t : { ...t, x: origin.x + (t.x - origin.x) * boost, y: origin.y + (t.y - origin.y) * boost, size: t.size * boost, ...(t.maxWidth !== undefined && { maxWidth: t.maxWidth * boost }) };
}

/**
 * The texts a node writes in a state: a card's at its level (its own at the
 * full level unboosted), scaled up from their start; an event's, a gateway's
 * or a note's label while it reaches the floor.
 */
export function nodeTexts(mark: NodeMark, r: Readable): ElementText[] {
  const label = NODE_LABELS[mark.kind];
  const { levels } = mark;
  if (label || !levels) return !label || r.labels[label] ? mark.texts : [];
  const texts = r.level === "box" ? [] : r.level === "full" && r.boost === 1 ? mark.texts : levels[r.level];
  return r.boost === 1 ? texts : texts.map((t) => boostText(t, r.boost, levels.origin));
}

/** A group's title in a state: shed with the cards' names, and scaled up to the floor from its start. */
export const titleTexts = (texts: ElementText[], r: Readable): ElementText[] => (r.level === "box" ? [] : texts.map((t) => boostText(t, textBoost(r.floor, t.size), t)));

/** A pill (a badge, a chip, an arc's label) and its texts scaled by `boost` about `origin`, its outline too; an arc's path keeps its course. */
export function boostMark(m: OverlayMark, boost: number, origin: XY): OverlayMark {
  if (boost === 1) return m;
  const box = (b: Box) => ({ x: origin.x + (b.x - origin.x) * boost, y: origin.y + (b.y - origin.y) * boost, width: b.width * boost, height: b.height * boost });
  const line = <S extends { width: number }>(s: S) => ({ ...s, width: s.width * boost });
  const texts = m.texts.map((t) => boostText(t, boost, origin));
  const { pill, stroke, gauge } = m;
  return pill
    ? { ...m, texts, pill: { ...pill, box: box(pill.box), radius: pill.radius * boost, stroke: line(pill.stroke) } }
    : { ...m, texts, box: box(m.box), radius: m.radius * boost, stroke: stroke && line(stroke), gauge: gauge && { ...gauge, ...box(gauge) } };
}

/** Whether a mark is a deviation pill: a badge, a chip, or an arc with its label. */
export const isPill = (m: OverlayMark): boolean => m.kind === "badge" || m.kind === "chip" || (m.kind === "arc" && !!m.pill);

const rows = new WeakMap<ReadableRules, ReadonlyMap<string, XY>>();

/**
 * The boost of a pill in a state (the floor over the scene's smallest pill
 * text, at least 1), and the point it grows from: a badge with the row of
 * badges of its element, from the row's bottom-right corner (`badgeRows`), so
 * that the row keeps its order above the card; a chip and an arc's label from
 * their middle.
 */
export function pillBoost(m: OverlayMark, floor: number, rules: ReadableRules): { boost: number; origin: XY } {
  const b = m.pill?.box ?? m.box;
  return { boost: textBoost(floor, rules.pills), origin: (m.kind === "badge" && rows.get(rules)?.get(m.overlay.target)) || { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
}

/** The top of the ladder: the largest floor a text is drawn at. */
export const LADDER_TOP = 2 ** (readableTokens.last / readableTokens.steps);

/** The largest floor at which a card shows a name, and with it the groups their titles: the ladder's top where no level ever goes. */
export const namedUpTo = (rules: ReadableRules): number => Math.min(LADDER_TOP, Math.max(rules.levels.full.floor, rules.levels.name.floor, rules.levels.line.floor));

/** A mark as a state draws it: a deviation pill scaled up to the floor, a self-loop's label shed with the paths' labels. */
export function readableMark(m: OverlayMark, r: Readable, rules: ReadableRules): OverlayMark {
  if (isPill(m)) {
    const { boost, origin } = pillBoost(m, r.floor, rules);
    return boostMark(m, boost, origin);
  }
  return m.kind === "selfLoop" && !r.labels.loop && m.texts.length ? { ...m, texts: [] } : m;
}

const isCard = (m: NodeMark) => m.kind === "activity" || m.kind === "stage";
const smallest = (texts: readonly MarkText[]) => texts.reduce((s, t) => Math.min(s, t.size), Infinity);

/** Where a text's baseline lies in a line of `lineHeight`: its capitals centred in the line (as a card's are laid out). */
const baseline = (top: number, lineHeight: number, size: number) => top + (lineHeight + 0.7 * size) / 2;

interface Card {
  mark: NodeMark;
  name: string;
  names: ElementText[];
  numbers: ElementText[];
  room: number;
  /** The height of the room above the cue's foot and its middle. */
  height: number;
  middle: number;
}

/** A card's room and texts as its mark laid them out. */
function cardOf(mark: NodeMark, theme: Theme, labels: ActivityLabelOptions | undefined): Card {
  const { box, stroke } = mark;
  const width = stroke.width;
  const unit = theme.space.unit;
  const name = labels && mark.kind === "activity" ? activityLabel(mark.node, labels) : mark.node.label;
  const height = box.height - 2 * width - dimensionTokens.cueFoot;
  // The room the interactive map gives the texts: inside the padding and a solid outline, as the mark measured it.
  const room = box.width - 12 * unit - (stroke.dash ? 0 : 2 * width);
  return { mark, name, names: mark.texts.filter((t) => t.role === "nameLine"), numbers: mark.texts.filter((t) => t.role === "countLine" || t.role === "share"), room, height, middle: box.y + width + height / 2 };
}

/**
 * The largest boost at which a card's texts fit at a level: the block's
 * height in its room, the start of its name and its number line along it,
 * their widths by the estimate (`estimateTextWidth`), so that the levels are
 * the same in every font.
 */
function largest(card: Card, level: Exclude<ReadableLevel, "box">, theme: Theme, measure: TextMeasure = estimateTextWidth): number {
  const [nameStyle] = card.names;
  const lines = level === "line" ? 1 : 2;
  const numbers = level === "full" && card.numbers.length;
  const block = (nameStyle ? lines * theme.text.activityName.lineHeight : 0) + (numbers ? theme.text.activityNumber.lineHeight : 0);
  let most = block > 0 ? card.height / block : Infinity;
  if (nameStyle) {
    // The first characters of the name, and the ellipsis where the name goes on.
    const chars = Array.from(card.name.trim());
    const start = chars.slice(0, readableTokens.nameChars).join("") + (chars.length > readableTokens.nameChars ? "…" : "");
    most = Math.min(most, card.room / Math.max(1e-9, measure(start, nameStyle)));
  }
  if (numbers) {
    const last = card.numbers[card.numbers.length - 1];
    const x = card.names[0]?.x ?? card.numbers[0].x;
    most = Math.min(most, card.room / Math.max(1e-9, last.x - x + measure(last.text, last)));
  }
  // A hair under: at the largest boost the start of the name fills its line exactly, and must still fit when it is wrapped.
  return most * (1 - 1e-9);
}

/** A name, the room of its lines and the font they are written in. */
export interface NameRoom {
  name: string;
  room: number;
  font: { size: number; weight?: number };
}

/** The characters every text starts with alike. */
function sharedStart(texts: readonly string[]): number {
  const chars = texts.map((text) => Array.from(text));
  let n = 0;
  while (chars.every((c) => n < c.length && c[n] === chars[0][n])) n++;
  return n;
}

/** The lines of each item by their text, in groups: the items whose lines coincide. */
function alike(items: readonly number[], lines: readonly string[][]): number[][] {
  const groups = new Map<string, number[]>();
  for (const i of items) {
    const key = lines[i].join("\n");
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * The last line of a name whose shortened lines coincide with others': its
 * start, an ellipsis and the part from the first character that tells it
 * from the others (`from`), as much of each as the room holds, the telling
 * part before the start. `rest` is the name after the lines kept before the
 * last.
 */
function tellingLine(rest: string, from: number, room: number, font: { size: number; weight?: number }, measure: TextMeasure): string {
  const chars = Array.from(rest);
  const limit = Math.max(font.size, room);
  const shown = truncateText(chars.slice(from).join(""), Math.max(font.size, limit - measure("…", font)), font, measure);
  let lo = 0;
  let hi = from;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(`${chars.slice(0, mid).join("")}…${shown}`, font) <= limit + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join("")}…${shown}`;
}

/**
 * The lines of each name wrapped in its room (`wrapLines`, or `given`), and
 * where the lines of names that differ coincide, their last line told apart
 * (`tellingLine`): names shortened to the same text are shortened again
 * from the first character that differs among them, and again among those
 * that still coincide, until each differs or nothing of the name is left to
 * tell it by. Names that are the same stay the same.
 */
export function distinctLines(items: readonly NameRoom[], max: number, measure: TextMeasure, given?: readonly (readonly string[])[]): string[][] {
  const lines = given ? given.map((l) => [...l]) : items.map((i) => wrapLines(i.name, i.room, i.font, max, measure));
  const tellApart = (group: readonly number[], after: number) => {
    const rests = group.map((i) => restOf(items[i].name, lines[i].slice(0, -1)));
    const from = sharedStart(rests);
    if (from <= after || rests.every((rest) => Array.from(rest).length <= from)) return;
    group.forEach((i, k) => {
      lines[i][lines[i].length - 1] = tellingLine(rests[k], from, items[i].room, items[i].font, measure);
    });
    for (const still of alike(group, lines)) tellApart(still, from);
  };
  for (const group of alike(items.map((_, i) => i), lines)) tellApart(group, 0);
  return lines;
}

/** A card's texts at a level: its name's lines (`distinctLines`, fitted for the level's boost) and, at the full level, its numbers, laid out at a boost of 1 as its mark lays out its own. */
function levelTexts(card: Card, level: Exclude<ReadableLevel, "box">, lines: readonly string[], theme: Theme): ElementText[] {
  const [style] = card.names;
  const { lineHeight: nameHeight } = theme.text.activityName;
  const numbers = level === "full" ? card.numbers : [];
  const names = style ? lines : [];
  const numberHeight = numbers.length ? theme.text.activityNumber.lineHeight : 0;
  const top = card.middle - (names.length * nameHeight + numberHeight) / 2;
  const out = names.map((text, i) => ({ ...style, text, y: baseline(top + i * nameHeight, nameHeight, style.size) }));
  for (const t of numbers) out.push({ ...t, y: baseline(top + names.length * nameHeight, numberHeight, numbers[0].size) });
  return out;
}

const sameTexts = (a: readonly ElementText[], b: readonly ElementText[]) => a.length === b.length && a.every((t, i) => t.text === b[i].text && t.y === b[i].y);

/**
 * The rules of a scene's levels, and each card's texts at them, fitted once
 * (`NodeMark.levels`, set on the marks), from its node marks and its overlay
 * marks (`overlays`, for the pills): a level fits while every card's
 * block fits its room at the boost, a line holds the first
 * `readableTokens.nameChars` characters of every name (and the ellipsis
 * where the name goes on) and the number line its width, by the estimate of
 * text widths, so that the levels do not depend on the font; the lines are
 * fitted by `measure`. A level that never fits is drawn only unboosted.
 */
export function readableRules(marks: readonly NodeMark[], overlays: readonly OverlayMark[], theme: Theme, measure: TextMeasure, labels?: ActivityLabelOptions): ReadableRules {
  const t = theme.text;
  // Each element's row of badges grows from its bottom-right corner.
  const corners = new Map<string, XY>();
  let pills = Infinity;
  for (const m of overlays) {
    if (isPill(m)) pills = Math.min(pills, smallest(m.texts));
    if (m.kind !== "badge") continue;
    const was = corners.get(m.overlay.target);
    corners.set(m.overlay.target, { x: Math.max(was?.x ?? -Infinity, m.box.x + m.box.width), y: Math.max(was?.y ?? -Infinity, m.box.y + m.box.height) });
  }
  const cards = marks.filter((m) => isCard(m) && m.texts.length).map((m) => cardOf(m, theme, labels));
  const levels = {} as Record<Exclude<ReadableLevel, "box">, { size: number; floor: number }>;
  const boosts = {} as Record<Exclude<ReadableLevel, "box">, number>;
  for (const l of LEVELS) {
    const size = cards.reduce((s, c) => Math.min(s, smallest(l === "full" ? [...c.names, ...c.numbers] : c.names)), Infinity);
    const most = cards.reduce((m, c) => Math.min(m, largest(c, l, theme)), Infinity);
    // The full level is drawn unboosted whatever fits: it is the card as it always was.
    levels[l] = { size, floor: cards.length ? size * (l === "full" ? Math.max(1, most) : most) : Infinity };
    boosts[l] = Number.isFinite(most) ? Math.max(1, most) : 1;
  }
  // The cards' own lines, and each level's wrapped at its boost, told apart where names that differ were shortened alike.
  const rooms = (boost: number): NameRoom[] => cards.map((c) => ({ name: c.names.length ? c.name : "", room: c.room, font: { size: (c.names[0]?.size ?? 0) * boost, weight: c.names[0]?.weight } }));
  const own = distinctLines(rooms(1), 2, measure, cards.map((c) => c.names.map((n) => n.text)));
  const lines = { full: distinctLines(rooms(boosts.full), 2, measure), name: distinctLines(rooms(boosts.name), 2, measure), line: distinctLines(rooms(boosts.line), 1, measure) };
  cards.forEach((c, i) => {
    if (own[i].some((text, k) => text !== c.names[k].text)) {
      let k = 0;
      c.mark.texts = c.mark.texts.map((tx) => (tx.role === "nameLine" ? { ...tx, text: own[i][k++] } : tx));
      c.names = c.mark.texts.filter((tx) => tx.role === "nameLine");
    }
    const full = levelTexts(c, "full", lines.full[i], theme);
    c.mark.levels = {
      origin: { x: (c.names[0] ?? c.numbers[0]).x, y: c.middle },
      full: sameTexts(full, c.mark.texts) ? c.mark.texts : full,
      name: levelTexts(c, "name", lines.name[i], theme),
      line: levelTexts(c, "line", lines.line[i], theme),
    };
  });
  const rules = {
    levels,
    labels: { path: t.pathLabel.size, loop: t.selfLoopLabel.size, event: t.eventLabel.size, glyph: t.gatewayGlyph.size, note: t.noteLabel.size },
    pills,
  };
  rows.set(rules, corners);
  return rules;
}

/** A shown figure replays the live text state, or decides at its supplied screen zoom; ordinary figures keep their own floor. */
export function shownReadable(scene: { readable: ReadableRules; theme: Theme }, options: { readable?: Readable; lodZoom?: number; edgeBudget?: EdgeBudget | ShownEdges }): Readable | undefined {
  return options.readable ?? (options.edgeBudget && typeof options.edgeBudget === "object" && options.lodZoom !== undefined ? readableAt(scene.readable, options.lodZoom, scene.theme.text.minScreenPx) : undefined);
}
