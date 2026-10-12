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

/** What an arc keeps clear of other nodes: half its width (1.5) and 4 of paper. */
const CLEAR = 4.75;

/** Nodes other than its ends that an arc's stroke and the paper it keeps around it touch, at 4,000 points along it. */
function crossedBy(mark: OverlayMark, nodes: Record<string, Box>): string[] {
  const at = cubic(mark.path!);
  const half = CLEAR;
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
   * before arcs began to choose their course and their label's place. The
   * overlay kinds' SVG was recorded again when groups became marks of the
   * scene: only its stage group's outline changed, drawn at full opacity.
   * All four were recorded again when deviations began to be drawn in the
   * one accent, arcs at one width with their label in a pill and badges as
   * pills above their activity; the arcs keep their courses here.
   * Recorded again when activities became cards and the sizes, radii and
   * strokes moved onto their scales: the arcs' marks are unchanged (the rows'
   * marks keep their digest); of the overlay kinds' other marks the tint has a
   * radius of 8 (10), the hatch 4 (6), the self-loop is 2 wide (2.5), badges are
   * outlined 1 wide, and badge, chip and self-loop texts are 11 px with weights
   * of 600 (10 px, 700). In the SVG of both, activities are cards and groups
   * solid hairlines.
   * Both SVGs were recorded again when the legend became a key and the numbers
   * honest, paths being labelled with their cases: compared element by element
   * only the paths changed. None of them has a count: they are not evaluated,
   * drawn in the line colour and labelled "–".
   * Both SVGs were recorded again when paths began to end in a head that
   * grows with the line: compared element by element only the paths' lines
   * changed, each ending 2.25 before its route inside its head of 12, whose
   * marker's triangle now lies 2.25 beyond the end of the line; the marks keep
   * their digests.
   * The overlay kinds' marks and SVG were recorded again when a group's chips
   * began to keep clear of activities, titles, badges, self-loops and other
   * chips: compared mark by mark only the chip of stage s2 moved, from its
   * title row over C (442, −4) to below the stage (450, 54); the rows keep
   * their digests.
   */
  const recorded = {
    kindsMarks: "92f313412330544a8996cf549e95ec33819daf95fe965c50e01339c4c2638a70",
    kindsSvg: "61b5130d198250ee01a4df6909f2a55408b06d8b6252492cd4528b18900e4aed",
    rowsMarks: "e96c088a2c77eb0aab68e807e8d8f733d3ddc156cde9b25f66d8a4a0356fe408",
    rowsSvg: "300ecc6fea8196351006eabe9ea516d8f2637b8f7fa2a522a5e243196724aebe",
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
/** The pill an arc's label is written in. */
const labelBox = (m: OverlayMark): Box => m.pill!.box;
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

  it("puts the label on the arc's middle where it covers no activity", () => {
    const [mark] = arcs(scene());
    // "late 50 %": 9 characters of 0.55 × 11 and 6 on either side, 66.45 wide and 18 tall, centred on the middle (350, 122),
    // below f (80–110).
    expect(mark.texts[0]).toMatchObject({ text: "late 50 %", x: 350, y: 122.5 });
    expect(mark.pill!.box).toEqual({ x: 350 - 66.45 / 2, y: 113, width: 66.45, height: 18 });
    expect(Object.values(boxes).filter((b) => meets(b, labelBox(mark)))).toEqual([]);
  });

  it("moves the label along the arc to the nearest point where it covers no activity", () => {
    // g sits just above the middle of the course: 4.75 clear of the arc, but in the way of the pill's top (113).
    const withG = { ...boxes, g: { x: 330, y: 100, width: 40, height: 15 } };
    const [mark] = arcs(buildScene({ nodes: nodesOf(withG), edges: [] }, createPositions({ nodes: withG, groups: {}, edges: {} }, "given", "RIGHT"), { overlays: [arc("a", "b")] }));
    expect(mark.path).toBe("M50 200 C50 96 650 96 650 200");
    // At 1/32 on either side of the middle the pill (±33.2 around 321.9 and 378.1) still reaches g (330–370); at t = 7/16 the
    // arc is at (50 + 600 × 0.40674, 200 − 104 × 0.73828) = (294.04, 123.22) and the pill ends at 327.27, clear of g.
    expect(mark.texts[0]).toMatchObject({ text: "late 50 %", x: 294.04296875, y: 123.71875 });
    expect(Object.values(withG).filter((b) => meets(b, labelBox(mark)))).toEqual([]);
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
    // The label's pill centred on the middle (350, 339).
    expect(mark.texts[0]).toMatchObject({ x: 350, y: 339.5 });
  });

  it("rises over an activity at the top of the map when only a taller course clears it", () => {
    // f spans 150–550 × 100–190 above the row and is the map's top; d and e sit under a and b, so every course below crosses them.
    const boxes = { a, b, f: { x: 150, y: 100, width: 400, height: 90 }, d: { x: 0, y: 260, width: 100, height: 30 }, e: { x: 600, y: 260, width: 100, height: 30 } };
    // Over f's left edge (x = 150, t ≈ 0.2596) a course of height h is at 200 − 3t(1 − t)h ≈ 200 − 0.5766h; it clears f's top
    // with the 4.75 it keeps from h ≈ 181.7. Of the default 132 and its steps of 14, 174 still reaches f and 188 is the nearest clear one.
    for (const h of [76, 90, 104, 118, 132, 146, 160, 174]) expect(crossedBy(along(course(boxes).mark, `M50 200 C50 ${200 - h} 650 ${200 - h} 650 200`), boxes), `at ${h}`).toEqual(["f"]);
    const { mark, crossed } = course(boxes);
    expect(mark.path).toBe("M50 200 C50 12 650 12 650 200");
    expect(crossed).toEqual([]);
    // Its middle at 200 − 0.75 × 188 = 59, the label's pill centred on it.
    expect(mark.texts[0]).toMatchObject({ x: 350, y: 59.5 });
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
    // The first on the middle, (550, 95); the second ("order 25 %", 72.5 wide) at t = 7/16, (456.74, 96.64), the nearest point
    // where its pill clears the first's (516.8–583.2): at 15/32 it would end at 539.4, at 17/32 start at 560.6.
    expect(first.texts[0]).toMatchObject({ text: "late 50 %", x: 550, y: 95.5 });
    expect(second.texts[0]).toMatchObject({ text: "order 25 %", x: 456.73828125, y: 97.140625 });
    expect(meets(labelBox(first), labelBox(second))).toBe(false);
  });

  it("keeps clear of a group's title", () => {
    // The title "Stage" of a group whose corner is at (505, 67) is written at (517, 89) and covers 517–559 × 75–93.
    const graph: FlowGraph = { nodes: nodesOf(boxes), edges: [], groups: [{ id: "g", kind: "stage", label: "Stage" }] };
    const [mark] = arcs(buildScene(graph, positions({ g: { x: 505, y: 67, width: 200, height: 100 } }), { overlays: [arc("p", "q")] }));
    // In the middle the pill (516.8–583.2 × 86–104) reaches the title; at 17/32 the arc is at (596.81, 95.41) and the pill starts at 563.6.
    expect(mark.texts[0]).toMatchObject({ x: 596.81396484375, y: 95.91015625 });
  });

  /** The box a text covers as drawn: 0.55 em per character, from 0.8 em above its baseline to 0.25 em below (half an em each way from a middle baseline). */
  const drawn = (t: OverlayMark["texts"][number]): Box => {
    const width = Array.from(t.text).length * 0.55 * t.size;
    const [up, down] = t.baseline === "middle" ? [t.size / 2, t.size / 2] : [0.8 * t.size, 0.25 * t.size];
    return { x: t.anchor === "middle" ? t.x - width / 2 : t.anchor === "end" ? t.x - width : t.x, y: t.y - up, width, height: up + down };
  };

  it("keeps clear of a badge, also of one on its own start", () => {
    // a's badge "∅ · 45 %" is a pill wholly above a, from a's right edge: 8 × 6.05 + 2 × 6 = 60.4 wide and 18 high,
    // 2 above a's top, covering 1750.6–1811 × 36–54. The arc from a to b is 44 high; in the middle, at (1821, 57), its
    // pill "late 2 %" (60.4 wide) would cover 1790.8–1851.2 × 48–66, the badge with it.
    const at: Record<string, Box> = { a: { x: 1631, y: 56, width: 180, height: 48 }, b: { x: 1831, y: 124, width: 180, height: 48 } };
    const graph: FlowGraph = { nodes: nodesOf(at), edges: [] };
    const overlays: Overlay[] = [
      { kind: "badge", target: "a", payload: { constraintId: "never", glyph: "∅", value: 0.45, text: "45 % occur" } },
      arc("a", "b", { constraintId: "lag", value: 0.02, coverage: 0.8 }),
    ];
    const scene = buildScene(graph, createPositions({ nodes: at, groups: {}, edges: {} }, "given", "RIGHT"), { overlays });
    const badge = scene.marks.find((m) => m.kind === "badge")!;
    expect(badge.box).toEqual({ x: 1750.6, y: 36, width: 8 * 0.55 * 11 + 2 * 6, height: 18 });
    const [mark] = arcs(scene);
    expect(mark.texts[0].text).toBe("late 2 %");
    expect(meets(drawn(mark.texts[0]), badge.box)).toBe(false);
    expect(Object.values(at).some((b) => meets(drawn(mark.texts[0]), b))).toBe(false);
  });

  it("keeps clear of a path's count", () => {
    // From the BPIC map at 50 %: the path from Vendor creates invoice back to Record Goods Receipt runs below both,
    // its count "110k" in the middle of the long lower stretch, where the reverse arc's label "⇐ 52 %" was written too.
    const at: Record<string, Box> = { goods: { x: 437.375, y: 149, width: 180, height: 48 }, invoice: { x: 736.40625, y: 136.5, width: 180, height: 48 } };
    const route = [[916.40625, 160.5], [941.40625, 160.5], [948.5625, 217.75], [941.40625, 275], [412.375, 275], [406, 224], [412.375, 173], [437.375, 173]].map(([x, y]) => ({ x, y }));
    const graph: FlowGraph = { nodes: nodesOf(at), edges: [{ id: "back", kind: "follows", source: "invoice", target: "goods", metrics: { count: 109557 } }] };
    const overlays: Overlay[] = [
      arc("goods", "invoice", { constraintId: "order", glyph: "⇒", value: 0.5167, coverage: 0.733 }),
      arc("invoice", "goods", { constraintId: "order", glyph: "⇐", value: 0.5167, coverage: 0.5167, reverse: true }),
    ];
    const scene = buildScene(graph, createPositions({ nodes: at, groups: {}, edges: { back: { points: route } } }, "given", "RIGHT"), { overlays });
    const [count] = scene.edgeMarks[0].texts;
    expect(count.text).toBe("110k");
    for (const m of arcs(scene)) expect(meets(drawn(m.texts[0]), drawn(count)), m.id).toBe(false);
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
    const written = [...svg.matchAll(/<g class="wf-overlay wf-arc"><title>[^<]*<\/title><path d="([^"]+)"[^>]*\/><rect class="wf-pill"[^>]*\/><text x="([^"]+)" y="([^"]+)"/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
    // A label is given by its middle and written on a baseline 0.3 × its size (11) lower.
    expect(written).toEqual(marks.map((m) => [m.path, Number(m.texts[0].x.toFixed(2)), Number((m.texts[0].y + 3.3).toFixed(2))]));
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
