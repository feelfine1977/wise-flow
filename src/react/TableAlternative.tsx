import { type FlowGraph, type Locale, type Overlay, type Scales, type StringKey, buildScales, defaultStyle, describeOverlay, formatShare, t } from "../core/index.js";
import { formatMetric, metricColumns, metricLabel } from "./describe.js";
import type { Selection } from "./types.js";

export interface TableAlternativeProps {
  graph: FlowGraph;
  overlays?: Overlay[];
  scales?: Scales;
  locale?: Locale;
  selection?: Selection;
  onSelect?: (selection: Selection) => void;
  /** Which tables to show. Default all three. */
  tables?: ("nodes" | "edges" | "overlays")[];
  className?: string;
}

const NODE_METRICS = ["cases", "share", "events", "violationShare", "medianNextHours", "starts", "ends", "members", "internalCount"];
const EDGE_METRICS = ["count", "cases", "share", "violationShare", "medianLagHours", "p90LagHours"];

/**
 * The same graph and overlays as accessible tables: activities, paths and
 * constraint overlays with the numbers they encode.
 */
export function TableAlternative({ graph, overlays, scales, locale = "en", selection, onSelect, tables = ["nodes", "edges", "overlays"], className }: TableAlternativeProps) {
  const sc = scales ?? buildScales(graph, defaultStyle);
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const groupLabel = new Map((graph.groups ?? []).map((g) => [g.id, g.label]));
  const allOverlays = overlays ?? graph.overlays ?? [];
  const nodeCols = metricColumns(graph.nodes, NODE_METRICS);
  const edgeCols = metricColumns(graph.edges, EDGE_METRICS);
  const selectNode = (id: string) => onSelect?.({ nodes: [id], edges: [], groups: [] });
  const selectEdge = (id: string) => onSelect?.({ nodes: [], edges: [id], groups: [] });
  const targetLabel = (id: string) => labelOf.get(id) ?? groupLabel.get(id) ?? id;

  return (
    <div className={`wf-table${className ? ` ${className}` : ""}`}>
      {tables.includes("nodes") ? (
        <table>
          <caption>{t(locale, "table.caption.nodes")}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, "table.label")}</th>
              <th scope="col">{t(locale, "table.kind")}</th>
              <th scope="col">{t(locale, "table.group")}</th>
              {nodeCols.map((c) => (
                <th key={c} scope="col" className="wf-num">
                  {metricLabel(locale, c)}
                </th>
              ))}
              <th scope="col">{t(locale, "table.tags")}</th>
            </tr>
          </thead>
          <tbody>
            {graph.nodes.length === 0 ? (
              <tr>
                <td colSpan={4 + nodeCols.length}>{t(locale, "table.empty")}</td>
              </tr>
            ) : null}
            {graph.nodes.map((n) => (
              <tr key={n.id} className={selection?.nodes.includes(n.id) ? "wf-row--selected" : undefined} onClick={() => selectNode(n.id)} tabIndex={onSelect ? 0 : undefined} onKeyDown={(e) => e.key === "Enter" && selectNode(n.id)}>
                <th scope="row">
                  <span className="wf-swatch" style={{ background: sc.nodeColor(n) }} aria-hidden="true" />
                  {n.label}
                </th>
                <td>{t(locale, `kind.${n.kind}` as StringKey)}</td>
                <td>{n.group ? (groupLabel.get(n.group) ?? n.group) : ""}</td>
                {nodeCols.map((c) => (
                  <td key={c} className="wf-num">
                    {formatMetric(c, n.metrics?.[c], locale)}
                  </td>
                ))}
                <td>{(n.tags ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tables.includes("edges") ? (
        <table>
          <caption>{t(locale, "table.caption.edges")}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, "table.source")}</th>
              <th scope="col">{t(locale, "table.target")}</th>
              <th scope="col">{t(locale, "table.kind")}</th>
              {edgeCols.map((c) => (
                <th key={c} scope="col" className="wf-num">
                  {metricLabel(locale, c)}
                </th>
              ))}
              <th scope="col">{t(locale, "table.tags")}</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.length === 0 ? (
              <tr>
                <td colSpan={4 + edgeCols.length}>{t(locale, "table.empty")}</td>
              </tr>
            ) : null}
            {graph.edges.map((e) => (
              <tr key={e.id} className={selection?.edges.includes(e.id) ? "wf-row--selected" : undefined} onClick={() => selectEdge(e.id)} tabIndex={onSelect ? 0 : undefined} onKeyDown={(ev) => ev.key === "Enter" && selectEdge(e.id)}>
                <th scope="row">{labelOf.get(e.source) ?? e.source}</th>
                <td>{labelOf.get(e.target) ?? e.target}</td>
                <td>{t(locale, `kind.${e.kind}` as StringKey)}</td>
                {edgeCols.map((c) => (
                  <td key={c} className="wf-num">
                    {formatMetric(c, e.metrics?.[c], locale)}
                  </td>
                ))}
                <td>{(e.tags ?? []).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {tables.includes("overlays") ? (
        <table>
          <caption>{t(locale, "table.caption.overlays")}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, "table.overlay")}</th>
              <th scope="col">{t(locale, "table.target.column")}</th>
              <th scope="col">{t(locale, "table.constraint")}</th>
              <th scope="col" className="wf-num">
                {t(locale, "table.value")}
              </th>
              <th scope="col">{t(locale, "table.text")}</th>
            </tr>
          </thead>
          <tbody>
            {allOverlays.length === 0 ? (
              <tr>
                <td colSpan={5}>{t(locale, "table.empty")}</td>
              </tr>
            ) : null}
            {allOverlays.map((o, i) => (
              <tr key={`${o.kind}-${o.target}-${i}`}>
                <th scope="row">{t(locale, `overlay.${o.kind}` as StringKey)}</th>
                <td>
                  {o.kind === "arc" && o.payload?.source && o.payload?.target
                    ? `${targetLabel(String(o.payload.source))} → ${targetLabel(String(o.payload.target))}`
                    : targetLabel(o.target)}
                </td>
                <td>
                  {o.payload?.label ?? o.payload?.constraintId ?? ""}
                  {o.payload?.constraintType ? ` (${t(locale, `constraint.${o.payload.constraintType}` as StringKey)})` : ""}
                </td>
                <td className="wf-num">{typeof o.payload?.value === "number" ? formatShare(o.payload.value, locale) : "–"}</td>
                <td>{o.payload?.text ?? describeOverlay(o, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
