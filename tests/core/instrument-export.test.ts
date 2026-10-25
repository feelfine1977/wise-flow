/**
 * Exports in the instrument look (WF-12): `toSVG` with `theme: "instrument"`
 * draws the preset in the light scheme, deterministically, with literal
 * colours only, and says what the terminal paths count under the figure.
 */
import { describe, expect, it } from "vitest";
import { type FlowGraph, layout, toSVG } from "../../src/index";
import { graph, positions } from "../support/terminals";

describe("an export in the instrument look", () => {
  it("is light, deterministic and written in literal colours", () => {
    const a = toSVG({ graph, positions }, { theme: "instrument", preset: "single-column" });
    expect(toSVG({ graph: { ...graph, nodes: [...graph.nodes].reverse() }, positions }, { theme: "instrument", preset: "single-column" })).toBe(a);
    expect(a).not.toMatch(/var\(|oklch\(|color-mix\(/);
    expect(a).toContain('fill="#ffffff"');
    expect(a).toContain('stroke="#c9ced6"');
    expect(a).toMatch(/font-family="Inter, system-ui/);
    expect(a.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).toContain("Start and End paths count cases by their first and last activity (Σ = 1,000)");
  });

  it("draws the dark scheme only when asked", () => {
    expect(toSVG({ graph, positions }, { theme: "instrument" })).not.toContain("#15181c");
    expect(toSVG({ graph, positions }, { theme: "instrument", scheme: "dark" })).toContain("#15181c");
  });

  it("lays out and exports a graph without positions of its own", async () => {
    const g: FlowGraph = { ...graph };
    expect(toSVG({ graph: g, positions: await layout(g, { engine: "dagre" }) }, { theme: "instrument" })).toContain("<svg");
  });
});
