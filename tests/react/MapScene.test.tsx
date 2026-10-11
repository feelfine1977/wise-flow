import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreparedScene } from "../../src/canvas/index";

vi.mock("../../src/core/scene.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/scene.js")>();
  return { ...original, buildScene: vi.fn(original.buildScene) };
});
vi.mock("../../src/canvas/scene.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/canvas/scene.js")>();
  return { ...original, prepareScene: vi.fn(original.prepareScene) };
});
// jsdom has no 2D context; the stand-in records the scene the map hands over.
const canvasScenes: (PreparedScene | undefined)[] = [];
vi.mock("../../src/react/CanvasMap.js", async () => {
  const { forwardRef } = await import("react");
  return { CanvasMap: forwardRef((props: { scene?: PreparedScene }, _ref) => { canvasScenes.push(props.scene); return <div data-testid="canvas-map" />; }) };
});

const { buildScene } = await import("../../src/core/scene.js");
const { prepareScene } = await import("../../src/canvas/scene.js");
const { constraintItems, vendorScene, vendorSceneKey } = await import("../../fixtures/bpic2019");
const { abstract, layout, overlaysFor, toSVG } = await import("../../src/index");
const { ProcessMap } = await import("../../src/react/index");
type FlowGraph = import("../../src/index").FlowGraph;
type Positions = import("../../src/index").Positions;
type FlowScene = import("../../src/index").FlowScene;

afterEach(() => {
  cleanup();
  vi.mocked(buildScene).mockClear();
  vi.mocked(prepareScene).mockClear();
  canvasScenes.length = 0;
});

const loop: FlowGraph = {
  nodes: [{ id: "a", kind: "activity", label: "A", metrics: { cases: 900 } }, { id: "b", kind: "activity", label: "B" }],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 1500 } }, { id: "aa", kind: "follows", source: "a", target: "a", metrics: { count: 1500 } }],
};
const loopPositions: Positions = {
  engine: "dagre", direction: "RIGHT", bounds: { x: 0, y: 0, width: 400, height: 40 }, groups: {},
  nodes: { a: { x: 0, y: 0, width: 120, height: 40 }, b: { x: 280, y: 0, width: 120, height: 40 } },
  edges: { ab: { points: [{ x: 120, y: 20 }, { x: 280, y: 20 }] } },
};
const plain = { controls: false, legend: false, fitView: false } as const;

function lastScene(): FlowScene {
  return vi.mocked(buildScene).mock.results.at(-1)!.value as FlowScene;
}

describe("ProcessMap scene", () => {
  it("labels follows self-loops in the map's locale", async () => {
    const { container } = render(<ProcessMap graph={loop} positions={loopPositions} locale="de" {...plain} />);
    await waitFor(() => expect(container.querySelector('.wf-selfloop[data-edge-id="aa"]')).not.toBeNull());
    // 1 500 transitions in compact German notation.
    expect(container.querySelector('.wf-selfloop[data-edge-id="aa"] title')?.textContent).toBe("aa — 1.500 ×");
  });

  it("draws a host self-loop that stands for a follows edge once", async () => {
    const stale = [{ kind: "selfLoop" as const, target: "a", payload: { edgeId: "aa", label: "old" } }];
    const { container } = render(<ProcessMap graph={loop} positions={loopPositions} overlays={stale} {...plain} />);
    await waitFor(() => expect(container.querySelector('.wf-selfloop[data-edge-id="aa"]')).not.toBeNull());
    expect(container.querySelectorAll('.wf-selfloop[data-edge-id="aa"]')).toHaveLength(1);
    expect(container.querySelector('.wf-selfloop[data-edge-id="aa"] title')?.textContent).toBe("aa — 1,500 ×");
  });

  it("leaves out arcs whose endpoints are not both on the map", async () => {
    const arcs = [
      { kind: "arc" as const, target: "a", payload: { source: "a", target: "gone", label: "Dangling" } },
      { kind: "arc" as const, target: "a->b", payload: { source: "a", target: "b", label: "Kept" } },
    ];
    render(<ProcessMap graph={loop} positions={loopPositions} overlays={arcs} selfLoops={false} view="table" {...plain} />);
    const table = await screen.findByRole("table", { name: /overlay/i });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Kept")]);
  });

  it("hands the Canvas map the scene it built, with every graph overlay once", async () => {
    const graph: FlowGraph = { ...loop, overlays: [{ kind: "badge", target: "b", payload: { constraintId: "c1", value: 0.2 } }] };
    render(<ProcessMap graph={graph} positions={loopPositions} renderer="canvas" edgeBudget="all" {...plain} />);
    await waitFor(() => expect(canvasScenes.at(-1)).toBeDefined());
    const handed = canvasScenes.at(-1)!;
    expect(prepareScene).not.toHaveBeenCalled();
    expect(handed.overlays).toBe(lastScene().overlays);
    expect(handed.shapes.filter((s) => s.kind === "badge").map((s) => s.overlay.payload?.constraintId)).toEqual(["c1"]);
    expect(handed.shapes.filter((s) => s.kind === "selfLoop").map((s) => s.overlay.payload?.edgeId)).toEqual(["aa"]);
  });
});

describe("React Flow and SVG", () => {
  it("show the same overlays in the same order for the vendor fixture", async () => {
    const shown = abstract(vendorScene, { minEdgeShare: 0.02 });
    const graph = { ...shown, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: shown }) };
    const positions = await layout(graph, { engine: "dagre" });
    const { container } = render(<div style={{ width: 1200, height: 800 }}><ProcessMap graph={graph} positions={positions} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector(".wf-overlay-layer")).not.toBeNull());
    const map = lastScene();
    const svg = toSVG({ graph, positions });
    const exported = lastScene();
    expect(exported).not.toBe(map);
    const ids = exported.geometry.shapes.map((s) => s.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(map.geometry.shapes.map((s) => s.id)).toEqual(ids);
    // The map draws arcs and self-loops in that order, and the SVG draws the same paths in the same order.
    const drawn = [...container.querySelectorAll<SVGElement>(".wf-overlay-layer [data-overlay-id]")];
    expect(drawn.map((g) => g.dataset.overlayId)).toEqual(ids.filter((id) => id.startsWith("arc:") || id.startsWith("selfLoop:")));
    expect(drawn.length).toBeGreaterThan(0);
    const exportedPaths = [...svg.matchAll(/<g class="wf-overlay wf-(?:arc|selfloop)"[^>]*>(?:<title>.*?<\/title>)?<path d="([^"]+)"/g)].map((m) => m[1]);
    expect(drawn.map((g) => g.querySelector("path")?.getAttribute("d"))).toEqual(exportedPaths);
  });
});
