import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { PATTERNS, buildScales, contrastRatio, contrastText, defaultStyle, diff, diffStyle, hashKey, interpolatePalette, lodAt, lodForSize, palettes, patternDefs } from "../../src/index";

describe("buildScales", () => {
  it("is deterministic and independent of element order", () => {
    const a = buildScales(globalScene, defaultStyle);
    const shuffled = { ...globalScene, nodes: [...globalScene.nodes].reverse(), edges: [...globalScene.edges].reverse() };
    const b = buildScales(shuffled, defaultStyle);
    for (const n of globalScene.nodes) {
      expect(b.nodeColor(n)).toBe(a.nodeColor(n));
      expect(b.nodePattern(n)).toBe(a.nodePattern(n));
    }
    for (const e of globalScene.edges) {
      expect(b.edgeWidth(e)).toBe(a.edgeWidth(e));
      expect(b.edgeColor(e)).toBe(a.edgeColor(e));
    }
    expect(b.legend).toEqual(a.legend);
    expect(b.domains).toEqual(a.domains);
  });

  it("maps edge widths into the range and colours into the palette", () => {
    const s = buildScales(globalScene, defaultStyle);
    const widths = globalScene.edges.map((e) => s.edgeWidth(e));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...widths)).toBeLessThanOrEqual(8);
    const strongest = globalScene.edges.reduce((m, e) => ((e.metrics?.count ?? 0) > (m.metrics?.count ?? 0) ? e : m));
    expect(s.edgeWidth(strongest)).toBe(8);
    expect(s.edgeColor({ id: "x", kind: "follows", source: "a", target: "b", metrics: { violationShare: 0 } })).toBe(palettes.sequential[0]);
    expect(s.edgeColor({ id: "x", kind: "follows", source: "a", target: "b", metrics: { violationShare: 1 } })).toBe(palettes.sequential[palettes.sequential.length - 1]);
    expect(s.edgeColor({ id: "x", kind: "follows", source: "a", target: "b" })).toBe("#8c8c8c");
  });

  it("assigns categorical colours by hashed key with pattern twins", () => {
    const s = buildScales(globalScene, defaultStyle);
    const order = s.categorical("order");
    expect(s.categorical("order")).toEqual(order);
    expect(PATTERNS[order.index]).toBe(order.pattern);
    expect(palettes.categorical[order.index]).toBe(order.color);
    expect(hashKey("order")).toBe(hashKey("order"));
    expect(hashKey("order")).not.toBe(hashKey("Order"));
    const node = globalScene.nodes.find((n) => n.group === "order")!;
    expect(s.nodeColor(node)).toBe(order.color);
    expect(s.nodePattern(node)).toBe(order.pattern);
    const cat = s.legend.find((l) => l.kind === "categorical");
    expect(cat && cat.kind === "categorical" ? cat.entries.map((e) => e.key) : []).toEqual(["invoice", "order", "payment", "receipt", "requisition"]);
  });

  it("uses a symmetric diverging domain for deltas", () => {
    const d = diff(globalScene, globalScene);
    const s = buildScales(d, diffStyle);
    expect(s.domains.edgeColor).toEqual([-0.5, 0, 0.5]);
    expect(s.edgeColor({ id: "x", kind: "follows", source: "a", target: "b", metrics: { delta_violationShare: 0 } })).toBe(palettes.diverging[3]);
    const auto = buildScales(d, { edgeColor: { metric: "delta_count", palette: "diverging" } });
    const dom = auto.domains.edgeColor!;
    expect(dom[1]).toBe(0);
    expect(dom[0]).toBe(-dom[2]);
  });

  it("keeps text readable on every palette colour", () => {
    for (const c of [...palettes.sequential, ...palettes.diverging, ...palettes.categorical]) {
      expect(contrastRatio(c, contrastText(c))).toBeGreaterThanOrEqual(4.5);
    }
    expect(interpolatePalette(palettes.sequential, 0)).toBe(palettes.sequential[0]);
    expect(interpolatePalette(palettes.sequential, 1)).toBe(palettes.sequential[4]);
    expect(interpolatePalette(palettes.sequential, 2)).toBe(palettes.sequential[4]);
    expect(interpolatePalette(palettes.sequential, 0.5)).toBe(palettes.sequential[2]);
  });

  it("level of detail follows zoom and map size", () => {
    expect(lodAt(0.15)).toMatchObject({ labels: false, badges: false, arcs: false });
    expect(lodAt(1)).toMatchObject({ labels: true, badges: true, arcs: true, edgeLabels: true });
    expect(lodAt(0.5, { labels: 0.6 }).labels).toBe(false);
    expect(lodForSize(500).labels).toBeGreaterThan(lodForSize(10).labels);
    expect(patternDefs()).toContain('id="wf-pattern-diagonal"');
  });
});
