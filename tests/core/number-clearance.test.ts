import { describe, expect, it } from "vitest";
import { buildScene, createPositions, estimateTextWidth, readableAt, type FlowGraph } from "../../src/index";
import { figureFrame, numbered } from "../../src/core/figure";
import { drawScene, prepareScene } from "../../src/canvas/index";
import { recordingContext } from "../browser/parity/canvas";
import { globalScene } from "../../fixtures/bpic2019";
import { layout } from "../../src/index";
import { RUNGS, optionsOf, shownGraph } from "../support/ladder";

const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "Approve" }, { id: "b", kind: "activity", label: "Pay" }], edges: [] };
const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 0, y: 84, width: 180, height: 64 } }, edges: {}, groups: {} }, "given", "RIGHT");

describe("activity reference clearance", () => {
  it("separates reference glyphs whose card centres are only 4.2 screen pixels apart", () => {
    const scene = buildScene(graph, positions);
    const zoom = 0.05;
    const state = readableAt(scene.readable, zoom, 9);
    const [a, b] = numbered(scene, state.floor, 260, estimateTextWidth).texts.map((n) => n.text);
    // Centres (90,32) and (90,116) are 84*.05 = 4.2 px apart.
    expect(a.size * zoom).toBeGreaterThanOrEqual(9);
    expect(b.size * zoom).toBeGreaterThanOrEqual(9);
    expect(Math.abs(a.x - b.x) * zoom >= 0.55 * 9 || Math.abs(a.y - b.y) * zoom >= 9).toBe(true);
  });

  it("links a displaced reference to its card and keeps it in view independently of node culling", () => {
    const scene = prepareScene(graph, positions);
    const state = readableAt(scene.readable, 0.05, 9);
    const { texts } = numbered(scene, state.floor, 260, estimateTextWidth);
    const [a, b] = texts.map((n) => n.text);
    // The first padded glyph clears the neighbouring card at x=180; the second clears the first glyph.
    expect(a.x).toBeCloseTo(180 + 0.75 * state.floor);
    expect(b.x).toBeCloseTo(180 + 2.25 * state.floor);
    expect(a.from).toEqual({ x: 90, y: 32 });
    expect(b.from).toEqual({ x: 90, y: 116 });
    const ctx = recordingContext(() => 0);
    const view = { x: -b.x * 0.05 + 1, y: -b.y * 0.05 + 1, zoom: 0.05, width: 2, height: 2 };
    expect(scene.hit.within({ x: b.x - 20, y: b.y - 20, width: 40, height: 40 }).filter((h) => h.kind === "node")).toEqual([]);
    drawScene(ctx.ctx, scene, view, undefined, { cull: true, pathRule: { minPx: 0.5 }, background: false });
    expect(ctx.ops.filter((o) => o.op === "text").filter((o) => !o.halo).map((o) => o.text)).toEqual(["2"]);
    expect(ctx.ops.filter((o) => o.op === "stroke").map((o) => o.op === "stroke" && o.shape.lines)).toContainEqual([[90, 116, b.x, b.y]]);
    ctx.ops.length = 0;
    drawScene(ctx.ctx, scene, { ...view, x: -10000, y: -10000 }, undefined, { cull: true, pathRule: { minPx: 0.5 }, background: false });
    expect(ctx.ops).toEqual([]);
    const frame = figureFrame(scene, { readable: state, legend: false, caption: false });
    for (const { text: { box } } of texts) {
      expect(frame.map.offset.x + box!.x).toBeGreaterThanOrEqual(frame.padding);
      expect(frame.map.offset.y + box!.y).toBeGreaterThanOrEqual(frame.padding);
      expect(frame.map.offset.x + box!.x + box!.width).toBeLessThanOrEqual(frame.map.width - frame.padding);
      expect(frame.map.offset.y + box!.y + box!.height).toBeLessThanOrEqual(frame.map.height - frame.padding);
    }
    expect(numbered(scene, state.floor, 260, estimateTextWidth, false).texts.map((n) => [n.text.x, n.text.y, n.text.from, n.text.box])).toEqual([[90, 32, undefined, undefined], [90, 116, undefined, undefined]]);
  });

  for (const rung of RUNGS) {
    // The two dense 0 % layouts take up to 63 s with coverage and four forks sharing two cores.
    // 150 s gives each twice that work time; the smaller settings use the ordinary 30 s limit.
    const timeout = rung.step === 0 && !rung.collapse ? 150_000 : 30_000;
    it(`separates whole-log glyphs on a settled ELK layout at ${rung.name} and every fixed zoom`, async () => {
      const graph = shownGraph(globalScene, optionsOf(rung));
      // Dense whole-log layouts need time to settle under coverage on two cores, as in path-courses.test.ts.
      const positions = await layout(graph, { engine: "elk", timeoutMs: 240_000 });
      expect(positions.engine).toBe("elk");
      const scene = buildScene(graph, positions);
      for (const zoom of [0.05, 0.1, 0.2]) {
        const state = readableAt(scene.readable, zoom, 9);
        if (state.level !== "box") continue;
        const { texts } = numbered(scene, state.floor, 260, estimateTextWidth);
        for (const { id, text: { box } } of texts) for (const card of scene.nodeMarks.filter((m) => m.kind === "activity" || m.kind === "stage")) {
          if (card.id === id) continue;
          const b = card.box;
          expect(box!.x >= b.x + b.width || box!.x + box!.width <= b.x || box!.y >= b.y + b.height || box!.y + box!.height <= b.y, `${rung.name} zoom ${zoom}: backing ${id}/card ${card.id}`).toBe(true);
        }
        for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i].text, b = texts[j].text;
          const aw = Math.max(a.size, estimateTextWidth(a.text, { size: a.size }));
          const bw = Math.max(b.size, estimateTextWidth(b.text, { size: b.size }));
          expect(Math.abs(a.x - b.x) >= (aw + bw) / 2 || Math.abs(a.y - b.y) >= Math.max(a.size, b.size) * 1.2, `${rung.name} zoom ${zoom}: ${texts[i].id}/${texts[j].id}`).toBe(true);
          if (b.from) expect(b.from).toEqual({ x: positions.nodes[texts[j].id].x + positions.nodes[texts[j].id].width / 2, y: positions.nodes[texts[j].id].y + positions.nodes[texts[j].id].height / 2 });
        }
      }
    }, timeout);
  }
});
