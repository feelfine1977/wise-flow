import { useId, useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { formatCount, formatNumber, hashKey, palettes, type Locale } from "../core/index.js";

export interface VariantMatrixRow {
  id: string;
  activities: readonly (string | null)[];
  count: number;
}
export interface VariantMatrixProps {
  rows: readonly VariantMatrixRow[];
  /** All selected cases, including selected cases without events. */
  totalCases: number;
  zeroEventCases?: number;
  selectedId?: string;
  /** Inspect an existing exact sequence; never implicitly applies a case filter. */
  onInspect?: (id: string) => void;
  maxSteps?: number;
  locale?: Locale;
}

/** Aligned observed sequences retain repeated activities and the selected-case denominator. */
export function VariantMatrix({ rows, totalCases, zeroEventCases, selectedId, onInspect, maxSteps = 18, locale = "en" }: VariantMatrixProps) {
  const id = useId();
  const [focused, setFocused] = useState<string>();
  const valid = rows.every(row => Number.isSafeInteger(row.count) && row.count >= 0) && Number.isSafeInteger(totalCases) && totalCases >= 0;
  const covered = rows.reduce((sum, row) => sum + row.count, 0);
  const activities = [...new Set(rows.flatMap(row => row.activities))];
  const columns = Math.min(Number.isFinite(maxSteps) ? Math.max(1, Math.floor(maxSteps)) : 18, Math.max(1, ...rows.map(row => row.activities.length)));
  const width = Math.max(680, columns * 42 + 310);
  const x = scaleBand<number>().domain(Array.from({ length: columns }, (_, index) => index)).range([130, width - 190]).padding(.1);
  const support = scaleLinear().domain([0, Math.max(1, totalCases)]).range([0, 92]);
  const focusId = rows.some(row => row.id === focused) ? focused : rows[0]?.id;
  const share = (count: number) => totalCases === 0 ? "—" : count > 0 && count / totalCases < .001 ? "<0.1%" : `${formatNumber(count / totalCases * 100, 1, locale)}%`;
  const description = (row: VariantMatrixRow) => `${formatCount(row.count, locale)} cases (${share(row.count)} of selected): ${row.activities.map(activity => activity ?? "Missing activity").join(" → ") || "No events"}`;
  return <section className="wf-variant-matrix" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>{locale === "de" ? "Beobachtete vollständige Pfade" : "Observed exact paths"}</h3>
    <p>{locale === "de" ? "Spalten sind Ereignispositionen, keine Zeitabstände." : "Columns are event positions, not elapsed time. Repeated steps stay visible. Select a row to inspect its complete path."}</p>
    {!valid || covered > totalCases || new Set(rows.map(row => row.id)).size !== rows.length || (zeroEventCases !== undefined && (!Number.isSafeInteger(zeroEventCases) || zeroEventCases < 0 || zeroEventCases > totalCases - covered)) ? <p role="status">Exact path counts do not reconcile with the selected population. The matrix is unavailable.</p> : <>
      <div className="wf-variant-matrix__scroll" role="region" aria-label="Exact path sequence matrix" tabIndex={0}>
        <svg viewBox={`0 0 ${width} ${rows.length * 42 + 56}`} style={{ minWidth: width }} role="group" aria-label="Observed sequences and case shares">
          <text x={12} y={20}>Path</text><text x={130} y={20}>Event position →</text><text x={width - 178} y={20}>Cases / selected</text>
          {rows.map((row, index) => <g key={row.id} role={onInspect ? "button" : undefined} tabIndex={onInspect ? row.id === focusId ? 0 : -1 : undefined}
            aria-label={`Inspect path ${index + 1}: ${description(row)}`} aria-pressed={onInspect ? row.id === selectedId : undefined} data-variant-id={row.id}
            onFocus={() => setFocused(row.id)} onClick={() => onInspect?.(row.id)} onKeyDown={event => {
              if (!onInspect) return;
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!event.repeat) onInspect(row.id); }
              const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : event.key === "ArrowUp" ? Math.max(0, index - 1) : -1;
              if (next >= 0) { event.preventDefault(); event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>("[data-variant-id]")[next]?.focus(); }
            }} transform={`translate(0,${index * 42 + 32})`}>
            <title>{description(row)}</title>
            <rect className="wf-variant-matrix__row" x={1} y={0} width={width - 2} height={38} rx={5} fill={row.id === selectedId ? "var(--wf-selection)" : "var(--wf-paper)"} />
            <text x={12} y={23}>{locale === "de" ? "Pfad" : "Path"} {index + 1}</text>
            {row.activities.slice(0, columns).map((activity, step) => <g key={step} aria-hidden="true">
              <rect x={x(step)} y={4} width={x.bandwidth()} height={30} rx={4} fill="var(--wf-surface)" stroke={activity === null ? "var(--wf-line-strong)" : palettes.categorical[hashKey(activity) % palettes.categorical.length]} strokeDasharray={activity === null ? "3 2" : undefined} />
              <text x={(x(step) ?? 0) + x.bandwidth() / 2} y={23} textAnchor="middle">{activity === null ? "?" : activities.indexOf(activity) + 1}</text>
              <title>{`${step + 1}. ${activity ?? "Missing activity"}`}</title>
            </g>)}
            {row.activities.length > columns && <text x={width - 187} y={23} textAnchor="end">…</text>}
            <rect x={width - 178} y={27} width={support(row.count)} height={5} rx={2} fill="var(--wf-focus)" />
            <text x={width - 178} y={19}>{formatCount(row.count, locale)} · {share(row.count)}</text>
          </g>)}
        </svg>
      </div>
      <p>{formatCount(covered, locale)} / {formatCount(totalCases, locale)} selected cases shown · {formatCount(totalCases - covered, locale)} outside the displayed paths{zeroEventCases !== undefined ? ` (including ${formatCount(zeroEventCases, locale)} without events)` : ""}. {rows.some(row => row.activities.length > columns) && `Only the first ${columns} positions fit here; complete sequences are in the table and path details.`}</p>
      <ol className="wf-variant-matrix__key">{activities.map((activity, index) => <li key={JSON.stringify(activity)}><strong>{activity === null ? "?" : index + 1}</strong> {activity ?? "Missing activity"}</li>)}</ol>
      <details><summary>{locale === "de" ? "Genaue Pfade" : "Exact path table"}</summary>
        <table><caption>Complete ordered sequences, including repeats</caption><thead><tr><th scope="col">Path</th><th scope="col">Activity sequence</th><th scope="col">Cases</th><th scope="col">Selected share</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.id}><th scope="row">{onInspect ? <button type="button" className="wf-button" onClick={() => onInspect(row.id)}>Inspect path {index + 1}</button> : index + 1}</th><td>{row.activities.map(activity => activity ?? "Missing activity").join(" → ") || "No events"}</td><td>{formatCount(row.count, locale)}</td><td>{share(row.count)}</td></tr>)}</tbody>
        </table>
      </details>
    </>}
  </section>;
}
