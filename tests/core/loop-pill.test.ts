/**
 * The self-loop as a pill on the card's border (WF-08): with
 * `overlayGeometry: { selfLoop: "pill", badgeAnchor: "border" }` the loop is
 * one hairline pill "↻ 17 %" centred on the top border at the card's right
 * end, clear of the name and left of nothing; badges keep left of it. The
 * default draws the arc as before.
 */
import { describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { type FlowGraph, buildScene, createPositions, defaultNodeSize, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";

function row(graph: FlowGraph) {
  let x = 0;
  const nodes = Object.fromEntries(graph.nodes.map((n) => {
    const s = defaultNodeSize(n);
    const box = { x, y: 40, ...s };
    x += s.width + 40;
    return [n.id, box];
  }));
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}
const positions = row(smallP2P);
const pill = { selfLoop: "pill", badgeAnchor: "border" } as const;
const loopOf = (scene: ReturnType<typeof buildScene>) => scene.marks.find((m) => m.kind === "selfLoop")!;

describe("a self-loop as a pill", () => {
  it("is one pill centred on the card's top border at its right end, clear of the name's lines", () => {
    const scene = buildScene(smallP2P, positions, { overlayGeometry: pill });
    const m = loopOf(scene);
    const card = scene.nodeMarks.find((n) => n.id === m.overlay.target)!;
    expect(m.path).toBeUndefined();
    expect([m.fill?.paint, m.stroke?.paint, m.stroke?.width, m.radius]).toEqual(["paper", "lineStrong", 1, m.box.height / 2]);
    expect(m.texts.map((t) => [t.text, t.weight, t.anchor, t.paint])).toEqual([["↻ 17 %", 600, "middle", "ink"]]);
    // Its middle on the top border; its right end at the card's.
    expect(m.box.y + m.box.height / 2).toBeCloseTo(card.box.y, 6);
    expect(m.box.x + m.box.width).toBeCloseTo(card.box.x + card.box.width, 6);
    // Not over a line of the name.
    for (const t of card.texts.filter((tx) => tx.role === "nameLine")) expect(t.y - t.size).toBeGreaterThanOrEqual(m.box.y + m.box.height - 1e-6);
  });

  it("sits just inside the border where asked, and is the arc by default", () => {
    const inside = loopOf(buildScene(smallP2P, positions, { overlayGeometry: { selfLoop: "pill", badgeAnchor: "inside" } }));
    expect(inside.box.y).toBe(positions.nodes[inside.overlay.target].y + 2);
    expect(loopOf(buildScene(smallP2P, positions)).path).toBeDefined();
  });

  it("keeps the badges left of it", () => {
    const badged = { ...smallP2P, overlays: [{ kind: "badge" as const, target: "goods_receipt", payload: { glyph: "≥1", value: 0.2 } }] };
    const scene = buildScene(badged, positions, { overlayGeometry: pill });
    const badge = scene.marks.find((m) => m.kind === "badge")!;
    expect(badge.box.x + badge.box.width).toBeLessThanOrEqual(loopOf(scene).box.x - 4 + 1e-6);
  });

  it("is drawn alike by the SVG export and the Canvas map", () => {
    const svg = toSVG({ graph: smallP2P, positions }, { overlayGeometry: pill, legend: false, theme: "default" });
    expect(svg).toMatch(/<g class="wf-overlay wf-selfloop"[^>]*><title>[^<]*<\/title><rect [^>]*fill="#ffffff" stroke="#8c94a1" stroke-width="1"\/><text [^>]*font-weight="600" text-anchor="middle" fill="#1f1f1f">↻ 17 %<\/text><\/g>/);
    const texts: string[] = [];
    const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : k === "fillText" ? (s: string) => texts.push(s) : () => undefined),
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as DrawContext;
    drawScene(ctx, prepareScene(smallP2P, positions, { overlayGeometry: pill, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 2000, height: 300 }, undefined, { cull: false });
    expect(texts).toContain("↻ 17 %");
  });
});
