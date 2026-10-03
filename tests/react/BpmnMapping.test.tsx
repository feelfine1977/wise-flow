import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BpmnSelection, createBpmnView } from "../../src/react/BpmnView";
import { memoryViewers } from "./memory-viewer";

// The viewer's registry is the fixture's diagram interchange.
const viewers = memoryViewers();
const BpmnView = createBpmnView(viewers.connect);

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
// The activity id differs from the task's BPMN and FlowGraph id `Task_CreatePO`.
const mapping = { create_purchase_order_item: "Task_CreatePO" };
// The fixture with `Task_ClearInvoice` carrying the FlowGraph id `clear invoice`.
const flowIdXml = xml
  .replace("<bpmn:definitions ", '<bpmn:definitions xmlns:wise="http://wise-workbench.org/schema/flow" ')
  .replace('<bpmn:serviceTask id="Task_ClearInvoice"', '<bpmn:serviceTask id="Task_ClearInvoice" wise:flowId="clear invoice"');
const reported: BpmnSelection = { tasks: ["Task_CreatePO"], flows: [], lanes: [] };

beforeEach(() => { viewers.instances.length = 0; });
afterEach(cleanup);

async function ready(container: HTMLElement, table = true) {
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  if (table) await waitFor(() => expect(screen.getAllByRole("table").length).toBe(3));
  return viewers.instances[0];
}
// The first table lists the tasks; the flows table repeats their labels.
const row = (label: string) => within(screen.getAllByRole("table")[0]).getByText(label).closest("tr")!;

describe("BpmnView with an activity mapping", () => {
  it("highlights the mapped table row for a selection made in the diagram", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} mapping={mapping} view="table" onSelect={onSelect} />);
    const viewer = await ready(container);
    act(() => viewer.select([viewer.element("Task_CreatePO")]));
    expect(onSelect).toHaveBeenLastCalledWith(reported);
    expect(row("Create Purchase Order Item").className).toBe("wf-row--selected");
    expect(row("Approve Invoice").className).toBe("");
  });

  it("reports the same FlowGraph ids for a table click as for a diagram click", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} mapping={mapping} view="table" onSelect={onSelect} />);
    await ready(container);
    fireEvent.click(row("Create Purchase Order Item"));
    expect(onSelect).toHaveBeenLastCalledWith(reported);
    expect(row("Create Purchase Order Item").className).toBe("wf-row--selected");
    // An unmapped task keeps its own id in both.
    fireEvent.click(row("Approve Invoice"));
    expect(onSelect).toHaveBeenLastCalledWith({ tasks: ["Task_ApproveInvoice"], flows: [], lanes: [] });
  });

  it("selects the diagram element for a controlled selection in FlowGraph ids or activity ids", async () => {
    const { container, rerender } = render(<BpmnView xml={xml} mapping={mapping} selection={reported} />);
    const viewer = await ready(container, false);
    await waitFor(() => expect(viewer.selected().map((e) => e.id)).toEqual(["Task_CreatePO"]));
    rerender(<BpmnView xml={xml} mapping={mapping} selection={{ tasks: ["Task_ApproveInvoice"], flows: [], lanes: [] }} />);
    await waitFor(() => expect(viewer.selected().map((e) => e.id)).toEqual(["Task_ApproveInvoice"]));
    rerender(<BpmnView xml={xml} mapping={mapping} selection={{ tasks: ["create_purchase_order_item"], flows: [], lanes: [] }} />);
    await waitFor(() => expect(viewer.selected().map((e) => e.id)).toEqual(["Task_CreatePO"]));
  });

  it("places an overlay that targets the activity id on the mapped task", async () => {
    const overlays = [{ kind: "badge" as const, target: "create_purchase_order_item", payload: { value: 0.5, label: "late" } }];
    const { container } = render(<BpmnView xml={xml} mapping={mapping} overlays={overlays} />);
    const viewer = await ready(container, false);
    await waitFor(() => expect(viewer.overlays.map((a) => a.element)).toEqual(["Task_CreatePO"]));
    expect(viewer.overlays[0].overlay.html.className).toBe("wf-badge");
  });

  it("honours an activity mapped by BPMN id when the FlowGraph id differs", async () => {
    const byBpmnId = { clear_invoice: "Task_ClearInvoice" };
    const onSelect = vi.fn();
    const { container, rerender } = render(<BpmnView xml={flowIdXml} mapping={byBpmnId} view="table" onSelect={onSelect} />);
    const viewer = await ready(container);
    rerender(<BpmnView xml={flowIdXml} mapping={byBpmnId} view="table" onSelect={onSelect} selection={{ tasks: ["clear_invoice"], flows: [], lanes: [] }} />);
    await waitFor(() => expect(viewer.selected().map((e) => e.id)).toEqual(["Task_ClearInvoice"]));
    expect(onSelect).toHaveBeenLastCalledWith({ tasks: ["clear invoice"], flows: [], lanes: [] });
    expect(row("Clear Invoice").className).toBe("wf-row--selected");
  });
});
