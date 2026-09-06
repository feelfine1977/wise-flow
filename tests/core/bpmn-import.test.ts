import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { applyMapping, importBpmn, mappingIndex, matchActivities, normalizeLabel } from "../../src/bpmn/index";
import { validateGraph } from "../../src/index";

const xml = readFileSync(fileURLToPath(new URL("../../fixtures/p2p_small.bpmn", import.meta.url)), "utf8");
const activities = globalScene.nodes.filter((n) => n.kind === "activity").map((n) => ({ id: n.id, label: n.label }));

describe("importBpmn", () => {
  it("parses a hand-written file into the expected graph", async () => {
    const result = await importBpmn(xml);
    expect(result.warnings).toEqual([]);
    expect(result.processId).toBe("Process_p2p");
    const g = result.graph;
    expect(validateGraph(g)).toEqual([]);
    expect(g.meta?.label).toBe("Purchase-to-pay");
    expect(g.groups).toEqual([
      { id: "Participant_p2p", kind: "pool", label: "Purchase-to-pay" },
      { id: "Lane_Purchasing", kind: "lane", label: "Purchasing", parent: "Participant_p2p" },
      { id: "Lane_Warehouse", kind: "lane", label: "Warehouse", parent: "Participant_p2p" },
      { id: "Lane_AccountsPayable", kind: "lane", label: "Accounts payable", parent: "Participant_p2p" },
    ]);
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));
    expect(kinds).toEqual({
      StartEvent_Need: "event",
      Task_CreateRequisition: "activity",
      Task_CreatePO: "activity",
      Gateway_GoodsOrService: "gateway",
      record_goods_receipt: "activity",
      Task_ServiceEntry: "activity",
      Gateway_Received: "gateway",
      Task_InvoiceReceipt: "activity",
      Task_ApproveInvoice: "activity",
      Task_ClearInvoice: "activity",
      EndEvent_Paid: "event",
    });
    expect(g.nodes.find((n) => n.id === "StartEvent_Need")).toMatchObject({ label: "Purchase need", group: "Lane_Purchasing", tags: ["start"] });
    expect(g.nodes.find((n) => n.id === "EndEvent_Paid")?.tags).toEqual(["end"]);
    expect(g.nodes.find((n) => n.id === "Gateway_GoodsOrService")).toMatchObject({ label: "Goods or service?", group: "Lane_Warehouse", tags: ["xor"] });
    expect(g.nodes.find((n) => n.id === "Task_InvoiceReceipt")?.tags).toEqual(["task", "userTask"]);
    expect(g.nodes.find((n) => n.id === "Task_ClearInvoice")?.tags).toEqual(["task", "serviceTask"]);
    expect(g.edges.length).toBe(12);
    expect(g.edges.every((e) => e.kind === "flow")).toBe(true);
    const goods = g.edges.find((e) => e.id === "Flow_Goods")!;
    expect(goods).toMatchObject({ source: "Gateway_GoodsOrService", target: "record_goods_receipt", payload: { bpmnId: "Flow_Goods", label: "goods" } });
    const rejected = g.edges.find((e) => e.id === "Flow_Rejected")!;
    expect([rejected.source, rejected.target]).toEqual(["Task_ApproveInvoice", "Task_InvoiceReceipt"]);
    // Positions from the DI, in absolute coordinates.
    expect(result.positions?.engine).toBe("di");
    expect(result.positions?.nodes.Task_CreatePO).toEqual({ x: 440, y: 140, width: 100, height: 80 });
    expect(result.positions?.groups.Lane_Warehouse).toEqual({ x: 190, y: 280, width: 1210, height: 200 });
    expect(result.positions?.groups.Participant_p2p.width).toBe(1240);
    expect(result.positions?.edges.Flow_PO_Gateway.points).toEqual([
      { x: 540, y: 180 },
      { x: 610, y: 180 },
      { x: 610, y: 355 },
    ]);
    expect(result.ids.toBpmn.Task_CreatePO).toBe("Task_CreatePO");
  });

  it("returns a mapping table for every task, filled by id and by label", async () => {
    const result = await importBpmn(xml, { activities });
    const rows = Object.fromEntries(result.mapping.map((r) => [r.taskId, r]));
    expect(Object.keys(rows).sort()).toEqual(["Task_ApproveInvoice", "Task_ClearInvoice", "Task_CreatePO", "Task_CreateRequisition", "Task_InvoiceReceipt", "Task_ServiceEntry", "record_goods_receipt"].sort());
    expect(rows.record_goods_receipt).toMatchObject({ activityId: "record_goods_receipt", matchedBy: "id", lane: "Lane_Warehouse", type: "bpmn:Task" });
    expect(rows.Task_CreatePO).toMatchObject({ activityId: "create_purchase_order_item", matchedBy: "label" });
    expect(rows.Task_CreateRequisition).toMatchObject({ activityId: "create_purchase_requisition_item", matchedBy: "label" });
    expect(rows.Task_InvoiceReceipt).toMatchObject({ activityId: "record_invoice_receipt", matchedBy: "label", type: "bpmn:UserTask" });
    expect(rows.Task_ClearInvoice).toMatchObject({ activityId: "clear_invoice", matchedBy: "label" });
    expect(rows.Task_ApproveInvoice.activityId).toBeUndefined();
    expect(rows.Task_ApproveInvoice.matchedBy).toBeUndefined();
    // Aliases and manual rows.
    const aliased = matchActivities(result.mapping, [{ id: "approve", label: "Approval", aliases: ["approve invoice"] }]);
    expect(aliased.find((r) => r.taskId === "Task_ApproveInvoice")).toMatchObject({ activityId: "approve", matchedBy: "alias" });
    const manual = matchActivities([{ ...rows.Task_ApproveInvoice, activityId: "custom", matchedBy: "manual" }], activities);
    expect(manual[0].activityId).toBe("custom");
    expect(normalizeLabel("Record_Goods-Receipt!  ")).toBe("record goods receipt");
  });

  it("applies the mapping so that overlays keyed by activity ids hit the tasks", async () => {
    const result = await importBpmn(xml, { activities });
    const mapped = applyMapping(result.graph, result.mapping);
    const ids = mapped.nodes.map((n) => n.id);
    expect(ids).toContain("create_purchase_order_item");
    expect(ids).toContain("clear_invoice");
    expect(ids).toContain("Task_ApproveInvoice");
    expect(mapped.edges.find((e) => e.id === "Flow_Req_PO")).toMatchObject({ source: "create_purchase_requisition_item", target: "create_purchase_order_item" });
    expect(validateGraph(mapped)).toEqual([]);
    expect((mapped.meta?.bpmnIds as Record<string, string>).clear_invoice).toBe("Task_ClearInvoice");
    const index = mappingIndex(result.mapping);
    expect(index.toTasks.clear_invoice).toEqual(["Task_ClearInvoice"]);
    expect(index.toActivity.Task_CreatePO).toBe("create_purchase_order_item");
    expect(mappingIndex({ clear_invoice: "Task_ClearInvoice" }).toActivity.Task_ClearInvoice).toBe("clear_invoice");
  });
});
