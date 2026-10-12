import { describe, expect, it } from "vitest";
import { type FlowGraph, type Overlay, createPositions } from "../../src/index";
import { type DrawState, type PreparedScene, type View, CanvasRenderer, drawScene, prepareScene } from "../../src/canvas/index";
import { drawn, inkContext, watch } from "../support/ink";

// Elements whose box lies outside a culled view while something they draw
// reaches into it. Each case was first found by the searching comparison in
// canvas-reference.test.ts and is pinned here with hand-placed geometry.

/**
 * Two activities of 180 × 48 at the origin and at x = 300, joined by a path of
 * 1,200 transitions (it gives no cases, so it is labelled with them) whose
 * straight route runs from (180, 24) to (300, 24) with its count label 4 above
 * the middle, at (240, 20). `A` repeats in two of its four
 * cases when `loop` is set, which gives it a self-loop mark at its top right.
 */
function pair(overlays: Overlay[] = [], loop = false, groups?: { group: FlowGraph["groups"]; boxes: Record<string, { x: number; y: number; width: number; height: number }> }): PreparedScene {
  const graph: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: "A", metrics: { cases: 4 } },
      { id: "b", kind: "activity", label: "B", metrics: { cases: 4 } },
    ],
    edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 1200 } }, ...(loop ? [{ id: "aa", kind: "follows" as const, source: "a", target: "a", metrics: { count: 2, cases: 2 } }] : [])],
    overlays,
    groups: groups?.group,
  };
  const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 48 }, b: { x: 300, y: 0, width: 180, height: 48 } }, groups: groups?.boxes ?? {}, edges: {} }, "given", "RIGHT");
  return prepareScene(graph, positions, { lodBySize: false });
}

/** A view of 400 × 300 at zoom 1 whose left edge is at flow `x` and whose top edge is at flow `y`. */
const viewFrom = (x: number, y = -150): View => ({ x: -x, y: -y, zoom: 1, width: 400, height: 300 });

const none: DrawState = { selection: { nodes: [], edges: [], groups: [] } };

/** What a culled draw of the view draws: `list:id` of every element with ink, and every text written. */
function culled(scene: PreparedScene, view: View, state: DrawState = none) {
  const ink = inkContext();
  drawScene(ink.ctx, watch(scene, ink.begin), view, state, { cull: true });
  const visits = drawn(ink.visits);
  return { ids: visits.map((v) => `${v.list}:${v.id}`), texts: visits.flatMap((v) => v.calls.filter((c) => c.startsWith("fillText(")).map((c) => JSON.parse(c.slice(9, -1))[0] as string)) };
}

describe("a culled view draws what reaches into it", () => {
  it("draws a node whose outline reaches into the view while its box ends outside it", () => {
    // A's box ends at 180; its outline is 2 wide, so its ink reaches 181. The view begins at 180.5.
    expect(culled(pair(), viewFrom(180.5)).ids).toContain("nodes:a");
    // Beyond the selection ring's reach of 6 the node is not read.
    expect(culled(pair(), viewFrom(186.5)).ids).not.toContain("nodes:a");
  });

  it("draws the selection ring and the focus rectangle of a node whose box ends outside the view", () => {
    // The ring is drawn 3 outside the box, 6 wide: it reaches 186; the focus rectangle 4 outside, 2 wide: 185.
    expect(culled(pair(), viewFrom(184), { ...none, selection: { nodes: ["a"], edges: [], groups: [] } }).ids).toContain("nodes:a");
    expect(culled(pair(), viewFrom(184), { ...none, focused: "a" }).ids).toContain("nodes:a");
  });

  it("draws an edge whose count label reaches into the view above its route", () => {
    // The route lies at y = 24 and its label's halo reaches up to 10.5; the view ends at y = 14.
    const { ids, texts } = culled(pair(), viewFrom(-100, 14 - 300));
    expect(ids).toContain("edges:ab");
    expect(texts).toContain("1,200");
  });

  it("draws a badge whose outline reaches into the view to the right of it", () => {
    // The badge writes its glyph and share in a pill wholly above A: "≥1 · 25 %" at 11 px is 9 × 6.05 + 2 × 6 = 66.45
    // wide and ends at A's right edge, 180; its outline, 1 wide, reaches 180.5. The view begins at 180.25.
    const scene = pair([{ kind: "badge", target: "a", payload: { constraintId: "presence", glyph: "≥1", value: 0.25 } }]);
    const { ids, texts } = culled(scene, viewFrom(180.25, -150));
    expect(ids.some((id) => id.startsWith("marks:badge:a"))).toBe(true);
    expect(texts).toContain("≥1 · 25 %");
  });

  it("draws a self-loop whose label reaches into the view", () => {
    // The loop's box ends at 205; its label is written from 186 on. The view begins at 210.
    const { ids, texts } = culled(pair([], true), viewFrom(210));
    expect(ids.some((id) => id.startsWith("marks:selfLoop:a"))).toBe(true);
    expect(texts.some((t) => t.startsWith("↻"))).toBe(true);
  });

  it("draws a group whose title reaches into the view beyond its box", () => {
    // The group is 60 wide and ends at 60; its title starts at 12 and is longer than the box. The view begins at 100.
    const scene = pair([], false, { group: [{ id: "g", kind: "stage", label: "A rather long group title" }], boxes: { g: { x: 0, y: 100, width: 60, height: 80 } } });
    const { ids, texts } = culled(scene, viewFrom(100, 0));
    expect(ids).toContain("groups:g");
    expect(texts).toContain("A rather long group title");
  });

  it("draws a gateway wider than tall whose diamond reaches into the view below its box", () => {
    const graph: FlowGraph = { nodes: [{ id: "x", kind: "gateway", label: "X", tags: ["xor"] }], edges: [] };
    // The diamond spans half the width, 100, above and below the centre at y = 24: it reaches y = 124 while the box ends at 48.
    const scene = prepareScene(graph, createPositions({ nodes: { x: { x: 0, y: 0, width: 200, height: 48 } }, groups: {}, edges: {} }, "given", "RIGHT"), { lodBySize: false });
    expect(culled(scene, viewFrom(-100, 110)).ids).toContain("nodes:x");
  });
});

describe("an arc between ends at different heights", () => {
  /** A reverse arc below the map from `s` (lower) to `t` (upper). */
  const scene = () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "s", kind: "activity", label: "S", metrics: { cases: 4 } },
        { id: "t", kind: "activity", label: "T", metrics: { cases: 4 } },
      ],
      edges: [{ id: "st", kind: "follows", source: "s", target: "t", metrics: { count: 4 } }],
      overlays: [{ kind: "arc", target: "ts", payload: { constraintId: "order", constraintType: "precedence", source: "s", target: "t", reverse: true, value: 0.05, coverage: 0.56, glyph: "⇐", text: "Reverse" } }],
    };
    return prepareScene(graph, createPositions({ nodes: { s: { x: 0, y: 500, width: 180, height: 48 }, t: { x: 960, y: 300, width: 180, height: 48 } }, groups: {}, edges: {} }, "given", "RIGHT"), { lodBySize: false });
  };

  it("has a box that holds its whole curve, which is farthest from the ends nearer the lower one", () => {
    const arc = scene().marks.find((m) => m.kind === "arc")!;
    // M90 548 C90 688 1050 488 1050 348: both handles 140 below their ends.
    const n = arc.path!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const [p0, p1, p2, p3] = [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6), n.slice(6, 8)];
    expect([p0, p1, p2, p3]).toEqual([[90, 548], [90, 688], [1050, 488], [1050, 348]]);
    let maxY = -Infinity;
    for (let i = 0; i <= 10_000; i++) {
      const t = i / 10_000;
      const u = 1 - t;
      maxY = Math.max(maxY, u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]);
    }
    // At the middle parameter the curve is at 553; its lowest point, near t = 0.24, lies about 596.
    expect(maxY).toBeGreaterThan(590);
    expect(arc.box.y + arc.box.height).toBeGreaterThanOrEqual(maxY);
  });

  it("is drawn where only its bulge reaches into the view", () => {
    // The view begins at y = 580, below the label (ending at 571) and the middle of the curve (553), above the bulge (596).
    const view: View = { x: 0, y: -580, zoom: 1, width: 1200, height: 300 };
    expect(culled(scene(), view).ids.some((id) => id.startsWith("marks:arc:"))).toBe(true);
  });
});

describe("hit tests return what is painted on top", () => {
  function renderer(scene: PreparedScene) {
    const ink = inkContext();
    const canvas = { width: 0, height: 0, style: {}, getContext: () => ink.ctx } as unknown as HTMLCanvasElement;
    const r = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
    r.setScene(scene);
    r.resize(800, 600);
    r.setViewport({ x: 0, y: 0, zoom: 1 });
    r.draw();
    return r;
  }

  it("returns the node under the pointer inside a tinted group, and the tint where the group is bare", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A", group: "g", metrics: { cases: 4 } }],
      edges: [],
      groups: [{ id: "g", kind: "stage", label: "G" }],
      overlays: [{ kind: "tint", target: "g", payload: { constraintId: "balance", constraintType: "balance", value: 0.5 } }],
    };
    const scene = prepareScene(graph, createPositions({ nodes: { a: { x: 100, y: 76, width: 180, height: 48 } }, groups: { g: { x: 0, y: 0, width: 400, height: 200 } }, edges: {} }, "given", "RIGHT"), { lodBySize: false });
    const r = renderer(scene);
    expect(r.hitAt(190, 100)).toMatchObject({ kind: "node", id: "a" });
    expect(scene.hit.at(190, 100).map((h) => `${h.kind}:${h.shapeId ?? h.id}`)).toEqual(["node:a", "overlay:tint:g:0", "group:g"]);
    expect(r.hitAt(20, 20)).toMatchObject({ kind: "overlay", shapeId: "tint:g:0" });
  });

  it("returns the node where an arc crosses it, and the arc where it runs clear", () => {
    // S is overlapped above and below by M and N, so the arc from S to T crosses one of them whichever side it takes.
    const graph: FlowGraph = {
      nodes: ["s", "t", "m", "n"].map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase(), metrics: { cases: 4 } })),
      edges: [{ id: "st", kind: "follows", source: "s", target: "t", metrics: { count: 4 } }],
      overlays: [{ kind: "arc", target: "st", payload: { constraintId: "lag", constraintType: "lag", source: "s", target: "t", value: 0.5, glyph: "⏱", text: "Lag" } }],
    };
    const nodes = { s: { x: 0, y: 0, width: 180, height: 48 }, t: { x: 600, y: 0, width: 180, height: 48 }, m: { x: 0, y: -20, width: 180, height: 48 }, n: { x: 0, y: 20, width: 180, height: 48 } };
    const scene = prepareScene(graph, createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT"), { lodBySize: false });
    const arc = scene.marks.find((x) => x.kind === "arc")!;
    const r = renderer(scene);
    // The arc leaves S's top at (90, 0) and rises through M.
    expect(arc.path!.startsWith("M90 0 ")).toBe(true);
    expect(r.hitAt(90, -10)).toMatchObject({ kind: "node", id: "m" });
    // At its apex above the row, 99 up for a span of 600, nothing else is near.
    expect(r.hitAt(390, -99)).toMatchObject({ kind: "overlay", shapeId: arc.id });
  });
});
