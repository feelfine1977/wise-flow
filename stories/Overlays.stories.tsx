import type { Meta, StoryObj } from "@storybook/react";
import { useMemo } from "react";
import { type ConstraintDescription, type ConstraintStats, type FlowGraph, type Overlay, MAP_TARGET, constraintOverlays } from "../src/index";
import { smallP2P } from "../fixtures/p2p_small";
import { ProcessMap } from "./maps";

/** Small synthetic purchase-to-pay graph for the catalogue (`fixtures/p2p_small.ts`). */
export const catalogueGraph: FlowGraph = smallP2P;

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

/** One overlay of every kind, written by hand. */
export const rawKinds: Overlay[] = [
  { kind: "badge", target: "create_po", payload: { label: "badge", glyph: "≥1", value: 0.42, text: "42 % missing" } },
  { kind: "arc", target: "create_po->clear_invoice", payload: { label: "arc", source: "create_po", target: "clear_invoice", value: 0.6, coverage: 0.8, glyph: "⏱", text: "60 % late" } },
  { kind: "hatch", target: "service_entry", payload: { label: "hatch", text: "outside scope" } },
  { kind: "tint", target: "invoice", payload: { label: "tint", value: 0.7 } },
  { kind: "chip", target: "receipt", payload: { label: "chip", text: "mean 2.4 · threshold 2", value: 0.3, gauge: { value: 2.4, threshold: 2, width: 4 } } },
  { kind: "chip", target: MAP_TARGET, payload: { label: "map chip", text: "applies to 63 % of cases", glyph: "⊂" } },
  { kind: "selfLoop", target: "invoice_receipt", payload: { label: "self-loop", value: 0.12, text: "12 % repeated" } },
];

const meta: Meta = {
  title: "Overlays",
  parameters: { layout: "fullscreen" },
  excludeStories: ["catalogueGraph", "examples", "rawKinds"],
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
export const RawKinds: StoryObj = { name: "Raw overlay kinds", render: () => <Catalogue keys={[]} extra={rawKinds} /> };
