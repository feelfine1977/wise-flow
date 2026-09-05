import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { type ConstraintDescription, type ConstraintStats, type FlowGraph, type Overlay, MAP_TARGET, constraintOverlays } from "../src/index";
import { ProcessMap } from "../src/react/index";

/** Small synthetic purchase-to-pay graph for the catalogue. */
export const catalogueGraph: FlowGraph = {
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

interface Example {
  description: ConstraintDescription;
  stats: ConstraintStats;
}

export const examples: Record<string, Example> = {
  presence: {
    description: { id: "presence", type: "presence", layer: "L1", label: "Clear Invoice present", activities: ["clear_invoice"], params: { m: 1 } },
    stats: { cases: 1000, evaluated: 1000, violations: 220, violationShare: 0.22 },
  },
  singularity: {
    description: { id: "singularity", type: "singularity", layer: "L4", label: "Goods receipt at most once", activities: ["goods_receipt"], params: { k: 1 } },
    stats: { cases: 900, evaluated: 900, violations: 150, violationShare: 0.17, repeatShare: 0.17, maxCount: 12 },
  },
  exclusion: {
    description: { id: "exclusion", type: "exclusion", layer: "L5", label: "No cancelled invoice receipt", activities: ["cancel_invoice"] },
    stats: { cases: 1000, evaluated: 1000, violations: 40, violationShare: 0.04 },
  },
  lag: {
    description: { id: "lag", type: "lag", layer: "L3", label: "Goods receipt to invoice within 10 days", a: ["goods_receipt", "service_entry"], b: ["invoice_receipt"], params: { delta: 10, width: 20, unit: "D" } },
    stats: { cases: 1000, evaluated: 850, coverage: 0.85, violations: 300, violationShare: 0.35, medianDays: 12.5, p90Days: 40 },
  },
  precedence: {
    description: { id: "precedence", type: "precedence", layer: "L2", label: "Goods receipt before invoice", a: ["goods_receipt"], b: ["invoice_receipt"] },
    stats: { cases: 1000, evaluated: 850, coverage: 0.85, violations: 120, violationShare: 0.14, reverseShare: 0.14 },
  },
  balance: {
    description: { id: "balance", type: "balance", layer: "L7", label: "Manual touches in the order stage", group: "order", params: { attribute: "manual_touch_count", threshold: 2, width: 4, direction: "high" } },
    stats: { cases: 1000, evaluated: 1000, violations: 260, violationShare: 0.26, mean: 1.9, median: 1, p90: 4, threshold: 2, width: 4 },
  },
  applicability: {
    description: { id: "applicability", type: "applicability", label: "Applies to 3-way match flows", scope: { flowType: ["DF1"] } },
    stats: { cases: 1000, casesInScope: 630, inScopeShare: 0.63, nodeShareInScope: { create_po: 0.63, change_price: 0.6, goods_receipt: 0.7, service_entry: 0, invoice_receipt: 0.65, cancel_invoice: 0.005, clear_invoice: 0.66 } },
  },
};

const meta: Meta = {
  title: "Overlays",
  parameters: { layout: "fullscreen" },
  excludeStories: ["catalogueGraph", "examples"],
};
export default meta;

function Catalogue({ keys, extra }: { keys: string[]; extra?: Overlay[] }) {
  const overlays = useMemo(
    () => [...keys.flatMap((k) => constraintOverlays(examples[k].description, examples[k].stats, { graph: catalogueGraph })), ...(extra ?? [])],
    [keys, extra],
  );
  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <ProcessMap graph={catalogueGraph} overlays={overlays} layout={{ engine: "dagre" }} controls={false} />
    </div>
  );
}

export const All: StoryObj = { name: "All constraint presets", render: () => <Catalogue keys={Object.keys(examples)} /> };
export const Presence: StoryObj = { name: "Presence → badge", render: () => <Catalogue keys={["presence"]} /> };
export const Singularity: StoryObj = { name: "Singularity → badge + self-loop", render: () => <Catalogue keys={["singularity"]} /> };
export const Exclusion: StoryObj = { name: "Exclusion → ∅ badge", render: () => <Catalogue keys={["exclusion"]} /> };
export const Lag: StoryObj = { name: "Lag → arc above the map", render: () => <Catalogue keys={["lag"]} /> };
export const Precedence: StoryObj = { name: "Precedence → arc + reverse arc", render: () => <Catalogue keys={["precedence"]} /> };
export const Balance: StoryObj = { name: "Balance → chip + group tint", render: () => <Catalogue keys={["balance"]} /> };
export const Applicability: StoryObj = { name: "Applicability → hatch + scope chip", render: () => <Catalogue keys={["applicability"]} /> };
export const RawKinds: StoryObj = {
  name: "Raw overlay kinds",
  render: () => (
    <Catalogue
      keys={[]}
      extra={[
        { kind: "badge", target: "create_po", payload: { label: "badge", glyph: "≥1", value: 0.42, text: "42 % missing" } },
        { kind: "arc", target: "create_po->clear_invoice", payload: { label: "arc", source: "create_po", target: "clear_invoice", value: 0.6, coverage: 0.8, glyph: "⏱", text: "60 % late" } },
        { kind: "hatch", target: "service_entry", payload: { label: "hatch", text: "outside scope" } },
        { kind: "tint", target: "invoice", payload: { label: "tint", value: 0.7 } },
        { kind: "chip", target: "receipt", payload: { label: "chip", text: "mean 2.4 · threshold 2", value: 0.3, gauge: { value: 2.4, threshold: 2, width: 4 } } },
        { kind: "chip", target: MAP_TARGET, payload: { label: "map chip", text: "applies to 63 % of cases", glyph: "⊂" } },
        { kind: "selfLoop", target: "invoice_receipt", payload: { label: "self-loop", value: 0.12, text: "12 % repeated" } },
      ]}
    />
  ),
};
