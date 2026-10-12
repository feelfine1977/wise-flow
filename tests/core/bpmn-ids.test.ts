import { describe, expect, it } from "vitest";
import { createIdResolver, createModdle, mappingIndex, renameToActivities, type IdMap } from "../../src/bpmn/headless";

// Two FlowGraph ids that are not XML ids and one that is, as the exporter writes them.
const ids: IdMap = {
  toBpmn: { "review order": "review_order", "review order->ship": "Flow_review_order-_ship", ship: "ship" },
  toFlow: { review_order: "review order", "Flow_review_order-_ship": "review order->ship", ship: "ship" },
};

describe("createIdResolver", () => {
  it("converts between BPMN ids and FlowGraph ids in both directions", () => {
    const r = createIdResolver({ ids });
    expect(r.flowId("review_order")).toBe("review order");
    expect(r.flowId("Flow_review_order-_ship")).toBe("review order->ship");
    expect(r.bpmnId("review order")).toBe("review_order");
    expect(r.bpmnId("review order->ship")).toBe("Flow_review_order-_ship");
    // An element the id map does not know (added in the modeler) is its own FlowGraph id.
    expect(r.flowId("Task_new")).toBe("Task_new");
    expect(r.bpmnId("Task_new")).toBeUndefined();
  });

  it("reads the FlowGraph id of a moddle element from the id map, else from wise:flowId or its XML id", () => {
    const moddle = createModdle();
    const known = moddle.create("bpmn:Task", { id: "review_order" });
    const added = moddle.create("bpmn:Task", { id: "Task_copy" });
    added.set("wise:flowId", "copied task");
    const plain = moddle.create("bpmn:Task", { id: "Task_plain" });
    const r = createIdResolver({ ids });
    expect(r.flowId(known)).toBe("review order");
    expect(r.flowId(added)).toBe("copied task");
    expect(r.flowId(plain)).toBe("Task_plain");
  });

  it("maps FlowGraph ids to activity ids whether the mapping names the task by FlowGraph or BPMN id", () => {
    const byBpmnId = createIdResolver({ ids, mapping: { check: "review_order" } });
    expect(byBpmnId.activityId("review order")).toBe("check");
    expect(byBpmnId.flowIdsOfActivity("check")).toEqual(["review order"]);
    const byRows = createIdResolver({
      ids,
      mapping: [
        { taskId: "review_order", nodeId: "review order", label: "Review order", type: "bpmn:Task", activityId: "check" },
        { taskId: "ship", nodeId: "ship", label: "Ship", type: "bpmn:Task" },
      ],
    });
    expect(byRows.activityId("review order")).toBe("check");
    expect(byRows.activityId("ship")).toBeUndefined();
    expect(byRows.flowIdsOfActivity("check")).toEqual(["review order"]);
    expect(byRows.flowIdsOfActivity("unknown")).toEqual([]);
  });

  it("names an element by its BPMN id, its FlowGraph id and every activity id mapped to it", () => {
    const moddle = createModdle();
    const task = moddle.create("bpmn:Task", { id: "review_order" });
    // Two activities point at the task, one through its FlowGraph id and one through its BPMN id.
    const r = createIdResolver({ ids, mapping: { check: "review order", inspect: "review_order" } });
    expect(r.names(task)).toEqual(["review_order", "review order", "check", "inspect"]);
    expect(r.names("review_order")).toEqual(["review_order", "review order", "check", "inspect"]);
    for (const id of ["review_order", "review order", "check", "inspect"]) expect(r.matches(task, id)).toBe(true);
    expect(r.matches(task, "ship")).toBe(false);
    expect(r.names("ship")).toEqual(["ship"]);
  });
});

describe("renameToActivities", () => {
  it("renames mapped nodes to unique activity ids and translates both ways", () => {
    const r = createIdResolver({ mapping: { pay: "t1" } });
    const two = createIdResolver({ mapping: [
      { taskId: "t1", nodeId: "t1", label: "", type: "bpmn:Task", activityId: "pay" },
      { taskId: "t2", nodeId: "t2", label: "", type: "bpmn:Task", activityId: "pay" },
      { taskId: "t3", nodeId: "t3", label: "", type: "bpmn:Task", activityId: "ship" },
    ] });
    // `ship` is already a node id, so t3 becomes `ship_`.
    const renaming = renameToActivities(["t1", "t2", "t3", "ship", "t4"], two);
    expect([...renaming.renamed]).toEqual([["t1", "pay"], ["t2", "pay#2"], ["t3", "ship_"]]);
    expect(renaming.toMapped("t2")).toBe("pay#2");
    expect(renaming.toMapped("t4")).toBe("t4");
    expect(renaming.toFlow("pay#2")).toBe("t2");
    expect(renaming.toFlow("ship")).toBe("ship");
    expect(renaming.toFlow("ship_")).toBe("t3");
    expect(renameToActivities(["t1"], r).toMapped("t1")).toBe("pay");
  });
});

describe("mappingIndex", () => {
  it("indexes mapping rows and plain objects by activity and by task", () => {
    const index = mappingIndex([
      { taskId: "Task_ClearInvoice", nodeId: "Task_ClearInvoice", label: "Clear Invoice", type: "bpmn:ServiceTask", activityId: "clear_invoice" },
      { taskId: "Task_CreatePO", nodeId: "Task_CreatePO", label: "Create Purchase Order Item", type: "bpmn:Task", activityId: "create_purchase_order_item" },
      { taskId: "Task_ApproveInvoice", nodeId: "Task_ApproveInvoice", label: "Approve Invoice", type: "bpmn:UserTask" },
    ]);
    expect(index.toTasks).toEqual({ clear_invoice: ["Task_ClearInvoice"], create_purchase_order_item: ["Task_CreatePO"] });
    expect(index.toActivity).toEqual({ Task_ClearInvoice: "clear_invoice", Task_CreatePO: "create_purchase_order_item" });
    expect(mappingIndex({ clear_invoice: "Task_ClearInvoice" }).toActivity).toEqual({ Task_ClearInvoice: "clear_invoice" });
  });
});
