import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, abstract } from "../../src/index.js";
import { FlowComparison, type FlowComparisonCohort } from "../../src/react/index.js";

afterEach(cleanup);

function graph(activities: [string, number | undefined][], pairs: [string, string, number | undefined][] = [], prefix = ""): FlowGraph {
  return {
    nodes: activities.map(([label, cases], index) => ({ id: `${prefix}${index}`, label, kind: "activity", metrics: cases === undefined ? undefined : { cases } })),
    edges: pairs.map(([source, target, cases], index) => ({
      id: `${prefix}edge${index}`, kind: "follows",
      source: `${prefix}${activities.findIndex(([label]) => label === source)}`,
      target: `${prefix}${activities.findIndex(([label]) => label === target)}`,
      metrics: cases === undefined ? undefined : { cases },
    })),
    meta: { abstraction: 0, nodesTotal: activities.length, edgesTotal: pairs.length },
  };
}

function cohort(id: string, cases: number, data: FlowGraph): FlowComparisonCohort {
  return { id, label: `Cohort ${id}`, cases, graph: data };
}

function rowCells(label: string) {
  const row = screen.getByRole("rowheader", { name: label }).closest("tr");
  if (!row) throw new Error(`Missing row for ${label}`);
  return within(row).getAllByRole("cell");
}

function cellValues(label: string) {
  return rowCells(label).map((cell) => cell.getAttribute("aria-label") ?? cell.textContent);
}

function connections() { fireEvent.click(screen.getByRole("tab", { name: "Direct connections" })); }

describe("FlowComparison", () => {
  it("does not round rare observations to absence or partial coverage to certainty", () => {
    render(<FlowComparison cohorts={[cohort("A", 10000, graph([["Rare", 1], ["Almost all", 9999]]))]} />);
    expect(cellValues("Rare")).toEqual(["<0.1% of Cohort A; 1 distinct cases"]);
    expect(cellValues("Almost all")).toEqual([">99.9% of Cohort A; 9,999 distinct cases"]);
  });

  it("aligns full labels across different IDs and uses cohort denominators, never event counts or supplied shares", () => {
    const first = graph([["Review application", 20]], [], "left-");
    first.nodes[0].metrics = { cases: 20, events: 9000, count: 3000, share: 0.99, caseShare: 0.88 };
    const second = graph([["Review application", 20]], [], "right-");
    render(<FlowComparison cohorts={[cohort("A", 100, first), cohort("B", 400, second)]} noun="orders" />);
    expect(screen.getAllByRole("rowheader")).toHaveLength(1);
    expect(cellValues("Review application")).toEqual(["20% of Cohort A; 20 distinct orders", "5% of Cohort B; 20 distinct orders"]);
    expect(screen.getByRole("columnheader", { name: "Cohort A 100 orders" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Cohort B 400 orders" })).toBeTruthy();
    expect(rowCells("Review application")[0].querySelector<HTMLElement>(".wf-comparison__bar > span")?.style.width).toBe("20%");
    expect(screen.getByRole("table").getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(/How often each activity or connection appears/)).toBeTruthy();
    const method = screen.getByText("How to read these numbers").closest("details");
    expect(method?.open).toBe(false);
    expect(method?.textContent).toContain("percentage-point range");
    expect(rowCells("Review application")[0].querySelector("strong")?.textContent).toBe("20%");
    expect(rowCells("Review application")[0].querySelector(".wf-comparison__count")?.textContent).toBe("20");
  });

  it("keeps forward, reverse and repeated direct pairs separate without reconstructing an indirect path", () => {
    const first = graph([["A", 80], ["B", 90], ["X", 70]], [["A", "B", 12], ["B", "A", 7], ["A", "A", 3], ["A", "X", 10], ["X", "B", 9]], "first-");
    first.edges[0].metrics = { cases: 12, count: 2400, share: 1 };
    const second = graph([["A", 20], ["B", 20]], [["B", "A", 8], ["A", "A", 2], ["A", "B", 5]], "second-");
    render(<FlowComparison cohorts={[cohort("A", 100, first), cohort("B", 50, second)]} />);
    connections();
    expect(cellValues("A → B")).toEqual(["12% of Cohort A; 12 distinct cases", "10% of Cohort B; 5 distinct cases"]);
    expect(cellValues("B → A")).toEqual(["7% of Cohort A; 7 distinct cases", "16% of Cohort B; 8 distinct cases"]);
    expect(cellValues("A → A")).toEqual(["3% of Cohort A; 3 distinct cases", "4% of Cohort B; 2 distinct cases"]);
    expect(screen.getAllByRole("rowheader")).toHaveLength(5);
    expect(screen.getByText(/An arrow means these activities were recorded consecutively/)).toBeTruthy();
  });

  it("does not treat non-activity nodes, constraint edges, flow edges or path aggregates as direct observations", () => {
    const data = graph([["A", 10], ["B", 10]], [["A", "B", 5]]);
    data.nodes.push({ id: "start", label: "Start boundary", kind: "event", metrics: { cases: 10 } });
    data.edges.push({ id: "boundary", source: "start", target: "0", kind: "follows", metrics: { cases: 10 } });
    data.edges.push({ id: "rule", source: "1", target: "0", kind: "constraint", metrics: { cases: 10 } });
    data.edges.push({ id: "model", source: "1", target: "1", kind: "flow", metrics: { cases: 10 } });
    data.paths = { incoming: [], outgoing: [{ from: "B", to: "A", cases: 10 }] };
    render(<FlowComparison cohorts={[cohort("A", 10, data)]} />);
    expect(screen.queryByRole("rowheader", { name: "Start boundary" })).toBeNull();
    connections();
    expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["A → B"]);
  });

  it("uses zero for absent activities and pairs only in a complete graph", () => {
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 5]], [["A", "B", 5]])),
      cohort("B", 20, graph([["A", 20]])),
    ]} />);
    expect(cellValues("B")[1]).toBe("0% of Cohort B; 0 distinct cases");
    connections();
    expect(cellValues("A → B")[1]).toBe("0% of Cohort B; 0 distinct cases");
  });

  it.each([
    undefined,
    { abstraction: 0.1, nodesTotal: 0, edgesTotal: 0 },
    { abstraction: { minEdgeShare: 0 }, nodesTotal: 0, edgesTotal: 0 },
    { abstraction: 0, nodesTotal: 1, edgesTotal: 0 },
    { abstraction: 0, nodesTotal: 0, edgesTotal: 1 },
    { abstraction: 0, nodesTotal: 0 },
    { abstraction: 0, nodesTotal: -1, edgesTotal: 0 },
    { abstraction: 0, nodesTotal: 0, edgesTotal: Number.NaN },
  ])("does not invent zero for absent data when completeness is unknown (%j)", (meta) => {
    const missing: FlowGraph = { nodes: [], edges: [], meta };
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 5]], [["A", "B", 5]])),
      cohort("B", 10, missing),
    ]} />);
    expect(rowCells("A")[1].textContent).toBe("— not supplied");
    connections();
    expect(rowCells("A → B")[1].textContent).toBe("— not supplied");
  });

  it("reads the thresholds that abstract records: zero thresholds remove nothing", () => {
    // `abstract` replaces a numeric `meta.abstraction` with its thresholds as an object.
    const unchanged = abstract(graph([["A", 20]]), { minNodeShare: 0, minEdgeShare: 0 });
    expect(unchanged.meta?.abstraction).toMatchObject({ minNodeShare: 0, minEdgeShare: 0 });
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 5]], [["A", "B", 5]])),
      cohort("B", 20, unchanged),
    ]} />);
    expect(cellValues("B")[1]).toBe("0% of Cohort B; 0 distinct cases");
    connections();
    expect(cellValues("A → B")[1]).toBe("0% of Cohort B; 0 distinct cases");
  });

  it("reads the detail shares that abstract records: full detail removes nothing", () => {
    const unchanged = abstract(graph([["A", 20]]), { activityDetail: 1, pathDetail: 1 });
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 5]], [["A", "B", 5]])),
      cohort("B", 20, unchanged),
    ]} />);
    expect(cellValues("B")[1]).toBe("0% of Cohort B; 0 distinct cases");
  });

  it.each([
    { minNodeShare: 0.5, minEdgeShare: 0 },
    { minNodeShare: 0, minEdgeShare: 0.5 },
    { activityDetail: 0.5, pathDetail: 1 },
    { activityDetail: 1, pathDetail: 1, collapse: "all" as const },
  ])("does not invent zero after an abstraction with thresholds (%j)", (thresholds) => {
    const reduced = abstract(graph([["A", 20]]), thresholds);
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 5]], [["A", "B", 5]])),
      cohort("B", 20, reduced),
    ]} />);
    expect(rowCells("B")[1].textContent).toBe("— not supplied");
  });

  it("does not let boundary edges hide missing activity pairs in completeness totals", () => {
    const missing = graph([["A", 10], ["B", 10]]);
    missing.nodes.push({ id: "start", kind: "event", label: "Start" });
    missing.edges.push({ id: "boundary", kind: "follows", source: "start", target: "0", metrics: { cases: 10 } });
    missing.meta = { abstraction: 0, nodesTotal: 2, edgesTotal: 1 };
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 10]], [["A", "B", 5]])),
      cohort("B", 10, missing),
    ]} />);
    connections();
    expect(rowCells("A → B")[1].textContent).toBe("— not supplied");
  });

  it("does not assign edges to an arbitrary activity when endpoint IDs are duplicated or unresolved", () => {
    const duplicate = graph([["A", 10], ["B", 10]], [["A", "B", 5]]);
    duplicate.nodes.push({ id: "0", kind: "activity", label: "Other", metrics: { cases: 10 } });
    const unresolved = graph([["A", 10], ["B", 10]], [["A", "B", 5]]);
    unresolved.edges[0].source = "absent";
    render(<FlowComparison cohorts={[
      cohort("A", 10, graph([["A", 10], ["B", 10]], [["A", "B", 5]])),
      cohort("B", 10, duplicate),
      cohort("C", 10, unresolved),
    ]} />);
    connections();
    expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["A → B"]);
    expect(cellValues("A → B")).toEqual(["50% of Cohort A; 5 distinct cases", "— not supplied", "— not supplied"]);
  });

  it("does not replace a supplied item's unknown metrics with zero or occurrence counts", () => {
    const data = graph([["A", undefined], ["B", 10]], [["A", "B", undefined]]);
    data.nodes[0].metrics = { events: 900, share: 0.9 };
    data.edges[0].metrics = { count: 500, share: 0.8 };
    render(<FlowComparison cohorts={[cohort("A", 10, data)]} />);
    expect(rowCells("A")[0].textContent).toBe("— not supplied");
    connections();
    expect(rowCells("A → B")[0].textContent).toBe("— not supplied");
  });

  it.each([-1, 1.5, Number.NaN, Infinity, 11, Number.MAX_SAFE_INTEGER + 1])("rejects invalid distinct-case counts (%s) instead of clamping or overflowing", (count) => {
    render(<FlowComparison cohorts={[cohort("A", 10, graph([["A", count], ["B", 10]], [["A", "B", count]]))]} />);
    expect(rowCells("A")[0].textContent).toBe("— invalid case count");
    expect(rowCells("A")[0].querySelector(".wf-comparison__bar")).toBeNull();
    connections();
    expect(rowCells("A → B")[0].textContent).toBe("— invalid case count");
  });

  it.each([0, -1, 0.5, Number.NaN, Infinity])("does not invent a percentage for zero or invalid cohort denominators (%s)", (cases) => {
    render(<FlowComparison cohorts={[cohort("A", cases, graph([["A", 0]]))]} />);
    expect(cellValues("A")[0]).toBe("Percentage unavailable; 0 distinct cases");
    expect(rowCells("A")[0].querySelector(".wf-comparison__bar")).toBeNull();
    expect(screen.getByText(cases === 0 ? "0 cases" : "Group size unavailable")).toBeTruthy();
  });

  it("does not sum overlapping distinct-case counts for duplicate labels or pairs", () => {
    const data = graph([["A", 8], ["A", 7], ["B", 9]], [["A", "B", 5], ["B", "B", 3], ["B", "B", 4]]);
    render(<FlowComparison cohorts={[cohort("A", 10, data)]} />);
    expect(rowCells("A")[0].textContent).toBe("— distinct count unavailable for duplicate labels or pairs");
    connections();
    expect(rowCells("A → B")[0].textContent).toBe("— distinct count unavailable for duplicate labels or pairs");
    expect(rowCells("B → B")[0].textContent).toBe("— distinct count unavailable for duplicate labels or pairs");
  });

  it("ranks by percentage-point range, not absolute count, while missing values stay unknown", () => {
    const first = graph([["Large count", 900], ["Large difference", 500], ["Unknown elsewhere", 1000], ["Stable", 200]]);
    const second = graph([["Large count", 90], ["Large difference", 5], ["Stable", 20]]);
    second.meta = { abstraction: 0.5, nodesTotal: 4, edgesTotal: 0 };
    render(<FlowComparison cohorts={[cohort("A", 1000, first), cohort("B", 100, second)]} />);
    expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Large difference", "Large count", "Stable", "Unknown elsewhere"]);
    expect(rowCells("Unknown elsewhere")[1].textContent).toBe("— not supplied");
  });

  it("uses the full range of all known cohorts, including known values in partially supplied graphs", () => {
    const partial = graph([["Spread", 90]]);
    partial.meta = { abstraction: 0.5, nodesTotal: 2, edgesTotal: 0 };
    render(<FlowComparison cohorts={[
      cohort("A", 100, graph([["Spread", 10], ["Runner up", 10]])),
      cohort("B", 100, graph([["Spread", 10], ["Runner up", 40]])),
      cohort("C", 100, partial),
    ]} />);
    expect(screen.getAllByRole("rowheader").map((row) => row.textContent)).toEqual(["Spread", "Runner up"]);
  });

  it("defaults to the top eight, exposes all rows, and searches full untruncated names beyond the initial eight", () => {
    const longName = "Check the complete supporting documentation for a cross-border application with a unique final phrase";
    const labels: [string, number][] = Array.from({ length: 10 }, (_, index) => [`Activity ${index}`, 10 - index]);
    labels.push([longName, 0]);
    render(<FlowComparison cohorts={[cohort("A", 10, graph(labels)), cohort("B", 10, graph(labels.map(([label]) => [label, 0])))]} />);
    expect(screen.getAllByRole("rowheader")).toHaveLength(8);
    expect(screen.getByRole("status").textContent).toContain("Largest differences first · showing 8 of 11 activities");
    fireEvent.click(screen.getByRole("button", { name: "Show all 11" }));
    expect(screen.getAllByRole("rowheader")).toHaveLength(11);
    expect(screen.getByRole("rowheader", { name: longName }).textContent).toBe(longName);
    fireEvent.click(screen.getByRole("button", { name: "Show top 8" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search full labels" }), { target: { value: "UNIQUE FINAL PHRASE" } });
    expect(screen.getAllByRole("rowheader")).toHaveLength(1);
    expect(screen.getByRole("rowheader", { name: longName }).textContent).toBe(longName);
    expect(screen.getByRole("status").textContent).toContain("Largest differences first · showing 1 of 1 matching activities (11 total)");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no such activity" } });
    expect(screen.getByText("No matching labels.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Largest differences first · showing 0 of 0 matching activities (11 total)");
  });

  it("supports roving keyboard tabs, an associated panel and native cohort selection buttons", () => {
    const onSelect = vi.fn();
    render(<FlowComparison cohorts={[cohort("A", 10, graph([["A", 10], ["B", 10]], [["A", "B", 5]]))]} onSelect={onSelect} />);
    const activities = screen.getByRole("tab", { name: "Activities" });
    const direct = screen.getByRole("tab", { name: "Direct connections" });
    activities.focus();
    fireEvent.keyDown(activities, { key: "ArrowRight" });
    expect(document.activeElement).toBe(direct);
    expect(direct.getAttribute("aria-selected")).toBe("true");
    expect(activities.tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").id).toBe(direct.getAttribute("aria-controls"));
    expect(screen.getByRole("table").textContent).toContain("A → B");
    fireEvent.keyDown(direct, { key: "ArrowRight" });
    expect(document.activeElement).toBe(activities);
    fireEvent.keyDown(activities, { key: "End" });
    expect(document.activeElement).toBe(direct);
    fireEvent.keyDown(direct, { key: "Home" });
    expect(document.activeElement).toBe(activities);
    fireEvent.keyDown(activities, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(direct);
    const select = screen.getByRole("button", { name: "Open Cohort A" });
    select.focus();
    expect(document.activeElement).toBe(select);
    expect(select.tagName).toBe("BUTTON");
    expect(select.getAttribute("type")).toBe("button");
    fireEvent.click(select);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("A");
  });

  it("keeps headers noninteractive without a selection handler and handles empty inputs", () => {
    const { rerender } = render(<FlowComparison cohorts={[cohort("A", 0, graph([]))]} />);
    expect(screen.queryByRole("button", { name: /Open Cohort/ })).toBeNull();
    expect(screen.getByText("No activities supplied.")).toBeTruthy();
    connections();
    expect(screen.getByText("No direct connections supplied.")).toBeTruthy();
    rerender(<FlowComparison cohorts={[]} />);
    expect(screen.getByText("No cohorts supplied.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
