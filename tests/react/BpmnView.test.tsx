import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { p2pStages } from "../../fixtures/p2p_stages";
import { liteFromStages } from "../../src/bpmn/index";
import { BpmnView, ViewSwitcher } from "../../src/react/index";
import { abstract, layout, resolveViews } from "../../src/index";

afterEach(cleanup);

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");

// jsdom has no SVG geometry, so bpmn-js cannot render here; the headless
// import, the table alternative, the ARIA description and the controls are
// what these tests cover. Rendering is checked in Storybook and Playwright.
describe("BpmnView", () => {
  it("imports the XML headlessly, describes the diagram and lists it as tables", async () => {
    const onImport = vi.fn();
    const onError = vi.fn();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <BpmnView xml={xml} view="table" onImport={onImport} onError={onError} mapping={{ create_purchase_order_item: "Task_CreatePO" }} />
      </div>,
    );
    await waitFor(() => expect(onImport).toHaveBeenCalled());
    const result = onImport.mock.calls[0][0];
    expect(result.mapping.length).toBe(7);
    await waitFor(() => expect(screen.getAllByRole("table").length).toBe(3));
    const group = container.querySelector(".wf-bpmn") as HTMLElement;
    expect(group.getAttribute("aria-label")).toBe("BPMN diagram with 7 tasks, 2 gateways and 12 sequence flows in 3 lanes.");
    // The mapped task appears under its activity id in the table.
    expect(container.textContent).toContain("Create Purchase Order Item");
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows.some((r) => r.textContent?.includes("Purchasing"))).toBe(true);
    expect(screen.getByRole("button", { name: "Diagram view" })).toBeTruthy();
  });

  it("exports a BPMN-lite graph on the fly and offers the table toggle", async () => {
    const lite = liteFromStages(p2pStages);
    const onViewChange = vi.fn();
    render(
      <div style={{ width: 1200, height: 800 }}>
        <BpmnView graph={lite} layout={{ engine: "dagre" }} view="diagram" onViewChange={onViewChange} onError={() => {}} />
      </div>,
    );
    const toggle = await screen.findByRole("button", { name: "Table view" });
    fireEvent.click(toggle);
    expect(onViewChange).toHaveBeenCalledWith("table");
  });
});

describe("ViewSwitcher", () => {
  it("renders tabs for every view and the same positions in the grid", async () => {
    const base = abstract(globalScene, { minNodeShare: 0.05, minEdgeShare: 0.1 });
    const positions = await layout(base, { engine: "dagre" });
    const set = resolveViews(
      base,
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta", style: { edgeWidth: { metric: "count" }, edgeColor: { metric: "medianLagHours", palette: "sequentialBlue" } } },
      ],
      positions,
    );
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ViewSwitcher views={set} />
      </div>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Alpha", "Beta"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All views" }));
    await waitFor(() => expect(container.querySelectorAll(".wf-views__cell").length).toBe(2));
    const nodeBoxes = (cell: Element) =>
      Array.from(cell.querySelectorAll<HTMLElement>(".react-flow__node")).map((n) => `${n.getAttribute("data-id")}:${n.style.transform}`).sort();
    const cells = container.querySelectorAll(".wf-views__cell");
    await waitFor(() => expect(nodeBoxes(cells[0]).length).toBeGreaterThan(0));
    expect(nodeBoxes(cells[0])).toEqual(nodeBoxes(cells[1]));
  });
});
