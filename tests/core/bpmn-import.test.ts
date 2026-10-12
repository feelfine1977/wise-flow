import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { applyMapping, importBpmn, matchActivities, normalizeLabel } from "../../src/bpmn/headless";
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
      Gateway_Approved: "gateway",
      Task_ClearInvoice: "activity",
      EndEvent_Paid: "event",
    });
    expect(g.nodes.find((n) => n.id === "StartEvent_Need")).toMatchObject({ label: "Purchase need", group: "Lane_Purchasing", tags: ["start"] });
    expect(g.nodes.find((n) => n.id === "EndEvent_Paid")?.tags).toEqual(["end"]);
    expect(g.nodes.find((n) => n.id === "Gateway_GoodsOrService")).toMatchObject({ label: "Goods or service?", group: "Lane_Warehouse", tags: ["xor"] });
    expect(g.nodes.find((n) => n.id === "Task_InvoiceReceipt")?.tags).toEqual(["task", "userTask"]);
    expect(g.nodes.find((n) => n.id === "Task_ClearInvoice")?.tags).toEqual(["task", "serviceTask"]);
    expect(g.edges.length).toBe(13);
    expect(g.edges.every((e) => e.kind === "flow")).toBe(true);
    const goods = g.edges.find((e) => e.id === "Flow_Goods")!;
    expect(goods).toMatchObject({ source: "Gateway_GoodsOrService", target: "record_goods_receipt", payload: { bpmnId: "Flow_Goods", label: "goods" } });
    const rejected = g.edges.find((e) => e.id === "Flow_Rejected")!;
    expect([rejected.source, rejected.target]).toEqual(["Gateway_Approved", "Task_InvoiceReceipt"]);
    expect(g.nodes.find((n) => n.id === "Gateway_Approved")).toMatchObject({ label: "Approved?", group: "Lane_AccountsPayable", tags: ["xor"] });
    // Positions from the DI, in absolute coordinates.
    expect(result.positions?.engine).toBe("di");
    expect(result.positions?.nodes.Task_CreatePO).toEqual({ x: 440, y: 140, width: 100, height: 80 });
    expect(result.positions?.groups.Lane_Warehouse).toEqual({ x: 190, y: 280, width: 1310, height: 200 });
    expect(result.positions?.groups.Participant_p2p.width).toBe(1340);
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
  });
});

describe("importBpmn on broken files", () => {
  const NS = 'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:wise="http://wise-workbench.org/schema/flow"';
  const file = (process: string, shapes = "") => `<?xml version="1.0" encoding="UTF-8"?>
<definitions ${NS} id="d"><process id="p">${process}</process>${shapes ? `<bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="pl" bpmnElement="p">${shapes}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>` : ""}</definitions>`;
  const shape = (id: string, x: string, y = "0", width = "100", height = "80") => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}"/></bpmndi:BPMNShape>`;

  it("reads a flow without a source beside an element without an id as a flow without an endpoint", async () => {
    // Both were looked up under the name "undefined", so the flow found the start event
    // as its source and the import threw a TypeError reading the source's default flow.
    const result = await importBpmn(file('<startEvent name="Begin"/><task id="t" name="Work"/><sequenceFlow id="f" targetRef="t"/>'));
    expect(result.warnings).toEqual(["sequence flow f has an endpoint that is not a flow node"]);
    expect(result.graph.nodes.map((n) => [n.id, n.label])).toEqual([
      ["", "Begin"],
      ["t", "Work"],
    ]);
    expect(result.graph.edges).toEqual([]);
  });

  it("marks only the flow a gateway names as its default, also when flows have no id", async () => {
    // A flow without an id and a source without a default both have none: the two
    // were compared by id, so every flow without an id came back as a default flow.
    const result = await importBpmn(file('<task id="a"/><exclusiveGateway id="g" default="f"/><task id="b"/><task id="c"/><sequenceFlow sourceRef="a" targetRef="g"/><sequenceFlow id="f" sourceRef="g" targetRef="b"/><sequenceFlow sourceRef="g" targetRef="c"/>'));
    expect(result.graph.edges.map((e) => [e.source, e.target, e.tags ?? []])).toEqual([
      ["a", "g", []],
      ["g", "b", ["default"]],
      ["g", "c", []],
    ]);
  });

  it("leaves out and reports shapes and routes whose coordinates are not finite numbers", async () => {
    const result = await importBpmn(
      file(
        '<task id="a"/><task id="b"/><task id="c"/><sequenceFlow id="f" sourceRef="a" targetRef="b"/>',
        shape("a", "abc") + shape("b", "200", "1e400") + shape("c", "400") + '<bpmndi:BPMNEdge id="f_di" bpmnElement="f"><di:waypoint x="100" y="40"/><di:waypoint x="NaN" y="40"/></bpmndi:BPMNEdge>',
      ),
    );
    expect(result.warnings).toEqual(["shape of a has coordinates that are not finite numbers", "shape of b has coordinates that are not finite numbers", "route of f has coordinates that are not finite numbers"]);
    expect(result.positions?.nodes).toEqual({ c: { x: 400, y: 0, width: 100, height: 80 } });
    expect(result.positions?.edges).toEqual({});
    expect(result.positions?.bounds).toEqual({ x: 400, y: 0, width: 100, height: 80 });
  });

  it("reports and leaves out the positions when the diagram is too large to measure", async () => {
    // Each box is a finite number, but the distance between them is not.
    const result = await importBpmn(file('<task id="a"/><task id="b"/>', shape("a", "-1e308") + shape("b", "1e308")));
    expect(result.warnings).toEqual(["the diagram's extent is not a finite number; its positions are left out"]);
    expect(result.positions).toBeUndefined();
    expect(result.graph.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("reports the ids that two elements share as FlowGraph ids", async () => {
    // Different XML ids, one FlowGraph id: the parser sees nothing wrong.
    const result = await importBpmn(file('<task id="a" wise:flowId="same"/><task id="b" wise:flowId="same"/><task/><task/>'));
    expect(validateGraph(result.graph)).toEqual([
      { level: "error", message: "duplicate node id", id: "same" },
      { level: "error", message: "duplicate node id", id: "" },
    ]);
    expect(result.warnings).toEqual(["duplicate node id: same", "duplicate node id: "]);
  });
});

describe("importBpmn on deeply nested files", () => {
  it("reads sub-processes and lanes nested deeper than a call stack reaches", async () => {
    // 10,000 levels each: reading them by recursion threw a RangeError.
    const depth = 10_000;
    let process = '<task id="deep" name="Deep"/>';
    for (let i = depth; i > 0; i--) process = `<subProcess id="s${i}">${process}</subProcess>`;
    let lanes = '<lane id="l0"><flowNodeRef>deep</flowNodeRef></lane>';
    for (let i = 1; i <= depth; i++) lanes = `<lane id="l${i}"><childLaneSet id="c${i}">${lanes}</childLaneSet></lane>`;
    const xml = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"><process id="p"><laneSet id="ls">${lanes}</laneSet>${process}<task id="last"/></process></definitions>`;
    const result = await importBpmn(xml);
    expect(result.warnings).toEqual([]);
    expect(result.graph.nodes.map((n) => [n.id, n.group])).toEqual([
      ["deep", "l0"],
      ["last", undefined],
    ]);
    const groups = new Map(result.graph.groups!.map((g) => [g.id, g]));
    expect(groups.size).toBe(2 * depth + 1);
    // Lanes outermost first, each the child of the one around it; sub-processes the same.
    expect(result.graph.groups!.slice(0, 2).map((g) => [g.id, g.parent])).toEqual([
      [`l${depth}`, undefined],
      [`l${depth - 1}`, `l${depth}`],
    ]);
    expect(groups.get("s1")).toEqual({ id: "s1", kind: "stage", label: "s1", parent: undefined });
    expect(groups.get(`s${depth}`)?.parent).toBe(`s${depth - 1}`);
  });
});
