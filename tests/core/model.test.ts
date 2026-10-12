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

  it("reports every group on a cycle of group parents as an error, and no group that only leads into one", () => {
    const node = (id: string, group: string) => ({ id, kind: "activity" as const, label: id, group });
    // g1 inside g2 and g2 inside g1; g3 inside g1 (its chain enters the cycle); s is its own parent; ok1 ⊂ ok2 ⊂ ok3 is sound.
    const g: FlowGraph = {
      nodes: [node("a", "g1"), node("b", "g3"), node("c", "s"), node("d", "ok1")],
      edges: [],
      groups: [
        { id: "g1", kind: "stage", label: "G1", parent: "g2" },
        { id: "g2", kind: "stage", label: "G2", parent: "g1" },
        { id: "g3", kind: "lane", label: "G3", parent: "g1" },
        { id: "s", kind: "lane", label: "S", parent: "s" },
        { id: "ok1", kind: "lane", label: "OK1", parent: "ok2" },
        { id: "ok2", kind: "lane", label: "OK2", parent: "ok3" },
        { id: "ok3", kind: "pool", label: "OK3" },
      ],
    };
    expect(validateGraph(g)).toEqual([
      { level: "error", message: "group parent cycle", id: "g1" },
      { level: "error", message: "group parent cycle", id: "g2" },
      { level: "error", message: "group parent cycle", id: "s" },
    ]);
    // A cycle of three, entered from the middle of the list.
    const three: FlowGraph = { nodes: [], edges: [], groups: [{ id: "x", kind: "stage", label: "X", parent: "y" }, { id: "z", kind: "stage", label: "Z", parent: "x" }, { id: "y", kind: "stage", label: "Y", parent: "z" }] };
    expect(validateGraph(three).map((i) => [i.message, i.id])).toEqual([["group parent cycle", "x"], ["group parent cycle", "z"], ["group parent cycle", "y"]]);
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

  it("formats with no decimals below zero and at most a hundred, the most a number can be printed with", () => {
    expect(formatNumber(1234.5, -1)).toBe("1,235");
    expect(formatNumber(1234.5, -2, "de")).toBe("1.235");
    expect(formatNumber(1.26, NaN)).toBe("1");
    expect(formatNumber(0.5, 1e308)).toBe(`0.5${"0".repeat(99)}`);
    expect(formatNumber(0.5, Infinity, "de")).toBe(`0,5${"0".repeat(99)}`);
    expect(formatNumber(0.25, 2.9)).toBe("0.25");
  });

  it("translates with placeholders and falls back to English", () => {
    expect(t("en", "map.description", { nodes: 3, edges: 4, groups: 1 })).toBe("Process map with 3 nodes and 4 connections in 1 groups.");
    expect(t("de", "legend.title")).toBe("Legende");
  });
});
