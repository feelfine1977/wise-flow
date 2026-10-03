import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ActivityLabelOptions, type FlowGraph, activityNodeSize, activityReferences, layout } from "../../src/index";
import { ActivityTooltip } from "../../src/react/ActivityTooltip";
import { ProcessMap, useStableLayout } from "../../src/react/index";

const graph: FlowGraph = {
  nodes: [
    { id: "price", kind: "activity", label: "Change Price", metrics: { cases: 41, events: 57 } },
    { id: "quantity", kind: "activity", label: "Change Quantity", metrics: { cases: 1107, events: 2198 } },
  ],
  edges: [{ id: "pq", kind: "follows", source: "price", target: "quantity" }],
};
const names: ActivityLabelOptions = { mode: "names", references: activityReferences(graph), caseLabel: "items" };
const ids: ActivityLabelOptions = { ...names, mode: "ids" };

afterEach(cleanup);

function dimensions(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".react-flow__node")).map((element) => ({
    id: element.dataset.id,
    width: element.style.width, height: element.style.height, transform: element.style.transform,
    innerWidth: element.querySelector<HTMLElement>(".wf-node")?.style.width,
    innerHeight: element.querySelector<HTMLElement>(".wf-node")?.style.height,
  }));
}

describe("activity label interaction", () => {
  it("shows distinct names and case-only units; hover/focus/Escape never move or resize nodes", async () => {
    const positions = await layout(graph, { engine: "dagre", nodeSize: (node) => activityNodeSize(node, names) });
    const onSelect = vi.fn();
    const { container } = render(<ProcessMap graph={graph} positions={positions} activityLabels={names} onSelect={onSelect} controls={false} legend={false} fitView={false} contextMenu={false} />);
    await waitFor(() => expect(container.querySelectorAll(".wf-activity-name")).toHaveLength(2));
    const labels = Array.from(container.querySelectorAll(".wf-activity-name"), (n) => n.textContent);
    expect(labels).toEqual(["Change Price", "Change Quantity"]);
    const subtitles = Array.from(container.querySelectorAll(".wf-activity-counts"), (n) => n.textContent);
    expect(subtitles).toEqual(["41 items", "1.1k items"]);
    const before = dimensions(container);
    const trigger = container.querySelector<HTMLElement>('.react-flow__node[data-id="price"]')!;
    fireEvent.mouseEnter(trigger);
    expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", expect.stringContaining("41 items · 57 events"));
    expect(dimensions(container)).toEqual(before);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(dimensions(container)).toEqual(before);
    fireEvent.mouseLeave(trigger);
    fireEvent.focus(trigger);
    expect(await screen.findByRole("tooltip")).toHaveProperty("textContent", expect.stringContaining("Change Price"));
    expect(dimensions(container)).toEqual(before);
    fireEvent.click(trigger);
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["price"], edges: [], groups: [] });
    expect(dimensions(container)).toEqual(before);
    expect(container.querySelector(".wf-node--activity-labels.wf-node--dimmed")).toBeNull();
  });

  it("keeps the tooltip hoverable and persistent, closes after leaving, and keeps hidden counts in accessible details", async () => {
    const positions = await layout(graph, { engine: "dagre", nodeSize: (node) => activityNodeSize(node, ids) });
    const { container, rerender } = render(<ProcessMap graph={graph} positions={positions} activityLabels={ids} controls={false} legend={false} fitView={false} />);
    await waitFor(() => expect(container.querySelectorAll(".wf-activity-name")).toHaveLength(2));
    expect(Array.from(container.querySelectorAll(".wf-activity-name"), (n) => n.textContent)).toEqual(["A01", "A02"]);
    const before = dimensions(container);
    const trigger = container.querySelector<HTMLElement>('.react-flow__node[data-id="quantity"]')!;
    fireEvent.mouseEnter(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toContain("1,107 items · 2,198 events");
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tooltip);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });
    expect(screen.getByRole("tooltip")).toBe(tooltip);
    expect(dimensions(container)).toEqual(before);
    fireEvent.mouseLeave(tooltip);
    expect(screen.queryByRole("tooltip")).toBeNull();
    rerender(<ProcessMap graph={graph} positions={positions} activityLabels={{ ...ids, showCounts: false }} controls={false} legend={false} fitView={false} />);
    expect(container.querySelectorAll(".wf-activity-counts")).toHaveLength(0);
    expect(dimensions(container)).toEqual(before);
    expect(trigger.getAttribute("aria-label")).toContain("1,107 items · 2,198 events");
  });
});

describe("resolved layout dimensions", () => {
  it("relayouts for changed dimensions, not equivalent callbacks or count visibility", async () => {
    const { result, rerender } = renderHook(({ options }: { options: ActivityLabelOptions }) => useStableLayout(graph, {
      engine: "dagre", nodeSize: (node) => activityNodeSize(node, options),
    }), { initialProps: { options: names } });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const initial = result.current.positions;
    expect(initial?.nodes.price.width).toBe(280);
    rerender({ options: { ...names, showCounts: false } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.status).toBe("ready");
    expect(result.current.positions).toBe(initial);
    rerender({ options: ids });
    await waitFor(() => expect(result.current.positions?.nodes.price.width).toBe(140));
    const compact = result.current.positions;
    rerender({ options: { ...ids, showCounts: true } });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.positions).toBe(compact);
  });
});


describe("tooltip map bounds", () => {
  it("places a measured tooltip above bottom-row activities using body-local coordinates", async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("wf-activity-tooltip")) return { x: 0, y: 0, left: 0, top: 0, right: 130, bottom: 120, width: 130, height: 120, toJSON: () => ({}) };
      return original.call(this);
    });
    try {
      const anchor = () => ({ x: 380, y: 190, above: 170 });
      const { rerender } = render(<div style={{ width: 400, height: 200 }}><ActivityTooltip id="bounded" node={graph.nodes[0]} description="Change Price. 41 items · 57 events." anchor={anchor} /></div>);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip.style.left).toBe("262px");
      expect(tooltip.style.top).toBe("50px");
      expect(parseFloat(tooltip.style.top) + 120).toBeLessThanOrEqual(192);
      rerender(<div style={{ width: 400, height: 200 }}><ActivityTooltip id="bounded" node={graph.nodes[0]} description="Change Price. 41 items · 57 events." anchor={() => ({ x: -40, y: 10, above: -30 })} /></div>);
      expect(tooltip.style.left).toBe("8px");
      expect(tooltip.style.top).toBe("10px");
    } finally { rect.mockRestore(); }
  });
});
