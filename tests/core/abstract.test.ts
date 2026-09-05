import { describe, expect, it } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { COLLAPSED_TAG, DIFF_TAGS, RECONNECTED_TAG, type FlowGraph, abstract, collapseGroups, diff, hasTag, isConnected, validateGraph } from "../../src/index";

/** Deterministic pseudo-random graph generator (LCG). */
function randomGraph(seed: number, n: number): FlowGraph {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    kind: "activity" as const,
    label: `Activity ${i}`,
    group: `g${i % 3}`,
    metrics: { cases: Math.round(1 + rnd() * 1000) },
  }));
  const edges: FlowGraph["edges"] = [];
  const seen = new Set<string>();
  const add = (a: number, b: number) => {
    const id = `a${a}->a${b}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, kind: "follows", source: `a${a}`, target: `a${b}`, metrics: { count: Math.round(1 + rnd() * 1000) } });
  };
  for (let i = 1; i < n; i++) add(Math.floor(rnd() * i), i); // spanning tree: connected
  for (let k = 0; k < n * 2; k++) add(Math.floor(rnd() * n), Math.floor(rnd() * n));
  return {
    nodes: [{ id: "__start", kind: "event", label: "Start", tags: ["start"] }, ...nodes, { id: "__end", kind: "event", label: "End", tags: ["end"] }],
    edges: [
      { id: "__start->a0", kind: "follows", source: "__start", target: "a0", metrics: { count: 500 } },
      ...edges,
      { id: `a${n - 1}->__end`, kind: "follows", source: `a${n - 1}`, target: "__end", metrics: { count: 500 } },
    ],
    groups: [
      { id: "g0", kind: "stage", label: "G0" },
      { id: "g1", kind: "stage", label: "G1" },
      { id: "g2", kind: "stage", label: "G2" },
    ],
  };
}

const thresholds = [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8];

describe("abstract", () => {
  it("keeps the fixture connected at every threshold and never adds dangling edges", () => {
    for (const tt of thresholds) {
      const g = abstract(globalScene, { minEdgeShare: tt, minNodeShare: tt / 2 });
      expect(isConnected(g), `threshold ${tt}`).toBe(true);
      expect(validateGraph(g).filter((i) => i.level === "error")).toEqual([]);
      expect(g.nodes.some((n) => n.id === "__start")).toBe(true);
      expect(g.nodes.some((n) => n.id === "__end")).toBe(true);
    }
  });

  it("is monotone in the thresholds on the fixture", () => {
    let prevNodes = Infinity;
    let prevEdges = Infinity;
    let prevKept: Set<string> | undefined;
    for (const tt of thresholds) {
      const g = abstract(globalScene, { minEdgeShare: tt, minNodeShare: tt / 2 });
      expect(g.nodes.length).toBeLessThanOrEqual(prevNodes);
      expect(g.edges.length).toBeLessThanOrEqual(prevEdges);
      const kept = new Set(g.edges.filter((e) => !hasTag(e, RECONNECTED_TAG)).map((e) => e.id));
      if (prevKept) for (const id of kept) expect(prevKept.has(id), `edge ${id} kept at ${tt} but not at the lower threshold`).toBe(true);
      prevNodes = g.nodes.length;
      prevEdges = g.edges.length;
      prevKept = kept;
    }
    const loose = abstract(globalScene, { minEdgeShare: 0 });
    const tight = abstract(globalScene, { minEdgeShare: 0.5, minNodeShare: 0.25 });
    expect(tight.edges.length).toBeLessThan(loose.edges.length);
    expect(tight.nodes.length).toBeLessThan(loose.nodes.length);
  });

  it("keeps random connected graphs connected and monotone", () => {
    // The thresholded part is monotone (a subset at every higher threshold); the
    // reconnection re-adds the strongest paths and one edge per open need, which is
    // bounded but not a global optimum, so the total may differ by one re-added edge.
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGraph(seed, 8 + (seed % 30));
      expect(isConnected(g)).toBe(true);
      let prevTotal = Infinity;
      let prevKept: Set<string> | undefined;
      for (const tt of thresholds) {
        const r = abstract(g, { minEdgeShare: tt, minNodeShare: tt / 2 });
        expect(isConnected(r), `seed ${seed} threshold ${tt}`).toBe(true);
        expect(validateGraph(r).filter((i) => i.level === "error")).toEqual([]);
        const kept = new Set([...r.nodes, ...r.edges].filter((el) => !hasTag(el, RECONNECTED_TAG)).map((el) => el.id));
        if (prevKept) for (const id of kept) expect(prevKept.has(id), `seed ${seed}: ${id} kept at ${tt} only`).toBe(true);
        const reconnected = r.edges.filter((e) => hasTag(e, RECONNECTED_TAG)).length;
        expect(reconnected).toBeLessThanOrEqual(2 * r.nodes.length);
        expect(r.nodes.length + r.edges.length).toBeLessThanOrEqual(prevTotal + 1);
        prevTotal = r.nodes.length + r.edges.length;
        prevKept = kept;
      }
    }
  });

  it("gives every kept activity an incoming and an outgoing path where the original had one", () => {
    const g = abstract(globalScene, { minEdgeShare: 0.3 });
    for (const n of g.nodes) {
      if (n.kind !== "activity") continue;
      const hasIn = g.edges.some((e) => e.target === n.id && e.source !== n.id);
      const hasOut = g.edges.some((e) => e.source === n.id && e.target !== n.id);
      const originalIn = globalScene.edges.some((e) => e.target === n.id && e.source !== n.id);
      const originalOut = globalScene.edges.some((e) => e.source === n.id && e.target !== n.id);
      if (originalIn) expect(hasIn, `${n.id} lost its incoming paths`).toBe(true);
      if (originalOut) expect(hasOut, `${n.id} lost its outgoing paths`).toBe(true);
    }
  });

  it("tags re-added elements and can be switched off", () => {
    const connected = abstract(globalScene, { minEdgeShare: 0.3 });
    expect(connected.edges.some((e) => hasTag(e, RECONNECTED_TAG))).toBe(true);
    const raw = abstract(globalScene, { minEdgeShare: 0.3, keepConnected: false });
    expect(raw.edges.every((e) => !hasTag(e, RECONNECTED_TAG))).toBe(true);
    expect(raw.edges.length).toBeLessThanOrEqual(connected.edges.length);
  });

  it("removes weak activities but never events, gateways or kept ids", () => {
    const g = abstract(globalScene, { minNodeShare: 0.5, keep: ["change_currency"] });
    expect(g.nodes.find((n) => n.id === "change_currency")).toBeDefined();
    expect(g.nodes.find((n) => n.id === "__start")).toBeDefined();
    expect(g.nodes.find((n) => n.id === "srm_held")).toBeUndefined();
    expect(g.nodes.length).toBeLessThan(globalScene.nodes.length);
  });

  it("collapses stage groups into stage nodes with summed counts", () => {
    const g = collapseGroups(globalScene, "all");
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const grp of globalScene.groups ?? []) expect(ids.has(grp.id)).toBe(true);
    const order = g.nodes.find((n) => n.id === "order")!;
    expect(order.kind).toBe("stage");
    expect(hasTag(order, COLLAPSED_TAG)).toBe(true);
    const memberEvents = globalScene.nodes.filter((n) => n.group === "order").reduce((s, n) => s + (n.metrics?.events ?? 0), 0);
    expect(order.metrics?.events).toBe(memberEvents);
    expect(order.metrics?.members).toBe(globalScene.nodes.filter((n) => n.group === "order").length);
    expect(order.metrics?.internalCount).toBeGreaterThan(0);
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
    expect(g.groups).toEqual([]);
    const viaAbstract = abstract(globalScene, { collapse: ["receipt"] });
    expect(viaAbstract.nodes.find((n) => n.id === "receipt")?.kind).toBe("stage");
    expect(viaAbstract.nodes.find((n) => n.id === "record_goods_receipt")).toBeUndefined();
    expect(viaAbstract.groups?.map((x) => x.id)).not.toContain("receipt");
  });

  it("keeps overlays whose targets survive and moves them on collapse", () => {
    const withOverlays: FlowGraph = {
      ...globalScene,
      overlays: [
        { kind: "badge", target: "record_goods_receipt", payload: { value: 0.2 } },
        { kind: "badge", target: "srm_held", payload: { value: 0.9 } },
        { kind: "arc", target: "x", payload: { source: "record_goods_receipt", target: "record_invoice_receipt" } },
      ],
    };
    const filtered = abstract(withOverlays, { minNodeShare: 0.5 });
    expect(filtered.overlays?.map((o) => o.target)).toEqual(["record_goods_receipt", "x"]);
    const collapsed = collapseGroups(withOverlays, ["receipt"]);
    expect(collapsed.overlays?.[0].target).toBe("receipt");
    expect(collapsed.overlays?.[2].payload?.source).toBe("receipt");
  });
});

describe("diff", () => {
  it("carries slice metrics, baseline metrics and deltas and tags one-sided elements", () => {
    const d = diff(globalScene, vendorScene);
    expect(d.nodes.length).toBe(globalScene.nodes.length);
    const clear = d.nodes.find((n) => n.id === "clear_invoice")!;
    expect(clear.metrics?.cases).toBe(vendorScene.nodes.find((n) => n.id === "clear_invoice")!.metrics!.cases);
    expect(clear.metrics?.a_cases).toBe(globalScene.nodes.find((n) => n.id === "clear_invoice")!.metrics!.cases);
    expect(clear.metrics?.delta_cases).toBe(clear.metrics!.cases - clear.metrics!.a_cases);
    expect(clear.tags).toContain(DIFF_TAGS.both);
    const onlyA = d.nodes.find((n) => n.id === "srm_held")!;
    expect(onlyA.tags).toContain(DIFF_TAGS.onlyA);
    expect(onlyA.metrics?.delta_cases).toBe(-(onlyA.metrics?.a_cases ?? 0));
    expect(validateGraph(d).filter((i) => i.level === "error")).toEqual([]);
  });
});
