import { scaleLinear, scaleTime } from "d3-scale";
import { useId, useMemo, useState } from "react";
import { type Locale, contrastText, formatNumber, hashKey, palettes, t } from "../core/index";

export interface TraceEvent {
  activity: string;
  canonicalId?: string;
  timestamp: string | number | Date;
  resource?: string;
  lifecycle?: string;
  /** Constraint ids this event violates. */
  violates?: string[];
}

export interface Trace {
  caseId: string;
  attributes?: Record<string, unknown>;
  events: TraceEvent[];
}

/** Annotation of a violated constraint between two events of a case. */
export interface Annotation {
  caseId: string;
  constraintId: string;
  label?: string;
  /** Index of the first event of the span. */
  from: number;
  /** Index of the last event of the span; equal to `from` for point annotations. */
  to?: number;
}

export interface TraceTimelineProps {
  traces: Trace[];
  /** Canonical id or label of the activity that aligns the cases at time zero. */
  anchor?: string;
  annotations?: Annotation[];
  locale?: Locale;
  width?: number;
  rowHeight?: number;
  /** Colour events by activity (default) or by a key of your own. */
  colorKey?: (event: TraceEvent) => string;
  onSelect?: (caseId: string, eventIndex: number) => void;
  /** Show the table alternative instead of the drawing. */
  table?: boolean;
  className?: string;
}

const LEFT = 140;
const RIGHT = 24;
const TOP = 28;

function toMs(ts: TraceEvent["timestamp"]): number {
  return ts instanceof Date ? ts.getTime() : typeof ts === "number" ? ts : Date.parse(ts);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function colorFor(key: string): string {
  return palettes.categorical[hashKey(key) % palettes.categorical.length];
}

/**
 * Events per case on a time axis, optionally aligned at an anchor activity,
 * with violated constraints marked on the events and spans annotated.
 */
export function TraceTimeline({ traces, anchor, annotations = [], locale = "en", width = 900, rowHeight = 28, colorKey, onSelect, table = false, className }: TraceTimelineProps) {
  const id = useId();
  const [hover, setHover] = useState<{ caseId: string; index: number; x: number; y: number } | null>(null);
  const keyOf = colorKey ?? ((e: TraceEvent) => e.canonicalId ?? e.activity);

  const rows = useMemo(() => {
    return traces.map((trace) => {
      const times = trace.events.map((e) => toMs(e.timestamp));
      const anchorIndex = anchor ? trace.events.findIndex((e) => e.canonicalId === anchor || e.activity === anchor) : -1;
      const offset = anchorIndex >= 0 ? times[anchorIndex] : anchor ? Math.min(...times) : 0;
      return { trace, times, anchorIndex, rel: times.map((tm) => (tm - offset) / 86400000) };
    });
  }, [traces, anchor]);

  const domain = useMemo(() => {
    if (anchor) {
      const all = rows.flatMap((r) => r.rel).filter(Number.isFinite);
      const lo = Math.min(0, ...all);
      const hi = Math.max(0, ...all);
      return [lo, hi === lo ? lo + 1 : hi] as [number, number];
    }
    const all = rows.flatMap((r) => r.times).filter(Number.isFinite);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    return [lo, hi === lo ? lo + 86400000 : hi] as [number, number];
  }, [rows, anchor]);

  const innerWidth = Math.max(100, width - LEFT - RIGHT);
  const linear = scaleLinear().domain(domain).range([LEFT, LEFT + innerWidth]);
  const time = scaleTime().domain([new Date(domain[0]), new Date(domain[1])]).range([LEFT, LEFT + innerWidth]);
  const xOf = (row: (typeof rows)[number], i: number): number => (anchor ? linear(row.rel[i]) : time(new Date(row.times[i])));
  const tickX = (tick: number | Date): number => (tick instanceof Date ? time(tick) : linear(tick));
  const height = TOP + rows.length * rowHeight + 24;
  const ticks: (number | Date)[] = anchor ? linear.ticks(8) : time.ticks(8);
  const tickLabel = (tick: number | Date) => (tick instanceof Date ? isoDate(tick.getTime()) : `${tick > 0 ? "+" : ""}${formatNumber(tick, 0, locale)} ${t(locale, "timeline.days")}`);
  const totalEvents = traces.reduce((n, tr) => n + tr.events.length, 0);
  const description = `${t(locale, "timeline.description", { traces: traces.length, events: totalEvents })}${anchor ? ` ${t(locale, "timeline.anchor", { anchor })}.` : ""}`;

  if (table) {
    return (
      <div className={`wf-table wf-trace-timeline${className ? ` ${className}` : ""}`}>
        <table>
          <caption>{description}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, "timeline.case")}</th>
              <th scope="col">{t(locale, "timeline.time")}</th>
              {anchor ? <th scope="col" className="wf-num">{t(locale, "timeline.days")}</th> : null}
              <th scope="col">{t(locale, "timeline.activity")}</th>
              <th scope="col">{t(locale, "timeline.violates")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) =>
              row.trace.events.map((e, i) => (
                <tr key={`${row.trace.caseId}-${i}`} onClick={() => onSelect?.(row.trace.caseId, i)}>
                  <th scope="row">{i === 0 ? row.trace.caseId : ""}</th>
                  <td>{Number.isFinite(row.times[i]) ? new Date(row.times[i]).toISOString().replace("T", " ").slice(0, 16) : "–"}</td>
                  {anchor ? <td className="wf-num">{formatNumber(row.rel[i], 1, locale)}</td> : null}
                  <td>{e.activity}</td>
                  <td>{(e.violates ?? []).join(", ")}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`wf-trace-timeline${className ? ` ${className}` : ""}`} style={{ position: "relative", width }}>
      <svg width={width} height={height} role="img" aria-labelledby={`${id}-desc`}>
        <title id={`${id}-desc`}>{description}</title>
        <g className="wf-axis">
          <path d={`M${LEFT} ${TOP - 6}H${LEFT + innerWidth}`} fill="none" />
          {ticks.map((tick, i) => {
            const tx = tickX(tick);
            return (
              <g key={i} transform={`translate(${tx} ${TOP - 6})`}>
                <line y2={height - TOP} strokeOpacity={0.4} />
                <text y={-8} textAnchor="middle">
                  {tickLabel(tick)}
                </text>
              </g>
            );
          })}
        </g>
        {anchor ? <line className="wf-anchor-line" x1={linear(0)} x2={linear(0)} y1={TOP - 6} y2={height - 24} /> : null}
        {rows.map((row, r) => {
          const cy = TOP + r * rowHeight + rowHeight / 2;
          const xs = row.trace.events.map((_, i) => xOf(row, i));
          const rowAnnotations = annotations.filter((a) => a.caseId === row.trace.caseId);
          return (
            <g key={row.trace.caseId} className="wf-row" transform={`translate(0 0)`}>
              <text className="wf-row-label" x={LEFT - 8} y={cy + 4} textAnchor="end">
                {row.trace.caseId}
              </text>
              {xs.length > 1 ? <line x1={Math.min(...xs)} x2={Math.max(...xs)} y1={cy} y2={cy} stroke="var(--wf-line)" /> : null}
              {rowAnnotations.map((a, i) => {
                const from = xs[a.from];
                const to = xs[a.to ?? a.from];
                if (from === undefined || to === undefined) return null;
                const y = cy - 12 - (i % 2) * 8;
                return (
                  <g key={`${a.constraintId}-${i}`} className="wf-annotation">
                    <title>{a.label ?? a.constraintId}</title>
                    <path d={`M${from} ${y + 4}V${y}H${to}V${y + 4}`} fill="none" stroke="var(--wf-fail)" strokeWidth={1.5} />
                    <text x={(from + to) / 2} y={y - 2} textAnchor="middle">
                      {a.label ?? a.constraintId}
                    </text>
                  </g>
                );
              })}
              {row.trace.events.map((e, i) => {
                const fill = colorFor(keyOf(e));
                const violates = (e.violates ?? []).length > 0;
                return (
                  <g key={i}>
                    <title>{`${e.activity}\n${Number.isFinite(row.times[i]) ? new Date(row.times[i]).toISOString().replace("T", " ").slice(0, 16) : ""}${violates ? `\n${t(locale, "timeline.violates")}: ${e.violates!.join(", ")}` : ""}`}</title>
                    <circle
                      className={`wf-event${violates ? " wf-event--violates" : ""}`}
                      cx={xs[i]}
                      cy={cy}
                      r={violates ? 6.5 : 5}
                      fill={fill}
                      onMouseEnter={() => setHover({ caseId: row.trace.caseId, index: i, x: xs[i], y: cy })}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => onSelect?.(row.trace.caseId, i)}
                    />
                    {violates ? (
                      <text x={xs[i]} y={cy + 3} textAnchor="middle" fontSize={8} fill={contrastText(fill)} pointerEvents="none">
                        !
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      {hover ? (
        <div className="wf-tooltip" style={{ left: Math.min(hover.x + 10, width - 200), top: hover.y + 10 }} role="status">
          {(() => {
            const row = rows.find((r) => r.trace.caseId === hover.caseId)!;
            const e = row.trace.events[hover.index];
            return `${e.activity}\n${new Date(row.times[hover.index]).toISOString().replace("T", " ").slice(0, 16)}${e.violates?.length ? `\n${t(locale, "timeline.violates")}: ${e.violates.join(", ")}` : ""}`;
          })()}
        </div>
      ) : null}
    </div>
  );
}
