/**
 * Path emphasis on the interactive map (WF-06): selecting an activity labels
 * every path touching it, with the share of its cases where the style asks;
 * `lod.edgeLabels: { minPx }` leaves out the labels of thinner paths.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { createPositions, defaultNodeSize } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

let x = 0;
const positions = createPositions({ nodes: Object.fromEntries(smallP2P.nodes.map((n) => { const s = defaultNodeSize(n); const box = { x, y: 40, ...s }; x += s.width + 60; return [n.id, box]; })), groups: {}, edges: {} }, "given", "RIGHT");
afterEach(cleanup);

const labels = (container: HTMLElement) => [...container.querySelectorAll("g.wf-edge")].map((g) => [g.getAttribute("data-id"), g.querySelector(".wf-edge-label")?.textContent ?? null, g.querySelector(".wf-edge-label")?.classList.contains("wf-lod-edge-labels") ?? null] as const);

describe("paths around a selection", () => {
  it("label every path touching the selected activity with the share of its cases, whatever the zoom rule", async () => {
    const { container } = render(<div style={{ width: 2000, height: 400 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" fitView={false} style={{ selectedShare: true }} selection={{ nodes: ["goods_receipt"], edges: [], groups: [] }} /></div>);
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBeGreaterThan(5));
    const byId = new Map(labels(container).map(([id, text, ruled]) => [id, [text, ruled]]));
    expect(byId.get("create_po->goods_receipt")).toEqual(["800 · 89 %", false]);
    expect(byId.get("invoice_receipt->clear_invoice")).toEqual(["780", true]);
  });

  it("leave out the labels of paths thinner than minPx on the screen", async () => {
    const { container } = render(<div style={{ width: 2000, height: 400 }}><ProcessMap graph={smallP2P} positions={positions} renderer="svg" fitView={false} lod={{ edgeLabels: { minPx: 2 } }} /></div>);
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBeGreaterThan(5));
    const byId = new Map(labels(container).map(([id, text]) => [id, text]));
    // 1,000 cases from Start: 8 wide; 40 cases to Cancel Invoice Receipt: under 2.
    expect([byId.get("__start->create_po"), byId.get("invoice_receipt->cancel_invoice")]).toEqual(["1,000", null]);
  });
});
