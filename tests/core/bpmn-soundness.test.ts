import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../../fixtures/p2p_stages";
import { importBpmn, liteFromGraph, liteFromStages } from "../../src/bpmn/headless";
import { type FlowGraph, hasTag, validateGateways } from "../../src/index";
import { playTokens } from "./token-game";

// The models of the BPMN stories: the stage model (lanes by stage, role or none),
// the hand-written small model and the model built from the log, at the story's
// abstraction and over the range of its sliders, with AND gateways on and off.
const sound = { complete: true, completes: true, stuck: [], unsafe: [] };
const fromLog = (minNodeShare: number, minEdgeShare: number, andGateways: boolean) =>
  liteFromGraph(globalScene, { abstraction: { minNodeShare, minEdgeShare, keepConnected: true }, andGateways });
const parallel = (g: FlowGraph) => g.nodes.filter((n) => hasTag(n, "and")).map((n) => n.id);

describe("token game on the story models", () => {
  it("finds the stage model sound with every lane choice", () => {
    for (const lanes of ["stage", "role", "none"] as const) {
      const lite = liteFromStages(withSceneMetrics(p2pStages, globalScene), { lanes });
      // One token, exclusive gateways only: one state per flow and the empty state.
      expect(playTokens(lite)).toEqual({ ...sound, states: lite.edges.length + 1 });
      expect(validateGateways(lite)).toEqual([]);
    }
  });

  it("finds the model from the log sound at the story's abstraction, with and without AND gateways", () => {
    const xor = fromLog(0.05, 0.12, false);
    const and = fromLog(0.05, 0.12, true);
    // The only concurrent pair here, Record Goods Receipt and Vendor creates invoice,
    // has no common split, so their join before Record Invoice Receipt is exclusive.
    expect(and).toEqual(xor);
    expect(and.nodes.find((n) => n.id === "gw_join_record_invoice_receipt")?.tags).toContain("xor");
    for (const lite of [xor, and]) {
      expect(playTokens(lite)).toEqual({ ...sound, states: lite.edges.length + 1 });
      expect(validateGateways(lite)).toEqual([]);
    }
  });

  it("finds every model the story's sliders reach sound, with parallel blocks where the log has them", () => {
    let blocks = 0;
    for (let n = 0; n <= 50; n += 5) {
      for (let e = 0; e <= 60; e += 4) {
        for (const andGateways of [false, true]) {
          const lite = fromLog(n / 100, e / 100, andGateways);
          expect(playTokens(lite), `${n} % / ${e} %`).toMatchObject(sound);
          expect(validateGateways(lite)).toEqual([]);
          if (parallel(lite).length) blocks++;
        }
      }
    }
    expect(blocks).toBeGreaterThan(0);
    // At 15 % of the activities and 12 % of the paths, Create Purchase Order Item is
    // followed by Record Goods Receipt and Vendor creates invoice, which follow each
    // other in both orders and both lead only to Record Invoice Receipt: one block.
    const block = fromLog(0.15, 0.12, true);
    expect(parallel(block)).toEqual(["gw_split_create_purchase_order_item", "gw_join_record_invoice_receipt"]);
    expect(block.edges.map((e) => e.id)).toEqual(
      expect.arrayContaining([
        "gw_split_create_purchase_order_item->record_goods_receipt",
        "gw_split_create_purchase_order_item->vendor_creates_invoice",
        "record_goods_receipt->gw_join_record_invoice_receipt",
        "vendor_creates_invoice->gw_join_record_invoice_receipt",
      ]),
    );
    // Its two branches give 2 × 2 states with a token on each, one per flow of the
    // block, so the count matches one state per flow and the empty state again.
    expect(playTokens(block)).toEqual({ ...sound, states: block.edges.length + 1 });
  });

  it("finds the small model sound", async () => {
    const small = (await importBpmn(readFileSync(new URL("../../fixtures/p2p_small.bpmn", import.meta.url), "utf8"))).graph;
    expect(validateGateways(small)).toEqual([]);
    // Two exclusive choices (goods or service, approved or rejected), one token:
    // one state per flow of its 13 and the empty state.
    expect(playTokens(small)).toEqual({ ...sound, states: 14 });
  });
});
