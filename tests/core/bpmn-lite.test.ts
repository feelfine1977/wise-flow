import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { p2pStages } from "../../fixtures/p2p_stages";
import { type StageModel, END_ID, START_ID, liteCounts, liteFromGraph, liteFromStages, stageModelFromGraph } from "../../src/bpmn/index";
import { type FlowGraph, abstract, hasTag, indexGraph, validateGraph } from "../../src/index";

const idsOf = (g: FlowGraph) => [...g.nodes.map((n) => n.id), ...g.edges.map((e) => e.id)].sort();

describe("liteFromStages", () => {
  it("has one start, one end, every activity as a task and gateways only where needed", () => {
    const lite = liteFromStages(p2pStages);
    expect(validateGraph(lite)).toEqual([]);
    const starts = lite.nodes.filter((n) => n.kind === "event" && hasTag(n, "start"));
    const ends = lite.nodes.filter((n) => n.kind === "event" && hasTag(n, "end"));
    expect(starts.map((n) => n.id)).toEqual([START_ID]);
    expect(ends.map((n) => n.id)).toEqual([END_ID]);
    const activities = p2pStages.stages.flatMap((s) => s.activities.map((a) => (typeof a === "string" ? a : a.id)));
    const tasks = lite.nodes.filter((n) => n.kind === "activity");
    expect(tasks.map((n) => n.id).sort()).toEqual([...activities].sort());
    expect(tasks.every((n) => hasTag(n, "task"))).toBe(true);
    // Gateways: skip/merge for the optional requisition stage, for the three optional
    // order activities and the optional payment block, split/join for the choice stage.
    const gateways = lite.nodes.filter((n) => n.kind === "gateway");
    expect(gateways.map((n) => n.id).sort()).toEqual(
      [
        "gw_skip_requisition",
        "gw_merge_requisition",
        "gw_skip_receive_order_confirmation",
        "gw_merge_receive_order_confirmation",
        "gw_skip_change_price",
        "gw_merge_change_price",
        "gw_skip_change_quantity",
        "gw_merge_change_quantity",
        "gw_receipt_split",
        "gw_receipt_join",
        "gw_skip_remove_payment_block",
        "gw_merge_remove_payment_block",
      ].sort(),
    );
    expect(gateways.every((n) => hasTag(n, "xor"))).toBe(true);
    // Every node lies on a path from start to end.
    const idx = indexGraph(lite);
    for (const n of lite.nodes) {
      if (n.id !== START_ID) expect(idx.incoming.get(n.id)!.length, `${n.id} has no incoming flow`).toBeGreaterThan(0);
      if (n.id !== END_ID) expect(idx.outgoing.get(n.id)!.length, `${n.id} has no outgoing flow`).toBeGreaterThan(0);
    }
    expect(lite.edges.every((e) => e.kind === "flow")).toBe(true);
    expect(lite.groups?.map((g) => g.id)).toEqual(["requisition", "order", "receipt", "invoice", "payment"]);
    expect(lite.groups?.every((g) => g.kind === "lane")).toBe(true);
    expect(lite.nodes.find((n) => n.id === "record_goods_receipt")?.tags).toContain("loop");
  });

  it("emits no gateway for a plain sequence and AND gateways for a parallel stage", () => {
    const sequence: StageModel = { stages: [{ id: "a", activities: ["x", "y", "z"] }] };
    const lite = liteFromStages(sequence);
    expect(liteCounts(lite)).toEqual({ tasks: 3, gateways: 0, events: 2, flows: 4, lanes: 1 });
    expect(lite.edges.map((e) => e.id)).toEqual(["x->y", "y->z", "__start->x", "z->__end"]);
    const parallel = liteFromStages({ stages: [{ id: "p", flow: "parallel", activities: ["x", "y"] }] });
    const gw = parallel.nodes.filter((n) => n.kind === "gateway");
    expect(gw.map((n) => n.id)).toEqual(["gw_p_split", "gw_p_join"]);
    expect(gw.every((n) => hasTag(n, "and"))).toBe(true);
  });

  it("uses roles as lanes on request and rejects duplicate activity ids", () => {
    const byRole = liteFromStages(p2pStages, { lanes: "role" });
    expect(byRole.groups?.map((g) => g.id)).toEqual(["Requester", "Purchasing", "Warehouse", "Accounts payable"]);
    expect(byRole.nodes.find((n) => n.id === "clear_invoice")?.group).toBe("Accounts payable");
    expect(() => liteFromStages({ stages: [{ id: "a", activities: ["x", "x"] }] })).toThrow(/duplicate/);
  });

  it("is deterministic", () => {
    expect(liteFromStages(p2pStages)).toEqual(liteFromStages(p2pStages));
  });
});

describe("liteFromGraph", () => {
  const scene = abstract(globalScene, { minNodeShare: 0.02, minEdgeShare: 0.05 });

  it("turns paths into sequence flows with XOR gateways where nodes branch or merge", () => {
    const lite = liteFromGraph(scene);
    expect(validateGraph(lite)).toEqual([]);
    const idx = indexGraph(lite);
    for (const n of lite.nodes) {
      const outs = idx.outgoing.get(n.id)!.filter((e) => e.source !== e.target);
      const ins = idx.incoming.get(n.id)!.filter((e) => e.source !== e.target);
      if (n.kind !== "gateway") {
        expect(outs.length, `${n.id} should have a split gateway`).toBeLessThanOrEqual(1);
        expect(ins.length, `${n.id} should have a join gateway`).toBeLessThanOrEqual(1);
      } else {
        expect(hasTag(n, "split") ? outs.length : ins.length).toBeGreaterThan(1);
      }
    }
    expect(lite.nodes.filter((n) => n.kind === "activity").length).toBe(scene.nodes.filter((n) => n.kind === "activity").length);
    expect(lite.edges.every((e) => e.kind === "flow")).toBe(true);
    // Sequence flows out of a split keep the metrics and the origin of the path they replace.
    const origin = scene.edges.find((e) => e.source === "create_purchase_order_item" && e.target === "record_goods_receipt")!;
    const flow = lite.edges.find((e) => (e.payload as { origin?: string })?.origin === origin.id)!;
    expect(flow.metrics).toEqual(origin.metrics);
    expect(flow.source).toBe("gw_split_create_purchase_order_item");
    // Stage groups became lanes; self-loops became loop markers.
    expect(lite.groups?.every((g) => g.kind === "lane")).toBe(true);
    const looping = scene.edges.filter((e) => e.source === e.target).map((e) => e.source);
    for (const id of looping) expect(lite.nodes.find((n) => n.id === id)?.tags).toContain("loop");
    expect(lite.edges.some((e) => e.source === e.target)).toBe(false);
  });

  it("marks concurrent successors as AND gateways only when asked", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", metrics: { cases: 10 } },
        { id: "b", kind: "activity", label: "B", metrics: { cases: 10 } },
        { id: "c", kind: "activity", label: "C", metrics: { cases: 10 } },
        { id: "d", kind: "activity", label: "D", metrics: { cases: 10 } },
      ],
      edges: [
        { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 5 } },
        { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { count: 5 } },
        { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 5 } },
        { id: "c->b", kind: "follows", source: "c", target: "b", metrics: { count: 5 } },
        { id: "b->d", kind: "follows", source: "b", target: "d", metrics: { count: 5 } },
        { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { count: 5 } },
      ],
    };
    const xor = liteFromGraph(g);
    expect(xor.nodes.find((n) => n.id === "gw_split_a")?.tags).toContain("xor");
    const and = liteFromGraph(g, { andGateways: true });
    expect(and.nodes.find((n) => n.id === "gw_split_a")?.tags).toContain("and");
    expect(and.nodes.find((n) => n.id === "gw_join_d")?.tags).toContain("and");
    // Start and end events were added for the free ends.
    expect(and.edges.find((e) => e.id === `${START_ID}->a`)).toBeTruthy();
    expect(and.edges.find((e) => e.id === `d->${END_ID}`)).toBeTruthy();
  });

  it("yields the same ids regardless of element order", () => {
    const a = liteFromGraph(scene);
    const shuffled = { ...scene, nodes: [...scene.nodes].reverse(), edges: [...scene.edges].reverse() };
    const b = liteFromGraph(shuffled);
    expect(idsOf(a)).toEqual(idsOf(b));
  });
});

describe("stageModelFromGraph", () => {
  it("lists the activities of every stage by strength", () => {
    const model = stageModelFromGraph(globalScene, { limit: 3 });
    expect(model.stages.map((s) => s.id)).toEqual(["requisition", "order", "receipt", "invoice", "payment"]);
    const order = model.stages.find((s) => s.id === "order")!;
    expect(order.activities.map((a) => (typeof a === "string" ? a : a.id))).toEqual(["create_purchase_order_item", "receive_order_confirmation", "change_quantity"]);
    const lite = liteFromStages(model);
    expect(liteCounts(lite).tasks).toBe(model.stages.reduce((n, s) => n + s.activities.length, 0));
  });
});
