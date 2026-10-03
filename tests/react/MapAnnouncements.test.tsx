import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type Positions, type Selection, emptySelection } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(cleanup);

const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "Receive" },
    { id: "b", kind: "activity", label: "Check" },
    { id: "c", kind: "activity", label: "Pay" },
  ],
  edges: [
    { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 5 } },
    { id: "bc", kind: "follows", source: "b", target: "c", metrics: { count: 4 } },
  ],
};
const box = (x: number) => ({ x, y: 0, width: 120, height: 40 });
const positions: Positions = {
  nodes: { a: box(0), b: box(200), c: box(400) },
  groups: {},
  edges: {},
  bounds: { x: 0, y: 0, width: 520, height: 40 },
  engine: "dagre",
  direction: "RIGHT",
};

const live = () => screen.getByTestId("wf-live").textContent;

async function renderMap(element: React.ReactElement) {
  const utils = render(<div style={{ width: 900, height: 500 }}>{element}</div>);
  await waitFor(() => expect(utils.container.querySelector('[data-id="b"]')).toBeTruthy());
  return utils;
}

/** A host that controls the selection and reports it back on the next render. */
function Echo({ onSelect }: { onSelect?: (s: Selection) => void }) {
  const [selection, setSelection] = useState<Selection>(emptySelection);
  return (
    <ProcessMap
      graph={graph}
      positions={positions}
      fitView={false}
      selection={selection}
      onSelect={(s) => {
        onSelect?.(s);
        setSelection(s);
      }}
    />
  );
}

describe("ProcessMap announcements", () => {
  it("announces the focus a menu action sets, or the host's text for it, in the step that runs it", async () => {
    const { container, rerender } = await renderMap(<ProcessMap graph={graph} positions={positions} fitView={false} />);
    fireEvent.contextMenu(container.querySelector('[data-id="b"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Paths in and out/ }));
    expect(live()).toBe("Paths of Check are shown; unrelated activities are dimmed.");

    const onAction = vi.fn(() => "Paths opened.");
    rerender(
      <div style={{ width: 900, height: 500 }}>
        <ProcessMap graph={graph} positions={positions} fitView={false} onAction={onAction} />
      </div>,
    );
    fireEvent.contextMenu(container.querySelector('[data-id="c"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Paths in and out/ }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".wf-process-map")?.getAttribute("data-focus")).toBe("c");
    expect(live()).toBe("Paths opened.");
  });

  it("announces the focus a menu action asks a controlling host for once the host takes it", async () => {
    const onFocusChange = vi.fn();
    const { container } = await renderMap(<ProcessMap graph={graph} positions={positions} fitView={false} focus={null} onFocusChange={onFocusChange} />);
    fireEvent.contextMenu(container.querySelector('[data-id="b"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Paths in and out/ }));
    expect(onFocusChange).toHaveBeenLastCalledWith("b");
    expect(container.querySelector(".wf-process-map")?.getAttribute("data-focus")).toBeNull();
    // The host turned the focus down: the action's own sentence, not paths that are not shown.
    expect(live()).toBe("Paths in and out: Check.");
    cleanup();

    function Taking({ onAction }: { onAction?: () => string }) {
      const [focus, setFocus] = useState<string | [string, string] | null>(null);
      return <ProcessMap graph={graph} positions={positions} fitView={false} focus={focus} onFocusChange={(f) => setFocus(f ?? null)} onAction={onAction} />;
    }
    const taken = await renderMap(<Taking />);
    fireEvent.contextMenu(taken.container.querySelector('[data-id="b"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Paths in and out/ }));
    expect(taken.container.querySelector(".wf-process-map")?.getAttribute("data-focus")).toBe("b");
    expect(live()).toBe("Paths of Check are shown; unrelated activities are dimmed.");
    cleanup();

    const withText = await renderMap(<Taking onAction={() => "Paths opened."} />);
    fireEvent.contextMenu(withText.container.querySelector('[data-id="c"]')!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Paths in and out/ }));
    expect(withText.container.querySelector(".wf-process-map")?.getAttribute("data-focus")).toBe("c");
    expect(live()).toBe("Paths opened.");
  });

  it("keeps the menu's sentence when a controlling host reports the new selection back", async () => {
    const onSelect = vi.fn();
    const { container } = await renderMap(<Echo onSelect={onSelect} />);
    fireEvent.contextMenu(container.querySelector('[data-id="b"]')!);
    await screen.findByRole("menu");
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["b"], edges: [], groups: [] });
    expect(live()).toBe("Selected: Check. Actions menu for Check opened; 7 actions.");

    const map = screen.getByRole("group", { name: /Process map with/ });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(live()).toBe("Actions menu closed.");
    await act(async () => {
      fireEvent.keyDown(map, { key: "ArrowRight" });
    });
    expect(map.getAttribute("aria-activedescendant")).toBe("wf-node-c");
    await act(async () => {
      fireEvent.keyDown(map, { key: "Enter" });
    });
    await screen.findByRole("menu");
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["c"], edges: [], groups: [] });
    expect(live()).toBe("Selected: Pay. Actions menu for Pay opened; 7 actions.");
  });

  it("announces a selection only once a controlling host takes it", async () => {
    const onSelect = vi.fn();
    const { container, rerender } = await renderMap(<ProcessMap graph={graph} positions={positions} fitView={false} selection={emptySelection} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('[data-id="b"]')!);
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["b"], edges: [], groups: [] });
    expect(live()).toBe("");
    const map = screen.getByRole("group", { name: /Process map with/ });
    fireEvent.keyDown(map, { key: "ArrowLeft", shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["a"], edges: [], groups: [] });
    fireEvent.keyDown(map, { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["a"], edges: [], groups: [] });
    expect(live()).toBe("");

    rerender(
      <div style={{ width: 900, height: 500 }}>
        <ProcessMap graph={graph} positions={positions} fitView={false} selection={{ nodes: ["a"], edges: [], groups: [] }} onSelect={onSelect} />
      </div>,
    );
    expect(live()).toBe("Selected: Receive.");
  });

  it("announces a selection and a focus the host sets", async () => {
    const { rerender } = await renderMap(<ProcessMap graph={graph} positions={positions} fitView={false} selection={emptySelection} />);
    expect(live()).toBe("");
    const again = (props: Partial<React.ComponentProps<typeof ProcessMap>>) =>
      rerender(
        <div style={{ width: 900, height: 500 }}>
          <ProcessMap graph={graph} positions={positions} fitView={false} {...props} />
        </div>,
      );
    again({ selection: { nodes: ["a", "c"], edges: [], groups: [] } });
    expect(live()).toBe("Selected: Receive and Pay.");
    again({ selection: { nodes: ["a", "c"], edges: [], groups: [] }, focus: "a" });
    expect(live()).toBe("Paths of Receive are shown; unrelated activities are dimmed.");
  });

  it("announces the host's text over a focus that arrives with it", async () => {
    const { rerender } = await renderMap(<ProcessMap graph={graph} positions={positions} fitView={false} defaultFocus="a" announce="Map ready." />);
    expect(live()).toBe("Map ready.");
    rerender(
      <div style={{ width: 900, height: 500 }}>
        <ProcessMap graph={graph} positions={positions} fitView={false} focus="b" announce="Showing Check." />
      </div>,
    );
    expect(live()).toBe("Showing Check.");
    rerender(
      <div style={{ width: 900, height: 500 }}>
        <ProcessMap graph={graph} positions={positions} fitView={false} focus="c" announce="Showing Check." />
      </div>,
    );
    expect(live()).toBe("Paths of Pay are shown; unrelated activities are dimmed.");
  });
});
