import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowGraph, type LayoutOptions, type Positions, abstract, clearLayoutCache, layout, overlaysFor } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  clearLayoutCache();
});

const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
const overlays = overlaysFor(constraintItems(vendorSceneKey), { graph });
let positions: Positions | undefined;
async function pos() {
  positions ??= await layout(graph, { engine: "dagre" });
  return positions;
}

const pair: FlowGraph = {
  nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }],
};

function nodeBox(container: HTMLElement, id: string) {
  const node = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
  expect(node).not.toBeNull();
  const translate = node!.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/);
  expect(translate).not.toBeNull();
  return { x: Number(translate![1]), y: Number(translate![2]), width: parseFloat(node!.style.width), height: parseFloat(node!.style.height) };
}

// React Flow copies controlled nodes into its store in an effect, so the nodes can
// appear one commit after the layout status turns ready.
async function ready(container: HTMLElement) {
  await waitFor(() => {
    expect(container.querySelector('[data-layout-status="ready"]')).not.toBeNull();
    expect(container.querySelector(".react-flow__node")).not.toBeNull();
  });
}

function automaticMap(options: LayoutOptions, data = pair) {
  return <ProcessMap graph={data} layout={{ engine: "dagre", ...options }} controls={false} legend={false} fitView={false} />;
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

  it("moves successors from the right to below when direction changes", async () => {
    const { container, rerender } = render(automaticMap({ direction: "RIGHT" }));
    await ready(container);
    expect(nodeBox(container, "b").x).toBeGreaterThan(nodeBox(container, "a").x);
    expect(nodeBox(container, "b").y).toBeCloseTo(nodeBox(container, "a").y);

    rerender(automaticMap({ direction: "DOWN" }));
    await ready(container);
    await waitFor(() => {
      expect(nodeBox(container, "b").y).toBeGreaterThan(nodeBox(container, "a").y);
      expect(nodeBox(container, "b").x).toBeCloseTo(nodeBox(container, "a").x);
    });
  });

  it("keeps independent maps with the same IDs in their requested directions", async () => {
    const horizontal = render(automaticMap({ direction: "RIGHT" }));
    await ready(horizontal.container);
    const vertical = render(automaticMap({ direction: "DOWN" }));
    await ready(vertical.container);
    expect(nodeBox(horizontal.container, "b").x).toBeGreaterThan(nodeBox(horizontal.container, "a").x);
    expect(nodeBox(vertical.container, "b").y).toBeGreaterThan(nodeBox(vertical.container, "a").y);
    expect(nodeBox(vertical.container, "b").x).toBeCloseTo(nodeBox(vertical.container, "a").x);
  });

  it("follows changed edge endpoints even when every element ID is unchanged", async () => {
    const { container, rerender } = render(automaticMap({}));
    await ready(container);
    expect(nodeBox(container, "b").x).toBeGreaterThan(nodeBox(container, "a").x);

    const reversed = { ...pair, edges: [{ ...pair.edges[0], source: "b", target: "a" }] };
    rerender(automaticMap({}, reversed));
    await ready(container);
    await waitFor(() => expect(nodeBox(container, "a").x).toBeGreaterThan(nodeBox(container, "b").x));
  });

  it.each(["fixed", "callback"] as const)("uses changed %s node sizes", async (mode) => {
    const options = (width: number, height: number): LayoutOptions => ({
      nodeSize: mode === "fixed" ? { width, height } : () => ({ width, height }),
    });
    const { container, rerender } = render(automaticMap(options(120, 40)));
    await ready(container);
    const before = nodeBox(container, "a");
    expect(before).toMatchObject({ width: 120, height: 40 });
    const beforeGap = nodeBox(container, "b").x - before.x;

    rerender(automaticMap(options(260, 80)));
    await ready(container);
    await waitFor(() => {
      expect(nodeBox(container, "a")).toMatchObject({ width: 260, height: 80 });
      expect(nodeBox(container, "b").x - nodeBox(container, "a").x).toBeGreaterThan(beforeGap);
    });
  });

  it("reevaluates a stable size callback when its node data changes", async () => {
    const options: LayoutOptions = { nodeSize: (node) => ({ width: node.metrics?.width ?? 120, height: 40 }) };
    const { container, rerender } = render(automaticMap(options));
    await ready(container);
    expect(nodeBox(container, "a").width).toBe(120);

    const wider = { ...pair, nodes: pair.nodes.map((node) => ({ ...node, metrics: { width: 300 } })) };
    rerender(automaticMap(options, wider));
    await ready(container);
    await waitFor(() => expect(nodeBox(container, "a").width).toBe(300));
  });

  it("uses the new kind's default size when node IDs are unchanged", async () => {
    const { container, rerender } = render(automaticMap({}));
    await ready(container);
    const before = nodeBox(container, "a");

    const events = { ...pair, nodes: pair.nodes.map((node) => ({ ...node, kind: "event" as const })) };
    rerender(automaticMap({}, events));
    await ready(container);
    await waitFor(() => {
      expect(nodeBox(container, "a").width).toBeLessThan(before.width);
      expect(nodeBox(container, "a").height).toBeLessThan(before.height);
    });
  });

  it("increases the gap between layers when spacing changes", async () => {
    const { container, rerender } = render(automaticMap({ spacing: { layer: 30 } }));
    await ready(container);
    const gap = () => nodeBox(container, "b").x - nodeBox(container, "a").x - nodeBox(container, "a").width;
    const before = gap();

    rerender(automaticMap({ spacing: { layer: 150 } }));
    await ready(container);
    await waitFor(() => expect(gap()).toBeGreaterThan(before));
  });

  it("honors an explicit cache key across option changes and unmounting", async () => {
    const cacheKey = "process-map-caller-layout";
    const cached = await layout(pair, { engine: "dagre", direction: "RIGHT", cacheKey });
    const { container, rerender, unmount } = render(automaticMap({ cacheKey, direction: "DOWN" }));
    await ready(container);
    expect(nodeBox(container, "a")).toEqual(cached.nodes.a);
    expect(nodeBox(container, "b")).toEqual(cached.nodes.b);

    rerender(automaticMap({ cacheKey, direction: "LEFT", nodeSize: { width: 300, height: 100 } }));
    await ready(container);
    expect(nodeBox(container, "b")).toEqual(cached.nodes.b);
    unmount();
    expect(await layout({ nodes: [], edges: [] }, { cacheKey })).toBe(cached);
  });
});
