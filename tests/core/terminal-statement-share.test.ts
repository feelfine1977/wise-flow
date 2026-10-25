import { describe, expect, it } from "vitest";
import { type FlowGraph, type Positions, buildScene } from "../../src/core/index.js";
import { wrapLines } from "../../src/core/text.js";

// The statement under Start writes its share as every share of the library does, "100 %", with a no-break space (U+00A0)
// so that wrapping it under the event never puts the sign on the next line ("(100" / "%) at …", read together as "(100%)").
describe("the terminal statement's share", () => {
  const graph: FlowGraph = {
    nodes: [
      { id: "start", kind: "event", label: "Start", tags: ["start"], metrics: { cases: 1000, atShown: 1000 } },
      { id: "a", kind: "activity", label: "A", metrics: { cases: 1000 } },
    ],
    edges: [{ id: "s-a", kind: "follows", source: "start", target: "a", metrics: { cases: 1000 } }],
  };
  const positions: Positions = { nodes: { start: { x: 0, y: 0, width: 36, height: 36 }, a: { x: 200, y: 0, width: 160, height: 60 } }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 360, height: 60 }, engine: "given", direction: "RIGHT" };

  for (const [locale, text] of [["en", "1,000 cases · 1,000 (100\u00a0%) at a shown activity"], ["de", "1.000 Fälle · 1.000 (100\u00a0%) an einer gezeigten Aktivität"]] as const) {
    it(`reads "${text}"`, () => {
      const start = buildScene(graph, positions, { locale, style: { terminals: { statement: true } } }).nodeMarks.find((m) => m.id === "start")!;
      expect(start.texts.slice(2).map((t) => t.text).join(" ")).toBe(text);
    });
  }

  it("never wraps between the number and its per-cent sign", () => {
    // Each character 1 wide: "135 cases · 135 (100" is 20, so a line of 20 would end there were the space a break.
    const lines = wrapLines("135 cases · 135 (100\u00a0%) at a shown activity", 20, { size: 1 }, 3, (t) => t.length);
    expect(lines.some((l) => l.endsWith("(100"))).toBe(false);
    expect(lines.join(" ")).toContain("(100\u00a0%)");
  });
});
