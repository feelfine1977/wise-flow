/**
 * The metric registry: for each metric the words it is named by, its unit and
 * how its values are written, in English and German, and how a value reads
 * that is a lower bound or a mean of merged elements (`metricBasis`).
 */
import { type Locale, formatCount, formatDelta, formatHours, formatNumber, formatPathCount, formatShare } from "./format.js";
import type { Metrics } from "./model.js";
import { type StringKey, t } from "./strings.js";

/**
 * What a merged value is: `atLeast`, a lower bound (the maximum of the merged
 * elements' cases or share, where the cases they share are not known);
 * `mean`, a mean of the merged elements' values weighted by their cases (a
 * mean of medians is not the median of all values). An exact value has none.
 */
export type MetricBasis = "atLeast" | "mean";

/** How a metric's values are written: a count, a share, a duration in hours, or a number. */
export type MetricKind = "count" | "share" | "hours" | "number";

/** One entry of the registry. */
export interface MetricEntry {
  /** The metric's name in a text ("cases", "median lag"). */
  label: StringKey;
  /** Its unit in a legend ("count", "% of cases", "min, h, d"). */
  unit: StringKey;
  kind: MetricKind;
  /** What a mean of its values over merged elements is called ("mean of medians"). */
  mean: StringKey;
  /** Its name where its value is such a mean ("lag, mean of medians"); without one the label and `mean`. */
  meanLabel?: StringKey;
  /** The measure a map shows when its paths are coloured by the metric. */
  measure?: StringKey;
}

const count = (label: StringKey): MetricEntry => ({ label, unit: "unit.count", kind: "count", mean: "metric.mean.weighted", measure: "measure.frequency" });

/** The metrics the library names, writes and measures. */
export const metricRegistry: Readonly<Record<string, MetricEntry>> = {
  cases: count("metric.cases"),
  count: count("metric.count"),
  events: count("metric.events"),
  starts: count("metric.starts"),
  ends: count("metric.ends"),
  internalCount: count("metric.internalCount"),
  members: count("metric.members"),
  violations: count("metric.violations"),
  share: { label: "metric.share", unit: "unit.shareOfCases", kind: "share", mean: "metric.mean.weighted", measure: "measure.frequency" },
  violationShare: { label: "metric.violationShare", unit: "unit.shareOfCases", kind: "share", mean: "metric.mean.weighted", measure: "measure.shortfall" },
  medianLagHours: { label: "metric.medianLagHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.medians", meanLabel: "metric.mean.medianLagHours", measure: "measure.performance" },
  medianPrevHours: { label: "metric.medianPrevHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.medians", meanLabel: "metric.mean.medianPrevHours", measure: "measure.performance" },
  meanPrevHours: { label: "metric.meanPrevHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.weighted", measure: "measure.performance" },
  meanNextHours: { label: "metric.meanNextHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.weighted", measure: "measure.performance" },
  meanLagHours: { label: "metric.meanLagHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.weighted", measure: "measure.performance" },
  prevPassages: count("metric.prevPassages"),
  nextPassages: count("metric.nextPassages"),
  lagPassages: count("metric.lagPassages"),
  p90LagHours: { label: "metric.p90LagHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.percentiles", meanLabel: "metric.mean.p90LagHours", measure: "measure.performance" },
  medianNextHours: { label: "metric.medianNextHours", unit: "unit.duration", kind: "hours", mean: "metric.mean.medians", meanLabel: "metric.mean.medianNextHours", measure: "measure.performance" },
};

/** The kind of a metric the registry does not hold, from its name. */
function kindOf(name: string): MetricKind {
  return /share/i.test(name) ? "share" : /hours/i.test(name) ? "hours" : /count|cases|events/i.test(name) ? "count" : "number";
}

/** The registry's entry of a metric; `undefined` for one it does not hold. */
export function metricEntry(name: string): MetricEntry | undefined {
  return Object.hasOwn(metricRegistry, name) ? metricRegistry[name] : undefined;
}

/** The kind of a metric's values. */
export function metricKind(name: string): MetricKind {
  const own = metricEntry(name);
  if (own) return own.kind;
  const inner = /^(?:delta_|a_)(.+)$/.exec(name)?.[1];
  return inner ? metricKind(inner) : kindOf(name);
}

/** The name of a metric in a locale: the registry's label, "difference …" for `delta_`, "… (a)" for `a_`, else the name itself. */
export function metricName(name: string, locale: Locale = "en"): string {
  const own = metricEntry(name);
  if (own) return t(locale, own.label);
  if (name.startsWith("delta_")) return `${t(locale, "metric.delta")} ${metricName(name.slice(6), locale)}`;
  if (name.startsWith("a_")) return `${metricName(name.slice(2), locale)} (a)`;
  return name;
}

/** The unit of a metric in a legend ("count", "% of cases", "min, h, d"); empty for a number without one. */
export function metricUnit(name: string, locale: Locale = "en"): string {
  const own = metricEntry(name);
  if (own) return t(locale, own.unit);
  const kind = metricKind(name);
  return kind === "number" ? "" : t(locale, kind === "share" ? "unit.shareOfCases" : kind === "hours" ? "unit.duration" : "unit.count");
}

/** What a value of an element's metric is: a lower bound, a mean of merged values, or exact (`undefined`). */
export function metricBasis(element: { metricBasis?: Partial<Record<string, MetricBasis>> } | undefined, name: string): MetricBasis | undefined {
  return element?.metricBasis?.[name];
}

export interface MetricFormatOptions {
  /** A lower bound reads "at least …"; a mean is written as the value (its name says what it is: `metricLabelOf`). */
  basis?: MetricBasis;
  /** Written on a path: counts in full up to 99,999, then "113k", "1.2M". Default false: counts in full. */
  path?: boolean;
  /** A lower bound reads "≥ 211,379", as on a card's number line, where it is otherwise "at least 211,379". */
  compactBasis?: boolean;
}

/**
 * A value of a metric as the registry writes it: counts grouped in full (on a
 * path up to 99,999, then shortened), shares as percentages, durations in
 * minutes, hours or days, differences of shares signed; "–" for a missing
 * value, never 0; any other number in full if whole, else with one decimal.
 * A lower bound reads "at least 211,379" ("mindestens").
 */
export function formatMetricValue(name: string, value: number | undefined, locale: Locale = "en", options: MetricFormatOptions = {}): string {
  if (value === undefined || !Number.isFinite(value)) return "–";
  const kind = metricKind(name);
  const text =
    kind === "share" ? (name.startsWith("delta_") ? formatDelta(value, locale) : formatShare(value, locale))
    : kind === "hours" ? formatHours(value, locale)
    : kind === "count" || Number.isInteger(value) ? (options.path ? formatPathCount(value, locale) : formatCount(value, locale))
    : formatNumber(value, 1, locale);
  return options.basis === "atLeast" ? (options.compactBasis ? `≥ ${text}` : t(locale, "metric.atLeast", { value: text })) : text;
}

/** An element's metric as text: its value read with its basis (`formatMetricValue`). */
export function elementMetric(element: { metrics?: Metrics; metricBasis?: Partial<Record<string, MetricBasis>> }, name: string, locale: Locale = "en", path = false): string {
  return formatMetricValue(name, element.metrics?.[name], locale, { basis: metricBasis(element, name), path });
}

/** The name of a metric for a value of the basis: a mean of medians is "lag, mean of medians", never "median lag". */
export function metricLabelOf(name: string, locale: Locale = "en", basis?: MetricBasis): string {
  if (basis !== "mean") return metricName(name, locale);
  const own = metricEntry(name);
  if (own?.meanLabel) return t(locale, own.meanLabel);
  return `${metricName(name, locale)}, ${t(locale, own?.mean ?? "metric.mean.weighted")}`;
}

/** What a mean of a metric's values is called, for a table cell ("mean of medians"). */
export function metricMeanNote(name: string, locale: Locale = "en"): string {
  return t(locale, metricEntry(name)?.mean ?? "metric.mean.weighted");
}

/** "Path width: cases (count)": a legend row's channel with the metric's name and unit. */
export function channelTitle(channel: StringKey, name: string, locale: Locale = "en"): string {
  const unit = metricUnit(name, locale);
  return t(locale, unit ? "legend.channel" : "legend.channelBare", { channel: t(locale, channel), metric: metricName(name, locale), unit });
}
