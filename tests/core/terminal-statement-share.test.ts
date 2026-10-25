import { describe, expect, it } from "vitest";
import { type FlowGraph, type Positions, buildScene } from "../../src/core/index.js";

// The statement under Start writes its share as every share of the library does: "100 %", the number and a space before the sign.
describe("the terminal statement's share", () => {
  const graph: FlowGraph = {
    nodes: [
      { id: "start", kind: "event", label: "Start", tags: ["start"], metrics: { cases: 1000, atShown: 1000 } },
      { id: "a", kind: "activity", label: "A", metrics: { cases: 1000 } },
    ],
    edges: [{ id: "s-a", kind: "follows", source: "start", target: "a", metrics: { cases: 1000 } }],
  };
  const positions: Positions = { nodes: { start: { x: 0, y: 0, width: 36, height: 36 }, a: { x: 200, y: 0, width: 160, height: 60 } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 360, height: 60 }, engine: "given", direction: "RIGHT" };

  for (const [locale, text] of [["en", "1,000 cases · 1,000 (100 %) at a shown activity"], ["de", "1.000 Fälle · 1.000 (100 %) an einer gezeigten Aktivität"]] as const) {
    it(`reads "${text}"`, () => {
      const start = buildScene(graph, positions, { locale, style: { terminals: { statement: true } } }).nodeMarks.find((m) => m.id === "start")!;
      expect(start.texts.map((t) => t.text).join(" ")).toContain(text);
    });
  }
});
