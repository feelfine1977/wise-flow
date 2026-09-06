/**
 * A purchase-to-pay stage model with known activities and no log: the input of
 * `liteFromStages`. Ids and labels follow the BPIC 2019 fixture so that the
 * fixture's metrics and constraint statistics can be laid over the model.
 */
import type { FlowGraph } from "../src/core/index";
import type { StageModel } from "../src/bpmn/index";

export const p2pStages: StageModel = {
  id: "p2p",
  label: "Purchase-to-pay",
  stages: [
    {
      id: "requisition",
      label: "Requisition",
      role: "Requester",
      optional: true,
      activities: [{ id: "create_purchase_requisition_item", label: "Create Purchase Requisition Item" }],
    },
    {
      id: "order",
      label: "Purchase order",
      role: "Purchasing",
      activities: [
        { id: "create_purchase_order_item", label: "Create Purchase Order Item" },
        { id: "receive_order_confirmation", label: "Receive Order Confirmation", optional: true },
        { id: "change_price", label: "Change Price", optional: true },
        { id: "change_quantity", label: "Change Quantity", optional: true },
      ],
    },
    {
      id: "receipt",
      label: "Goods receipt",
      role: "Warehouse",
      flow: "choice",
      activities: [
        { id: "record_goods_receipt", label: "Record Goods Receipt", loop: true },
        { id: "record_service_entry_sheet", label: "Record Service Entry Sheet" },
      ],
    },
    {
      id: "invoice",
      label: "Invoice",
      role: "Accounts payable",
      activities: [
        { id: "vendor_creates_invoice", label: "Vendor creates invoice" },
        { id: "record_invoice_receipt", label: "Record Invoice Receipt" },
        { id: "remove_payment_block", label: "Remove Payment Block", optional: true },
      ],
    },
    {
      id: "payment",
      label: "Payment",
      role: "Accounts payable",
      activities: [{ id: "clear_invoice", label: "Clear Invoice" }],
    },
  ],
};

/** The stage model with the metrics of a fixture scene copied onto its activities. */
export function withSceneMetrics(model: StageModel, scene: FlowGraph): StageModel {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  return {
    ...model,
    stages: model.stages.map((s) => ({
      ...s,
      activities: s.activities.map((a) => {
        const activity = typeof a === "string" ? { id: a, label: a } : a;
        const node = byId.get(activity.id);
        return node ? { ...activity, metrics: { ...(node.metrics ?? {}), ...(activity.metrics ?? {}) } } : activity;
      }),
    })),
  };
}
