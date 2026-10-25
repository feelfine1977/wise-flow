/**
 * Workbench #39: the map's cards with no drawn path until a reload. React Flow
 * draws an edge only once both its cards are "initialized": a size and handle
 * bounds. It measures handle bounds from the DOM; a new card object without
 * `measured` drops them, and a measurement that does not land (taken before
 * the card was laid out, so its fixed size never changes again) left them
 * missing for good. Here the ResizeObserver never reports, standing for that
 * lost measurement: every path must still be drawn, on the first render and
 * after the cards are replaced.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { createPositions, defaultNodeSize } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

let x = 0;
const positions = createPositions({ nodes: Object.fromEntries(smallP2P.nodes.map((n) => { const s = defaultNodeSize(n); const box = { x, y: 40, ...s }; x += s.width + 60; return [n.id, box]; })), groups: {}, edges: {} }, "given", "RIGHT");
const paths = smallP2P.edges.filter((e) => e.source !== e.target).length;

let original: typeof ResizeObserver;
beforeEach(() => {
  original = globalThis.ResizeObserver;
  // Observes, never reports: no DOM measurement lands.
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  globalThis.ResizeObserver = original;
  cleanup();
});

describe("paths drawn without a DOM measurement of the cards (#39)", () => {
  it("draws every path on the first render", async () => {
    const { container } = render(<div style={{ width: 1200, height: 600 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" selfLoops={false} edgeBudget="all" minPathPx={0} /></div>);
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBe(smallP2P.nodes.length));
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBe(paths));
  });

  it("keeps every path when the cards are replaced (a new selection makes new card objects)", async () => {
    const view = (selected: string[]) => <div style={{ width: 1200, height: 600 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" selfLoops={false} edgeBudget="all" minPathPx={0} selection={{ nodes: selected, edges: [], groups: [] }} /></div>;
    const { container, rerender } = render(view([]));
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBe(paths));
    act(() => rerender(view([smallP2P.nodes[1].id])));
    await waitFor(() => expect(container.querySelector(".react-flow__node.selected")).not.toBeNull());
    expect(container.querySelectorAll("g.wf-edge").length).toBe(paths);
  });
});
