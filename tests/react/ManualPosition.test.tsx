import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStoreApi, useReactFlow } from "@xyflow/react";
import { ProcessMap } from "../../src/react/index";
import type { FlowGraph, Positions } from "../../src/index";

afterEach(cleanup);
const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "Create Order", group: "capture" }, { id: "b", kind: "activity", label: "Create Order Item", group: "capture" }], edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }], groups: [{ id: "capture", kind: "stage", label: "Capture" }] };
const positions: Positions = { engine: "given", direction: "RIGHT", bounds: { x: 100, y: 100, width: 700, height: 400 }, groups: { capture: { x: 100, y: 100, width: 700, height: 400 } }, nodes: { a: { x: 130, y: 160, width: 180, height: 48 }, b: { x: 550, y: 160, width: 180, height: 48 } }, edges: { ab: { points: [{ x: 310, y: 184 }, { x: 550, y: 184 }] } } };
function Move() {
  const store = useStoreApi();
  const rf = useReactFlow();
  return <><button onClick={() => store.getState().triggerNodeChanges([{ type: "position", id: "a", position: { x: 70, y: 160 }, dragging: true }])}>Move activity</button><button onClick={() => void rf.setViewport({ x: 40, y: 20, zoom: 0.5 })}>Zoom</button></>;
}
const wrapper = (key = 0, onNodeMove?: (id: string, p: { x: number; y: number }) => void) => <ProcessMap graph={graph} positions={positions} nodesDraggable layoutResetKey={key} onNodeMove={onNodeMove} controls={false} legend={false} fitView={false}><Move /></ProcessMap>;

it("moves grouped activities in absolute coordinates and preserves geometry across hover, selection and zoom", async () => {
  const { container, rerender } = render(wrapper());
  await waitFor(() => expect(container.querySelector('.react-flow__node[data-id="a"]')).toBeTruthy());
  const node = () => container.querySelector<HTMLElement>('.react-flow__node[data-id="a"]')!;
  expect(node().classList.contains("draggable")).toBe(true);
  const edge = () => container.querySelector('.react-flow__edge-path')?.getAttribute('d');
  await waitFor(() => expect(edge()).toBeTruthy());
  const originalPath = edge();
  fireEvent.click(screen.getByText("Move activity"));
  expect(node().style.transform).toBe("translate(170px,260px)");
  await waitFor(() => expect(edge()).not.toBe(originalPath));
  const path = edge();
  expect(path).toMatch(/^M/);
  fireEvent.mouseEnter(node()); fireEvent.click(node()); fireEvent.mouseLeave(node());
  fireEvent.click(screen.getByText("Zoom"));
  rerender(wrapper());
  expect(node().style.transform).toBe("translate(170px,260px)");
  expect(edge()).toBe(path);
  rerender(wrapper(1));
  expect(node().style.transform).toBe("translate(130px,160px)");
  expect(edge()).toBe(originalPath);
});
it("reports the absolute grouped position to a controlling host", async () => {
  const moved = vi.fn();
  render(wrapper(0, moved));
  fireEvent.click(screen.getByText("Move activity"));
  expect(moved).toHaveBeenCalledWith("a", { x: 170, y: 260 });
});

it("accepts an actual mouse drag at half zoom without treating it as a click", async () => {
  const onMove = vi.fn();
  const { container } = render(wrapper(0, onMove));
  fireEvent.click(screen.getByText("Zoom"));
  await waitFor(() => expect(container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform).toContain("scale(0.5)"));
  const node = container.querySelector<HTMLElement>('.react-flow__node[data-id="a"]')!;
  // Vitest's global Window proxy fails jsdom's UIEvent constructor brand check.
  const mouse = (kind: "mouseDown" | "mouseMove" | "mouseUp", target: HTMLElement | Window, x: number, y: number) => {
    const event = createEvent[kind](target, { clientX: x, clientY: y, button: 0, buttons: kind === "mouseUp" ? 0 : 1 });
    Object.defineProperty(event, "view", { value: window });
    fireEvent(target, event);
  };
  mouse("mouseDown", node, 150, 120);
  mouse("mouseMove", window, 151, 121); // cross the drag threshold
  mouse("mouseMove", window, 181, 141);
  mouse("mouseUp", window, 181, 141);
  await waitFor(() => expect(onMove).toHaveBeenCalled());
  expect(onMove.mock.calls.at(-1)).toEqual(["a", { x: 190, y: 200 }]);
});
