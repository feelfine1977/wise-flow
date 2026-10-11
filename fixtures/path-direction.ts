/**
 * Small graphs for what the committed scenes do not hold: two paths in
 * opposite directions between the same activities, a path back across two
 * stages, and a stage with a long name and a chip, roomy and crowded.
 */
import type { FlowGraph, Overlay } from "../src/core/index";

const activity = (id: string, label: string, cases: number, group?: string) => ({ id, kind: "activity" as const, label, group, metrics: { cases } });
const path = (source: string, target: string, cases: number) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { cases } });

/** Approve and Order follow each other in both orders: 800 cases from Approve to Order, 300 back. */
export const oppositePaths: FlowGraph = {
  nodes: [activity("request", "Request", 1000), activity("approve", "Approve", 1000), activity("order", "Order", 900), activity("pay", "Pay", 900)],
  edges: [path("request", "approve", 1000), path("approve", "order", 800), path("order", "approve", 300), path("order", "pay", 900)],
  meta: { cases: 1000 },
};

/** Two stages in a row; 200 of 1,000 cases return from the last activity of the second to the first of the first. */
export const backAcrossStages: FlowGraph = {
  nodes: [activity("create", "Create", 1000, "buy"), activity("approve", "Approve", 1000, "buy"), activity("receive", "Receive", 1000, "get"), activity("check", "Check", 1000, "get"), activity("pay", "Pay", 1000)],
  edges: [path("create", "approve", 1200), path("approve", "receive", 1200), path("receive", "check", 1200), path("check", "create", 200), path("check", "pay", 1000)],
  groups: [
    { id: "buy", kind: "stage", label: "Buy" },
    { id: "get", kind: "stage", label: "Get" },
  ],
  meta: { cases: 1000 },
};

/** A stage with a long name and a chip of a measure that belongs to it, and a stage after it. */
export const stageChip: FlowGraph = {
  nodes: [activity("enter", "Enter Order", 1000, "manual"), activity("touch", "Touch Order", 600, "manual"), activity("ship", "Ship Order", 1000, "ship")],
  edges: [path("enter", "touch", 600), path("enter", "ship", 400), path("touch", "ship", 600)],
  groups: [
    { id: "manual", kind: "stage", label: "Manual touches in the order stage" },
    { id: "ship", kind: "stage", label: "Shipping" },
  ],
  meta: { cases: 1000 },
};

/** The chip of a balance measure on the stage with the long name. */
export const stageChipOverlays: Overlay[] = [{ kind: "chip", target: "manual", payload: { label: "Manual touches", text: "2.4 per case, at most 2 expected", glyph: "◔", value: 0.4, gauge: { value: 0.4, threshold: 0.3 } } }];
