/** Text descriptions of map elements for ARIA labels and the table alternative. */
import { describeEdge } from "../core/describe.js";
import {
  type ActivityLabelOptions,
  activityCounts,
  type FlowGraph,
  type FlowGroup,
  type FlowNode,
  type Locale,
  type Overlay,
  type StringKey,
  RECONNECTED_TAG,
  describeOverlay,
  type MetricBasis,
  elementMetric,
  formatCount,
  formatMetricValue,
  formatShare,
  hasTag,
  metric,
  metricBasis,
  metricLabel,
  metricLabelOf,
  metricMeanNote,
  t,
} from "../core/index.js";

export function describeNode(node: FlowNode, overlays: Overlay[], locale: Locale, groupLabel?: string, activityLabels?: ActivityLabelOptions): string {
  const parts: string[] = [];
  parts.push(`${node.label}, ${t(locale, `kind.${node.kind}` as StringKey)}${groupLabel ? ` (${groupLabel})` : ""}`);
  const cases = metric(node, "cases", NaN);
  const share = metric(node, "share", NaN);
  if (activityLabels) {
    const reference = Object.hasOwn(activityLabels.references, node.id) ? activityLabels.references[node.id] : undefined;
    if (reference) parts[0] = `${reference} — ${parts[0]}`;
    parts.push(activityCounts(node, activityLabels, locale, true));
    if (Number.isFinite(share)) parts.push(formatShare(share, locale));
  } else if (Number.isFinite(cases)) {
    // A collapsed stage's cases and share are lower bounds: "at least 211,379 cases (at least 84 %)".
    parts.push(`${elementMetric(node, "cases", locale)} ${t(locale, "metric.cases")}${Number.isFinite(share) ? ` (${elementMetric(node, "share", locale)})` : ""}`);
  }
  const events = metric(node, "events", NaN);
  if (!activityLabels && Number.isFinite(events) && events !== cases) parts.push(`${formatCount(events, locale)} ${t(locale, "metric.events")}`);
  // A stage node's card shows its cases; how many activities it holds is said here.
  const members = metric(node, "members", NaN);
  if (node.kind === "stage" && Number.isFinite(members)) parts.push(`${formatCount(members, locale)} ${t(locale, "metric.members")}`);
  const violation = metric(node, "violationShare", NaN);
  if (Number.isFinite(violation)) parts.push(`${formatShare(violation, locale)} ${metricLabelOf("violationShare", locale, metricBasis(node, "violationShare"))}`);
  if (hasTag(node, RECONNECTED_TAG)) parts.push(t(locale, "map.reconnected"));
  for (const o of overlays) parts.push(describeOverlay(o, locale));
  return parts.join(". ") + ".";
}

export function describeGroup(group: FlowGroup, members: number, overlays: Overlay[], locale: Locale): string {
  const parts = [`${group.label}, ${t(locale, `group.${group.kind}` as StringKey)}`, `${members} ${t(locale, "metric.members")}`];
  for (const o of overlays) parts.push(describeOverlay(o, locale));
  return parts.join(". ") + ".";
}

export function describeMap(graph: FlowGraph, overlays: Overlay[], locale: Locale): string {
  // A server's threshold share (a number) names no node and path shares; only the recorded thresholds are described.
  const recorded = graph.meta?.abstraction;
  const abstraction = typeof recorded === "object" ? recorded : undefined;
  const parts = [
    t(locale, "map.description", { nodes: graph.nodes.length, edges: graph.edges.length, groups: graph.groups?.length ?? 0 }),
  ];
  const shown = graph.meta?.shown;
  if (abstraction?.activityDetail !== undefined && shown) {
    parts.push(
      t(locale, "map.detail", {
        activities: formatCount(shown.activities.shown, locale),
        allActivities: formatCount(shown.activities.of, locale),
        paths: formatCount(shown.paths.shown, locale),
        allPaths: formatCount(shown.paths.of, locale),
      }),
    );
  } else if (abstraction) {
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

/**
 * A table cell: the value as the metric registry writes it ("–" when
 * missing), a lower bound as "at least …", and a mean of merged values with
 * what it is ("15 h (mean of medians)").
 */
export function formatMetric(name: string, value: number | undefined, locale: Locale, basis?: MetricBasis): string {
  const text = formatMetricValue(name, value, locale, { basis });
  return basis === "mean" && text !== "–" ? `${text} (${metricMeanNote(name, locale)})` : text;
}

export { describeEdge, metricLabel };
