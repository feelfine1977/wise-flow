import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useReactFlow } from "@xyflow/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPositions, layout, type FlowGraph } from "../../src/index";
import { drawScene, prepareScene } from "../../src/canvas/index";
import { CanvasMap, type CanvasMapHandle, ProcessMap } from "../../src/react/index";
import { inkContext } from "../support/ink";
import { globalScene } from "../../fixtures/bpic2019";
import { RUNGS, optionsOf, shownGraph } from "../support/ladder";
import { readReactMap } from "./map-reading";
import { readCanvas } from "../support/reading";
import { flowLoop, flowLoopPositions } from "../support/flow-loop";

const graph: FlowGraph = {
  nodes: [{ id: "a", kind: "activity", label: "Record Goods Receipt" }, { id: "b", kind: "activity", label: "Record Service Entry Sheet" }], edges: [],
};
const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 600, y: 0, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");
let zoomTo: (zoom: number) => void;
function Zoom() {
  const rf = useReactFlow();
  zoomTo = (zoom) => void rf.setViewport({ x: 0, y: 100, zoom });
  return null;
}
const nothing = () => new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createLinearGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => undefined), set: (t, k: string, v) => ((t[k] = v), true) });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("numbered activities on the screen", () => {
  it("keeps every whole-log card named or numbered with a full-name key across all control settings and zoom steps", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => nothing() as unknown as CanvasRenderingContext2D);
    for (const rung of RUNGS) {
      const options = optionsOf(rung);
      const graph = shownGraph(globalScene, options);
      const positions = await layout(graph, { engine: "dagre" });
      const scene = prepareScene(graph, positions);
      const cards = graph.nodes.filter((n) => n.kind === "activity" || n.kind === "stage");
      const names = [...cards].sort((a, b) => positions.nodes[a.id].x - positions.nodes[b.id].x || positions.nodes[a.id].y - positions.nodes[b.id].y || a.id.localeCompare(b.id));
      const { container } = render(<ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} controls={false} legend={false}><Zoom /></ProcessMap>);
      await waitFor(() => expect(container.querySelectorAll(".wf-node")).toHaveLength(graph.nodes.length));
      let previous;
      for (const zoom of [1, 0.75, 0.35, 0.2, 0.1, 0.05, 0.1, 0.35, 1]) {
        act(() => zoomTo(zoom));
        const dom = readReactMap(container).fitted;
        const canvas = readCanvas(scene, { x: 0, y: 100, zoom, width: 1400, height: 900 }, { pathRule: { minPx: 0.5 }, readableFrom: previous });
        previous = canvas.readable;
        const box = container.querySelector(".wf-process-map")!.classList.contains("wf-text--box");
        expect(box, `${rung.name} zoom ${zoom}`).toBe(canvas.readable!.level === "box");
        for (const reading of [dom, canvas]) {
          expect(reading.texts.filter((t) => t.size * zoom < 9 - 1e-8), `${rung.name} ${reading.renderer} zoom ${zoom}`).toEqual([]);
          for (const card of cards) expect(reading.texts.some((t) => t.owner === card.id && (t.role === "number" || t.role === "node"))).toBe(true);
        }
        if (box) {
          const markers = dom.texts.filter((t) => t.role === "number");
          expect(markers.map((t) => [t.owner, t.text])).toEqual(names.map((n, i) => [n.id, String(i + 1)]));
          for (let i = 0; i < markers.length; i++) for (let j = i + 1; j < markers.length; j++) {
            const a = markers[i], b = markers[j];
            expect(Math.abs(a.box.x + a.box.width / 2 - b.box.x - b.box.width / 2) >= (a.box.width + b.box.width) / 2 || Math.abs(a.box.y - b.box.y) >= Math.max(a.size, b.size), `${rung.name} zoom ${zoom}: ${a.owner}/${b.owner}`).toBe(true);
          }
          expect(canvas.texts.filter((t) => t.role === "number").map((t) => [t.owner, t.text]).sort()).toEqual(markers.map((t) => [t.owner, t.text]).sort());
          const key = screen.getByRole("region", { name: "Activities by number" });
          const lines = [...key.children].map((line) => line.textContent).join(" ");
          for (const [i, n] of names.entries()) expect(lines).toContain(`${i + 1} ${n.label}`);
        } else expect(screen.queryByRole("region", { name: "Activities by number" })).toBeNull();
      }
      cleanup();
    }
  }, 90000);

  it("draws readable markers and a complete key when names are shed, including below the text ladder", async () => {
    const { container } = render(<ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} controls={false} legend={false}><Zoom /></ProcessMap>);
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2));
    for (const zoom of [0.2, 0.1, 0.05]) {
      act(() => zoomTo(zoom));
      const markers = [...container.querySelectorAll<SVGTextElement>(".wf-map-numbers text")];
      expect(markers.map((m) => [m.dataset.id, m.textContent]), `zoom ${zoom}`).toEqual([["a", "1"], ["b", "2"]]);
      for (const m of markers) expect(Number(m.getAttribute("font-size")) * zoom).toBeGreaterThanOrEqual(9);
      const key = screen.getByRole("region", { name: "Activities by number" });
      expect(key.textContent).toContain("1 Record Goods Receipt");
      expect(key.textContent).toContain("2 Record Service Entry Sheet");
      expect(key.tabIndex).toBe(0);
    }
    act(() => zoomTo(1));
    expect(container.querySelector(".wf-map-numbers")).toBeNull();
    expect(screen.queryByRole("region", { name: "Activities by number" })).toBeNull();
  });

  it("uses the same numbers and full names on standalone Canvas, with a German key and host reference labels", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => nothing() as unknown as CanvasRenderingContext2D);
    const scene = prepareScene(graph, positions, { activityLabels: { mode: "ids", references: { a: "A23", b: "A46" } } });
    let handle: CanvasMapHandle | null = null;
    render(<CanvasMap ref={(h) => void (handle = h)} scene={scene} state={{ selection: { nodes: [], edges: [], groups: [] } }} locale="de" fitView={false} edgeBudget="all" />);
    await waitFor(() => expect(handle?.renderer()).toBeTruthy());
    const renderer = handle!.renderer()!;
    for (const zoom of [0.1, 0.05]) {
      act(() => { renderer.setViewport({ x: 0, y: 100, zoom }); renderer.draw(); });
      const key = screen.getByRole("region", { name: "Aktivitäten nach Nummer" });
      expect(key.textContent).toContain("Aktivitäten nach Nummer");
      expect(key.textContent).toContain("1 Record Goods Receipt");
      expect(key.textContent).toContain("2 Record Service Entry Sheet");
      const ink = inkContext();
      drawScene(ink.ctx, scene, { x: 0, y: 100, zoom, width: 1400, height: 900 }, undefined, { pathRule: { minPx: 0.5 } });
      expect(ink.outside.filter((c) => c.startsWith("fillText"))).toEqual(expect.arrayContaining([expect.stringContaining('"1"'), expect.stringContaining('"2"')]));
    }
    act(() => { renderer.setViewport({ x: 0, y: 0, zoom: 1 }); renderer.draw(); });
    expect(screen.queryByRole("region", { name: "Aktivitäten nach Nummer" })).toBeNull();
  });

  it("draws the selected model flow loop in the DOM alongside its two terminal paths", async () => {
    const { container } = render(<ProcessMap graph={flowLoop} positions={flowLoopPositions} renderer="svg" fitView={false} edgeBudget={0} selection={{ nodes: [], edges: ["aa"], groups: [] }} controls={false} legend={false}><Zoom /></ProcessMap>);
    await waitFor(() => expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(3));
    for (const zoom of [1, 0.1, 0.05]) {
      act(() => zoomTo(zoom));
      expect(container.querySelector('.wf-edge[data-id="aa"] path')).toBeTruthy();
      expect(screen.queryByTestId("wf-edge-note")).toBeNull();
    }
  });
});
