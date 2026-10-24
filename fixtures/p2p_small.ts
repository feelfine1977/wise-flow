/**
 * A small synthetic purchase-to-pay graph of 1,000 cases: seven activities in
 * four stages with their cases, events and shares, the paths between them
 * with counts, cases, median lags and shortfall shares, and a self-loop. The
 * overlay catalogue and the parity stories draw it, and the tests check the
 * cards' shares on it by hand.
 */
import type { FlowGraph } from "../src/core/index";

export const smallP2P: FlowGraph = {
  nodes: [
    { id: "__start", kind: "event", label: "Start", tags: ["start"], metrics: { cases: 1000 } },
    { id: "create_po", kind: "activity", label: "Create Purchase Order Item", group: "order", metrics: { cases: 1000, events: 1000, share: 1, violationShare: 0.3 } },
    { id: "change_price", kind: "activity", label: "Change Price", group: "order", metrics: { cases: 120, events: 150, share: 0.12, violationShare: 0.8 } },
    { id: "goods_receipt", kind: "activity", label: "Record Goods Receipt", group: "receipt", metrics: { cases: 900, events: 1100, share: 0.9, violationShare: 0.35 } },
    { id: "service_entry", kind: "activity", label: "Record Service Entry Sheet", group: "receipt", metrics: { cases: 60, events: 70, share: 0.06, violationShare: 0.5 } },
    { id: "invoice_receipt", kind: "activity", label: "Record Invoice Receipt", group: "invoice", metrics: { cases: 850, events: 900, share: 0.85, violationShare: 0.4 } },
    { id: "cancel_invoice", kind: "activity", label: "Cancel Invoice Receipt", group: "invoice", metrics: { cases: 40, events: 40, share: 0.04, violationShare: 1 } },
    { id: "clear_invoice", kind: "activity", label: "Clear Invoice", group: "payment", metrics: { cases: 780, events: 780, share: 0.78, violationShare: 0.2 } },
    { id: "__end", kind: "event", label: "End", tags: ["end"], metrics: { cases: 1000 } },
  ],
  edges: [
    { id: "__start->create_po", kind: "follows", source: "__start", target: "create_po", metrics: { count: 1000, cases: 1000 } },
    { id: "create_po->change_price", kind: "follows", source: "create_po", target: "change_price", metrics: { count: 120, cases: 120, medianLagHours: 30, violationShare: 0.8 } },
    { id: "change_price->goods_receipt", kind: "follows", source: "change_price", target: "goods_receipt", metrics: { count: 110, cases: 110, medianLagHours: 100, violationShare: 0.7 } },
    { id: "create_po->goods_receipt", kind: "follows", source: "create_po", target: "goods_receipt", metrics: { count: 800, cases: 800, medianLagHours: 240, violationShare: 0.3 } },
    { id: "create_po->service_entry", kind: "follows", source: "create_po", target: "service_entry", metrics: { count: 60, cases: 60, medianLagHours: 200, violationShare: 0.5 } },
    { id: "goods_receipt->goods_receipt", kind: "follows", source: "goods_receipt", target: "goods_receipt", metrics: { count: 200, cases: 150, medianLagHours: 48, violationShare: 0.6 } },
    { id: "goods_receipt->invoice_receipt", kind: "follows", source: "goods_receipt", target: "invoice_receipt", metrics: { count: 820, cases: 800, medianLagHours: 300, violationShare: 0.35 } },
    { id: "service_entry->invoice_receipt", kind: "follows", source: "service_entry", target: "invoice_receipt", metrics: { count: 50, cases: 50, medianLagHours: 120, violationShare: 0.5 } },
    { id: "invoice_receipt->cancel_invoice", kind: "follows", source: "invoice_receipt", target: "cancel_invoice", metrics: { count: 40, cases: 40, medianLagHours: 2, violationShare: 1 } },
    { id: "cancel_invoice->invoice_receipt", kind: "follows", source: "cancel_invoice", target: "invoice_receipt", metrics: { count: 38, cases: 38, medianLagHours: 24, violationShare: 1 } },
    { id: "invoice_receipt->clear_invoice", kind: "follows", source: "invoice_receipt", target: "clear_invoice", metrics: { count: 780, cases: 780, medianLagHours: 700, violationShare: 0.2 } },
    { id: "clear_invoice->__end", kind: "follows", source: "clear_invoice", target: "__end", metrics: { count: 780, cases: 780 } },
    { id: "invoice_receipt->__end", kind: "follows", source: "invoice_receipt", target: "__end", metrics: { count: 70, cases: 70 } },
    { id: "goods_receipt->__end", kind: "follows", source: "goods_receipt", target: "__end", metrics: { count: 150, cases: 150 } },
  ],
  groups: [
    { id: "order", kind: "stage", label: "Purchase order" },
    { id: "receipt", kind: "stage", label: "Goods receipt" },
    { id: "invoice", kind: "stage", label: "Invoice" },
    { id: "payment", kind: "stage", label: "Payment" },
  ],
  meta: { label: "Catalogue", cases: 1000, events: 4040 },
};
