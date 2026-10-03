import { type FlowGraph, type Positions, type StyleSpec } from "../../src/index";

/**
 * One node of every kind in a row and one edge of every kind, on a style
 * without colour scales (nodes and edges neutral, edges 1.5 wide). Shared by
 * the node and edge mark, Canvas and SVG tests.
 */
export const graph: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "Check invoice", metrics: { cases: 1234 } },
    { id: "g", kind: "gateway", label: "Parallel split", tags: ["and", "split"] },
    { id: "s", kind: "stage", label: "Payment", metrics: { members: 4, cases: 1500 } },
    { id: "n", kind: "note", label: "Ask the vendor twice" },
    { id: "end", kind: "event", label: "End", tags: ["end"] },
    { id: "r", kind: "activity", label: "Re-added", tags: ["reconnected"] },
  ],
  edges: [
    { id: "start->a", kind: "follows", source: "start", target: "a", metrics: { count: 1234 } },
    { id: "a->g", kind: "flow", source: "a", target: "g", metrics: { count: 12 } },
    { id: "g->s", kind: "constraint", source: "g", target: "s" },
    { id: "s->r", kind: "follows", source: "s", target: "r", tags: ["reconnected"], metrics: { count: 3 } },
    { id: "a->a", kind: "follows", source: "a", target: "a", metrics: { count: 5 } },
    { id: "a->gone", kind: "follows", source: "a", target: "gone", metrics: { count: 5 } },
  ],
};

export const positions: Positions = {
  nodes: {
    start: { x: 0, y: 2, width: 36, height: 36 },
    a: { x: 100, y: 0, width: 180, height: 40 },
    g: { x: 320, y: -2, width: 44, height: 44 },
    s: { x: 400, y: 0, width: 200, height: 56 },
    n: { x: 640, y: 0, width: 160, height: 60 },
    end: { x: 840, y: 2, width: 36, height: 36 },
    r: { x: 400, y: 100, width: 180, height: 40 },
  },
  groups: {},
  edges: {
    "start->a": { points: [{ x: 36, y: 20 }, { x: 100, y: 20 }] },
    "g->s": { points: [{ x: 364, y: 20 }, { x: 382, y: 20 }, { x: 382, y: 28 }, { x: 400, y: 28 }] },
    "s->r": { points: [{ x: 500, y: 56 }, { x: 500, y: 100 }] },
  },
  bounds: { x: 0, y: -2, width: 876, height: 142 },
  engine: "given",
  direction: "RIGHT",
};

export const style: StyleSpec = {};
