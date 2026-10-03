import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowGraph, Positions } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(cleanup);

const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "Receive" },
    { id: "b", kind: "activity", label: "Check" },
  ],
  edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 5 } }],
};
const box = (x: number) => ({ x, y: 0, width: 120, height: 40 });
const positions: Positions = { nodes: { a: box(0), b: box(200) }, groups: {}, edges: {}, bounds: { x: 0, y: 0, width: 320, height: 40 }, engine: "dagre", direction: "RIGHT" };

const live = () => screen.getByTestId("wf-live").textContent;

async function renderMap(props: Partial<React.ComponentProps<typeof ProcessMap>> = {}) {
  const utils = render(
    <div style={{ width: 900, height: 500 }}>
      <ProcessMap graph={graph} positions={positions} fitView={false} {...props} />
    </div>,
  );
  await waitFor(() => expect(utils.container.querySelector('[data-id="b"]')).toBeTruthy());
  return { ...utils, map: screen.getByRole("group", { name: /Process map/ }) };
}

const press = (key: string, init: Partial<KeyboardEventInit> = {}) => act(() => void fireEvent.keyDown(document.activeElement!, { key, ...init }));

describe("ProcessMap actions menu", () => {
  it("runs the entry chosen with Enter once, leaves the menu closed and keeps the action's sentence", async () => {
    const onAction = vi.fn(() => "Pinned.");
    const { map } = await renderMap({ onAction });
    act(() => map.focus());
    press("Home");
    press("Enter");
    await screen.findByRole("menu");
    press("End");
    expect(document.activeElement?.getAttribute("data-action")).toBe("add-constraint");
    press("ArrowUp");
    expect(document.activeElement?.getAttribute("data-action")).toBe("pin");
    press("Enter");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "pin" }), expect.objectContaining({ id: "a" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(live()).toBe("Pinned.");
    expect(document.activeElement).toBe(map);
    expect(map.getAttribute("aria-activedescendant")).toBe("wf-node-a");
  });

  it("chooses with Space without toggling the selection on the map", async () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const { map } = await renderMap({ onAction, onSelect });
    act(() => map.focus());
    press("Home");
    press("Enter");
    await screen.findByRole("menu");
    press(" ");
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "filter-to" }), expect.objectContaining({ id: "a" }));
    expect(onSelect.mock.calls).toEqual([[{ nodes: ["a"], edges: [], groups: [] }]]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("follows the pointer over the entries and closes on a click outside, returning the focus to the map", async () => {
    const { container, map } = await renderMap();
    fireEvent.contextMenu(container.querySelector('[data-id="b"]')!);
    await screen.findByRole("menu");
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: /^Pin/ }));
    expect(document.activeElement?.getAttribute("data-action")).toBe("pin");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(live()).toBe("Actions menu closed.");
    expect(document.activeElement).toBe(map);
  });
});
