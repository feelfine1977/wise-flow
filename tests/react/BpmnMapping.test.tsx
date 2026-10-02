import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BpmnView, type BpmnSelection } from "../../src/react/BpmnView";

// A viewer whose registry holds three tasks of the fixture under their BPMN ids;
// the last carries a FlowGraph id of its own in `wise:flowId`.
const mock = vi.hoisted(() => {
  const task = (id: string, flowId?: string) => ({ id, x: 100, y: 100, width: 100, height: 80, businessObject: {
    id, get: (name: string) => (name === "wise:flowId" ? flowId : undefined),
    $instanceOf: (type: string) => type === "bpmn:Activity",
  } });
  const tasks = [task("Task_CreatePO"), task("Task_ApproveInvoice"), task("Task_ClearInvoice", "clear invoice")];
  type Element = (typeof tasks)[number];
  class Viewer {
    static instances: Viewer[] = [];
    handlers = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    selected: Element[] = [];
    added: { element: string; html: HTMLElement }[] = [];
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    constructor() { Viewer.instances.push(this); }
    on(name: string, fn: (event: Record<string, unknown>) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    }
    off(name: string, fn: (event: Record<string, unknown>) => void) {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter((handler) => handler !== fn));
    }
    select(elements: Element[] | Element | null) {
      this.selected = elements === null ? [] : Array.isArray(elements) ? elements : [elements];
      for (const handler of this.handlers.get("selection.changed") ?? []) handler({ newSelection: this.selected });
    }
    async importXML() { return { warnings: [] }; }
    get(name: string) {
      if (name === "selection") return { get: () => this.selected, select: (elements: Element[] | Element | null) => this.select(elements) };
      if (name === "elementRegistry") return { get: (id: string) => tasks.find((t) => t.id === id), getAll: () => tasks };
      if (name === "overlays") return { remove: () => { this.added = []; }, add: (element: string, _type: string, overlay: { html: HTMLElement }) => { this.added.push({ element, html: overlay.html }); return String(this.added.length); } };
      if (name === "canvas") return { getLayer: () => this.layer, zoom: () => 1, resized() {}, removeMarker() {}, addMarker() {} };
      throw new Error(`Unexpected service ${name}`);
    }
    destroy() {}
  }
  return { Viewer, tasks };
});
vi.mock("bpmn-js/lib/NavigatedViewer.js", () => ({ default: mock.Viewer }));
vi.mock("bpmn-js/lib/Modeler.js", () => ({ default: mock.Viewer }));

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
// The activity id differs from the task's BPMN and FlowGraph id `Task_CreatePO`.
const mapping = { create_purchase_order_item: "Task_CreatePO" };
// The fixture with `Task_ClearInvoice` carrying the FlowGraph id `clear invoice`.
const flowIdXml = xml
  .replace("<bpmn:definitions ", '<bpmn:definitions xmlns:wise="http://wise-workbench.org/schema/flow" ')
  .replace('<bpmn:serviceTask id="Task_ClearInvoice"', '<bpmn:serviceTask id="Task_ClearInvoice" wise:flowId="clear invoice"');
const reported: BpmnSelection = { tasks: ["Task_CreatePO"], flows: [], lanes: [] };

beforeEach(() => { mock.Viewer.instances = []; });
afterEach(cleanup);

async function ready(container: HTMLElement, table = true) {
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  if (table) await waitFor(() => expect(screen.getAllByRole("table").length).toBe(3));
  return mock.Viewer.instances[0];
}
// The first table lists the tasks; the flows table repeats their labels.
const row = (label: string) => within(screen.getAllByRole("table")[0]).getByText(label).closest("tr")!;

describe("BpmnView with an activity mapping", () => {
  it("highlights the mapped table row for a selection made in the diagram", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} mapping={mapping} view="table" onSelect={onSelect} />);
    const viewer = await ready(container);
    act(() => viewer.select(mock.tasks[0]));
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
    await waitFor(() => expect(viewer.selected.map((e) => e.id)).toEqual(["Task_CreatePO"]));
    rerender(<BpmnView xml={xml} mapping={mapping} selection={{ tasks: ["Task_ApproveInvoice"], flows: [], lanes: [] }} />);
    await waitFor(() => expect(viewer.selected.map((e) => e.id)).toEqual(["Task_ApproveInvoice"]));
    rerender(<BpmnView xml={xml} mapping={mapping} selection={{ tasks: ["create_purchase_order_item"], flows: [], lanes: [] }} />);
    await waitFor(() => expect(viewer.selected.map((e) => e.id)).toEqual(["Task_CreatePO"]));
  });

  it("places an overlay that targets the activity id on the mapped task", async () => {
    const overlays = [{ kind: "badge" as const, target: "create_purchase_order_item", payload: { value: 0.5, label: "late" } }];
    const { container } = render(<BpmnView xml={xml} mapping={mapping} overlays={overlays} />);
    const viewer = await ready(container, false);
    await waitFor(() => expect(viewer.added.map((a) => a.element)).toEqual(["Task_CreatePO"]));
    expect(viewer.added[0].html.className).toBe("wf-badge");
  });

  it("honours an activity mapped by BPMN id when the FlowGraph id differs", async () => {
    const byBpmnId = { clear_invoice: "Task_ClearInvoice" };
    const onSelect = vi.fn();
    const { container, rerender } = render(<BpmnView xml={flowIdXml} mapping={byBpmnId} view="table" onSelect={onSelect} />);
    const viewer = await ready(container);
    rerender(<BpmnView xml={flowIdXml} mapping={byBpmnId} view="table" onSelect={onSelect} selection={{ tasks: ["clear_invoice"], flows: [], lanes: [] }} />);
    await waitFor(() => expect(viewer.selected.map((e) => e.id)).toEqual(["Task_ClearInvoice"]));
    expect(onSelect).toHaveBeenLastCalledWith({ tasks: ["clear invoice"], flows: [], lanes: [] });
    expect(row("Clear Invoice").className).toBe("wf-row--selected");
  });
});
