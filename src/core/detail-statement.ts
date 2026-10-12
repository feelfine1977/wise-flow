/**
 * What the detail sliders show, in words: the statements beside the two
 * sliders, the marks not shown, the elements shown for a protected deviation,
 * and the notes the tooltips of the shown elements add (docs/API.md, "Detail
 * shares"). Read from the `meta.shown` that `abstract` records.
 */
import { ANCHOR_TAG, indirectWay } from "./detail.js";
import { type Locale, formatCount, formatNumber } from "./format.js";
import { type FlowGraph, type Overlay, hasTag, metric } from "./model.js";
import { canonicalOverlays, describeOverlay } from "./overlays.js";
import { type StringKey, t } from "./strings.js";

/** One statement: the short form beside a slider, the full form for its title and assistive technology. */
export interface StatementLine {
  short: string;
  full: string;
}

/** What the detail sliders show of a graph `abstract` returned. */
export interface DetailStatement {
  /** "25 of 42 · 99.2 % of events"; the share of events only where the graph counts them. */
  activities: StatementLine;
  /**
   * "61 of 677 · 30 kept", with the strongest path not shown where it is
   * stronger than the weakest shown; `parts` are the short form's parts,
   * `keptPart` the one that counts the kept paths ("30 kept"), where there are any.
   */
  paths: StatementLine & { parts: string[]; keptPart?: string };
  /** The marks not shown because their element is not, the full form saying what they are ("outside scope", or their constraint), one item per mark; absent when none is hidden. */
  marks?: StatementLine & { items: string[] };
  /** The activities and paths shown only for a protected deviation; absent when there are none. */
  protected?: StatementLine;
  /** The ids of the paths kept only so that an activity lies on a way from start to end. */
  kept: string[];
}

export interface DetailStatementOptions {
  locale?: Locale;
  /**
   * The marks the abstraction was given, in that order (the graph's own, then
   * those beside it), which the ids of `meta.shown.marksNotShown` count: with
   * them the statement names the marks not shown, otherwise it counts them.
   */
  marks?: readonly Overlay[];
  /** The label of an element, also of one not shown (read from the graph before the abstraction); default its id. */
  labelOf?: (id: string) => string;
}

/** A share with one decimal, never "100" for a part nor "0" for some: "99.2 %", ">99.9 %", "<0.1 %". */
function share(part: number, whole: number, locale: Locale): string {
  const pct = (100 * part) / whole;
  const text = part > 0 && pct < 0.05 ? `<${formatNumber(0.1, 1, locale)}` : part < whole && pct >= 99.95 ? `>${formatNumber(99.9, 1, locale)}` : formatNumber(pct, 1, locale);
  return `${text} %`;
}

/** One or several: the key for one, or the other with the count. */
const counted = (locale: Locale, count: number, one: StringKey, many: StringKey, vars: Record<string, string> = {}) => t(locale, count === 1 ? one : many, { ...vars, count: formatCount(count, locale) });

/**
 * The statements of the detail sliders for a graph `abstract` returned, from
 * its `meta.shown`; undefined for a graph not abstracted. With thresholds the
 * paths are counted without the parts the detail shares name.
 */
export function detailStatement(graph: FlowGraph, options: DetailStatementOptions = {}): DetailStatement | undefined {
  const shown = graph.meta?.shown;
  if (!shown) return undefined;
  const { locale = "en", labelOf = (id: string) => id } = options;
  const n = (v: number) => formatCount(v, locale);
  const { activities, paths, events } = shown;
  const of = (x: { shown: number; of: number }) => t(locale, "controls.kept", { shown: n(x.shown), total: n(x.of) });

  const eventShare = events && events.of > 0 ? share(events.shown, events.of, locale) : undefined;
  const hidden = activities.of - activities.shown;
  // Those not shown are the rarest unless an activity is shown out of its rank (for a protected deviation, kept by
  // the host or re-added); one that nothing measured has no rank and is always shown.
  const { activities: stops, at } = shown.positions;
  const rarest = activities.shown <= at.activities + activities.of - (stops[stops.length - 1] ?? 0);
  const activityLine: StatementLine = {
    short: [of(activities), ...(eventShare ? [t(locale, "detail.events", { share: eventShare })] : [])].join(" · "),
    full: `${t(locale, "detail.activities", { shown: n(activities.shown), of: n(activities.of) })}${eventShare ? t(locale, "detail.carrying", { share: eventShare }) : ""}${hidden > 0 ? (rarest ? counted(locale, hidden, "detail.rarestOne", "detail.rarest") : counted(locale, hidden, "detail.othersOne", "detail.others")) : ""}.`,
  };

  const kept = shown.anchorsOnly ?? 0;
  const strongest = shown.strongestNotShown;
  // The lowest position is not "only frequent paths": a kept path can be weaker than one not shown.
  const stronger = strongest !== undefined && shown.weakestShown !== undefined && strongest > shown.weakestShown;
  const keptPart = kept ? t(locale, "detail.kept", { count: n(kept) }) : undefined;
  const parts = [of(paths), ...(keptPart ? [keptPart] : []), ...(stronger ? [t(locale, "detail.strongest", { count: n(strongest) })] : [])];
  const pathLine: DetailStatement["paths"] = {
    short: parts.join(" · "),
    parts,
    ...(keptPart && { keptPart }),
    full:
      shown.byFrequency === undefined
        ? `${t(locale, "detail.pathsShown", { shown: n(paths.shown), of: n(paths.of) })}.`
        : [
            `${t(locale, "detail.paths", { shown: n(paths.shown), of: n(paths.of), frequent: n(shown.byFrequency) })}${kept ? t(locale, "detail.pathsKept", { count: n(kept) }) : ""}.`,
            ...(shown.indirect ? [counted(locale, shown.indirect, "detail.indirectOne", "detail.indirect")] : []),
            ...(strongest !== undefined ? [t(locale, "detail.strongestFull", { count: n(strongest) })] : []),
          ].join(" "),
  };

  const statement: DetailStatement = { activities: activityLine, paths: pathLine, kept: Object.keys(shown.keeps ?? {}) };

  const hiddenMarks = shown.marksNotShown;
  if (hiddenMarks.length) {
    const short = counted(locale, hiddenMarks.length, "detail.marksOne", "detail.marks");
    // A mark's id is its kind, its target and its place among the marks given in canonical order.
    const ordered = options.marks ? canonicalOverlays([...options.marks]) : [];
    const marks = hiddenMarks.map((id) => ordered[Number(id.slice(id.lastIndexOf(":") + 1))]).filter((m): m is Overlay => !!m);
    // A hatch marks an element outside a constraint's scope; another mark is named by its constraint.
    const name = (m: Overlay) => (m.kind === "hatch" ? t(locale, "constraint.outOfScope") : typeof m.payload?.label === "string" && m.payload.label ? m.payload.label : t(locale, `overlay.${m.kind}` as StringKey));
    const groups = new Map<string, number>();
    for (const m of marks) groups.set(name(m), (groups.get(name(m)) ?? 0) + 1);
    const on = (m: Overlay) => (m.kind === "arc" && m.payload?.source !== undefined && m.payload?.target !== undefined ? `${labelOf(String(m.payload.source))} → ${labelOf(String(m.payload.target))}` : labelOf(m.target));
    statement.marks = {
      short,
      // What they are, the most frequent first.
      full: marks.length === hiddenMarks.length ? `${short}: ${[...groups].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([what, count]) => `${n(count)} ${what}`).join(", ")}.` : `${short}.`,
      items: marks.map((m) => `${describeOverlay(m, locale)} (${on(m)})`),
    };
  }
  if (shown.forProtected.length) {
    const edges = new Map(graph.edges.map((e) => [e.id, e]));
    const short = t(locale, "detail.protected", { count: n(shown.forProtected.length) });
    const label = (id: string) => (edges.has(id) ? `${labelOf(edges.get(id)!.source)} → ${labelOf(edges.get(id)!.target)}` : labelOf(id));
    statement.protected = { short, full: `${short}: ${shown.forProtected.map(label).join(", ")}.` };
  }
  return statement;
}

/** The count of a path a note adds up: its transitions, else its cases. */
const passages = (e: FlowGraph["edges"][number]) => metric(e, "count", metric(e, "cases", NaN));

/**
 * What the tooltip of a shown element adds, by id: an activity the passages
 * in and out on paths not shown (so that what is drawn and what is not add
 * up to its count), a kept path the activities it keeps on a way from start
 * to end, an indirect path the activities it passes, and an element shown
 * only for a protected deviation that it is. `base` is the graph the shown
 * one was abstracted from, its stages already collapsed where they are.
 */
export function detailNotes(base: FlowGraph, shown: FlowGraph, options: Omit<DetailStatementOptions, "marks"> = {}): Map<string, string> {
  const { locale = "en", labelOf = (id: string) => id } = options;
  const notes = new Map<string, string[]>();
  const add = (id: string, note: string) => notes.set(id, [...(notes.get(id) ?? []), note]);
  const drawn = new Set(shown.edges.map((e) => e.id));
  const nodes = new Set(base.nodes.map((v) => v.id));
  const flow = new Map<string, { in: number; out: number }>(shown.nodes.filter((v) => v.kind === "activity" || v.kind === "stage").map((v) => [v.id, { in: 0, out: 0 }]));
  // A path not drawn between two nodes of the graph; one to or from no node is no passage the map could show.
  for (const e of base.edges) {
    const count = passages(e);
    if (e.kind === "constraint" || drawn.has(e.id) || !(count > 0) || !nodes.has(e.source) || !nodes.has(e.target)) continue;
    if (flow.has(e.target)) flow.get(e.target)!.in += count;
    if (flow.has(e.source)) flow.get(e.source)!.out += count;
  }
  for (const [id, f] of flow) if (f.in + f.out > 0) add(id, t(locale, "detail.hidden", { in: formatCount(f.in, locale), out: formatCount(f.out, locale) }));
  const keeps = shown.meta?.shown?.keeps ?? {};
  for (const e of shown.edges) {
    if (hasTag(e, ANCHOR_TAG) && keeps[e.id]) add(e.id, t(locale, "detail.keeps", { labels: keeps[e.id].map(labelOf).join(", ") }));
    const way = indirectWay(e);
    if (way) add(e.id, t(locale, "detail.viaFull", { labels: way.via.map(labelOf).join(", ") }));
  }
  for (const id of shown.meta?.shown?.forProtected ?? []) add(id, t(locale, "detail.forProtected"));
  return new Map([...notes].map(([id, list]) => [id, list.join(" ")]));
}
