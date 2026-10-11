import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { abstract, layout } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(cleanup);

describe("the arrowheads of the React Flow map", () => {
  it("ends every path in a head the map defines, at least as wide as the thinnest and the widest path", async () => {
    const graph = abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03 });
    const positions = await layout(graph, { engine: "dagre" });
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={positions} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    const drawable = graph.edges.filter((e) => e.source !== e.target);
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBe(drawable.length));
    const drawn = [...container.querySelectorAll<SVGGElement>("g.wf-edge")].map((g) => {
      const path = g.querySelector(".react-flow__edge-path")!;
      const id = /url\('?#([^')]+)'?\)/.exec(path.getAttribute("marker-end") ?? "")?.[1];
      const marker = id ? container.ownerDocument.getElementById(id) : null;
      return { width: Number(g.style.getPropertyValue("--wf-edge-width")), marker: marker?.tagName === "marker" ? Number(marker.getAttribute("markerHeight")) : undefined };
    });
    for (const d of drawn) {
      expect(d.marker).toBeDefined();
      expect(d.marker!).toBeGreaterThanOrEqual(d.width);
    }
    const sorted = [...drawn].sort((a, b) => a.width - b.width);
    // The thinnest path, 1 wide, ends in the head of 12: 4.8 wide with an outline of 0.6; the widest, 8 wide, in the head of 32: 14.4.
    expect(sorted[0]).toEqual({ width: 1, marker: 5.4 });
    expect(sorted.at(-1)).toEqual({ width: 8, marker: 14.4 });
  });
});
