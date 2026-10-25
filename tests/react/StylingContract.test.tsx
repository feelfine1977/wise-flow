import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useReactFlow } from "@xyflow/react";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { readContract, partsIn, stylingContractErrors } from "../../scripts/check-styling-contract.mjs";
import { type FlowGraph, type Positions, activityReferences } from "../../src/index";
import { FilterChips, ProcessMap, TraceTimeline, type Trace } from "../../src/react/index";
import * as kinds from "../core/element-kinds";
import * as overlayKinds from "../core/overlay-kinds";
import * as terminals from "../support/terminals";
import { browserBoxes } from "./panels";

/**
 * The fixtures of the node, edge and overlay kinds drawn by the interactive map
 * and its panels in the states a user brings about. Every part, kind and state
 * the styling contract lists must be found among their data attributes, and the
 * contract must list every one found. The tooling check reads what this file
 * finds (`FLOW_STYLING_FOUND`) and also holds it against docs/API.md.
 */
const drawn: Element[] = [];
const keep = (container: HTMLElement) => drawn.push(container.cloneNode(true) as Element);
const plain = { fitView: false, renderer: "svg" } as const;
const everything = { badges: 0, chips: 0, hatch: 0, arcs: 0, selfLoops: 0, labels: 0, edgeLabels: 0 };
const box = (x: number, y: number, width = 120, height = 40) => ({ x, y, width, height });

// A pool with two lanes and a stage beside it.
const grouped: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "l1" },
    { id: "b", kind: "activity", label: "B", group: "l2" },
    { id: "c", kind: "activity", label: "C", group: "s" },
  ],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }, { id: "bc", kind: "follows", source: "b", target: "c" }],
  groups: [
    { id: "p", kind: "pool", label: "Pool" },
    { id: "l1", kind: "lane", label: "Lane 1", parent: "p" },
    { id: "l2", kind: "lane", label: "Lane 2", parent: "p" },
    { id: "s", kind: "stage", label: "Stage" },
  ],
};
const groupedPositions: Positions = {
  nodes: { a: box(20, 20), b: box(20, 100), c: box(300, 60) },
  groups: { p: box(0, 0, 180, 160), l1: box(10, 10, 160, 60), l2: box(10, 90, 160, 60), s: box(280, 40, 160, 80) },
  edges: {},
  bounds: box(0, 0, 440, 160),
  engine: "given",
  direction: "RIGHT",
};

const traces: Trace[] = [
  { caseId: "1", events: [{ activity: "Create", timestamp: "2026-01-01" }, { activity: "Approve", timestamp: "2026-01-03", violates: ["late"] }] },
];

const map = (container: HTMLElement) => container.querySelector<HTMLElement>(".wf-process-map")!;
const element = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
let numberView: () => void;
function NumberView() {
  const rf = useReactFlow();
  numberView = () => void rf.setViewport({ x: 0, y: 0, zoom: 0.05 });
  return null;
}

afterEach(cleanup);
afterAll(() => {
  if (process.env.FLOW_STYLING_FOUND) writeFileSync(process.env.FLOW_STYLING_FOUND, JSON.stringify(partsIn(drawn), null, 2));
});

describe("the styling contract", () => {
  it("draws every node and edge kind, selected, focused, hovered, dimmed, out of scope and reconnected", async () => {
    // With the log's cases, the cards draw their frequency cue.
    const graph: FlowGraph = { ...kinds.graph, meta: { cases: 2468 }, overlays: [{ kind: "hatch", target: "a", payload: { text: "Out of scope" } }] };
    const selection = { nodes: ["a"], edges: ["start->a"], groups: [] };
    const { container, rerender } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={graph} positions={kinds.positions} style={kinds.style} selection={selection} lod={everything} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="edge"]')).not.toBeNull());
    fireEvent.mouseEnter(element(container, "s"));
    fireEvent.mouseEnter(container.querySelector('.react-flow__edge[data-id="a->g"]')!);
    act(() => void fireEvent.keyDown(map(container), { key: "ArrowRight" }));
    await waitFor(() => expect(container.querySelector('[data-wf-state~="focused"]')).not.toBeNull());
    keep(container);
    // The focus of paths dims the rest and opens the path list.
    rerender(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={graph} positions={kinds.positions} style={kinds.style} focus="a" lod={everything} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-state~="dimmed"]')).not.toBeNull());
    keep(container);
  });

  it("draws the paths from a start and to an end event as start and end", async () => {
    const { container } = render(<div style={{ width: 1800, height: 600 }}><ProcessMap graph={terminals.graph} positions={terminals.positions} lod={everything} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="edge"][data-wf-state~="end"]')).not.toBeNull());
    expect([...container.querySelectorAll('[data-wf-part="edge"][data-wf-state~="start"]')].map((e) => e.getAttribute("data-id")).sort()).toEqual(["start->a", "start->b"]);
    expect([...container.querySelectorAll('[data-wf-part="edge"][data-wf-state~="end"]')].map((e) => e.getAttribute("data-id")).sort()).toEqual(["d->end", "e->end"]);
    keep(container);
  });

  it("draws a path the keyboard is on", async () => {
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={kinds.graph} positions={kinds.positions} style={kinds.style} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="edge"]')).not.toBeNull());
    act(() => void fireEvent.keyDown(map(container), { key: "Home" }));
    act(() => void fireEvent.keyDown(map(container), { key: "ArrowRight", altKey: true }));
    await waitFor(() => expect(container.querySelector('[data-wf-part="edge"][data-wf-state~="focused"]')).not.toBeNull());
    keep(container);
  });

  it("draws every overlay kind as a mark, hovered, and the menu", async () => {
    const graph: FlowGraph = { ...overlayKinds.graph, overlays: overlayKinds.overlays };
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={graph} positions={overlayKinds.positions} lod={everything} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="mark"][data-wf-kind="arc"]')).not.toBeNull());
    fireEvent.mouseEnter(container.querySelector('[data-wf-part="mark"][data-wf-kind="arc"]')!);
    await waitFor(() => expect(container.querySelector('[data-wf-part="mark"][data-wf-state~="hovered"]')).not.toBeNull());
    fireEvent.contextMenu(element(container, "b"));
    await screen.findByRole("menu");
    keep(container);
  });

  it("draws the table alternative with a selected row", () => {
    const graph: FlowGraph = { ...overlayKinds.graph, overlays: overlayKinds.overlays };
    const { container } = render(<ProcessMap graph={graph} positions={overlayKinds.positions} view="table" selection={{ nodes: ["b"], edges: [], groups: [] }} {...plain} />);
    expect(container.querySelector('[data-wf-part="table-row"][data-wf-state~="selected"]')).not.toBeNull();
    keep(container);
  });

  it("draws the note on withheld paths", async () => {
    // Measured paths without terminals: neither is required to connect an activity from a start to an end.
    const graph = { ...grouped, edges: grouped.edges.map((e, i) => ({ ...e, metrics: { count: 2 - i } })) };
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={graph} positions={groupedPositions} edgeBudget={1} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="status"]')).not.toBeNull());
    keep(container);
  });

  it("draws a band's header with the count of its activities", async () => {
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={grouped} positions={groupedPositions} lanes="stages" laneOptions={{ counts: true }} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="group-header"]')).not.toBeNull());
    keep(container);
  });

  it("draws every group kind, selected, and the activity tooltip", async () => {
    const activityLabels = { mode: "names" as const, references: activityReferences(grouped) };
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={grouped} positions={groupedPositions} selection={{ nodes: [], edges: [], groups: ["s"] }} activityLabels={activityLabels} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="group"][data-wf-kind="lane"]')).not.toBeNull());
    fireEvent.mouseEnter(element(container, "a"));
    await screen.findByRole("tooltip");
    keep(container);
  });

  it("draws the filter chips and the trace timeline with its tooltip", async () => {
    const { container } = render(
      <>
        <FilterChips filter={{ and: [{ kind: "activity", op: "contains", activity: "a" }] }} onFilterChange={() => {}} />
        <TraceTimeline traces={traces} />
        {/* Events within a minute of each other as one ring (0.5). */}
        <TraceTimeline traces={[{ caseId: "c", events: [{ activity: "a", timestamp: 0 }, { activity: "b", timestamp: 1000 }, { activity: "c", timestamp: 86400000 }] }]} orientation="vertical" clusterMs={60000} terminals />
      </>,
    );
    fireEvent.mouseEnter(container.querySelector(".wf-event")!);
    await waitFor(() => expect(container.querySelector(".wf-trace-timeline .wf-tooltip")).not.toBeNull());
    keep(container);
  });

  it("draws the overview of a map that opens on its start", async () => {
    // Twelve activities in a row, 300 apart: fitted into 1,200 × 600 they would be at 0.31, so the map opens on its start.
    const ids = Array.from({ length: 12 }, (_, i) => `a${i}`);
    const row: FlowGraph = { nodes: ids.map((id) => ({ id, kind: "activity", label: id.toUpperCase() })), edges: ids.slice(1).map((id, i) => ({ id: `${ids[i]}->${id}`, kind: "follows", source: ids[i], target: id })) };
    const nodes = Object.fromEntries(ids.map((id, i) => [id, box(300 * i, 0)]));
    const restore = browserBoxes({ width: 1200, height: 600 }, { "bottom-left": { width: 150, height: 44 } });
    try {
      const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={row} positions={{ nodes, groups: {}, edges: {}, bounds: box(0, 0, 3420, 40), engine: "given", direction: "RIGHT" }} renderer="svg" controls={false} legend={false} /></div>);
      await waitFor(() => expect(container.querySelector('[data-wf-part="overview"]')).not.toBeNull());
      keep(container);
    } finally {
      restore();
    }
  });

  it("draws the numbered activities and their key", async () => {
    const { container } = render(<ProcessMap graph={grouped} positions={groupedPositions} {...plain}><NumberView /></ProcessMap>);
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
    act(() => numberView());
    expect(screen.getByRole("region", { name: "Activities by number" }).getAttribute("data-wf-part")).toBe("activity-key");
    keep(container);
  });

  it("lists exactly what the fixtures draw", () => {
    expect(stylingContractErrors(readContract(`${process.cwd()}/`), partsIn(drawn), readFileSync("docs/API.md", "utf8"))).toEqual([]);
  });
});
