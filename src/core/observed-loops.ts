import { type Locale, formatCompact, formatCount, formatShare } from "./format.js";
import { type FlowEdge, type FlowGraph, type FlowNode, type Overlay, type OverlayPayload, metric } from "./model.js";

export interface FollowsSelfLoopOptions {
  locale?: Locale;
  /**
   * Label the loops as observed directly-follows repeats (the activity-label
   * presentation) with this plural unit for cases. Without it the loops carry
   * the edge id, the case share and the transition count.
   */
  observed?: { caseLabel?: string };
}

interface LoopReading {
  edge: FlowEdge;
  node: FlowNode | undefined;
  count: number;
  cases: number;
  total: number;
  maxCount: number;
  locale: Locale;
}

function plainLabels({ edge, count, cases, total, maxCount, locale }: LoopReading): OverlayPayload {
  const share = Number.isFinite(cases) && Number.isFinite(total) && total > 0 ? cases / total : Number.isFinite(count) ? count / maxCount : undefined;
  return { label: edge.id, value: share, text: Number.isFinite(count) ? `${formatCompact(count, locale)} ×` : undefined, edgeId: edge.id };
}

function observedLabels({ edge, node, count, cases, total, locale }: LoopReading, caseLabel: string): OverlayPayload {
  const measuredCount = Number.isFinite(count) && count >= 0;
  const measuredCases = Number.isFinite(cases) && cases >= 0;
  const share = measuredCases && Number.isFinite(total) && total > 0 && cases <= total ? cases / total : undefined;
  const support = measuredCases ? `${formatCount(cases, locale)} ${caseLabel} with this direct repeat` : `repeat ${caseLabel} unavailable`;
  return {
    edgeId: edge.id, observed: true,
    label: `Observed directly-follows repeat: ${node?.label ?? edge.source}`,
    displayLabel: measuredCount ? `↻ ${formatCompact(count, locale)} transitions` : "↻ recorded repeat",
    text: `${measuredCount ? `${formatCount(count, locale)} transitions` : "transition count unavailable"} · ${support}${share !== undefined ? ` / ${formatCount(total, locale)} ${caseLabel} with activity (${formatShare(share, locale)})` : ""}`,
  };
}

/** One self-loop overlay per follows edge from a node to itself, in edge order. */
export function followsSelfLoops(graph: FlowGraph, options: FollowsSelfLoopOptions = {}): Overlay[] {
  const locale = options.locale ?? "en";
  const maxCount = Math.max(1, ...graph.edges.filter((e) => e.kind === "follows").map((e) => metric(e, "count", 0)));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges
    .filter((edge) => edge.kind === "follows" && edge.source === edge.target)
    .map((edge) => {
      const node = nodes.get(edge.source);
      const reading: LoopReading = { edge, node, count: metric(edge, "count", NaN), cases: metric(edge, "cases", NaN), total: metric(node, "cases", NaN), maxCount, locale };
      return { kind: "selfLoop", target: edge.source, payload: options.observed ? observedLabels(reading, options.observed.caseLabel ?? "cases") : plainLabels(reading) };
    });
}

/**
 * `overlays` plus the follows self-loops of the graph. Self-loop overlays that
 * already stand for one of these edges (an `edgeId` without a constraint) are
 * replaced; constraint repetition overlays stay.
 */
export function withFollowsSelfLoops(graph: FlowGraph, overlays: Overlay[], options: FollowsSelfLoopOptions = {}): Overlay[] {
  const loops = followsSelfLoops(graph, options);
  const ids = new Set(loops.map((overlay) => String(overlay.payload?.edgeId)));
  return [...overlays.filter((overlay) => !(overlay.kind === "selfLoop" && !overlay.payload?.constraintId && ids.has(String(overlay.payload?.edgeId)))), ...loops];
}

/** Recorded directly-follows self-edges; independent of constraint repetition overlays. */
export function withObservedSelfLoops(graph: FlowGraph, overlays: Overlay[], locale: Locale = "en", caseLabel = "cases"): Overlay[] {
  return withFollowsSelfLoops(graph, overlays, { locale, observed: { caseLabel } });
}
