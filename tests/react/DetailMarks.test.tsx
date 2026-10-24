import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/scene.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/scene.js")>();
  return { ...original, buildScene: vi.fn(original.buildScene) };
});

const { buildScene } = await import("../../src/core/scene.js");
const { layout } = await import("../../src/index");
const { ProcessMap } = await import("../../src/react/index");
type FlowGraph = import("../../src/index").FlowGraph;
type FlowScene = import("../../src/index").FlowScene;
type Overlay = import("../../src/index").Overlay;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(buildScene).mockClear();
});

const lastScene = () => vi.mocked(buildScene).mock.results.at(-1)!.value as FlowScene;

/** Two rare activities below every share, each with a badge; the one on "r" is protected. */
const graph: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 80 } },
    { id: "r", kind: "activity", label: "R", metrics: { cases: 2 } },
    { id: "q", kind: "activity", label: "Q", metrics: { cases: 3 } },
    { id: "end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    { id: "start->a", kind: "follows", source: "start", target: "a", metrics: { count: 100 } },
    { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { count: 80 } },
    { id: "b->end", kind: "follows", source: "b", target: "end", metrics: { count: 80 } },
    { id: "a->end", kind: "follows", source: "a", target: "end", metrics: { count: 20 } },
    { id: "a->r", kind: "follows", source: "a", target: "r", metrics: { count: 2 } },
    { id: "r->b", kind: "follows", source: "r", target: "b", metrics: { count: 2 } },
    { id: "a->q", kind: "follows", source: "a", target: "q", metrics: { count: 3 } },
    { id: "q->end", kind: "follows", source: "q", target: "end", metrics: { count: 3 } },
  ],
};
const marks: Overlay[] = [
  { kind: "badge", target: "r", payload: { glyph: "∅", value: 0.06 }, protected: true },
  { kind: "badge", target: "q", payload: { glyph: "≥1", value: 0.2 } },
];

/** A 2D context that records the texts of the last frame. */
function textRecorder() {
  let texts: string[] = [];
  const noop = () => {};
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", lineJoin: "miter", lineCap: "butt",
    save: noop, restore: noop, translate: noop, scale: noop, setTransform: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    bezierCurveTo: noop, quadraticCurveTo: noop, arc: noop, rect: noop, fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, strokeText: noop, setLineDash: noop,
    createPattern: () => null,
    clearRect() {
      texts = [];
    },
    fillText(text: string) {
      texts.push(text);
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
  return { ctx, frame: () => texts };
}

describe("marks and the detail shares on the map", () => {
  it("keep a protected mark and hide another alike, given in the graph or beside it, in the DOM map and on the Canvas", async () => {
    const positions = await layout(graph, { engine: "dagre" });
    const drawn: Record<string, string[]> = {};
    for (const renderer of ["svg", "canvas"] as const) {
      for (const where of ["inside", "beside"] as const) {
        const recorder = textRecorder();
        if (renderer === "canvas") vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recorder.ctx as unknown as CanvasRenderingContext2D);
        const { container, unmount } = render(
          <div style={{ width: 1200, height: 800 }}>
            <ProcessMap
              graph={where === "inside" ? { ...graph, overlays: marks } : graph}
              overlays={where === "beside" ? marks : undefined}
              positions={positions}
              abstraction={{ activityDetail: 0, pathDetail: 0 }}
              renderer={renderer}
              edgeBudget="all"
              lod={{ badges: 0 }}
              controls={false}
              legend={false}
              fitView={false}
            />
          </div>,
        );
        const label = `${renderer} ${where}`;
        await waitFor(() => expect(lastScene().graph.nodes.map((n) => n.id).sort(), label).toEqual(["a", "end", "r", "start"]));
        const scene = lastScene();
        expect(scene.marks.map((m) => m.kind), label).toEqual(["badge"]);
        expect(scene.graph.meta?.shown?.marksNotShown, label).toEqual(["badge:q:0"]);
        expect(scene.graph.meta?.shown?.forProtected, label).toEqual(["r"]);
        if (renderer === "svg") {
          await waitFor(() => expect(container.querySelectorAll("[data-overlay-id]").length, label).toBe(1));
          drawn[label] = [...container.querySelectorAll<HTMLElement>("[data-overlay-id]")].map((el) => el.dataset.overlayId!);
        } else {
          await waitFor(() => expect(recorder.frame(), label).toContain("∅ · 6 %"));
          expect(recorder.frame(), label).not.toContain("≥1 · 20 %");
          drawn[label] = scene.marks.filter((m) => recorder.frame().some((t) => m.texts.some((x) => x.text === t))).map((m) => m.id);
        }
        unmount();
        vi.restoreAllMocks();
      }
    }
    const lists = Object.values(drawn);
    expect(lists).toHaveLength(4);
    for (const list of lists) expect(list).toEqual(lists[0]);
    expect(lists[0]).toHaveLength(1);
  });
});
