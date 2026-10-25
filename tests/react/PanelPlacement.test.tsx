/**
 * Panels where the host puts them (WF-05) and the overview while part of the
 * map is out of view (WF-11): the legend and the detail panel in the corners
 * named, the key of activity names on the other side, a host's insets kept
 * beside the panels, and `minimap: "overflow"` drawing the library's overview
 * (never React Flow's minimap) only while the map overflows.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useReactFlow } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { createPositions, defaultNodeSize } from "../../src/index";
import { ProcessMap, cornerBox, insetBoxes } from "../../src/react/index";

let x = 0;
const positions = createPositions({ nodes: Object.fromEntries(smallP2P.nodes.map((n) => { const s = defaultNodeSize(n); const box = { x, y: 40, ...s }; x += s.width + 60; return [n.id, box]; })), groups: {}, edges: {} }, "given", "RIGHT");
afterEach(cleanup);

let setView: (v: { x: number; y: number; zoom: number }) => void;
function ViewSetter() {
  const rf = useReactFlow();
  setView = (v) => void rf.setViewport(v);
  return null;
}

describe("panel placement", () => {
  it("puts the legend and the detail panel in the corners the host names", async () => {
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" legendPosition="top-right" controlsPosition="bottom-right" /></div>);
    await waitFor(() => expect(container.querySelector('[data-wf-part="legend"]')).not.toBeNull());
    expect(container.querySelector('[data-wf-part="legend"]')!.closest(".react-flow__panel")!.className).toMatch(/\btop\b.*\bright\b|\bright\b.*\btop\b/);
    expect(container.querySelector('[data-wf-part="abstraction-panel"]')!.closest(".react-flow__panel")!.className).toMatch(/\bbottom\b.*\bright\b|\bright\b.*\bbottom\b/);
  });

  it("turns a host's insets into strips along their sides, and places a box in a corner", () => {
    expect(insetBoxes({ width: 1000, height: 600 }, { right: 300, top: 0 })).toEqual([{ x: 700, y: 0, width: 300, height: 600 }]);
    expect(insetBoxes({ width: 1000, height: 600 }, undefined)).toEqual([]);
    expect(cornerBox("top-right", { width: 1000, height: 600 }, 200, 100, 8)).toEqual({ x: 792, y: 8, width: 200, height: 100 });
    expect(cornerBox("bottom-left", { width: 1000, height: 600 }, 200, 100, 8)).toEqual({ x: 8, y: 492, width: 200, height: 100 });
  });
});

describe("the overview with minimap overflow", () => {
  it("never draws React Flow's minimap, and shows the overview only while part of the map is out of view", async () => {
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" minimap="overflow" opening="fit" fitView={false}><ViewSetter /></ProcessMap></div>);
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBeGreaterThan(3));
    expect(container.querySelector(".react-flow__minimap")).toBeNull();
    act(() => setView({ x: 0, y: 0, zoom: 2 }));
    await waitFor(() => expect(container.querySelector('[data-wf-part="overview"]')).not.toBeNull(), { timeout: 3000 });
    // jsdom's map area is small: the whole map is in view only at the smallest zoom.
    act(() => setView({ x: 0, y: 0, zoom: 0.05 }));
    await waitFor(() => expect(container.querySelector('[data-wf-part="overview"]')).toBeNull(), { timeout: 3000 });
  });

  it("keeps React Flow's minimap where the host asks for it with true", async () => {
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" minimap /></div>);
    await waitFor(() => expect(container.querySelector(".react-flow__minimap")).not.toBeNull());
  });
});
