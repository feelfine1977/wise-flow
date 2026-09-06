import { useMemo, useState } from "react";
import {
  type ActivityPaths,
  type FlowGraph,
  type FlowPaths,
  type Focus,
  type Locale,
  type PathRow,
  type PathSortKey,
  type Selection,
  type StringKey,
  formatCount,
  formatHours,
  formatShare,
  indexGraph,
  pathBetween,
  pathRows,
  pathsFor,
  t,
} from "../core/index";

export interface PathListProps {
  graph: FlowGraph;
  /** An activity (or stage) id, or two activity ids for the path between them. */
  focus: Focus;
  /** Paths from the API response; defaults to `graph.paths`, else computed from the graph. */
  paths?: FlowPaths;
  locale?: Locale;
  selection?: Selection;
  /** A row click selects the path (its edge, or its two endpoints when the edge is not in the map). */
  onSelect?: (selection: Selection) => void;
  onHover?: (id: string | null) => void;
  onClose?: () => void;
  sort?: PathSortKey;
  ascending?: boolean;
  onSortChange?: (sort: PathSortKey, ascending: boolean) => void;
  className?: string;
}

type Column = { key: PathSortKey; label: StringKey; numeric: boolean };

const COLUMNS: Column[] = [
  { key: "count", label: "metric.count", numeric: true },
  { key: "cases", label: "metric.cases", numeric: true },
  { key: "medianLagHours", label: "metric.medianLagHours", numeric: true },
  { key: "p90LagHours", label: "metric.p90LagHours", numeric: true },
  { key: "violationShare", label: "metric.violationShare", numeric: true },
];

function cell(row: PathRow, key: PathSortKey, locale: Locale): string {
  switch (key) {
    case "count":
      return row.count !== undefined ? formatCount(row.count, locale) : "–";
    case "cases":
      return row.cases !== undefined ? `${formatCount(row.cases, locale)}${row.share !== undefined ? ` (${formatShare(row.share, locale)})` : ""}` : row.share !== undefined ? formatShare(row.share, locale) : "–";
    case "medianLagHours":
      return row.medianLagHours !== undefined ? formatHours(row.medianLagHours, locale) : "–";
    case "p90LagHours":
      return row.p90LagHours !== undefined ? formatHours(row.p90LagHours, locale) : "–";
    case "violationShare":
      return row.violationShare !== undefined ? formatShare(row.violationShare, locale) : "–";
    default:
      return "";
  }
}

function sortRows(rows: PathRow[], key: PathSortKey, ascending: boolean, labelOf: (id: string) => string, other: (r: PathRow) => string): PathRow[] {
  const dir = ascending ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "label") return dir * labelOf(other(a)).localeCompare(labelOf(other(b)));
    const va = a[key];
    const vb = b[key];
    if (va === undefined && vb === undefined) return 0;
    if (va === undefined) return 1;
    if (vb === undefined) return -1;
    return dir * (va - vb);
  });
}

interface TableProps {
  caption: string;
  rows: PathRow[];
  /** Column header of the other endpoint. */
  otherHeader: string;
  other: (r: PathRow) => string;
  total?: number;
  sortKey: PathSortKey;
  ascending: boolean;
  onSort: (key: PathSortKey) => void;
  locale: Locale;
  labelOf: (id: string) => string;
  selection?: Selection;
  onSelect?: (s: Selection) => void;
  onHover?: (id: string | null) => void;
  emptyText: string;
}

function PathTable({ caption, rows, otherHeader, other, total, sortKey, ascending, onSort, locale, labelOf, selection, onSelect, onHover, emptyText }: TableProps) {
  const sorted = useMemo(() => sortRows(rows, sortKey, ascending, labelOf, other), [rows, sortKey, ascending, labelOf, other]);
  const ariaSort = (key: PathSortKey): "ascending" | "descending" | "none" => (sortKey === key ? (ascending ? "ascending" : "descending") : "none");
  const select = (r: PathRow) => {
    if (!onSelect) return;
    if (r.edgeId) onSelect({ nodes: [], edges: [r.edgeId], groups: [] });
    else onSelect({ nodes: [r.from, r.to], edges: [], groups: [] });
  };
  const header = (key: PathSortKey, label: string, numeric: boolean) => (
    <th key={key} scope="col" className={numeric ? "wf-num" : undefined} aria-sort={ariaSort(key)}>
      <button type="button" className="wf-paths__sort" onClick={() => onSort(key)} title={t(locale, "paths.sortedBy", { column: label, direction: t(locale, sortKey === key && ascending ? "paths.descending" : "paths.ascending") })}>
        {label}
        <span aria-hidden="true">{sortKey === key ? (ascending ? " ▲" : " ▼") : ""}</span>
      </button>
    </th>
  );
  return (
    <table>
      <caption>
        {caption} <span className="wf-paths__count">({t(locale, "paths.rows", { count: rows.length })})</span>
      </caption>
      <thead>
        <tr>
          {header("label", otherHeader, false)}
          {COLUMNS.map((c) => header(c.key, t(locale, c.label), c.numeric))}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td colSpan={1 + COLUMNS.length}>{emptyText}</td>
          </tr>
        ) : null}
        {sorted.map((r) => {
          const selected = !!selection && ((r.edgeId && selection.edges.includes(r.edgeId)) || (!r.edgeId && selection.nodes.includes(r.from) && selection.nodes.includes(r.to)));
          return (
            <tr
              key={r.edgeId ?? `${r.from}->${r.to}`}
              className={`${selected ? "wf-row--selected" : ""}${r.reconnected ? " wf-row--reconnected" : ""}`.trim() || undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={() => select(r)}
              onKeyDown={(e) => e.key === "Enter" && select(r)}
              onMouseEnter={() => onHover?.(r.edgeId ?? null)}
              onMouseLeave={() => onHover?.(null)}
              data-edge={r.edgeId}
            >
              <th scope="row">{labelOf(other(r))}</th>
              {COLUMNS.map((c) => (
                <td key={c.key} className="wf-num">
                  {cell(r, c.key, locale)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      {total !== undefined && rows.length > 0 ? (
        <tfoot>
          <tr>
            <th scope="row">{t(locale, "paths.total")}</th>
            <td className="wf-num">{formatCount(total, locale)}</td>
            <td colSpan={COLUMNS.length - 1} />
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

/**
 * Side list of the paths of an activity: incoming and outgoing paths with
 * transitions, cases (share of the activity's cases), median and 90th
 * percentile lag and the expectation shortfall on each path, sortable, with
 * totals that add up to the activity's in- and out-counts. With two
 * activities it lists the path between them and the reverse path. Rows
 * select and hover the path on the map; the list is a table, so it is its
 * own accessible alternative.
 */
export function PathList({ graph, focus, paths, locale = "en", selection, onSelect, onHover, onClose, sort, ascending, onSortChange, className }: PathListProps) {
  const [innerSort, setInnerSort] = useState<{ key: PathSortKey; ascending: boolean }>({ key: "count", ascending: false });
  const sortKey = sort ?? innerSort.key;
  const sortAsc = ascending ?? innerSort.ascending;
  const onSort = (key: PathSortKey) => {
    const asc = key === sortKey ? !sortAsc : key === "label";
    if (sort === undefined) setInnerSort({ key, ascending: asc });
    onSortChange?.(key, asc);
  };
  const idx = useMemo(() => indexGraph(graph), [graph]);
  const labelOf = (id: string) => idx.nodes.get(id)?.label ?? idx.groups.get(id)?.label ?? id;

  if (typeof focus === "string") {
    const activity: ActivityPaths = pathsFor(graph, focus, { paths });
    const title = t(locale, "paths.title", { label: labelOf(focus) });
    return (
      <section className={`wf-paths wf-table${className ? ` ${className}` : ""}`} aria-label={title} data-source={activity.source}>
        <header className="wf-paths__header">
          <h3>{title}</h3>
          {onClose ? (
            <button type="button" className="wf-button wf-paths__close" onClick={onClose} aria-label={t(locale, "paths.close")}>
              ×
            </button>
          ) : null}
        </header>
        <p className="wf-paths__source">{t(locale, activity.source === "payload" ? "paths.source.payload" : "paths.source.graph")}</p>
        <PathTable caption={t(locale, "paths.incoming")} rows={activity.incoming} otherHeader={t(locale, "paths.from")} other={(r) => r.from} total={activity.totals.incoming} sortKey={sortKey} ascending={sortAsc} onSort={onSort} locale={locale} labelOf={labelOf} selection={selection} onSelect={onSelect} onHover={onHover} emptyText={t(locale, "paths.none")} />
        <PathTable caption={t(locale, "paths.outgoing")} rows={activity.outgoing} otherHeader={t(locale, "paths.to")} other={(r) => r.to} total={activity.totals.outgoing} sortKey={sortKey} ascending={sortAsc} onSort={onSort} locale={locale} labelOf={labelOf} selection={selection} onSelect={onSelect} onHover={onHover} emptyText={t(locale, "paths.none")} />
      </section>
    );
  }

  const [a, b] = focus;
  const between = pathBetween(graph, a, b);
  const forward = pathRows(graph, between, "forward");
  const reverse = pathRows(graph, between, "reverse");
  const title = t(locale, "paths.titlePair", { a: labelOf(a), b: labelOf(b) });
  const step = (r: PathRow) => `${labelOf(r.from)} → ${labelOf(r.to)}`;
  return (
    <section className={`wf-paths wf-table${className ? ` ${className}` : ""}`} aria-label={title} data-source="graph" data-found={between.found}>
      <header className="wf-paths__header">
        <h3>{title}</h3>
        {onClose ? (
          <button type="button" className="wf-button wf-paths__close" onClick={onClose} aria-label={t(locale, "paths.close")}>
            ×
          </button>
        ) : null}
      </header>
      <p className="wf-paths__source">
        {between.direct ? `${t(locale, "paths.direct")} · ` : ""}
        {t(locale, "paths.source.graph")}
      </p>
      <PathTable caption={t(locale, "paths.forward", { a: labelOf(a), b: labelOf(b) })} rows={forward} otherHeader={t(locale, "kind.follows")} other={(r) => r.edgeId ?? `${r.from}->${r.to}`} sortKey={sortKey} ascending={sortAsc} onSort={onSort} locale={locale} labelOf={(id) => stepById(forward, id, step)} selection={selection} onSelect={onSelect} onHover={onHover} emptyText={t(locale, "paths.notFound", { a: labelOf(a), b: labelOf(b) })} />
      {between.reverse ? (
        <PathTable caption={t(locale, "paths.reverse", { a: labelOf(a), b: labelOf(b) })} rows={reverse} otherHeader={t(locale, "kind.follows")} other={(r) => r.edgeId ?? `${r.from}->${r.to}`} sortKey={sortKey} ascending={sortAsc} onSort={onSort} locale={locale} labelOf={(id) => stepById(reverse, id, step)} selection={selection} onSelect={onSelect} onHover={onHover} emptyText={t(locale, "paths.none")} />
      ) : null}
    </section>
  );
}

function stepById(rows: PathRow[], id: string, step: (r: PathRow) => string): string {
  const r = rows.find((x) => (x.edgeId ?? `${x.from}->${x.to}`) === id);
  return r ? step(r) : id;
}
