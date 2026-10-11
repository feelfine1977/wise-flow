import { useLayoutEffect, useRef, useState } from "react";
import { type ElementRef, type FlowGraph, type Locale, type Overlay, type Scales, type StringKey, buildScales, defaultStyle, describeOverlay, emptySelection, formatCount, formatShare, t } from "../core/index.js";
import { clickSelection } from "../core/map-controller.js";
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
  /**
   * Rows per page. With it every table shows one page at a time with buttons
   * for the previous and the next rows, a search field filters the rows of all
   * tables, and the tables carry their row counts (`aria-rowcount`). Default:
   * all rows, no search.
   */
  pageSize?: number;
  className?: string;
}

type TableName = "nodes" | "edges" | "overlays";

/**
 * The rows of one table on its page: those whose text contains the query,
 * from the page's first one; the attributes of the table and of its rows that
 * tell their position among all of them; and the line under the table that
 * names the rows shown and moves between pages. Without a page size, every
 * row and no attributes.
 */
function usePage<T>(rows: T[], text: (row: T) => string, query: string, pageSize: number | undefined, locale: Locale) {
  const [page, setPage] = useState({ query, at: 0 });
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // A button that goes to the first or the last page stops working there: the input focus it had moves to the other one.
  const refocus = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (refocus.current !== undefined) buttons.current[refocus.current]?.focus();
    refocus.current = undefined;
  });
  if (pageSize === undefined) return { rows, table: {}, head: {}, row: () => ({}), pager: null };
  const q = query.trim().toLocaleLowerCase();
  const matching = q ? rows.filter((r) => text(r).toLocaleLowerCase().includes(q)) : rows;
  const last = Math.max(0, Math.ceil(matching.length / pageSize) - 1);
  // A new query starts on the first page, and so does the next one, even when it is an earlier query again.
  if (page.query !== query) setPage({ query, at: 0 });
  const at = page.query === query ? Math.min(page.at, last) : 0;
  const from = at * pageSize;
  const shown = matching.slice(from, from + pageSize);
  const go = (to: number, button: HTMLButtonElement) => {
    if (document.activeElement === button && (to === 0 || to === last)) refocus.current = to === 0 ? 1 : 0;
    setPage({ query, at: to });
  };
  const pager = (
    <div className="wf-table__pager">
      <button ref={(b) => void (buttons.current[0] = b)} type="button" className="wf-button" disabled={at === 0} onClick={(e) => go(at - 1, e.currentTarget)}>
        {t(locale, "table.previous")}
      </button>
      <span role="status">
        {matching.length ? t(locale, "table.rows", { from: formatCount(from + 1, locale), to: formatCount(from + shown.length, locale), total: formatCount(matching.length, locale) }) : t(locale, "table.empty")}
      </span>
      <button ref={(b) => void (buttons.current[1] = b)} type="button" className="wf-button" disabled={at >= last} onClick={(e) => go(at + 1, e.currentTarget)}>
        {t(locale, "table.next")}
      </button>
    </div>
  );
  // The header is the first row.
  return { rows: shown, table: { "aria-rowcount": matching.length + 1 }, head: { "aria-rowindex": 1 }, row: (i: number) => ({ "aria-rowindex": from + i + 2 }), pager };
}

const NODE_METRICS = ["cases", "share", "events", "violationShare", "medianNextHours", "starts", "ends", "members", "internalCount"];
const EDGE_METRICS = ["count", "cases", "share", "violationShare", "medianLagHours", "p90LagHours"];

/**
 * The same graph and overlays as accessible tables: activities, paths and
 * constraint overlays with the numbers they encode. A click or Enter on a row
 * selects as a click on the map does (the map controller's `clickSelection`).
 */
export function TableAlternative({ graph, overlays, scales, locale = "en", selection, onSelect, tables = ["nodes", "edges", "overlays"], pageSize, className }: TableAlternativeProps) {
  const sc = scales ?? buildScales(graph, defaultStyle);
  const labelOf = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const groupLabel = new Map((graph.groups ?? []).map((g) => [g.id, g.label]));
  const allOverlays = overlays ?? graph.overlays ?? [];
  const nodeCols = metricColumns(graph.nodes, NODE_METRICS);
  const edgeCols = metricColumns(graph.edges, EDGE_METRICS);
  // A row is chosen as the map's click chooses an element: Shift, Ctrl or Cmd add it to the selection or remove it.
  const choose = (element: ElementRef, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) =>
    onSelect?.(clickSelection(selection ?? emptySelection, element, e.shiftKey || e.ctrlKey || e.metaKey));
  const targetLabel = (id: string) => labelOf.get(id) ?? groupLabel.get(id) ?? id;
  const kindLabel = (kind: string) => t(locale, `kind.${kind}` as StringKey);
  const [query, setQuery] = useState("");
  const nodePage = usePage(graph.nodes, (n) => [n.label, kindLabel(n.kind), n.group ? (groupLabel.get(n.group) ?? n.group) : "", ...(n.tags ?? [])].join("\n"), query, pageSize, locale);
  const edgePage = usePage(graph.edges, (e) => [labelOf.get(e.source) ?? e.source, labelOf.get(e.target) ?? e.target, kindLabel(e.kind), ...(e.tags ?? [])].join("\n"), query, pageSize, locale);
  const overlayTarget = (o: Overlay) =>
    o.kind === "arc" && o.payload?.source && o.payload?.target ? `${targetLabel(String(o.payload.source))} → ${targetLabel(String(o.payload.target))}` : targetLabel(o.target);
  const overlayRows = allOverlays.map((o, i) => ({ o, i }));
  const overlayPage = usePage(overlayRows, ({ o }) => [t(locale, `overlay.${o.kind}` as StringKey), overlayTarget(o), o.payload?.label ?? o.payload?.constraintId ?? "", o.payload?.text ?? describeOverlay(o, locale)].join("\n"), query, pageSize, locale);
  const shows = (name: TableName) => tables.includes(name);

  return (
    <div className={`wf-table${className ? ` ${className}` : ""}`}>
      {pageSize !== undefined ? <input type="search" className="wf-table__search" aria-label={t(locale, "table.search")} value={query} onChange={(e) => setQuery(e.target.value)} /> : null}
      {shows("nodes") ? (
        <table {...nodePage.table}>
          <caption>{t(locale, "table.caption.nodes")}</caption>
          <thead>
            <tr {...nodePage.head}>
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
            {nodePage.rows.map((n, i) => (
              <tr key={n.id} {...nodePage.row(i)} className={selection?.nodes.includes(n.id) ? "wf-row--selected" : undefined} onClick={(e) => choose({ kind: "node", id: n.id }, e)} tabIndex={onSelect ? 0 : undefined} onKeyDown={(e) => e.key === "Enter" && choose({ kind: "node", id: n.id }, e)}>
                <th scope="row">
                  <span className="wf-swatch" style={{ background: sc.nodeColor(n) }} aria-hidden="true" />
                  {n.label}
                </th>
                <td>{kindLabel(n.kind)}</td>
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
      {shows("nodes") ? nodePage.pager : null}
      {shows("edges") ? (
        <table {...edgePage.table}>
          <caption>{t(locale, "table.caption.edges")}</caption>
          <thead>
            <tr {...edgePage.head}>
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
            {edgePage.rows.map((e, i) => (
              <tr key={e.id} {...edgePage.row(i)} className={selection?.edges.includes(e.id) ? "wf-row--selected" : undefined} onClick={(ev) => choose({ kind: "edge", id: e.id }, ev)} tabIndex={onSelect ? 0 : undefined} onKeyDown={(ev) => ev.key === "Enter" && choose({ kind: "edge", id: e.id }, ev)}>
                <th scope="row">{labelOf.get(e.source) ?? e.source}</th>
                <td>{labelOf.get(e.target) ?? e.target}</td>
                <td>{kindLabel(e.kind)}</td>
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
      {shows("edges") ? edgePage.pager : null}
      {shows("overlays") ? (
        <table {...overlayPage.table}>
          <caption>{t(locale, "table.caption.overlays")}</caption>
          <thead>
            <tr {...overlayPage.head}>
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
            {overlayPage.rows.map(({ o, i }, at) => (
              <tr key={`${o.kind}-${o.target}-${i}`} {...overlayPage.row(at)}>
                <th scope="row">{t(locale, `overlay.${o.kind}` as StringKey)}</th>
                <td>{overlayTarget(o)}</td>
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
      {shows("overlays") ? overlayPage.pager : null}
    </div>
  );
}
