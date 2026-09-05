import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type Positions, abstract, layout, overlaysFor } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(cleanup);

const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
const overlays = overlaysFor(constraintItems(vendorSceneKey), { graph });
let positions: Positions | undefined;
async function pos() {
  positions ??= await layout(graph, { engine: "dagre" });
  return positions;
}

describe("ProcessMap", () => {
  it("renders nodes with ARIA labels, a description and a legend", async () => {
    const p = await pos();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={p} overlays={overlays} defaultAbstraction={{ minEdgeShare: 0.02 }} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
    const map = screen.getByRole("group", { name: /Process map with/ });
    expect(map.getAttribute("aria-describedby")).toBeTruthy();
    expect(map.textContent).toContain("Use the arrow keys");
    const clear = container.querySelector("#wf-node-clear_invoice") as HTMLElement;
    expect(clear).toBeTruthy();
    expect(clear.getAttribute("title")).toContain("Clear Invoice, activity (Payment)");
    expect(clear.querySelector(".wf-badge")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Legend" })).toBeTruthy();
    expect(container.querySelectorAll(".wf-group").length).toBeGreaterThan(0);
    expect(map.getAttribute("data-layout-status")).toBe("given");
  });

  it("selects on click, reports hover and navigates with the keyboard", async () => {
    const p = await pos();
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={p} onSelect={onSelect} onHover={onHover} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector('[data-id="clear_invoice"]')).toBeTruthy());
    const node = container.querySelector('[data-id="clear_invoice"]') as HTMLElement;
    fireEvent.mouseEnter(node);
    expect(onHover).toHaveBeenCalledWith("clear_invoice");
    fireEvent.click(node);
    expect(onSelect).toHaveBeenCalledWith({ nodes: ["clear_invoice"], edges: [], groups: [] });
    const map = screen.getByRole("group", { name: /Process map with/ });
    await act(async () => {
      fireEvent.keyDown(map, { key: "ArrowRight" });
    });
    expect(map.getAttribute("aria-activedescendant")).toMatch(/^wf-node-/);
    await act(async () => {
      fireEvent.keyDown(map, { key: "Escape" });
    });
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: [], edges: [], groups: [] });
  });

  it("switches to the table alternative and applies the abstraction controls", async () => {
    const p = await pos();
    const onAbstractionChange = vi.fn();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={p} overlays={overlays} onAbstractionChange={onAbstractionChange} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
    const before = container.querySelectorAll(".react-flow__node").length;
    const sliders = screen.getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "0.5" } });
    expect(onAbstractionChange).toHaveBeenCalledWith(expect.objectContaining({ minNodeShare: 0.5 }));
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeLessThan(before));
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    await waitFor(() => expect(screen.getAllByRole("table").length).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Map view" }));
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
  });

  it("computes its own layout when no positions are given", async () => {
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} layout={{ engine: "dagre" }} controls={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector('[data-layout-status="ready"]')).toBeTruthy(), { timeout: 10000 });
    expect(container.querySelector(".wf-process-map")?.getAttribute("data-engine")).toBe("dagre");
  });
});
