/**
 * Path emphasis (WF-06): a label by the path's width on the screen
 * (`lod.edgeLabels: { minPx }`), every path touching a selected activity
 * labelled with the share of that activity's cases it carries, and a backward
 * path a step thinner and fainter until an activity it touches is selected.
 */
import { describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { type FlowGraph, buildScene, createPositions, defaultNodeSize, defaultTheme, emphasisLabel, instrumentTheme, lodAt, pathLabelShown, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";

function row(graph: FlowGraph) {
  let x = 0;
  const nodes = Object.fromEntries(graph.nodes.map((n) => {
    const s = defaultNodeSize(n);
    const box = { x, y: 40, ...s };
    x += s.width + 60;
    return [n.id, box];
  }));
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}
const positions = row(smallP2P);
const nodeOf = (id: string) => smallP2P.nodes.find((n) => n.id === id);

/** The texts a Canvas drawing writes with a halo: the paths' labels (and self-loops'). */
function written(draw: (ctx: DrawContext) => void): string[] {
  const out: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : k === "strokeText" ? (s: string) => out.push(s) : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as DrawContext;
  draw(ctx);
  return out;
}

describe("a path's label by its width on the screen", () => {
  it("is drawn while the path is at least minPx wide at the zoom", () => {
    const rules = { edgeLabels: { minPx: 2 } };
    expect([pathLabelShown(2, 1, rules), pathLabelShown(1.99, 1, rules), pathLabelShown(4, 0.5, rules), pathLabelShown(4, 0.49, rules)]).toEqual([true, false, true, false]);
    // The zoom rule is as before; a touching path shows unless asked not to.
    expect([pathLabelShown(1, 0.5, {}), pathLabelShown(1, 0.6, {}), pathLabelShown(1, 0.1, rules, true), pathLabelShown(1, 0.1, { ...rules, selectedPaths: "none" }, true)]).toEqual([false, true, true, false]);
    expect(lodAt(0.01, rules).edgeLabels).toBe(true);
  });

  it("draws exactly the labels of paths at least 2 px wide in the Canvas map and the SVG export", () => {
    const scene = prepareScene(smallP2P, positions, { lod: { edgeLabels: { minPx: 2 } }, lodBySize: false });
    const wide = scene.edgeMarks.filter((m) => m.width >= 2 && m.texts.length).map((m) => m.texts[0].text).sort();
    expect(wide.length).toBeGreaterThan(0);
    expect(wide.length).toBeLessThan(scene.edgeMarks.filter((m) => m.texts.length).length);
    const drawn = written((ctx) => drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 2000, height: 300 }, undefined, { cull: false, lodZoom: 1 }));
    // The halo texts: the wide paths' labels, and the self-loop's.
    expect(drawn.filter((t) => !t.startsWith("↻")).sort()).toEqual(wide);
    const svg = toSVG({ graph: smallP2P, positions }, { theme: "default", legend: false, lodZoom: 1 });
    expect(svg).toContain(">1,000</text>");
  });
});

describe("paths touching a selected activity", () => {
  it("add the share of the selected activity's cases they carry, which sums to its in- and out-flow", () => {
    const scene = buildScene(smallP2P, positions);
    const chosen = new Set(["goods_receipt"]);
    const labels = scene.edgeMarks.filter((m) => m.edge.source === "goods_receipt" || m.edge.target === "goods_receipt").map((m) => [m.id, emphasisLabel(m, chosen, nodeOf)]);
    // Record Goods Receipt has 900 cases: 800 come from Create PO (89 %), 110 after a price change (12 %); 800 go on to the invoice (89 %).
    expect(Object.fromEntries(labels)).toMatchObject({ "create_po->goods_receipt": "800 · 89 %", "change_price->goods_receipt": "110 · 12 %", "goods_receipt->invoice_receipt": "800 · 89 %" });
    expect(emphasisLabel(scene.edgeMarks.find((m) => m.id === "invoice_receipt->clear_invoice")!, chosen, nodeOf)).toBe("780");
  });

  it("are labelled and carry the share on the Canvas map where the style asks", () => {
    const scene = prepareScene(smallP2P, positions, { style: { selectedShare: true }, lod: { edgeLabels: 5 }, lodBySize: false });
    const state = { selection: { nodes: ["goods_receipt"], edges: [], groups: [] } };
    const texts = written((ctx) => drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 2000, height: 300 }, state, { cull: false, lodZoom: 1 }));
    expect(texts).toEqual(expect.arrayContaining(["800 · 89 %", "110 · 12 %"]));
    // Only the touching paths' labels pass the zoom rule of 5.
    expect(texts.filter((t) => !t.startsWith("↻")).sort()).toEqual(["110 · 12 %", "150 · 17 %", "800 · 89 %", "800 · 89 %"]);
  });
});

describe("a backward path", () => {
  const back = (theme = instrumentTheme) => buildScene(smallP2P, positions, { theme }).edgeMarks.find((m) => m.backward)!;

  it("is a step thinner and fainter in the instrument theme, lifted while an activity it touches is selected", () => {
    const own = buildScene(smallP2P, positions, { theme: { ...instrumentTheme, stroke: { ...instrumentTheme.stroke, backwardStep: 0 }, opacity: { ...instrumentTheme.opacity, backward: 1 } } }).edgeMarks.find((m) => m.backward)!;
    const m = back();
    expect(m.id).toBe("cancel_invoice->invoice_receipt");
    expect(m.width).toBe(Math.max(1, Number((own.width - 1).toFixed(2))));
    expect(m.opacity).toBe(0.6);
    expect(m.lift).toMatchObject({ width: own.width });
    expect(m.lift!.opacity).toBeUndefined();
  });

  it("is drawn as any path in the default theme", () => {
    const m = back(defaultTheme);
    expect([m.opacity, m.lift]).toEqual([undefined, undefined]);
  });
});
