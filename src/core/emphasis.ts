/**
 * Paths around a selection (WF-06): which paths touch a selected activity,
 * how their labels read then ("112,924 · 48 %": the share of the selected
 * activity's cases the path carries), and how such a path is drawn (a
 * backward path lifted to its full width and opacity). One rule for the
 * interactive map and the Canvas map.
 */
import type { EdgeMark } from "./element-marks.js";
import { type Locale, formatShare } from "./format.js";
import { metricBasis } from "./metrics.js";
import { type FlowNode, metric } from "./model.js";

/** Whether a path touches a selected activity: its source or its target is selected. */
export function touchesSelection(mark: Pick<EdgeMark, "edge">, selected: ReadonlySet<string>): boolean {
  return selected.has(mark.edge.source) || selected.has(mark.edge.target);
}

/**
 * The label a path touching a selected activity draws: its count, then the
 * share of the selected activity's cases it carries (its source's where both
 * ends are selected), "≥" before a lower bound; its own label without a
 * selection, a count, or the activity's cases.
 */
export function emphasisLabel(mark: Pick<EdgeMark, "edge" | "texts">, selected: ReadonlySet<string>, nodeOf: (id: string) => FlowNode | undefined, locale: Locale = "en"): string | undefined {
  const own = mark.texts[0]?.text;
  if (own === undefined || !touchesSelection(mark, selected)) return own;
  const node = nodeOf(selected.has(mark.edge.source) ? mark.edge.source : mark.edge.target);
  const total = node ? metric(node, "cases", NaN) : NaN;
  const name = Number.isFinite(metric(mark.edge, "cases", NaN)) ? "cases" : "count";
  const part = metric(mark.edge, name, NaN);
  if (!(total > 0) || !Number.isFinite(part)) return own;
  const bound = (node && metricBasis(node, "cases") === "atLeast") || metricBasis(mark.edge, name) === "atLeast";
  return `${own} · ${bound ? "≥ " : ""}${formatShare(Math.max(0, part / total), locale)}`;
}
