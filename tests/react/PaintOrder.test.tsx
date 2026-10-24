/**
 * The interactive map paints its paths as every renderer does (WF-07): the
 * widest first, the thinnest on top, equal widths by id; and in the
 * `instrument` theme a path thinner than 2 ends without a head.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, createPositions } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

const graph: FlowGraph = {
  nodes: ["a", "b", "c", "d", "e"].map((id) => ({ id, kind: "activity" as const, label: id.toUpperCase(), metrics: { cases: 1000 } })),
  edges: [
    { id: "a-b", kind: "follows", source: "a", target: "b", metrics: { cases: 1 } },
    { id: "a-c", kind: "follows", source: "a", target: "c", metrics: { cases: 50 } },
    { id: "a-d", kind: "follows", source: "a", target: "d", metrics: { cases: 400 } },
    { id: "a-e", kind: "follows", source: "a", target: "e", metrics: { cases: 1000 } },
  ],
};
const positions = createPositions({
  nodes: { a: { x: 0, y: 150, width: 180, height: 64 }, b: { x: 400, y: 0, width: 180, height: 64 }, c: { x: 400, y: 100, width: 180, height: 64 }, d: { x: 400, y: 200, width: 180, height: 64 }, e: { x: 400, y: 300, width: 180, height: 64 } },
  groups: {}, edges: {},
}, "given", "RIGHT");

afterEach(cleanup);

describe("the interactive map's paths", () => {
  it("are painted the widest first, the thinnest on top", async () => {
    const { container } = render(<div style={{ width: 1000, height: 600 }}><ProcessMap graph={{ ...graph, edges: [...graph.edges].reverse() }} positions={positions} renderer="svg" controls={false} legend={false} fitView={false} /></div>);
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
    expect([...container.querySelectorAll("g.wf-edge")].map((g) => g.getAttribute("data-id"))).toEqual(["a-e", "a-d", "a-c", "a-b"]);
  });

  it("end without a head where they are thinner than the instrument theme's 2", async () => {
    const { container } = render(<div style={{ width: 1000, height: 600 }}><ProcessMap graph={graph} positions={positions} theme="instrument" renderer="svg" controls={false} legend={false} fitView={false} /></div>);
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
    const marker = (id: string) => container.querySelector(`g.wf-edge[data-id="${id}"] [data-wf-part="edge-path"]`)?.getAttribute("marker-end") ?? null;
    expect([marker("a-b"), marker("a-c")]).toEqual([null, null]);
    expect(marker("a-e")).toMatch(/wf-edge-arrow-40/);
  });
});
