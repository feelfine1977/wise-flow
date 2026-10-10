import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type DrawContext, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { type Box, type FlowGraph, type FlowScene, type Overlay, type OverlayMark, type Positions, abstract, buildScene, createPositions, overlaysFor, toSVG } from "../../src/index";
import * as kinds from "./overlay-kinds";
import p2pMap from "./p2p-map-positions.json";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The point at `t` of the cubic in an arc's path (`M x y C x1 y1 x2 y2 x y`). */
function cubic(path: string): (t: number) => { x: number; y: number } {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return (t) => {
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return { x: w[0] * x0 + w[1] * x1 + w[2] * x2 + w[3] * x3, y: w[0] * y0 + w[1] * y1 + w[2] * y2 + w[3] * y3 };
  };
}

/** Nodes other than its ends that an arc's stroke touches, at 4,000 points along it. */
function crossedBy(mark: OverlayMark, nodes: Record<string, Box>): string[] {
  const at = cubic(mark.path!);
  const half = mark.stroke!.width / 2;
  const ends = [mark.overlay.payload?.source, mark.overlay.payload?.target];
  const hit = new Set<string>();
  for (let i = 0; i <= 4000; i++) {
    const p = at(i / 4000);
    for (const [id, b] of Object.entries(nodes)) {
      if (!ends.includes(id) && p.x >= b.x - half && p.x <= b.x + b.width + half && p.y >= b.y - half && p.y <= b.y + b.height + half) hit.add(id);
    }
  }
  return [...hit].sort();
}

const arcs = (scene: FlowScene) => scene.marks.filter((m) => m.kind === "arc");

/**
 * Two rows of activities with arcs over the first row, under it and from the
 * second row up, none of which crosses another activity or puts its label on
 * one, on another label or on a stage's title.
 */
const rows: { graph: FlowGraph; positions: Positions } = (() => {
  const box = (x: number, y: number): Box => ({ x, y, width: 150, height: 50 });
  const nodes = { n1: box(0, 0), n2: box(250, 0), n3: box(500, 0), n4: box(750, 0), m1: box(125, 200), m2: box(375, 200), m3: box(625, 200) };
  return {
    graph: {
      nodes: Object.keys(nodes).map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase() })),
      edges: [{ id: "n1n2", kind: "follows", source: "n1", target: "n2" }, { id: "m1m2", kind: "follows", source: "m1", target: "m2" }],
      overlays: [
        { kind: "arc", target: "n1->n4", payload: { constraintId: "lag", source: "n1", target: "n4", value: 0.4, coverage: 0.8, glyph: "⏱" } },
        { kind: "arc", target: "n4->n1", payload: { constraintId: "order", source: "n4", target: "n1", value: 0.1, coverage: 0.2, reverse: true, glyph: "⇐" } },
        { kind: "arc", target: "m1->m3", payload: { constraintId: "lag", source: "m1", target: "m3", value: 0.6, glyph: "⇒" } },
      ],
    },
    positions: createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT"),
  };
})();

describe("arcs that cross no other activity", () => {
  /**
   * SHA-256 of the marks (as JSON) and of `toSVG` of two scenes whose arcs
   * cross no activity but their ends and whose labels lie clear, recorded
   * before arcs began to choose their course and their label's place.
   */
  const recorded = {
    kindsMarks: "4a6335a979e8e5cac63a82f3c4e8c6fd4e3bf945d67f8ae86f3a25fa5433ba9c",
    kindsSvg: "4576129bd17cd024b6888240e58d615c2cc52dda1fbd06364d1e7f8bc2c8102a",
    rowsMarks: "d5bc4e4d1fb81fcdfb77ecbe2c7d97bc1ce1304a39a759c952a531194b84ec7f",
    rowsSvg: "f956d0cdbd76a1e869e78685fde53686457f254fdc164a06541504d6982b853f",
  };

  it("keep the marks they had", () => {
    const kindsScene = buildScene(kinds.graph, kinds.positions, { overlays: kinds.overlays });
    const rowsScene = buildScene(rows.graph, rows.positions);
    for (const scene of [kindsScene, rowsScene]) {
      expect(arcs(scene).length).toBeGreaterThan(0);
      for (const arc of arcs(scene)) expect(crossedBy(arc, scene.positions.nodes), arc.id).toEqual([]);
    }
    expect({
      kindsMarks: sha(JSON.stringify(kindsScene.marks)),
      kindsSvg: sha(toSVG({ graph: kinds.graph, positions: kinds.positions, overlays: kinds.overlays }, { legend: false })),
      rowsMarks: sha(JSON.stringify(rowsScene.marks)),
      rowsSvg: sha(toSVG({ graph: rows.graph, positions: rows.positions }, { legend: false })),
    }).toEqual(recorded);
  });
});

const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** The rectangle an arc's label may cover: 11 per character and 4 on either side, from 14 above its baseline to 4 below. */
const labelBox = (m: OverlayMark): Box => {
  const t = m.texts[0];
  return { x: t.x - t.text.length * 5.5 - 4, y: t.y - 14, width: t.text.length * 11 + 8, height: 18 };
};
/** An arc's mark with another path, to ask what that course crosses. */
const along = (m: OverlayMark, path: string): OverlayMark => ({ ...m, path });
const nodesOf = (boxes: Record<string, Box>): FlowGraph["nodes"] => Object.keys(boxes).map((id) => ({ id, kind: "activity", label: id.toUpperCase() }));
const arc = (source: string, target: string, payload: Overlay["payload"] = {}): Overlay => ({ kind: "arc", target: `${source}->${target}`, payload: { source, target, value: 0.5, glyph: "⏱", ...payload } });

describe("the course of an arc", () => {
  // a and b 600 apart; c just above a, d and e just below a and b, f over the middle.
  const boxes: Record<string, Box> = {
    a: { x: 0, y: 200, width: 100, height: 40 },
    b: { x: 600, y: 200, width: 100, height: 40 },
    c: { x: 0, y: 160, width: 100, height: 25 },
    d: { x: 0, y: 260, width: 100, height: 30 },
    e: { x: 600, y: 260, width: 100, height: 30 },
    f: { x: 300, y: 80, width: 100, height: 30 },
  };
  const scene = (order: string[] = Object.keys(boxes)) =>
    buildScene({ nodes: nodesOf(Object.fromEntries(order.map((id) => [id, boxes[id]]))), edges: [] }, createPositions({ nodes: Object.fromEntries(order.map((id) => [id, boxes[id]])), groups: {}, edges: {} }, "given", "RIGHT"), { overlays: [arc("a", "b")] });

  it("crosses the fewest activities when every course crosses one", () => {
    const [mark] = arcs(scene());
    // Above, every course leaves a's top through c; below, every course crosses d and e.
    for (let h = 40; h <= 446; h += 14) {
      expect(crossedBy(along(mark, `M50 200 C50 ${200 - h} 650 ${200 - h} 650 200`), boxes), `above at ${h}`).toContain("c");
      expect(crossedBy(along(mark, `M50 240 C50 ${240 + h} 650 ${240 + h} 650 240`), boxes), `below at ${h}`).toEqual(expect.arrayContaining(["d", "e"]));
    }
    // The default height, 0.22 × 600 = 132, also crosses f (its middle at 200 − 0.75 × 132 = 101, 5 wide on either
    // side); 118, 146 and 160 still reach f's box (80–110), 104 is the nearest that passes below it.
    expect(crossedBy(along(mark, "M50 200 C50 68 650 68 650 200"), boxes)).toEqual(["c", "f"]);
    for (const h of [118, 146, 160]) expect(crossedBy(along(mark, `M50 200 C50 ${200 - h} 650 ${200 - h} 650 200`), boxes)).toEqual(["c", "f"]);
    expect(mark.path).toBe("M50 200 C50 96 650 96 650 200");
    expect(crossedBy(mark, boxes)).toEqual(["c"]);
  });

  it("chooses the same course for the same input, in any order", () => {
    expect(scene().marks).toEqual(scene().marks);
    expect(scene([...Object.keys(boxes)].reverse()).marks).toEqual(scene().marks);
  });

  it("moves the label along the arc to the nearest point where it covers no activity", () => {
    const [mark] = arcs(scene());
    // In the middle (350, 114) and at the next six points, 1/32 apart, its 74 × 18 box reaches into f;
    // at t = 3/8 the arc is at (239.84, 126.88) and the label 8 above it clears f.
    expect(mark.texts[0]).toMatchObject({ text: "⏱ 50 %", x: 239.84375, y: 118.875 });
    expect(Object.values(boxes).filter((b) => meets(b, labelBox(mark)))).toEqual([]);
  });
});

describe("the course of an arc on the map's lowest row", () => {
  // a and b 600 apart on the map's lowest row; the arc is 10 wide (no coverage), so 5 on either side.
  const a: Box = { x: 0, y: 200, width: 100, height: 40 };
  const b: Box = { x: 600, y: 200, width: 100, height: 40 };
  const course = (boxes: Record<string, Box>) => {
    const [mark] = arcs(buildScene({ nodes: nodesOf(boxes), edges: [] }, createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT"), { overlays: [arc("a", "b")] }));
    return { mark, crossed: crossedBy(mark, boxes) };
  };

  it("takes the other side when every course on its own crosses an activity", () => {
    // c sits on a, so every course above leaves a's top through it; nothing lies below the row.
    const boxes = { a, b, c: { x: 0, y: 160, width: 100, height: 25 } };
    const { mark, crossed } = course(boxes);
    // The default height 0.22 × 600 = 132, from the bottoms (240) downwards: the middle at 240 + 0.75 × 132 = 339, the label 14 below it.
    expect(mark.path).toBe("M50 240 C50 372 650 372 650 240");
    expect(crossed).toEqual([]);
    expect(mark.texts[0]).toMatchObject({ x: 350, y: 353 });
  });

  it("rises over an activity at the top of the map when only a taller course clears it", () => {
    // f spans 150–550 × 100–190 above the row and is the map's top; d and e sit under a and b, so every course below crosses them.
    const boxes = { a, b, f: { x: 150, y: 100, width: 400, height: 90 }, d: { x: 0, y: 260, width: 100, height: 30 }, e: { x: 600, y: 260, width: 100, height: 30 } };
    // Over f's left edge (x = 150, t ≈ 0.2596) a course of height h is at 200 − 3t(1 − t)h ≈ 200 − 0.5766h; it clears f's top
    // with its stroke from h ≈ 182. Of the default 132 and its steps of 14, 174 still reaches f and 188 is the nearest clear one.
    for (const h of [76, 90, 104, 118, 132, 146, 160, 174]) expect(crossedBy(along(course(boxes).mark, `M50 200 C50 ${200 - h} 650 ${200 - h} 650 200`), boxes), `at ${h}`).toEqual(["f"]);
    const { mark, crossed } = course(boxes);
    expect(mark.path).toBe("M50 200 C50 12 650 12 650 200");
    expect(crossed).toEqual([]);
    // Its middle at 200 − 0.75 × 188 = 59, the label 8 above it.
    expect(mark.texts[0]).toMatchObject({ x: 350, y: 51 });
  });

  it("keeps its default course when every other crosses as many activities", () => {
    // c sits on a and d under it: every course above crosses c and every course below crosses d.
    const boxes = { a, b, c: { x: 0, y: 160, width: 100, height: 25 }, d: { x: 0, y: 260, width: 100, height: 30 } };
    for (const h of [40, 104, 188, 300]) {
      expect(crossedBy(along(course(boxes).mark, `M50 200 C50 ${200 - h} 650 ${200 - h} 650 200`), boxes), `above at ${h}`).toEqual(["c"]);
      expect(crossedBy(along(course(boxes).mark, `M50 240 C50 ${240 + h} 650 ${240 + h} 650 240`), boxes), `below at ${h}`).toEqual(["d"]);
    }
    const { mark, crossed } = course(boxes);
    expect(mark.path).toBe("M50 200 C50 68 650 68 650 200");
    expect(crossed).toEqual(["c"]);
  });
});

describe("the label of an arc", () => {
  // p and q 1,000 apart: two arcs on the pair both have the highest default course, 140.
  const boxes: Record<string, Box> = { p: { x: 0, y: 200, width: 100, height: 40 }, q: { x: 1000, y: 200, width: 100, height: 40 } };
  const positions = (groups: Record<string, Box> = {}) => createPositions({ nodes: boxes, groups, edges: {} }, "given", "RIGHT");

  it("keeps clear of the labels of earlier arcs", () => {
    const graph: FlowGraph = { nodes: nodesOf(boxes), edges: [] };
    const [first, second] = arcs(buildScene(graph, positions(), { overlays: [arc("p", "q", { constraintId: "lag" }), arc("p", "q", { constraintId: "order", glyph: "⇒", value: 0.25 })] }));
    expect(second.path).toBe(first.path);
    // The first at the middle, (550, 95 − 8); the second at t = 7/16, the nearest point where its box clears the first's.
    expect(first.texts[0]).toMatchObject({ text: "⏱ 50 %", x: 550, y: 87 });
    expect(second.texts[0]).toMatchObject({ text: "⇒ 25 %", x: 456.73828125, y: 88.640625 });
    expect(meets(labelBox(first), labelBox(second))).toBe(false);
  });

  it("keeps clear of a group's title", () => {
    // The title "Stage" of a group whose corner is at (505, 67) is written at (517, 89) and covers 517–559 × 75–93.
    const graph: FlowGraph = { nodes: nodesOf(boxes), edges: [], groups: [{ id: "g", kind: "stage", label: "Stage" }] };
    const [mark] = arcs(buildScene(graph, positions({ g: { x: 505, y: 67, width: 200, height: 100 } }), { overlays: [arc("p", "q")] }));
    // In the middle and at 15/32 the label's box reaches the title; at 17/32 it starts at 559.8.
    expect(mark.texts[0]).toMatchObject({ x: 596.81396484375, y: 87.41015625 });
  });
});

describe("arcs on the BPIC map of the P2P story", () => {
  // The story's abstraction and overlays, on the layout ELK gives it (committed as data).
  const shown = abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: true });
  const positions = createPositions(p2pMap as Pick<Positions, "nodes" | "groups" | "edges">, "elk", "RIGHT");
  const overlays = overlaysFor(constraintItems("global"), { graph: globalScene, locale: "en" });
  const cancel = "cancel_invoice_receipt";

  it("lays out the activities of the story's abstraction", () => {
    expect(Object.keys(positions.nodes).sort()).toEqual(shown.nodes.map((n) => n.id).sort());
    expect(shown.nodes.find((n) => n.id === cancel)?.label).toBe("Cancel Invoice Receipt");
  });

  for (const lanes of ["none", "stages"] as const) {
    it(`keeps every arc and every arc label clear of the other activities (lanes: ${lanes})`, () => {
      const scene = buildScene(shown, positions, { overlays, lanes, lodBySize: true });
      const all = arcs(scene);
      expect(all).toHaveLength(12);
      // At its default height (140) the arc from Record Goods Receipt to Record Invoice Receipt crossed Cancel Invoice Receipt.
      const [goodsToInvoice] = all;
      expect(goodsToInvoice.id).toBe("arc:record_goods_receipt->record_invoice_receipt:12");
      expect(crossedBy(along(goodsToInvoice, "M1300.28 262 C1300.28 122 2077.72 88.1 2077.72 228.1"), scene.positions.nodes)).toEqual([cancel]);
      for (const m of all) expect(crossedBy(m, scene.positions.nodes), m.id).toEqual([]);
      const labels = all.map(labelBox);
      for (const [i, l] of labels.entries()) {
        expect(Object.entries(scene.positions.nodes).filter(([, b]) => meets(b, l)).map(([id]) => id), all[i].id).toEqual([]);
        expect(labels.filter((other, j) => j !== i && meets(other, l)), all[i].id).toEqual([]);
      }
    });
  }

  it("is drawn with the same geometry by the SVG export, the Canvas map and toPNG", () => {
    const scene = buildScene(shown, positions, { overlays });
    const marks = arcs(scene);
    // SVG: each arc's path and label as the mark has them.
    const svg = toSVG({ graph: shown, positions, overlays }, { legend: false });
    const written = [...svg.matchAll(/<g class="wf-overlay wf-arc"><title>[^<]*<\/title><path d="([^"]+)"[^>]*\/><text x="([^"]+)" y="([^"]+)"/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
    expect(written).toEqual(marks.map((m) => [m.path, Number(m.texts[0].x.toFixed(2)), Number(m.texts[0].y.toFixed(2))]));
    // Canvas map and PNG: the prepared scene holds the same marks, and each arc is stroked along its path.
    const prepared = prepareScene(shown, positions, { overlays, lodBySize: false });
    expect(arcs(prepared)).toEqual(marks);
    const curves = (draw: (ctx: DrawContext) => void) => {
      const out: string[] = [];
      let path = "";
      const r = (n: number) => Number(n.toFixed(2));
      const ctx = new Proxy({} as Record<string, unknown>, {
        get: (_t, key: string) => {
          if (key === "moveTo") return (x: number, y: number) => void (path = `M${r(x)} ${r(y)}`);
          if (key === "bezierCurveTo") return (...a: number[]) => void (path += ` C${a.map(r).join(" ")}`);
          if (key === "stroke") return () => void (path.includes("C") && out.push(path));
          if (key === "measureText") return (s: string) => ({ width: s.length * 6 });
          return () => undefined;
        },
        set: () => true,
      }) as unknown as DrawContext;
      draw(ctx);
      return out;
    };
    const arcPaths = marks.map((m) => m.path);
    const isArc = (p: string) => arcPaths.includes(p);
    expect(curves((ctx) => drawScene(ctx, prepared, { x: 0, y: 0, zoom: 1, width: 4000, height: 1000 }, undefined, { cull: false })).filter(isArc)).toEqual(arcPaths);
    expect(curves((ctx) => toPNGCanvas({ graph: shown, positions, overlays }, { legend: false, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => ctx }) })).filter(isArc)).toEqual(arcPaths);
  });
});
