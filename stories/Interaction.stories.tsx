import type { Meta, StoryObj } from "@storybook/react";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import { useMemo, useState } from "react";
import { constraintItems, globalScene } from "../fixtures/bpic2019";
import {
  type AbstractOptions,
  type Filter,
  type FilterPreview,
  type FlowPaths,
  type Focus,
  type MenuAction,
  type MenuTarget,
  canonicalFilter,
  describeClause,
  overlaysFor,
  pathsFor,
} from "../src/index";
import { ProcessMap, type Selection } from "../src/react/index";

const meta: Meta = {
  title: "Interaction",
  parameters: { layout: "fullscreen" },
};
export default meta;

const layout = { elkWorkerUrl };
const abstractionDefault: AbstractOptions = { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true };
const labelOf = (id: string) => globalScene.nodes.find((n) => n.id === id)?.label ?? id;

const headerStyle: React.CSSProperties = {
  padding: "6px 12px",
  borderBottom: "1px solid var(--wf-line)",
  display: "flex",
  gap: 16,
  alignItems: "center",
  flexWrap: "wrap",
  fontFamily: "var(--wf-font)",
  fontSize: 12,
};

/**
 * Click selects, Shift-click extends the selection, a right click (or Enter on
 * the focused activity) opens the actions menu. The default actions (filter
 * to, exclude, paths, distribution lens, add expectation, pin, worst cases)
 * reach the host through `onAction`; `onContextMenu` adds a host action of
 * its own. The header shows the selection and the last action.
 */
export const SelectAndMenu: StoryObj = {
  name: "select and context menu",
  render: () => {
    const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
    const [last, setLast] = useState<string>("–");
    const [abstraction, setAbstraction] = useState<AbstractOptions>(abstractionDefault);
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene }), []);
    const onContextMenu = (target: MenuTarget, actions: MenuAction[]): MenuAction[] => [
      ...actions,
      { id: "profile", label: target.kind === "node" ? "Open the activity profile" : "Open the profile", group: "explore", accelerator: "o", description: "A host action added through onContextMenu" },
    ];
    const onAction = (action: MenuAction, target: MenuTarget) => {
      setLast(`${action.id} on ${target.label}`);
      return undefined;
    };
    const describe = (s: Selection) => [s.nodes.length ? `activities ${s.nodes.map(labelOf).join(", ")}` : "", s.edges.length ? `paths ${s.edges.join(", ")}` : "", s.groups.length ? `groups ${s.groups.join(", ")}` : ""].filter(Boolean).join(" · ") || "nothing";
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={headerStyle}>
          <strong>Selection:</strong>
          <span data-testid="selection">{describe(selection)}</span>
          <strong>Last action:</strong>
          <span data-testid="last-action">{last}</span>
          <span style={{ color: "var(--wf-ink-muted)" }}>Right click or Enter opens the menu; Shift-click or Shift and an arrow key extends the selection; two activities offer the pair actions.</span>
        </div>
        <div style={{ minHeight: 0 }}>
          <ProcessMap graph={globalScene} overlays={overlays} abstraction={abstraction} onAbstractionChange={setAbstraction} selection={selection} onSelect={setSelection} onContextMenu={onContextMenu} onAction={onAction} layout={layout} />
        </div>
      </div>
    );
  },
};

/** The contract's `paths` block for an activity, computed here from the full directly-follows graph. */
function payloadPathsFor(focus: string): FlowPaths {
  const full = pathsFor(globalScene, focus);
  const row = (r: (typeof full.incoming)[number]) => ({ from: r.from, to: r.to, count: r.count, cases: r.cases, median_lag: r.medianLagHours, violation_share: r.violationShare });
  return { focus, incoming: full.incoming.map(row), outgoing: full.outgoing.map(row) };
}

/**
 * `focus` highlights the predecessors and successors of an activity and dims
 * the rest; the side list shows its incoming and outgoing paths with counts,
 * cases, median and 90th percentile lag and the expectation shortfall,
 * sortable, with totals. With *paths from the analysis* the list reads the
 * `paths` block of a focused flow response (here computed from the full
 * directly-follows graph, so it also lists paths the abstraction hides);
 * otherwise the numbers come from the map. Select two activities to see the
 * path between them.
 */
export const Paths: StoryObj = {
  name: "paths for an activity",
  render: () => {
    const [focus, setFocus] = useState<Focus | undefined>("record_invoice_receipt");
    const [fromPayload, setFromPayload] = useState(true);
    const [selection, setSelection] = useState<Selection>({ nodes: [], edges: [], groups: [] });
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene }), []);
    const activities = useMemo(() => globalScene.nodes.filter((n) => n.kind === "activity").sort((a, b) => (b.metrics?.cases ?? 0) - (a.metrics?.cases ?? 0)).slice(0, 25), []);
    const paths = useMemo(() => (fromPayload && typeof focus === "string" ? payloadPathsFor(focus) : undefined), [fromPayload, focus]);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={headerStyle}>
          <label>
            Focus{" "}
            <select value={typeof focus === "string" ? focus : ""} onChange={(e) => setFocus(e.target.value || undefined)} data-testid="focus-select">
              <option value="">(none)</option>
              {activities.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" checked={fromPayload} onChange={(e) => setFromPayload(e.target.checked)} /> paths from the analysis (full graph)
          </label>
          <span data-testid="focus-value">{focus ? (typeof focus === "string" ? focus : focus.join(" → ")) : "–"}</span>
        </div>
        <div style={{ minHeight: 0 }}>
          <ProcessMap graph={globalScene} overlays={overlays} defaultAbstraction={abstractionDefault} focus={focus ?? null} onFocusChange={setFocus} paths={paths} selection={selection} onSelect={setSelection} layout={layout} />
        </div>
      </div>
    );
  },
};

/**
 * A filter preview as the backend would return it for the chips: every clause
 * removes a fixed share of the 251,734 cases here, so that the counts are
 * deterministic; the real numbers come from `GET …/filters/preview`.
 */
function previewFor(filter: Filter): FilterPreview {
  const total = 251734;
  const shares = filter.and.map((c) => (c.kind === "time" ? 0.31 : c.kind === "activity" ? 0.22 : c.kind === "follows" ? 0.18 : c.kind === "count" ? 0.12 : c.kind === "open" ? 0.07 : 0.1));
  const kept = shares.reduce((n, s) => Math.round(n * (1 - s)), total);
  return {
    casesIn: kept,
    casesOut: total - kept,
    casesTotal: total,
    perClause: shares.map((s, i) => ({ clause: i, removedMarginally: Math.round(total * s * 0.6) })),
  };
}

/**
 * The `filters` prop renders the contract's clauses as chips above the map
 * with cases in and out and the marginal removal per chip; the map never
 * filters data, it calls `onFilterChange`. "Filter to" and "Exclude" in the
 * actions menu add clauses; the × on a chip (or Delete on a focused chip)
 * removes one. The header prints the canonical filter.
 */
export const Filters: StoryObj = {
  name: "filters",
  render: () => {
    const [filter, setFilter] = useState<Filter>({
      and: [
        { kind: "time", field: "case_start", from: "2018-01-01", to: "2018-06-30" },
        { kind: "activity", op: "contains", activity: "record_goods_receipt" },
      ],
    });
    const overlays = useMemo(() => overlaysFor(constraintItems("global"), { graph: globalScene }), []);
    const preview = useMemo(() => previewFor(filter), [filter]);
    const canonical = useMemo(() => JSON.stringify(canonicalFilter(filter)), [filter]);
    return (
      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100vh", width: "100vw" }}>
        <div style={headerStyle}>
          <strong>Canonical filter:</strong>
          <code data-testid="filter-json" style={{ fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "70vw" }}>
            {canonical}
          </code>
          <span data-testid="filter-count">{filter.and.length} clauses: {filter.and.map((c) => describeClause(c, "en", labelOf)).join(" · ")}</span>
        </div>
        <div style={{ minHeight: 0 }}>
          <ProcessMap graph={globalScene} overlays={overlays} defaultAbstraction={abstractionDefault} filters={filter} filterPreview={preview} onFilterChange={setFilter} layout={layout} />
        </div>
      </div>
    );
  },
};
