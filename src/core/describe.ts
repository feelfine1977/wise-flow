/** Text descriptions of map elements that the core announces. */
import { type Locale, formatCount, formatShare } from "./format.js";
import { RECONNECTED_TAG } from "./aggregate.js";
import { elementMetric, metricBasis, metricLabelOf } from "./metrics.js";
import { type FlowEdge, type FlowGraph, type FlowNode, type GraphIndex, hasTag, metric } from "./model.js";
import { type StringKey, type Strings, t } from "./strings.js";
import { terminalOf } from "./style.js";

export function describeEdge(edge: FlowEdge, graph: FlowGraph, locale: Locale): string {
  return describeIndexedEdge(edge, { nodes: new Map(graph.nodes.map((n) => [n.id, n])) }, locale);
}

/** `describeEdge` reading the end labels from an index built once for the graph. */
export function describeIndexedEdge(edge: FlowEdge, index: Pick<GraphIndex, "nodes">, locale: Locale, strings?: Strings): string {
  const label = (id: string) => { const n = index.nodes.get(id); return n ? nodeName(n, locale, strings) : id; };
  const parts: string[] = [];
  parts.push(`${t(locale, `kind.${edge.kind}` as StringKey)} ${label(edge.source)} → ${label(edge.target)}`);
  // A terminal path counts the cases that start or end at its activity, whatever its count says.
  const terminal = terminalOf(edge, (id) => index.nodes.get(id));
  const counted = metric(edge, "cases", metric(edge, "count", NaN));
  if (terminal && Number.isFinite(counted)) {
    parts.push(t(locale, terminal === "start" ? "terminal.describeStart" : "terminal.describeEnd", { count: elementMetric(edge, Number.isFinite(metric(edge, "cases", NaN)) ? "cases" : "count", locale) }, strings));
    if (hasTag(edge, RECONNECTED_TAG)) parts.push(t(locale, "map.reconnected"));
    return parts.join(". ") + ".";
  }
  const count = metric(edge, "count", NaN);
  if (Number.isFinite(count)) parts.push(`${formatCount(count, locale)} ${t(locale, "metric.count")}`);
  const cases = metric(edge, "cases", NaN);
  // Merged paths: their cases are a lower bound, their lag a mean of medians, never "median lag".
  if (Number.isFinite(cases) && (cases !== count || metricBasis(edge, "cases"))) parts.push(`${elementMetric(edge, "cases", locale)} ${t(locale, "metric.cases")}`);
  parts.push(...describeTimes(edge, locale));
  const violation = metric(edge, "violationShare", NaN);
  if (Number.isFinite(violation)) parts.push(`${formatShare(violation, locale)} ${metricLabelOf("violationShare", locale, metricBasis(edge, "violationShare"))}`);
  if (hasTag(edge, RECONNECTED_TAG)) parts.push(t(locale, "map.reconnected"));
  return parts.join(". ") + ".";
}

/** A node's name: its label, or "Start" / "End" for a start or an end event without one. */
export function nodeName(node: FlowNode, locale: Locale, strings?: Strings): string {
  if (node.label || node.kind !== "event") return node.label;
  return hasTag(node, "start") ? t(locale, "terminal.start", {}, strings) : hasTag(node, "end") ? t(locale, "terminal.end", {}, strings) : node.label;
}

/** Supplied activity times or path lags, with their statistics and measured passages. */
export function describeTimes(element: FlowNode | FlowEdge, locale: Locale): string[] {
  const activity = element.kind === "activity" || element.kind === "stage";
  const names = (activity ? "medianPrevHours meanPrevHours medianNextHours meanNextHours" : "medianLagHours meanLagHours").split(" ");
  if (element.kind === "stage") return [t(locale, "time.stage")];
  return names.filter(name => Number.isFinite(element.metrics?.[name])).map(name => {
    const passages = element.metrics?.[activity ? (name.includes("Prev") ? "prevPassages" : "nextPassages") : "lagPassages"];
    return `${metricLabelOf(name, locale, metricBasis(element, name))} ${elementMetric(element, name, locale)}${Number.isFinite(passages) ? ` (${t(locale, "time.passages", { value: formatCount(passages!, locale) })})` : ""}`;
  });
}
