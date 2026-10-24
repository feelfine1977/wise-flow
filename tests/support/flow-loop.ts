import { type FlowGraph, createPositions } from "../../src/index";

/** A valid model flow with one optional repeat, without directly-follows observations. */
export const flowLoop: FlowGraph = {
  nodes: [
    { id: "s", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "Approve", metrics: { cases: 100 } },
    { id: "e", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    { id: "sa", kind: "flow", source: "s", target: "a", metrics: { cases: 100 } },
    { id: "aa", kind: "flow", source: "a", target: "a", metrics: { cases: 10 } },
    { id: "ae", kind: "flow", source: "a", target: "e", metrics: { cases: 100 } },
  ],
};
export const flowLoopPositions = createPositions({
  nodes: { s: { x: 0, y: 0, width: 36, height: 36 }, a: { x: 200, y: 0, width: 180, height: 64 }, e: { x: 450, y: 0, width: 36, height: 36 } },
  groups: {}, edges: {},
}, "given", "RIGHT");
