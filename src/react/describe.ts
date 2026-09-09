/** Text descriptions of map elements for ARIA labels and the table alternative. */
import {
  type FlowEdge,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type Locale,
  type Overlay,
  type StringKey,
  RECONNECTED_TAG,
  describeOverlay,
  formatCount,
  formatHours,
  formatShare,
  hasTag,
  metric,
  metricLabel,
  t,
} from "../core/index.js";

export function describeNode(node: FlowNode, overlays: Overlay[], locale: Locale, groupLabel?: string): string {
  const parts: string[] = [];
  parts.push(`${node.label}, ${t(locale, `kind.${node.kind}` as StringKey)}${groupLabel ? ` (${groupLabel})` : ""}`);
  const cases = metric(node, "cases", NaN);
  const share = metric(node, "share", NaN);
  if (Number.isFinite(cases)) {
    parts.push(`${formatCount(cases, locale)} ${t(locale, "metric.cases")}${Number.isFinite(share) ? ` (${formatShare(share, locale)})` : ""}`);
  }
  const events = metric(node, "events", NaN);
  if (Number.isFinite(events) && events !== cases) parts.push(`${formatCount(events, locale)} ${t(locale, "metric.events")}`);
  const violation = metric(node, "violationShare", NaN);
  if (Number.isFinite(violation)) parts.push(`${formatShare(violation, locale)} ${t(locale, "metric.violationShare")}`);
  if (hasTag(node, RECONNECTED_TAG)) parts.push(t(locale, "map.reconnected"));
  for (const o of overlays) parts.push(describeOverlay(o, locale));
  return parts.join(". ") + ".";
}

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

export function describeGroup(group: FlowGroup, members: number, overlays: Overlay[], locale: Locale): string {
  const parts = [`${group.label}, ${t(locale, `group.${group.kind}` as StringKey)}`, `${members} ${t(locale, "metric.members")}`];
  for (const o of overlays) parts.push(describeOverlay(o, locale));
  return parts.join(". ") + ".";
}

export function describeMap(graph: FlowGraph, overlays: Overlay[], locale: Locale): string {
  const abstraction = graph.meta?.abstraction as { minNodeShare?: number; minEdgeShare?: number } | undefined;
  const parts = [
    t(locale, "map.description", { nodes: graph.nodes.length, edges: graph.edges.length, groups: graph.groups?.length ?? 0 }),
  ];
  if (abstraction) {
    parts.push(
      t(locale, "map.abstraction", {
        nodeShare: formatShare(abstraction.minNodeShare ?? 0, locale),
        edgeShare: formatShare(abstraction.minEdgeShare ?? 0, locale),
      }),
    );
  }
  if (overlays.length) parts.push(t(locale, "map.overlays", { count: overlays.length }));
  parts.push(t(locale, "map.instructions"));
  return parts.join(" ");
}

/** Metric columns worth showing for a list of elements, in a stable order. */
export function metricColumns(items: { metrics?: Record<string, number> }[], preferred: string[]): string[] {
  const present = new Set<string>();
  for (const it of items) for (const k of Object.keys(it.metrics ?? {})) present.add(k);
  const ordered = preferred.filter((p) => present.has(p));
  const rest = [...present].filter((p) => !preferred.includes(p)).sort();
  return [...ordered, ...rest];
}

export function formatMetric(name: string, value: number | undefined, locale: Locale): string {
  if (value === undefined || !Number.isFinite(value)) return "–";
  if (/share/i.test(name)) return formatShare(value, locale);
  if (/hours/i.test(name)) return formatHours(value, locale);
  if (Number.isInteger(value)) return formatCount(value, locale);
  return value.toFixed(2);
}

export { metricLabel };
