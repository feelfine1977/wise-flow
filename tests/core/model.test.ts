import { describe, expect, it } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { type FlowGraph, formatCompact, formatCount, formatDelta, formatHours, formatNumber, formatShare, indexGraph, normalizeGraph, t, validateGraph } from "../../src/index";

describe("model", () => {
  it("accepts the fixture scenes as valid FlowGraph JSON", () => {
    for (const g of [globalScene, vendorScene]) {
      expect(validateGraph(g)).toEqual([]);
      for (const n of g.nodes) {
        expect(["activity", "stage", "gateway", "event", "note"]).toContain(n.kind);
        expect(typeof n.label).toBe("string");
      }
      for (const e of g.edges) expect(["follows", "constraint", "flow"]).toContain(e.kind);
      for (const gr of g.groups ?? []) expect(["lane", "stage", "pool"]).toContain(gr.kind);
    }
  });

  it("reports duplicate ids, dangling edges and unknown targets", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "missing" },
        { id: "a", kind: "activity", label: "A2" },
      ],
      edges: [
        { id: "e", kind: "follows", source: "a", target: "b" },
        { id: "e", kind: "follows", source: "a", target: "a" },
      ],
      groups: [{ id: "g", kind: "stage", label: "G", parent: "nope" }],
      overlays: [{ kind: "badge", target: "zzz" }],
    };
    const issues = validateGraph(g);
    expect(issues.map((i) => i.message)).toEqual([
      "duplicate node id",
      "group parent not found: nope",
      "node group not found: missing",
      "edge target not found: b",
      "duplicate edge id",
      "overlay target not found: zzz",
    ]);
  });

  it("indexes adjacency and members", () => {
    const idx = indexGraph(globalScene);
    expect(idx.nodes.size).toBe(globalScene.nodes.length);
    expect(idx.outgoing.get("__start")!.length).toBeGreaterThan(0);
    expect(idx.incoming.get("__end")!.length).toBeGreaterThan(0);
    expect(idx.members.get("payment")!.map((n) => n.id)).toEqual(["clear_invoice"]);
  });

  it("normalises order and duplicates", () => {
    const g = normalizeGraph({ nodes: [...globalScene.nodes].reverse(), edges: [...globalScene.edges, globalScene.edges[0]] });
    expect(g.nodes[0].id < g.nodes[1].id).toBe(true);
    expect(g.edges.length).toBe(globalScene.edges.length);
  });
});

describe("format", () => {
  it("formats counts, shares, deltas and durations deterministically per locale", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(1234567, "de")).toBe("1.234.567");
    expect(formatNumber(1234.5, 1, "de")).toBe("1.234,5");
    expect(formatShare(0.2258)).toBe("23 %");
    expect(formatShare(0.004)).toBe("0.4 %");
    expect(formatShare(0)).toBe("0 %");
    expect(formatDelta(0.05)).toBe("+5 %");
    expect(formatDelta(-0.05)).toBe("−5 %");
    expect(formatHours(0.5)).toBe("30 min");
    expect(formatHours(36)).toBe("36 h");
    expect(formatHours(400)).toBe("17 d");
    expect(formatHours(-48)).toBe("−2.0 d");
    expect(formatCompact(1234)).toBe("1.2k");
    expect(formatCompact(1234567)).toBe("1.2M");
    expect(formatCompact(NaN)).toBe("–");
  });

  it("translates with placeholders and falls back to English", () => {
    expect(t("en", "map.description", { nodes: 3, edges: 4, groups: 1 })).toBe("Process map with 3 activities and 4 paths in 1 groups.");
    expect(t("de", "legend.title")).toBe("Legende");
  });
});
