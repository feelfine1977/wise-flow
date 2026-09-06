import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type MenuAction, type Positions, abstract, layout, overlaysFor } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(cleanup);

const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
const overlays = overlaysFor(constraintItems(vendorSceneKey), { graph });
let positions: Positions | undefined;
async function pos() {
  positions ??= await layout(graph, { engine: "dagre" });
  return positions;
}

async function renderMap(props: Partial<React.ComponentProps<typeof ProcessMap>> = {}) {
  const p = await pos();
  const utils = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={p} overlays={overlays} {...props} />
    </div>,
  );
  await waitFor(() => expect(utils.container.querySelector('[data-id="clear_invoice"]')).toBeTruthy());
  return utils;
}

const live = () => screen.getByTestId("wf-live").textContent;

describe("ProcessMap interaction", () => {
  it("opens the actions menu on a right click, runs an accelerator and announces the filter", async () => {
    const onFilterChange = vi.fn();
    const onAction = vi.fn();
    const { container } = await renderMap({ filters: [], onFilterChange, onAction });
    fireEvent.contextMenu(container.querySelector('[data-id="clear_invoice"]')!);
    const menu = await screen.findByRole("menu");
    expect(menu.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText("Actions for Clear Invoice")).toBeTruthy();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.getAttribute("data-action"))).toEqual(["filter-to", "exclude", "paths", "lens", "worst-cases", "pin", "add-constraint"]);
    expect(items[0].getAttribute("aria-keyshortcuts")).toBe("f");
    expect(live()).toBe("Selected: Clear Invoice. Actions menu for Clear Invoice opened; 7 actions.");
    fireEvent.keyDown(menu, { key: "f" });
    expect(onFilterChange).toHaveBeenCalledWith({ and: [{ kind: "activity", op: "contains", activity: "clear_invoice" }] });
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "filter-to" }), expect.objectContaining({ kind: "node", id: "clear_invoice" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(live()).toBe("Filter added: cases with Clear Invoice.");
  });

  it("opens the menu with Enter on the focused activity and closes it with Escape", async () => {
    const { container } = await renderMap();
    const map = screen.getByRole("group", { name: /Process map with/ });
    await act(async () => {
      fireEvent.keyDown(map, { key: "ArrowRight" });
    });
    const focused = map.getAttribute("aria-activedescendant")!.replace(/^wf-node-/, "");
    await act(async () => {
      fireEvent.keyDown(map, { key: "Enter" });
    });
    const menu = await screen.findByRole("menu");
    expect(container.querySelector(".wf-menu")).toBeTruthy();
    expect(menu.textContent).toContain(`Actions for ${graph.nodes.find((n) => n.id === focused)?.label}`);
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    await act(async () => {
      fireEvent.keyDown(menu, { key: "Escape" });
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(live()).toBe("Actions menu closed.");
    expect(document.activeElement).toBe(map);
  });

  it("lets the host replace the actions and reports the chosen one", async () => {
    const onAction = vi.fn(() => "Profile opened.");
    const onContextMenu = vi.fn((): MenuAction[] => [{ id: "profile", label: "Open the activity profile", group: "explore", accelerator: "o" }]);
    const { container } = await renderMap({ onContextMenu, onAction });
    fireEvent.contextMenu(container.querySelector('[data-id="clear_invoice"]')!);
    await screen.findByRole("menu");
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: "clear_invoice", label: "Clear Invoice" }), expect.arrayContaining([expect.objectContaining({ id: "filter-to" })]));
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(1);
    fireEvent.click(items[0]);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "profile" }), expect.objectContaining({ id: "clear_invoice" }));
    expect(live()).toBe("Profile opened.");
  });

  it("extends the selection with Shift-click and offers the pair actions", async () => {
    const onSelect = vi.fn();
    const { container } = await renderMap({ onSelect });
    fireEvent.click(container.querySelector('[data-id="record_goods_receipt"]')!);
    fireEvent.click(container.querySelector('[data-id="clear_invoice"]')!, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith({ nodes: ["record_goods_receipt", "clear_invoice"], edges: [], groups: [] });
    expect(live()).toBe("Selected: Record Goods Receipt and Clear Invoice.");
    fireEvent.contextMenu(container.querySelector('[data-id="clear_invoice"]')!);
    await screen.findByRole("menu");
    expect(screen.getByText("Actions for Clear Invoice and Record Goods Receipt")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Path between Clear Invoice and Record Goods Receipt/ })).toBeTruthy();
  });

  it("highlights the paths of a focused activity, dims the rest and lists them at the side", async () => {
    const onSelect = vi.fn();
    const { container } = await renderMap({ focus: "record_invoice_receipt", onSelect });
    const map = container.querySelector(".wf-process-map")!;
    expect(map.getAttribute("data-focus")).toBe("record_invoice_receipt");
    expect(map.classList.contains("wf-process-map--side")).toBe(true);
    const list = screen.getByRole("region", { name: "Paths of Record Invoice Receipt" });
    expect(list.getAttribute("data-source")).toBe("graph");
    expect(screen.getByText(/Incoming paths/)).toBeTruthy();
    expect(screen.getByText(/Outgoing paths/)).toBeTruthy();
    expect(container.querySelectorAll(".wf-node--dimmed").length).toBeGreaterThan(0);
    expect(container.querySelector('[data-id="record_invoice_receipt"] .wf-node')?.classList.contains("wf-node--dimmed")).toBe(false);
    expect(live()).toBe("Paths of Record Invoice Receipt are shown; unrelated activities are dimmed.");
    const row = list.querySelector("tbody tr[data-edge]") as HTMLElement;
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith({ nodes: [], edges: [row.getAttribute("data-edge")], groups: [] });
  });

  it("shows the path between two selected activities and reads the paths block of the response", async () => {
    const { container, rerender } = await renderMap({ selection: { nodes: ["record_goods_receipt", "clear_invoice"], edges: [], groups: [] } });
    expect(container.querySelector(".wf-process-map")?.getAttribute("data-focus")).toBe("record_goods_receipt|clear_invoice");
    expect(screen.getByRole("region", { name: "Path from Record Goods Receipt to Clear Invoice" })).toBeTruthy();
    const p = await pos();
    rerender(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={p} focus="clear_invoice" paths={{ focus: "clear_invoice", incoming: [{ from: "record_invoice_receipt", count: 321, cases: 300, median_lag: 40, violation_share: 0.2 }], outgoing: [] }} />
      </div>,
    );
    const list = await screen.findByRole("region", { name: "Paths of Clear Invoice" });
    expect(list.getAttribute("data-source")).toBe("payload");
    expect(list.textContent).toContain("321");
  });

  it("renders filter chips with cases in and out and calls back when a chip is removed", async () => {
    const onFilterChange = vi.fn();
    const { container } = await renderMap({
      filters: {
        and: [
          { kind: "time", field: "events_inside", from: "2018-01-01", to: "2018-06-30" },
          { kind: "activity", op: "contains", activity: "record_goods_receipt" },
        ],
      },
      filterPreview: { casesIn: 150, casesOut: 50, perClause: [{ clause: 1, removedMarginally: 12 }] },
      onFilterChange,
    });
    expect(screen.getByRole("group", { name: "Filters" })).toBeTruthy();
    expect(screen.getByTestId("wf-filters-count").textContent).toBe("150 of 200 cases · 50 removed");
    const chips = container.querySelectorAll(".wf-filter-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute("data-changes-cases")).toBe("true");
    expect(chips[1].textContent).toContain("cases with Record Goods Receipt");
    expect(chips[1].textContent).toContain("−12 by this filter alone");
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: events inside 2018-01-01 – 2018-06-30" }));
    expect(onFilterChange).toHaveBeenCalledWith({ and: [{ kind: "activity", op: "contains", activity: "record_goods_receipt" }] });
    expect(live()).toBe("Filter removed: events inside 2018-01-01 – 2018-06-30.");
  });

  it("draws stage groups as bands in the stage lane mode", async () => {
    const { container } = await renderMap({ lanes: "stages" });
    const map = container.querySelector(".wf-process-map")!;
    expect(map.getAttribute("data-lanes")).toBe("stages");
    const bands = container.querySelectorAll(".wf-group--band");
    expect(bands.length).toBeGreaterThan(1);
    expect(bands[0].getAttribute("data-band")).toBe("main");
    expect(container.querySelectorAll(".wf-group").length).toBe(bands.length);
  });
});
