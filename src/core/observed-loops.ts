import { type Locale, formatCompact, formatCount, formatShare } from "./format.js";
import { type FlowGraph, type Overlay, metric } from "./model.js";

/** Recorded directly-follows self-edges; independent of constraint repetition overlays. */
export function withObservedSelfLoops(graph: FlowGraph, overlays: Overlay[], locale: Locale = "en", caseLabel = "cases"): Overlay[] {
  const loops = graph.edges.filter((edge) => edge.kind === "follows" && edge.source === edge.target);
  const ids = new Set(loops.map((edge) => edge.id));
  const result = overlays.filter((overlay) => !(overlay.kind === "selfLoop" && !overlay.payload?.constraintId && ids.has(String(overlay.payload?.edgeId))));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of loops) {
    const count = metric(edge, "count", NaN);
    const cases = metric(edge, "cases", NaN);
    const node = nodes.get(edge.source);
    const total = metric(node, "cases", NaN);
    const measuredCount = Number.isFinite(count) && count >= 0;
    const measuredCases = Number.isFinite(cases) && cases >= 0;
    const share = measuredCases && Number.isFinite(total) && total > 0 && cases <= total ? cases / total : undefined;
    const support = measuredCases ? `${formatCount(cases, locale)} ${caseLabel} with this direct repeat` : `repeat ${caseLabel} unavailable`;
    result.push({
      kind: "selfLoop", target: edge.source,
      payload: {
        edgeId: edge.id, observed: true,
        label: `Observed directly-follows repeat: ${node?.label ?? edge.source}`,
        displayLabel: measuredCount ? `↻ ${formatCompact(count, locale)} transitions` : "↻ recorded repeat",
        text: `${measuredCount ? `${formatCount(count, locale)} transitions` : "transition count unavailable"} · ${support}${share !== undefined ? ` / ${formatCount(total, locale)} ${caseLabel} with activity (${formatShare(share, locale)})` : ""}`,
      },
    });
  }
  return result;
}
