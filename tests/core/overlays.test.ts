import { describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorSceneKey } from "../../fixtures/bpic2019";
import {
  type Box,
  type Overlay,
  HitIndex,
  MAP_TARGET,
  abstract,
  constraintOverlays,
  describeOverlay,
  layout,
  overlayGeometry,
  overlayMargin,
  overlaysFor,
} from "../../src/index";

function inside(limit: Box, b: Box, slack = 1e-6): boolean {
  return b.x >= limit.x - slack && b.y >= limit.y - slack && b.x + b.width <= limit.x + limit.width + slack && b.y + b.height <= limit.y + limit.height + slack;
}

const scene = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const items = constraintItems("global");

describe("constraintOverlays presets", () => {
  const byId = Object.fromEntries(items.map((it) => [it.description.id, it]));
  it("presence → badge with the missing share", () => {
    const o = constraintOverlays(byId.c_l1_clear_invoice_present.description, byId.c_l1_clear_invoice_present.stats);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ kind: "badge", target: "clear_invoice" });
    expect(o[0].payload?.glyph).toBe("≥1");
    expect(o[0].payload?.value).toBeCloseTo(0.2258);
    expect(o[0].payload?.text).toBe("23 % missing");
  });
  it("singularity → badge and self-loop", () => {
    const o = constraintOverlays(byId.c_l4_repeated_invoice_receipt.description, byId.c_l4_repeated_invoice_receipt.stats);
    expect(o.map((x) => x.kind)).toEqual(["badge", "selfLoop"]);
    expect(o[0].payload?.glyph).toBe("≤1");
  });
  it("exclusion → ∅ badge", () => {
    const o = constraintOverlays(byId.c_l5_cancel_invoice_receipt.description, byId.c_l5_cancel_invoice_receipt.stats);
    expect(o[0]).toMatchObject({ kind: "badge", target: "cancel_invoice_receipt" });
    expect(o[0].payload?.glyph).toBe("∅");
  });
  it("lag → arcs between the endpoints present in the graph", () => {
    const o = constraintOverlays(byId.c_l3_df1_goods_to_invoice_days.description, byId.c_l3_df1_goods_to_invoice_days.stats, { graph: globalScene });
    expect(o.length).toBe(4);
    expect(o.every((x) => x.kind === "arc")).toBe(true);
    expect(o[0].payload?.threshold).toBe(10);
    expect(o[0].payload?.coverage).toBeCloseTo(0.733);
    expect(o[0].payload?.text).toContain("threshold 10 d");
    const single = constraintOverlays(byId.c_l3_df1_goods_to_invoice_days.description, byId.c_l3_df1_goods_to_invoice_days.stats);
    expect(single).toHaveLength(1);
  });
  it("precedence → arc plus a reverse arc for violations", () => {
    const o = constraintOverlays(byId.c_l2_df1_invoice_after_goods.description, byId.c_l2_df1_invoice_after_goods.stats);
    expect(o.map((x) => x.kind)).toEqual(["arc", "arc"]);
    expect(o[1].payload?.reverse).toBe(true);
    expect(o[1].payload?.source).toBe(o[0].payload?.target);
  });
  it("balance → chip on the map or chip and tint on the group", () => {
    const map = constraintOverlays(byId.c_l7_manual_touches.description, byId.c_l7_manual_touches.stats);
    expect(map).toHaveLength(1);
    expect(map[0]).toMatchObject({ kind: "chip", target: MAP_TARGET });
    expect(map[0].payload?.gauge).toMatchObject({ threshold: 4 });
    const grp = constraintOverlays(byId.c_l7_manual_touches_order_stage.description, byId.c_l7_manual_touches_order_stage.stats);
    expect(grp.map((x) => `${x.kind}:${x.target}`)).toEqual(["chip:order", "tint:order"]);
  });
  it("applicability → hatch on nodes outside scope and a scope chip", () => {
    const o = constraintOverlays(byId.scope_consignment.description, byId.scope_consignment.stats, { graph: globalScene });
    const hatched = o.filter((x) => x.kind === "hatch").map((x) => x.target);
    expect(hatched).toContain("clear_invoice");
    expect(hatched).not.toContain("record_goods_receipt");
    expect(o[o.length - 1]).toMatchObject({ kind: "chip", target: MAP_TARGET });
    expect(o[o.length - 1].payload?.text).toBe("applies to 6 % of cases");
  });
  it("marks constraints without evaluated cases as not applicable", () => {
    const vendorItems = constraintItems(vendorSceneKey);
    const lag = vendorItems.find((it) => it.description.id === "c_l3_df1_goods_to_invoice_days")!;
    const o = constraintOverlays(lag.description, lag.stats);
    expect(o[0].payload?.text).toContain("not applicable");
    const de = constraintOverlays(lag.description, lag.stats, { locale: "de" });
    expect(de[0].payload?.text).toContain("nicht anwendbar");
  });
  it("describes overlays for tables and ARIA", () => {
    const o = constraintOverlays(byId.c_l1_clear_invoice_present.description, byId.c_l1_clear_invoice_present.stats)[0];
    expect(describeOverlay(o)).toBe("badge: Clear Invoice present — 23 % missing");
  });
});

describe("overlayGeometry", () => {
  it("keeps every shape inside the layout bounds plus the declared margin", async () => {
    for (const engine of ["elk", "dagre"] as const) {
      const positions = await layout(scene, { engine });
      const overlays = overlaysFor(items, { graph: scene });
      const g = overlayGeometry(overlays, positions);
      const margin = overlayMargin();
      expect(g.margin).toBe(margin);
      const limit: Box = { x: positions.bounds.x - margin, y: positions.bounds.y - margin, width: positions.bounds.width + 2 * margin, height: positions.bounds.height + 2 * margin };
      expect(g.shapes.length).toBeGreaterThan(5);
      const kinds = new Set(g.shapes.map((s) => s.kind));
      for (const k of ["badge", "arc", "hatch", "tint", "chip", "selfLoop"]) expect(kinds.has(k as Overlay["kind"]), `${k} missing`).toBe(true);
      for (const s of g.shapes) {
        expect(inside(limit, s), `${s.id} outside`).toBe(true);
        expect(inside(g.bounds, s), `${s.id} outside geometry bounds`).toBe(true);
        if (s.kind === "arc" || s.kind === "selfLoop") expect(s.path?.startsWith("M")).toBe(true);
      }
      expect(inside(limit, g.bounds)).toBe(true);
    }
  });

  it("stacks badges of one node without overlap and hides shapes by zoom level", async () => {
    const positions = await layout(scene, { engine: "dagre" });
    const overlays: Overlay[] = [
      { kind: "badge", target: "clear_invoice", payload: { glyph: "≥1", value: 0.2 } },
      { kind: "badge", target: "clear_invoice", payload: { glyph: "∅", value: 0.1 } },
      { kind: "badge", target: "clear_invoice", payload: { glyph: "≤1", value: 0.3 } },
    ];
    const g = overlayGeometry(overlays, positions, { lod: { badges: 0.7 } });
    expect(g.shapes).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = g.shapes[i];
        const b = g.shapes[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
      expect(g.shapes[i].minZoom).toBe(0.7);
    }
  });

  it("ignores overlays on unknown targets", async () => {
    const positions = await layout(scene, { engine: "dagre" });
    const g = overlayGeometry([{ kind: "badge", target: "nope" }, { kind: "arc", target: "x", payload: { source: "nope", target: "clear_invoice" } }], positions);
    expect(g.shapes).toEqual([]);
    expect(g.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("HitIndex", () => {
  it("finds nodes, edges and overlays under a point with overlays first", async () => {
    const positions = await layout(scene, { engine: "dagre" });
    const overlays = overlaysFor(items, { graph: scene });
    const geometry = overlayGeometry(overlays, positions);
    const index = HitIndex.fromScene(positions, geometry);
    expect(index.size).toBeGreaterThan(0);
    const box = positions.nodes.clear_invoice;
    const hits = index.at(box.x + box.width / 2, box.y + box.height / 2);
    expect(hits.some((h) => h.kind === "node" && h.id === "clear_invoice")).toBe(true);
    const badge = geometry.shapes.find((s) => s.kind === "badge" && s.overlay.target === "clear_invoice")!;
    const top = index.at(badge.x + badge.width / 2, badge.y + badge.height / 2)[0];
    expect(top.kind).toBe("overlay");
    const route = Object.entries(positions.edges)[0];
    const mid = route[1].points[0];
    const edgeHits = index.at(mid.x, mid.y, 6).filter((h) => h.kind === "edge");
    expect(edgeHits.map((h) => h.id)).toContain(route[0]);
    expect(index.at(-10000, -10000)).toEqual([]);
  });
});
