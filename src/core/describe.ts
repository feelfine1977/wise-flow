/** Text descriptions of map elements that the core announces. */
import { type Locale, formatCount, formatHours, formatShare } from "./format.js";
import { RECONNECTED_TAG } from "./aggregate.js";
import { type FlowEdge, type FlowGraph, hasTag, metric } from "./model.js";
import { type StringKey, t } from "./strings.js";

export function describeEdge(edge: FlowEdge, graph: FlowGraph, locale: Locale): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const parts: string[] = [];
  parts.push(`${t(locale, `kind.${edge.kind}` as StringKey)} ${byId.get(edge.source) ?? edge.source} → ${byId.get(edge.target) ?? edge.target}`);
  const count = metric(edge, "count", NaN);
  if (Number.isFinite(count)) parts.push(`${formatCount(count, locale)} ${t(locale, "metric.count")}`);
  const cases = metric(edge, "cases", NaN);
  if (Number.isFinite(cases) && cases !== count) parts.push(`${formatCount(cases, locale)} ${t(locale, "metric.cases")}`);
  const lag = metric(edge, "medianLagHours", NaN);
  if (Number.isFinite(lag)) parts.push(`${t(locale, "metric.medianLagHours")} ${formatHours(lag, locale)}`);
  const violation = metric(edge, "violationShare", NaN);
  if (Number.isFinite(violation)) parts.push(`${formatShare(violation, locale)} ${t(locale, "metric.violationShare")}`);
  if (hasTag(edge, RECONNECTED_TAG)) parts.push(t(locale, "map.reconnected"));
  return parts.join(". ") + ".";
}
