import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Box, type FlowGraph, type FlowScene, type OverlayMark, type Positions, buildScene, createPositions, toSVG } from "../../src/index";
import * as kinds from "./overlay-kinds";

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
