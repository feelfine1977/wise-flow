import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { FlowGraph, FlowMeta } from "../core/index.js";

export interface FlowComparisonCohort {
  id: string;
  label: string;
  /** Number of distinct cases in this cohort, including cases without events. */
  cases: number;
  graph: FlowGraph;
}

export interface FlowComparisonProps {
  cohorts: FlowComparisonCohort[];
  /** Plural display name for cases, for example "orders". */
  noun?: string;
  onSelect?: (cohortId: string) => void;
}

type Mode = "activities" | "connections";
interface Entry {
  label: string;
  count: number | undefined;
  ambiguous?: boolean;
}
interface IndexedCohort {
  activities: Map<string, Entry>;
  connections: Map<string, Entry>;
  complete: boolean;
  cases: number;
}
interface Cell {
  count: number | null;
  percent: number | null;
  reason?: string;
}

const countFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const percentText = (value: number) => value > 0 && value < 0.1 ? "<0.1%" : value > 99.9 && value < 100 ? ">99.9%" : `${percentFormat.format(value)}%`;
const modes: Mode[] = ["activities", "connections"];
const modeLabels = { activities: "Activities", connections: "Direct connections" };
const validCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Nothing was removed by abstraction: the server reports the threshold `0`, or
 * `abstract` recorded zero thresholds or full detail shares for activities and
 * paths without collapsing stages. Anything else, including a partial record,
 * may have removed elements.
 */
function unabstracted(abstraction: FlowMeta["abstraction"]): boolean {
  if (typeof abstraction === "number") return abstraction === 0;
  if (!abstraction || typeof abstraction !== "object" || abstraction.collapse) return false;
  return (abstraction.minNodeShare === 0 && abstraction.minEdgeShare === 0) || (abstraction.activityDetail === 1 && abstraction.pathDetail === 1);
}

function addEntry(entries: Map<string, Entry>, key: string, entry: Entry) {
  // Distinct-case counts cannot be summed without knowing the overlap.
  entries.set(key, entries.has(key) ? { label: entry.label, count: undefined, ambiguous: true } : entry);
}

function indexCohort({ graph, cases }: FlowComparisonCohort): IndexedCohort {
  const activities = new Map<string, Entry>();
  const connections = new Map<string, Entry>();
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const node of graph.nodes) {
    if (seenIds.has(node.id)) duplicateIds.add(node.id);
    seenIds.add(node.id);
  }
  const activityNodes = graph.nodes.filter((node) => node.kind === "activity");
  for (const node of activityNodes) {
    addEntry(activities, node.label, { label: node.label, count: node.metrics?.cases });
  }
  let suppliedPairs = 0;
  let resolved = nodes.size === graph.nodes.length;
  for (const edge of graph.edges) {
    if (edge.kind !== "follows") continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target || duplicateIds.has(edge.source) || duplicateIds.has(edge.target)) {
      resolved = false;
      continue;
    }
    if (source?.kind !== "activity" || target?.kind !== "activity") continue;
    suppliedPairs++;
    const ambiguous = activities.get(source.label)?.ambiguous || activities.get(target.label)?.ambiguous;
    addEntry(connections, JSON.stringify([source.label, target.label]), {
      label: `${source.label} → ${target.label}`,
      count: edge.metrics?.cases,
      ambiguous,
    });
  }
  const meta = graph.meta;
  // Boundary connectors and non-follows edges cannot prove all activity pairs
  // were supplied. Missing totals or an abstraction that removed elements are not completeness.
  const complete = resolved && !!meta && unabstracted(meta.abstraction)
    && validCount(meta.nodesTotal) && meta.nodesTotal <= activityNodes.length
    && validCount(meta.edgesTotal) && meta.edgesTotal <= suppliedPairs;
  return { activities, connections, complete, cases };
}

function cellFor(cohort: IndexedCohort, entry: Entry | undefined): Cell {
  if (entry?.ambiguous) return { count: null, percent: null, reason: "distinct count unavailable for duplicate labels or pairs" };
  if (!entry && !cohort.complete) return { count: null, percent: null, reason: "not supplied" };
  const count = entry ? entry.count : 0;
  if (count === undefined) return { count: null, percent: null, reason: "not supplied" };
  if (!validCount(count) || (validCount(cohort.cases) && count > cohort.cases)) {
    return { count: null, percent: null, reason: "invalid case count" };
  }
  if (!validCount(cohort.cases)) return { count, percent: null, reason: "cohort denominator unavailable" };
  if (cohort.cases === 0) return { count, percent: null, reason: "cohort has zero cases" };
  return { count, percent: count / cohort.cases * 100 };
}

/** Aligned observed activity/pair frequencies; does not reconstruct case paths. */
export function FlowComparison({ cohorts, noun = "cases", onSelect }: FlowComparisonProps) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("activities");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const indexed = useMemo(() => cohorts.map(indexCohort), [cohorts]);
  const rows = useMemo(() => {
    const labels = new Map<string, string>();
    for (const cohort of indexed) for (const [key, entry] of cohort[mode]) labels.set(key, entry.label);
    return [...labels].map(([key, label]) => {
      const cells = indexed.map((cohort) => cellFor(cohort, cohort[mode].get(key)));
      const known = cells.flatMap((cell) => cell.percent === null ? [] : [cell.percent]);
      const range = known.length >= 2 ? known.reduce((m, v) => Math.max(m, v), -Infinity) - known.reduce((m, v) => Math.min(m, v), Infinity) : -1;
      return { key, label, cells, range };
    }).sort((a, b) => b.range - a.range || a.label.localeCompare(b.label));
  }, [indexed, mode]);
  const query = search.trim().toLocaleLowerCase();
  const matches = rows.filter((row) => row.label.toLocaleLowerCase().includes(query));
  const displayed = showAll ? matches : matches.slice(0, 8);
  const rowNoun = mode === "activities" ? "activities" : "direct connections";

  function selectMode(next: Mode) {
    setMode(next);
    setShowAll(false);
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % modes.length
      : event.key === "ArrowLeft" ? (index + modes.length - 1) % modes.length
        : event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectMode(modes[next]);
    tabs.current[next]?.focus();
  }

  return (
    <section className="wf-comparison" aria-label="Compare cohorts">
      <div className="wf-comparison__tabs" role="tablist" aria-label="Compare observed frequencies">
        {modes.map((tabMode, index) => (
          <button key={tabMode} ref={(element) => { tabs.current[index] = element; }} type="button" role="tab"
            id={`${id}-${tabMode}-tab`} aria-controls={`${id}-panel`} aria-selected={mode === tabMode}
            tabIndex={mode === tabMode ? 0 : -1} onClick={() => selectMode(tabMode)} onKeyDown={(event) => handleTabKey(event, index)}>
            {modeLabels[tabMode]}
          </button>
        ))}
      </div>
      <p id={`${id}-explanation`} className="wf-comparison__explanation">
        How often each activity or connection appears in each group. Each item is counted once per row.
        {mode === "connections" ? " An arrow means these activities were recorded consecutively; rows are not complete paths." : null}
      </p>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${mode}-tab`}>
        <div className="wf-comparison__controls">
          <label htmlFor={`${id}-search`}>Search full labels</label>
          <input id={`${id}-search`} type="search" value={search} onChange={(event) => { setSearch(event.target.value); setShowAll(false); }} />
          {matches.length > 8 ? <button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show top 8" : `Show all ${countFormat.format(matches.length)}`}
          </button> : null}
        </div>
        <p className="wf-comparison__summary" role="status">
          Largest differences first · showing {countFormat.format(displayed.length)} of {countFormat.format(matches.length)} {query ? "matching " : ""}{rowNoun}
          {query ? ` (${countFormat.format(rows.length)} total)` : ""}
        </p>
        {cohorts.length === 0 ? <p>No cohorts supplied.</p> : (
          <div className="wf-comparison__overflow" role="region" aria-label={`${modeLabels[mode]} comparison table`} tabIndex={0}>
            <table aria-describedby={`${id}-explanation`}>
              <caption>{modeLabels[mode]} — percentage and distinct {noun} in each group</caption>
              <thead><tr>
                <th scope="col">{mode === "activities" ? "Activity" : "Directed pair (source → target)"}</th>
                {cohorts.map((cohort) => <th scope="col" key={cohort.id}>
                  {onSelect ? <button type="button" className="wf-comparison__cohort" onClick={() => onSelect(cohort.id)} aria-label={`Open ${cohort.label}`}>{cohort.label}</button> : cohort.label}
                  <span className="wf-comparison__denominator">{validCount(cohort.cases) ? `${countFormat.format(cohort.cases)} ${noun}` : "Group size unavailable"}</span>
                </th>)}
              </tr></thead>
              <tbody>
                {displayed.map((row) => <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  {row.cells.map((cell, index) => <td key={cohorts[index].id}
                    aria-label={cell.count === null ? undefined : `${cell.percent === null ? "Percentage unavailable" : `${percentText(cell.percent)} of ${cohorts[index].label}`}; ${countFormat.format(cell.count)} distinct ${noun}`}>
                    {cell.count === null ? <span className="wf-comparison__unavailable">— {cell.reason}</span> : <>
                      <strong className="wf-comparison__value" title={cell.reason}>{cell.percent === null ? "—" : percentText(cell.percent)}</strong>
                      {cell.percent === null ? <span className="wf-comparison__unavailable">percentage unavailable</span> : null}
                      <span className="wf-comparison__count">{countFormat.format(cell.count)}</span>
                      {cell.percent !== null ? <span className="wf-comparison__bar" aria-hidden="true"><span style={{ width: `${cell.percent}%` }} /></span> : null}
                    </>}
                  </td>)}
                </tr>)}
                {displayed.length === 0 ? <tr><td colSpan={cohorts.length + 1}>{rows.length === 0 ? `No ${rowNoun} supplied.` : "No matching labels."}</td></tr> : null}
              </tbody>
            </table>
          </div>
        )}
        <details className="wf-comparison__method">
          <summary>How to read these numbers</summary>
          <p>Each percentage divides the distinct {noun} for that row by all {noun} in the group, including those without events.
            {" "}Repeated events do not increase the count. Rows can overlap and do not sum to 100%.</p>
          <p>A dash means the value is unavailable. Missing activities or pairs count as zero only when the graph is complete and unpruned;
            {" "}otherwise they are not supplied. Percentages are unavailable for zero or invalid group sizes.</p>
          <p>Rows are sorted by the greatest percentage-point range across known values.
            {" "}Rows with fewer than two known percentages follow. Sequences and paths are not reconstructed.</p>
        </details>
      </div>
    </section>
  );
}
