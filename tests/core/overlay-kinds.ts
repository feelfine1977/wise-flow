import { type FlowGraph, type Overlay, type Positions, MAP_TARGET } from "../../src/index";

/**
 * Three activities in a row, 100 × 40 each, in two stages, with one overlay
 * of every kind. Shared by the overlay mark, Canvas and SVG tests.
 */
export const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", group: "s1" },
    { id: "b", kind: "activity", label: "B", group: "s2" },
    { id: "c", kind: "activity", label: "C", group: "s2" },
  ],
  edges: [
    { id: "ab", kind: "follows", source: "a", target: "b" },
    { id: "bc", kind: "follows", source: "b", target: "c" },
  ],
  groups: [
    { id: "s1", kind: "stage", label: "Stage 1" },
    { id: "s2", kind: "stage", label: "Stage 2" },
  ],
};

export const positions: Positions = {
  nodes: {
    a: { x: 0, y: 0, width: 100, height: 40 },
    b: { x: 200, y: 0, width: 100, height: 40 },
    c: { x: 400, y: 0, width: 100, height: 40 },
  },
  groups: {
    s1: { x: -10, y: -10, width: 120, height: 60 },
    s2: { x: 190, y: -10, width: 320, height: 60 },
  },
  edges: {},
  bounds: { x: -10, y: -10, width: 520, height: 60 },
  engine: "dagre",
  direction: "RIGHT",
};

// Values sit on the stops of the sequential palette: 0.25 #fdd0a2, 0.5 #fd8d3c, 0.75 #d94801, 1 #7f2704.
export const overlays: Overlay[] = [
  { kind: "chip", target: "s2", payload: { constraintId: "late", glyph: "◔", text: "Late" } },
  { kind: "badge", target: "b", payload: { constraintId: "presence", glyph: "≥1", value: 0.25 } },
  { kind: "selfLoop", target: "c", payload: { constraintId: "repeat", value: 0.75 } },
  { kind: "arc", target: "c->a", payload: { constraintId: "order", source: "c", target: "a", value: 1, coverage: 0, reverse: true, glyph: "⇐" } },
  { kind: "badge", target: "a", payload: { constraintId: "plain", value: 1 } },
  { kind: "hatch", target: "a", payload: { constraintId: "scope", label: "Scope", text: "Out of scope" } },
  { kind: "chip", target: MAP_TARGET, payload: { constraintId: "map", text: "Scope" } },
  { kind: "arc", target: "a->c", payload: { constraintId: "lag", source: "a", target: "c", value: 0.25, coverage: 0.5, glyph: "⏱" } },
  { kind: "tint", target: "s2", payload: { constraintId: "balance", value: 0.5, label: "Balance", text: "50 % above" } },
];
