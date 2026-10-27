import { scaleLinear, scaleTime } from "d3-scale";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { type Locale, colorTokens, contrastText, dimensionTokens, formatNumber, hashKey, opacityTokens, orderedCategorical, palettes, radiusTokens, strokeTokens, t, textTokens } from "../core/index.js";
import { part } from "./parts.js";

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
  /** Optional explicit colour for an event; undefined keeps the usual stage or activity palette. */
  eventColor?: (event: TraceEvent) => string | undefined;
  onSelect?: (caseId: string, eventIndex: number) => void;
  /** Show the table alternative instead of the drawing. */
  table?: boolean;
  className?: string;
  /**
   * The cases along a horizontal axis, one row each (default), or down a
   * vertical ruler, one column each, from the first event (0.5): ticks in
   * hours or days from it, each event a paper ring with its colour's dot and
   * its activity beside it.
   */
  orientation?: "horizontal" | "vertical";
  /** The drawing's height on a vertical timeline (0.5). Default 640. */
  height?: number;
  /** ▶ Start and ■ End rings at the ends of each case's line (0.5). */
  terminals?: boolean;
  /**
   * Events of a case that follow within this many milliseconds of the first
   * of them drawn as one ring, labelled "9 events · SRM: Created" (0.5);
   * the table keeps every event. Default none.
   */
  clusterMs?: number;
  /**
   * How events are drawn as one ring (0.6): within `clusterMs` of the first
   * of a run (`window`, the default), or in the same calendar minute in
   * `timeZone` (`minute`, `clusterMs` not read), as a table's "same minute".
   */
  clusterBy?: "window" | "minute";
  /** The IANA zone the times are printed in, named in the description (0.5). Default UTC. */
  timeZone?: string;
  /**
   * The stages `colorKey` returns, in order (0.5): each takes its colour of
   * the categorical palette in this order (`orderedCategorical`), an event
   * whose key is none of them the strong line colour.
   */
  stages?: readonly string[];
}

const LEFT = 140;
const RIGHT = 24;
const TOP = 28;
// A vertical timeline: the ruler's x, the first case's column and the least width of one, its margins.
const V_RULER = 72;
const V_FIRST = 120;
const V_COLUMN = 240;
const V_TOP = 40;
const V_BOTTOM = 24;
const V_GAP = 16;

const least = (values: readonly number[]) => values.reduce((m, v) => Math.min(m, v), Infinity);
const greatest = (values: readonly number[]) => values.reduce((m, v) => Math.max(m, v), -Infinity);

function toMs(ts: TraceEvent["timestamp"]): number {
  return ts instanceof Date ? ts.getTime() : typeof ts === "number" ? new Date(ts).getTime() : Date.parse(ts);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function formatTime(ms: number, timeZone?: string): string {
  if (!Number.isFinite(ms)) return "–";
  if (!timeZone) return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
  // The zone's wall time, written as the UTC times are: 2018-03-01 10:00.
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
  }
}

/** Whether the runtime knows the zone. */
function knownZone(timeZone: string | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function describeEvent(event: TraceEvent, ms: number, locale: Locale, timeZone?: string): string {
  return `${event.activity}\n${formatTime(ms, timeZone)}${event.violates?.length ? `\n${t(locale, "timeline.violates")}: ${event.violates.join(", ")}` : ""}`;
}

function colorFor(key: string): string {
  return palettes.categorical[hashKey(key) % palettes.categorical.length];
}

const DAY = 86400000;
const HOUR = 3600000;
const MINUTE = 60000;

function days(ms: number, locale: Locale): string {
  return Number.isFinite(ms) ? formatNumber(ms / DAY, 1, locale) : "–";
}

/**
 * Runs of a case's events, in their order, that start within `clusterMs` of
 * their first, or, with `key`, that follow one another with the same key (a
 * calendar minute); every event its own without either.
 */
export function eventClusters(times: readonly number[], clusterMs?: number, key?: (ms: number) => string): number[][] {
  const out: number[][] = [];
  times.forEach((ms, i) => {
    const run = out[out.length - 1];
    const first = run ? times[run[0]] : NaN;
    if (key) {
      if (run && Number.isFinite(ms) && Number.isFinite(first) && key(ms) === key(times[run[run.length - 1]])) run.push(i);
      else out.push([i]);
      return;
    }
    if (run && clusterMs !== undefined && clusterMs > 0 && Number.isFinite(ms) && Number.isFinite(first) && ms >= first && ms - first <= clusterMs) run.push(i);
    else out.push([i]);
  });
  return out;
}

/**
 * Events per case on a time axis, optionally aligned at an anchor activity,
 * with violated constraints marked on the events and spans annotated.
 */
export function TraceTimeline({ traces, anchor, annotations = [], locale = "en", width = 900, rowHeight = 28, colorKey, eventColor, onSelect, table = false, className, orientation = "horizontal", height: givenHeight, terminals = false, clusterMs, clusterBy = "window", timeZone: givenZone, stages }: TraceTimelineProps) {
  const id = useId();
  const [hover, setHover] = useState<{ caseId: string; index: number; event: TraceEvent; at?: { x: number; y: number } } | null>(null);
  const keyOf = colorKey ?? ((e: TraceEvent) => e.canonicalId ?? e.activity);
  const timeZone = knownZone(givenZone) ? givenZone : undefined;
  const formatAt = (ms: number) => formatTime(ms, timeZone);
  // Stages in their order take the palette's colours; a key that is no stage the strong line colour.
  const stageColors = useMemo(() => (stages ? orderedCategorical(stages) : undefined), [stages]);
  const fillOf = (e: TraceEvent) => {
    const explicit = eventColor?.(e);
    if (explicit !== undefined) return explicit;
    const key = keyOf(e);
    return stageColors ? stageColors.get(key)?.color ?? colorTokens.lineStrong : colorFor(key);
  };
  const vertical = orientation === "vertical";

  const rows = useMemo(() => {
    return traces.map((trace) => {
      const times = trace.events.map((e) => toMs(e.timestamp));
      const anchorIndex = anchor ? trace.events.findIndex((e) => e.canonicalId === anchor || e.activity === anchor) : -1;
      const validTimes = times.filter(Number.isFinite);
      const offset = !anchor ? 0 : Number.isFinite(times[anchorIndex]) ? times[anchorIndex] : validTimes.length ? least(validTimes) : 0;
      return { trace, times, anchorIndex, rel: times.map((tm) => (tm - offset) / 86400000), first: validTimes.length ? least(validTimes) : NaN };
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
  const description = `${t(locale, "timeline.description", { traces: traces.length, events: totalEvents })}${anchor ? ` ${t(locale, "timeline.anchor", { anchor })}.` : ""}${timeZone ? ` ${t(locale, "timeline.zone", { zone: timeZone })}` : ""}`;
  const selectWithKeyboard = (event: KeyboardEvent, caseId: string, index: number) => {
    if (onSelect && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onSelect(caseId, index);
    }
  };

  if (table) {
    return (
      <div className={`wf-table wf-trace-timeline${className ? ` ${className}` : ""}`} {...part("timeline")}>
        <table>
          <caption>{description}</caption>
          <thead>
            <tr>
              <th scope="col">{t(locale, "timeline.case")}</th>
              <th scope="col">{t(locale, "timeline.time")}</th>
              {anchor ? <th scope="col" className="wf-num">{t(locale, "timeline.days")}</th> : null}
              {vertical ? <th scope="col" className="wf-num">{t(locale, "timeline.elapsed")}</th> : null}
              {vertical ? <th scope="col" className="wf-num">{t(locale, "timeline.wait")}</th> : null}
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
                  <td>{formatAt(row.times[i])}</td>
                  {anchor ? <td className="wf-num">{formatNumber(row.rel[i], 1, locale)}</td> : null}
                  {vertical ? <td className="wf-num">{days(row.times[i] - row.first, locale)}</td> : null}
                  {vertical ? <td className="wf-num">{i === 0 ? "" : days(row.times[i] - row.times[i - 1], locale)}</td> : null}
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

  if (vertical) {
    const height = givenHeight ?? 640;
    const ring = dimensionTokens.timelineRing / 2;
    // The terminals' rings sit at the ruler's ends, the events between them.
    const end = terminals ? 2 * ring + V_GAP : 0;
    const placed = rows.flatMap((r) => r.times).filter(Number.isFinite);
    const lo = placed.length ? least(placed) : 0;
    const span = placed.length ? greatest(placed) - lo || HOUR : DAY;
    const y = scaleLinear().domain([0, span]).range([V_TOP + end, height - V_BOTTOM - end]);
    // Ticks from the first event in minutes over at most two hours, in hours over at most two days, else in days;
    // a step under one in as many decimals as it needs.
    const unit = span <= 2 * HOUR ? MINUTE : span <= 2 * DAY ? HOUR : DAY;
    const ticks = scaleLinear().domain([0, span / unit]).ticks(8);
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const digits = step < 1 ? Math.min(3, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
    const column = Math.max(V_COLUMN, (width - V_FIRST) / Math.max(1, rows.length));
    const enter = (caseId: string, index: number, event: TraceEvent, at: { x: number; y: number }) => setHover({ caseId, index, event, at });
    return (
      <div className={`wf-trace-timeline wf-trace-timeline--vertical${className ? ` ${className}` : ""}`} {...part("timeline")} style={{ position: "relative", width }}>
        <svg width={width} height={height} role={onSelect ? "group" : "img"} aria-labelledby={`${id}-desc`}>
          <title id={`${id}-desc`}>{description}</title>
          <g className="wf-axis">
            <path d={`M${V_RULER} ${y(0)}V${y(span)}`} fill="none" />
            {(placed.length ? ticks : []).map((tick) => (
              <g key={tick} transform={`translate(${V_RULER} ${y(tick * unit)})`}>
                <line x2={width - V_RULER} strokeOpacity={opacityTokens.timelineGrid} />
                <text x={-8} y={4} textAnchor="end">
                  {`${formatNumber(tick, Number.isInteger(tick) ? 0 : digits, locale)} ${t(locale, tick === 1 ? (unit === MINUTE ? "timeline.minute" : unit === HOUR ? "timeline.hour" : "timeline.day") : unit === MINUTE ? "timeline.minutes" : unit === HOUR ? "timeline.hours" : "timeline.days")}`}
                </text>
              </g>
            ))}
          </g>
          {rows.map((row, r) => {
            const x = V_FIRST + r * column;
            const runs = clusterBy === "minute" ? eventClusters(row.times, undefined, formatAt) : eventClusters(row.times, clusterMs);
            // Each ring at its time, moved down where it would touch the ring before it (same-day events), and the whole run back up where that passes the ruler's end.
            const ys = row.times.map((ms) => y(ms - lo));
            const firsts = runs.map((run) => run[0]).filter((i) => Number.isFinite(row.times[i]));
            firsts.forEach((i, k) => {
              if (k > 0) ys[i] = Math.max(ys[i], ys[firsts[k - 1]] + 2 * ring + V_GAP / 4);
            });
            const over = firsts.length ? ys[firsts[firsts.length - 1]] - y(span) : 0;
            if (over > 0) for (let k = firsts.length - 1; k >= 0; k--) {
              const i = firsts[k];
              ys[i] = k === firsts.length - 1 ? ys[i] - over : Math.min(ys[i], ys[firsts[k + 1]] - 2 * ring - V_GAP / 4);
            }
            const shown = ys.filter((_, i) => Number.isFinite(row.times[i]));
            const [top, bottom] = terminals ? [V_TOP + ring, height - V_BOTTOM - ring] : [least(shown), greatest(shown)];
            return (
              <g key={row.trace.caseId} className="wf-row">
                <text className="wf-row-label" x={x - ring} y={V_TOP - V_GAP} textAnchor="start">
                  {row.trace.caseId}
                </text>
                {Number.isFinite(top) && Number.isFinite(bottom) && bottom > top ? <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--wf-line)" /> : null}
                {terminals
                  ? (["start", "end"] as const).map((kind) => (
                      <g key={kind} className={`wf-terminal wf-terminal--${kind}`}>
                        <circle cx={x} cy={kind === "start" ? top : bottom} r={ring} />
                        <text x={x} y={(kind === "start" ? top : bottom) + 4} textAnchor="middle">{kind === "start" ? "▶" : "■"}</text>
                        <text className="wf-event-label" x={x + ring + 8} y={(kind === "start" ? top : bottom) + 4}>{t(locale, `terminal.${kind}`)}</text>
                      </g>
                    ))
                  : null}
                {runs.map((run) => {
                  const i = run[0];
                  if (!Number.isFinite(row.times[i])) return null;
                  const e = row.trace.events[i];
                  const cy = ys[i];
                  const violates = run.some((j) => (row.trace.events[j].violates ?? []).length > 0);
                  const label = run.length > 1 ? t(locale, "timeline.cluster", { count: formatNumber(run.length, 0, locale), activity: e.activity }) : e.activity;
                  const said = `${row.trace.caseId}: ${run.length > 1 ? `${label}\n${formatAt(row.times[i])}` : describeEvent(e, row.times[i], locale, timeZone)}`;
                  return (
                    <g key={i} {...(run.length > 1 && part("timeline-cluster"))}>
                      <title>{said}</title>
                      <circle
                        className={`wf-event wf-event--ring${violates ? " wf-event--violates" : ""}`}
                        {...part("timeline-event")}
                        cx={x}
                        cy={cy}
                        r={ring}
                        role={onSelect ? "button" : undefined}
                        aria-label={onSelect ? said : undefined}
                        tabIndex={onSelect ? 0 : undefined}
                        onMouseEnter={() => enter(row.trace.caseId, i, e, { x, y: cy })}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => enter(row.trace.caseId, i, e, { x, y: cy })}
                        onBlur={() => setHover(null)}
                        onClick={() => onSelect?.(row.trace.caseId, i)}
                        onKeyDown={(event) => selectWithKeyboard(event, row.trace.caseId, i)}
                      />
                      <circle className="wf-event-dot" cx={x} cy={cy} r={dimensionTokens.timelineDot / 2} fill={fillOf(e)} pointerEvents="none" />
                      <text className="wf-event-label" x={x + ring + 8} y={cy + 4} pointerEvents="none">
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        {unplacedEvents > 0 ? <p>{t(locale, "timeline.unplaced", { count: unplacedEvents })}</p> : null}
        {hover && hoveredRow && hover.at ? (
          <div className="wf-tooltip" {...part("tooltip")} style={{ left: Math.min(hover.at.x + 2 * ring, width - 200), top: hover.at.y + ring }} role="status">
            {describeEvent(hover.event, hoveredRow.times[hover.index], locale, timeZone)}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`wf-trace-timeline${className ? ` ${className}` : ""}`} {...part("timeline")} style={{ position: "relative", width }}>
      <svg width={width} height={height} role={onSelect ? "group" : "img"} aria-labelledby={`${id}-desc`}>
        <title id={`${id}-desc`}>{description}</title>
        <g className="wf-axis">
          <path d={`M${LEFT} ${TOP - 6}H${LEFT + innerWidth}`} fill="none" />
          {(totalEvents > unplacedEvents ? ticks : []).map((tick, i) => {
            const tx = tickX(tick);
            return (
              <g key={i} transform={`translate(${tx} ${TOP - 6})`}>
                <line y2={height - TOP} strokeOpacity={opacityTokens.timelineGrid} />
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
                    <path d={`M${from} ${y + 4}V${y}H${to}V${y + 4}`} fill="none" stroke="var(--wf-fail)" strokeWidth={strokeTokens.timelineSpan} />
                    <text x={(from + to) / 2} y={y - 2} textAnchor="middle">
                      {a.label ?? a.constraintId}
                    </text>
                  </g>
                );
              })}
              {row.trace.events.map((e, i) => {
                if (!Number.isFinite(row.times[i])) return null;
                const fill = fillOf(e);
                const violates = (e.violates ?? []).length > 0;
                return (
                  <g key={i}>
                    <title>{describeEvent(e, row.times[i], locale, timeZone)}</title>
                    <circle
                      className={`wf-event${violates ? " wf-event--violates" : ""}`}
                      {...part("timeline-event")}
                      cx={xs[i]}
                      cy={cy}
                      r={violates ? radiusTokens.timelineViolation : radiusTokens.timelineEvent}
                      fill={fill}
                      role={onSelect ? "button" : undefined}
                      aria-label={onSelect ? `${row.trace.caseId}: ${describeEvent(e, row.times[i], locale, timeZone)}` : undefined}
                      tabIndex={onSelect ? 0 : undefined}
                      onMouseEnter={() => setHover({ caseId: row.trace.caseId, index: i, event: e })}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover({ caseId: row.trace.caseId, index: i, event: e })}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelect?.(row.trace.caseId, i)}
                      onKeyDown={(event) => selectWithKeyboard(event, row.trace.caseId, i)}
                    />
                    {violates ? (
                      <text x={xs[i]} y={cy + 3} textAnchor="middle" fontSize={textTokens.timelineMark.size} fill={contrastText(fill)} pointerEvents="none">
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
        <div className="wf-tooltip" {...part("tooltip")} style={{ left: Math.min(xOf(hoveredRow, hover.index) + 10, width - 200), top: TOP + rows.indexOf(hoveredRow) * rowHeight + rowHeight / 2 + 10 }} role="status">
          {describeEvent(hover.event, hoveredRow.times[hover.index], locale, timeZone)}
        </div>
      ) : null}
    </div>
  );
}
