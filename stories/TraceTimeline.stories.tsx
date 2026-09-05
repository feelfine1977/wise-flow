import type { Meta, StoryObj } from "@storybook/react";
import { type Annotation, type Trace, TraceTimeline } from "../src/react/index";

const day = (d: number, h = 9) => new Date(Date.UTC(2018, 2, 1 + d, h)).toISOString();

export const traces: Trace[] = [
  {
    caseId: "4507000123_00010",
    events: [
      { activity: "Create Purchase Order Item", canonicalId: "create_purchase_order_item", timestamp: day(0) },
      { activity: "Record Goods Receipt", canonicalId: "record_goods_receipt", timestamp: day(12) },
      { activity: "Record Invoice Receipt", canonicalId: "record_invoice_receipt", timestamp: day(31), violates: ["c_l3_df1_goods_to_invoice_days"] },
      { activity: "Clear Invoice", canonicalId: "clear_invoice", timestamp: day(70) },
    ],
  },
  {
    caseId: "4507000456_00020",
    events: [
      { activity: "Create Purchase Order Item", canonicalId: "create_purchase_order_item", timestamp: day(3) },
      { activity: "Record Invoice Receipt", canonicalId: "record_invoice_receipt", timestamp: day(5), violates: ["c_l2_df1_invoice_after_goods"] },
      { activity: "Record Goods Receipt", canonicalId: "record_goods_receipt", timestamp: day(20) },
      { activity: "Record Invoice Receipt", canonicalId: "record_invoice_receipt", timestamp: day(22), violates: ["c_l4_repeated_invoice_receipt"] },
      { activity: "Clear Invoice", canonicalId: "clear_invoice", timestamp: day(48) },
    ],
  },
  {
    caseId: "4507000789_00030",
    events: [
      { activity: "Create Purchase Order Item", canonicalId: "create_purchase_order_item", timestamp: day(8) },
      { activity: "Change Price", canonicalId: "change_price", timestamp: day(9) },
      { activity: "Record Goods Receipt", canonicalId: "record_goods_receipt", timestamp: day(25) },
      { activity: "Record Invoice Receipt", canonicalId: "record_invoice_receipt", timestamp: day(27) },
      { activity: "Cancel Invoice Receipt", canonicalId: "cancel_invoice_receipt", timestamp: day(28), violates: ["c_l5_cancel_invoice_receipt"] },
      { activity: "Record Invoice Receipt", canonicalId: "record_invoice_receipt", timestamp: day(35), violates: ["c_l4_repeated_invoice_receipt"] },
    ],
  },
];

export const annotations: Annotation[] = [
  { caseId: "4507000123_00010", constraintId: "c_l3_df1_goods_to_invoice_days", label: "19 d > 10 d", from: 1, to: 2 },
  { caseId: "4507000456_00020", constraintId: "c_l2_df1_invoice_after_goods", label: "invoice before goods", from: 1, to: 2 },
  { caseId: "4507000789_00030", constraintId: "c_l5_cancel_invoice_receipt", label: "cancelled", from: 4 },
];

const meta: Meta<typeof TraceTimeline> = {
  title: "Trace timeline",
  component: TraceTimeline,
  parameters: { layout: "padded" },
  excludeStories: ["traces", "annotations"],
  args: { traces, annotations, width: 1000, locale: "en" },
  argTypes: { locale: { control: "radio", options: ["en", "de"] } },
};
export default meta;

type Story = StoryObj<typeof TraceTimeline>;

/** Three purchase order items on an absolute time axis; violated constraints marked. */
export const Absolute: Story = { name: "Absolute time" };

/** The same cases aligned at goods receipt (time zero). */
export const Anchored: Story = { name: "Aligned at goods receipt", args: { anchor: "record_goods_receipt" } };

/** Table alternative of the timeline. */
export const Table: Story = { name: "Table alternative", args: { table: true, anchor: "record_goods_receipt" } };
