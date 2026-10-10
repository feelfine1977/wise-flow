import { scaleLinear, scaleTime } from "d3-scale";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { type Locale, contrastText, formatNumber, hashKey, palettes, t } from "../core/index.js";

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

const least = (values: readonly number[]) => values.reduce((m, v) => Math.min(m, v), Infinity);
const greatest = (values: readonly number[]) => values.reduce((m, v) => Math.max(m, v), -Infinity);

function toMs(ts: TraceEvent["timestamp"]): number {
  return ts instanceof Date ? ts.getTime() : typeof ts === "number" ? new Date(ts).getTime() : Date.parse(ts);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatTime(ms: number): string {
  return Number.isFinite(ms) ? new Date(ms).toISOString().replace("T", " ").slice(0, 16) : "–";
}

function describeEvent(event: TraceEvent, ms: number, locale: Locale): string {
  return `${event.activity}\n${formatTime(ms)}${event.violates?.length ? `\n${t(locale, "timeline.violates")}: ${event.violates.join(", ")}` : ""}`;
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
  const [hover, setHover] = useState<{ caseId: string; index: number; event: TraceEvent } | null>(null);
  const keyOf = colorKey ?? ((e: TraceEvent) => e.canonicalId ?? e.activity);

  const rows = useMemo(() => {
    return traces.map((trace) => {
      const times = trace.events.map((e) => toMs(e.timestamp));
      const anchorIndex = anchor ? trace.events.findIndex((e) => e.canonicalId === anchor || e.activity === anchor) : -1;
      const validTimes = times.filter(Number.isFinite);
      const offset = !anchor ? 0 : Number.isFinite(times[anchorIndex]) ? times[anchorIndex] : validTimes.length ? least(validTimes) : 0;
      return { trace, times, anchorIndex, rel: times.map((tm) => (tm - offset) / 86400000) };
    });
  }, [traces, anchor]);

  // Index alone cannot identify an event after a cohort or trace replacement.
  const hoveredRow = hover ? rows.find((row) => row.trace.caseId === hover.caseId && row.trace.events[hover.index] === hover.event) : undefined;
  useEffect(() => {
    if (hover && (!hoveredRow || table)) setHover(null);
  }, [hover, hoveredRow, table]);

  const domain = useMemo(() => {
    if (anchor) {
      const all = rows.flatMap((r) => r.rel).filter(Number.isFinite);
      const lo = Math.min(0, least(all));
      const hi = Math.max(0, greatest(all));
      return [lo, hi === lo ? lo + 1 : hi] as [number, number];
    }
    const all = rows.flatMap((r) => r.times).filter(Number.isFinite);
    if (all.length === 0) return [0, 86400000] as [number, number];
    const lo = least(all);
    const hi = greatest(all);
    return [lo, hi === lo ? lo + 86400000 : hi] as [number, number];
  }, [rows, anchor]);

  const innerWidth = Math.max(100, width - LEFT - RIGHT);
  const linear = scaleLinear().domain(domain).range([LEFT, LEFT + innerWidth]);
  const time = scaleTime().domain([new Date(domain[0]), new Date(domain[1])]).range([LEFT, LEFT + innerWidth]);
  const xOf = (row: (typeof rows)[number], i: number): number => {
    const x = anchor ? linear(row.rel[i]) : time(new Date(row.times[i]));
    return Number.isFinite(x) ? x : LEFT;
  };
  const tickX = (tick: number | Date): number => (tick instanceof Date ? time(tick) : linear(tick));
  const height = TOP + rows.length * rowHeight + 24;
  const ticks: (number | Date)[] = anchor ? linear.ticks(8) : time.ticks(8);
  const tickLabel = (tick: number | Date) => (tick instanceof Date ? isoDate(tick.getTime()) : `${tick > 0 ? "+" : ""}${formatNumber(tick, 0, locale)} ${t(locale, "timeline.days")}`);
  const totalEvents = traces.reduce((n, tr) => n + tr.events.length, 0);
  const unplacedEvents = rows.reduce((n, row) => n + row.times.filter((ms) => !Number.isFinite(ms)).length, 0);
  const description = `${t(locale, "timeline.description", { traces: traces.length, events: totalEvents })}${anchor ? ` ${t(locale, "timeline.anchor", { anchor })}.` : ""}`;
  const selectWithKeyboard = (event: KeyboardEvent, caseId: string, index: number) => {
    if (onSelect && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelect(caseId, index);
    }
  };

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
                <tr
                  key={`${row.trace.caseId}-${i}`}
                  onClick={() => onSelect?.(row.trace.caseId, i)}
                  tabIndex={onSelect ? 0 : undefined}
                  onKeyDown={(event) => selectWithKeyboard(event, row.trace.caseId, i)}
                >
                  <th scope="row">{i === 0 ? row.trace.caseId : ""}</th>
                  <td>{formatTime(row.times[i])}</td>
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
      <svg width={width} height={height} role={onSelect ? "group" : "img"} aria-labelledby={`${id}-desc`}>
        <title id={`${id}-desc`}>{description}</title>
        <g className="wf-axis">
          <path d={`M${LEFT} ${TOP - 6}H${LEFT + innerWidth}`} fill="none" />
          {(totalEvents > unplacedEvents ? ticks : []).map((tick, i) => {
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
          const measuredXs = xs.filter((_, i) => Number.isFinite(row.times[i]));
          const rowAnnotations = annotations.filter((a) => a.caseId === row.trace.caseId);
          return (
            <g key={row.trace.caseId} className="wf-row" transform={`translate(0 0)`}>
              <text className="wf-row-label" x={LEFT - 8} y={cy + 4} textAnchor="end">
                {row.trace.caseId}
              </text>
              {measuredXs.length > 1 ? <line x1={least(measuredXs)} x2={greatest(measuredXs)} y1={cy} y2={cy} stroke="var(--wf-line)" /> : null}
              {rowAnnotations.map((a, i) => {
                const from = xs[a.from];
                const to = xs[a.to ?? a.from];
                if (from === undefined || to === undefined || !Number.isFinite(row.times[a.from]) || !Number.isFinite(row.times[a.to ?? a.from])) return null;
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
                if (!Number.isFinite(row.times[i])) return null;
                const fill = colorFor(keyOf(e));
                const violates = (e.violates ?? []).length > 0;
                return (
                  <g key={i}>
                    <title>{describeEvent(e, row.times[i], locale)}</title>
                    <circle
                      className={`wf-event${violates ? " wf-event--violates" : ""}`}
                      cx={xs[i]}
                      cy={cy}
                      r={violates ? 6.5 : 5}
                      fill={fill}
                      role={onSelect ? "button" : undefined}
                      aria-label={onSelect ? `${row.trace.caseId}: ${describeEvent(e, row.times[i], locale)}` : undefined}
                      tabIndex={onSelect ? 0 : undefined}
                      onMouseEnter={() => setHover({ caseId: row.trace.caseId, index: i, event: e })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ caseId: row.trace.caseId, index: i, event: e })}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelect?.(row.trace.caseId, i)}
                      onKeyDown={(event) => selectWithKeyboard(event, row.trace.caseId, i)}
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
      {unplacedEvents > 0 ? <p>{t(locale, "timeline.unplaced", { count: unplacedEvents })}</p> : null}
      {hover && hoveredRow ? (
        <div className="wf-tooltip" style={{ left: Math.min(xOf(hoveredRow, hover.index) + 10, width - 200), top: TOP + rows.indexOf(hoveredRow) * rowHeight + rowHeight / 2 + 10 }} role="status">
          {describeEvent(hover.event, hoveredRow.times[hover.index], locale)}
        </div>
      ) : null}
    </div>
  );
}
