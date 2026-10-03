import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import { graph, positions, style } from "../core/element-kinds";

afterEach(cleanup);

async function map(given: FlowGraph = graph) {
  const { container } = render(
    <div style={{ width: 1000, height: 400 }}>
      <ProcessMap graph={given} positions={positions} style={style} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
    </div>,
  );
  await waitFor(() => expect(container.querySelectorAll("g.wf-edge")).toHaveLength(4));
  const node = (id: string) => container.querySelector(`#wf-node-${id}`)!;
  const edge = (id: string) => container.querySelector(`g.wf-edge[data-id="${id}"]`)!;
  return { node, edge };
}

describe("React Flow nodes and edges from their marks", () => {
  it("shows a gateway's glyph and a note's label at every zoom, other labels by level of detail", async () => {
    const { node } = await map();
    const glyph = node("g").querySelector(".wf-node__label")!;
    expect(glyph.textContent).toBe("+");
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
    expect(glyph.className).toBe("wf-node__label");
    expect(node("n").querySelector(".wf-node__label")!.className).toBe("wf-node__label");
    expect(node("n").querySelector(".wf-node__band")).toBeNull();
    expect(node("start").querySelector(".wf-node__label")!.className).toBe("wf-node__label wf-lod-labels");
    expect([...node("s").querySelectorAll(".wf-node__label, .wf-node__meta")].map((e) => [e.textContent, e.className])).toEqual([
      ["Payment", "wf-node__label wf-lod-labels"],
      ["4 · 1.5k", "wf-node__meta wf-lod-labels"],
    ]);
    expect(node("r").className).toContain("wf-node--reconnected");
    // Without cases the activity shows no count.
    expect(node("r").querySelector(".wf-node__meta")).toBeNull();
  });

  it("draws edges along the scene's route, straight between the boxes where none is given, with the count at the label point", async () => {
    const { edge } = await map();
    const path = (id: string) => edge(id).querySelector("path.react-flow__edge-path")!.getAttribute("d");
    expect(path("a->g")).toBe("M280 20L320 20");
    expect(path("g->s")).toBe("M364 20L382 20L382 28L400 28");
    const label = edge("a->g").querySelector(".wf-edge-label")!;
    expect([label.textContent, label.getAttribute("x"), label.getAttribute("y")]).toEqual(["12", "300", "16"]);
    expect(edge("g->s").querySelector(".wf-edge-label")).toBeNull();
  });

  it("shortens labels by the core rule and keeps the full name in the description", async () => {
    const long = { ...graph, nodes: graph.nodes.map((n) => (n.id === "a" ? { ...n, label: "Change Approval for Purchase Order" } : n)) };
    const { node } = await map(long);
    expect(node("a").querySelector(".wf-node__label")!.textContent).toBe("Change Approval for Pu…");
    expect(node("a").getAttribute("title")).toContain("Change Approval for Purchase Order");
  });
});
