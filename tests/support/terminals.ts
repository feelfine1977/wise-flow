/**
 * Start and End as event nodes with paths weighted by the cases that start
 * and end at each activity (WF-02), harvested from the `added-flows` fixture
 * of the superseded start/end worktree: five activities, a start and an end
 * event, the terminal paths' `cases` the starts and ends, one host-added
 * flow tagged `added-by-map`, and measures on the recorded paths only.
 */
import { type FlowGraph, createPositions } from "../../src/index";

export const graph: FlowGraph = {
  meta: { cases: 1000 },
  nodes: [
    { id: "start", kind: "event", label: "", tags: ["start"], metrics: { cases: 1000, atShown: 940 } },
    { id: "a", kind: "activity", label: "Create Purchase Requisition Item", metrics: { cases: 900 } },
    { id: "b", kind: "activity", label: "Vendor creates invoice", metrics: { cases: 400 } },
    { id: "c", kind: "activity", label: "Record Goods Receipt", metrics: { cases: 700 } },
    { id: "d", kind: "activity", label: "Record Invoice Receipt", metrics: { cases: 650 } },
    { id: "e", kind: "activity", label: "Clear Invoice", metrics: { cases: 600 } },
    { id: "end", kind: "event", label: "", tags: ["end"], metrics: { cases: 1000, atShown: 900 } },
  ],
  edges: [
    { id: "start->a", kind: "follows", source: "start", target: "a", metrics: { cases: 800 } },
    { id: "start->b", kind: "follows", source: "start", target: "b", metrics: { cases: 140 } },
    { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { cases: 700, medianLagHours: 30, violationShare: 0.2 } },
    { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { cases: 600, medianLagHours: 100, violationShare: 0.5 } },
    { id: "b->d", kind: "follows", source: "b", target: "d", metrics: { cases: 140, medianLagHours: 10, violationShare: 0.05 } },
    { id: "d->e", kind: "follows", source: "d", target: "e", metrics: { cases: 600, medianLagHours: 300, violationShare: 0.35 } },
    { id: "e->end", kind: "follows", source: "e", target: "end", metrics: { cases: 600 } },
    { id: "d->end", kind: "follows", source: "d", target: "end", metrics: { cases: 300 } },
    { id: "a->b", kind: "follows", source: "a", target: "b", tags: ["added-by-map"], metrics: { cases: 25 } },
  ],
};

const row = ["start", "a", "b", "c", "d", "e", "end"];
export const positions = createPositions({
  nodes: Object.fromEntries(graph.nodes.map((n) => {
    const x = row.indexOf(n.id) * 240;
    return [n.id, n.kind === "event" ? { x, y: 14, width: 36, height: 36 } : { x, y: 0, width: 180, height: 64 }];
  })),
  edges: {},
  groups: {},
}, "dagre", "RIGHT");
