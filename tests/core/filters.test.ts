import { describe, expect, it } from "vitest";
import {
  type FilterClause,
  type FlowGraph,
  addClause,
  canonicalFilter,
  changesCases,
  clauseForTarget,
  clauseKey,
  describeClause,
  describePreview,
  emptyFilter,
  filterEquals,
  normalizeFilterPreview,
  removeClause,
} from "../../src/index";

const labels: Record<string, string> = { record_goods_receipt: "Record Goods Receipt", record_invoice_receipt: "Record Invoice Receipt", clear_invoice: "Clear Invoice" };
const labelOf = (id: string) => labels[id] ?? id;

const graph: FlowGraph = {
  nodes: [
    { id: "__start", kind: "event", label: "Start", tags: ["start"] },
    { id: "record_goods_receipt", kind: "activity", label: "Record Goods Receipt", group: "receipt" },
    { id: "record_invoice_receipt", kind: "activity", label: "Record Invoice Receipt", group: "invoice" },
    { id: "clear_invoice", kind: "activity", label: "Clear Invoice", group: "payment" },
    { id: "__end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [{ id: "record_goods_receipt->record_invoice_receipt", kind: "follows", source: "record_goods_receipt", target: "record_invoice_receipt" }],
  groups: [
    { id: "receipt", kind: "stage", label: "Goods receipt" },
    { id: "invoice", kind: "stage", label: "Invoice" },
    { id: "payment", kind: "stage", label: "Payment" },
  ],
};

describe("filters", () => {
  it("has one canonical form for any spelling and order of the same clauses", () => {
    const a: FilterClause[] = [
      { kind: "activity", op: "not_contains", activity: "clear_invoice" },
      { kind: "time", mode: "active", from: "2018-01-01", to: "2018-06-30" },
      { kind: "attribute", field: "vendor", in: ["V2", "V1"] },
    ];
    const b: FilterClause[] = [
      { kind: "attribute", field: "vendor", in: ["V1", "V2"] },
      { kind: "time", field: "active", from: "2018-01-01", to: "2018-06-30" },
      { kind: "activity", op: "never", activity: "clear_invoice" },
    ];
    expect(JSON.stringify(canonicalFilter(a))).toBe(JSON.stringify(canonicalFilter(b)));
    expect(filterEquals(a, { and: b })).toBe(true);
    const canon = canonicalFilter(a);
    expect(canon.and.find((c) => c.kind === "time")).toEqual({ kind: "time", field: "active", from: "2018-01-01", to: "2018-06-30" });
    expect(canon.and.find((c) => c.kind === "activity")).toEqual({ kind: "activity", op: "never", activity: "clear_invoice" });
    expect(canonicalFilter([...a, ...b]).and).toHaveLength(3);
    expect(clauseKey({ kind: "follows", a: "x", b: "y" })).toBe(clauseKey({ kind: "follows", a: "x", b: "y", directly: false }));
    expect(canonicalFilter(undefined)).toEqual(emptyFilter);
  });

  it("adds without duplicates, removes by index and flags clauses that change cases", () => {
    const contains: FilterClause = { kind: "activity", op: "contains", activity: "clear_invoice" };
    let f = addClause(undefined, contains);
    f = addClause(f, { kind: "activity", op: "contains", activity: "clear_invoice" });
    expect(f.and).toHaveLength(1);
    f = addClause(f, { kind: "open", value: false });
    expect(f.and).toHaveLength(2);
    expect(removeClause(f, 0).and).toEqual([{ kind: "open", value: false }]);
    expect(changesCases({ kind: "time", field: "events_inside", from: "2018-01-01" })).toBe(true);
    expect(changesCases({ kind: "time", mode: "events_inside" })).toBe(true);
    expect(changesCases({ kind: "time", field: "case_start" })).toBe(false);
    expect(changesCases({ kind: "any", clauses: [contains, { kind: "time", field: "events_inside" }] })).toBe(true);
    expect(changesCases(contains)).toBe(false);
  });

  it("describes every clause kind in plain words", () => {
    const d = (c: FilterClause) => describeClause(c, "en", labelOf);
    expect(d({ kind: "time", field: "case_start", from: "2018-01-01", to: "2018-06-30" })).toBe("case start 2018-01-01 – 2018-06-30");
    expect(d({ kind: "time", mode: "events_inside", from: "2018-01-01" })).toBe("events inside 2018-01-01 – …");
    expect(d({ kind: "attribute", field: "vendor", in: ["V1", "V2"] })).toBe("vendor in V1, V2");
    expect(d({ kind: "attribute", field: "vendor", not_in: ["V1"] })).toBe("vendor not in V1");
    expect(d({ kind: "attribute", field: "amount", range: [10, 20.5] })).toBe("amount between 10 and 20.5");
    expect(d({ kind: "attribute", field: "amount", range: { min: 10 } })).toBe("amount between 10 and …");
    expect(d({ kind: "attribute", field: "vendor", missing: true })).toBe("vendor missing");
    expect(d({ kind: "activity", op: "contains", activity: "record_goods_receipt" })).toBe("cases with Record Goods Receipt");
    expect(d({ kind: "activity", op: "not_contains", activity: "clear_invoice" })).toBe("cases without Clear Invoice");
    expect(d({ kind: "activity", op: "starts_with", activity: "record_goods_receipt" })).toBe("cases starting with Record Goods Receipt");
    expect(d({ kind: "follows", a: "record_goods_receipt", b: "record_invoice_receipt", directly: true })).toBe("Record Goods Receipt directly followed by Record Invoice Receipt");
    expect(d({ kind: "follows", a: "record_goods_receipt", b: "record_invoice_receipt" })).toBe("Record Goods Receipt eventually followed by Record Invoice Receipt");
    expect(d({ kind: "follows", a: "record_goods_receipt", b: "clear_invoice", never: true })).toBe("Record Goods Receipt never followed by Clear Invoice");
    expect(d({ kind: "lag", a: "record_goods_receipt", b: "record_invoice_receipt", max: 10 })).toBe("lag Record Goods Receipt → Record Invoice Receipt at most 10 d");
    expect(d({ kind: "lag", a: "record_goods_receipt", b: "record_invoice_receipt", min: 1.5, max: 3, unit: "H" })).toBe("lag Record Goods Receipt → Record Invoice Receipt between 1.5 h and 3 h");
    expect(d({ kind: "count", activity: "record_invoice_receipt", min: 2 })).toBe("Record Invoice Receipt at least 2 times");
    expect(d({ kind: "count", activity: "record_invoice_receipt", max: 1 })).toBe("Record Invoice Receipt at most 1 times");
    expect(d({ kind: "open", value: true })).toBe("open cases only");
    expect(d({ kind: "open", value: false })).toBe("closed cases only");
    expect(d({ kind: "constraint", constraint: "c1", state: "violating", label: "Clear Invoice present" })).toBe("cases violating Clear Invoice present");
    expect(d({ kind: "constraint", constraint: "c1", state: "out_of_scope" })).toBe("cases outside the scope of c1");
    expect(d({ kind: "slice", slicing: "vendor", key: ["0128", "DE"] })).toBe("slice vendor = 0128 · DE");
    expect(d({ kind: "any", clauses: [{ kind: "open", value: true }, { kind: "activity", op: "contains", activity: "clear_invoice" }] })).toBe("any of: open cases only | cases with Clear Invoice");
    expect(describeClause({ kind: "open", value: true }, "de")).not.toBe("open cases only");
    expect(describeClause({ kind: "activity", op: "contains", activity: "clear_invoice" }, "de", labelOf)).toContain("Clear Invoice");
  });

  it("reads the preview in either spelling and prints cases in and out", () => {
    const p = normalizeFilterPreview({ cases_in: 180000, cases_out: 71734, per_clause: [{ clause: 0, removed_marginally: 1200 }] });
    expect(p).toEqual({ casesIn: 180000, casesOut: 71734, casesTotal: 251734, perClause: [{ clause: 0, removedMarginally: 1200 }], inScopeByConstraint: undefined });
    expect(describePreview(p)).toBe("180,000 of 251,734 cases");
    expect(describePreview(normalizeFilterPreview({ casesIn: 5, casesTotal: 9 }), "de")).toBe("5 von 9 Fällen");
    expect(describePreview(undefined)).toBeUndefined();
    expect(describePreview({ casesIn: 7 })).toBe("7");
  });

  it("produces the clause of a map action for every target", () => {
    expect(clauseForTarget({ kind: "node", ids: ["clear_invoice"] }, "keep", graph)).toEqual({ kind: "activity", op: "contains", activity: "clear_invoice" });
    expect(clauseForTarget({ kind: "node", ids: ["clear_invoice"] }, "exclude", graph)).toEqual({ kind: "activity", op: "never", activity: "clear_invoice" });
    expect(clauseForTarget({ kind: "node", ids: ["__end"] }, "keep", graph)).toEqual({ kind: "open", value: false });
    expect(clauseForTarget({ kind: "node", ids: ["__end"] }, "exclude", graph)).toEqual({ kind: "open", value: true });
    expect(clauseForTarget({ kind: "edge", ids: ["record_goods_receipt->record_invoice_receipt"] }, "keep", graph)).toEqual({ kind: "follows", a: "record_goods_receipt", b: "record_invoice_receipt", directly: true, never: undefined });
    expect(clauseForTarget({ kind: "edge", ids: ["record_goods_receipt->record_invoice_receipt"] }, "exclude", graph)).toMatchObject({ kind: "follows", directly: true, never: true });
    expect(clauseForTarget({ kind: "edge", ids: ["nope"] }, "keep", graph)).toBeUndefined();
    expect(clauseForTarget({ kind: "pair", ids: ["record_goods_receipt", "clear_invoice"] }, "keep", graph)).toEqual({ kind: "follows", a: "record_goods_receipt", b: "clear_invoice", directly: false, never: undefined });
    expect(clauseForTarget({ kind: "group", ids: ["receipt"] }, "keep", graph)).toEqual({ kind: "any", clauses: [{ kind: "activity", op: "contains", activity: "record_goods_receipt" }] });
    expect(clauseForTarget({ kind: "group", ids: ["receipt"] }, "exclude", graph)).toEqual([{ kind: "activity", op: "never", activity: "record_goods_receipt" }]);
    expect(clauseForTarget({ kind: "group", ids: ["empty"] }, "keep", graph)).toBeUndefined();
    expect(clauseForTarget({ kind: "set", ids: ["record_goods_receipt", "clear_invoice"] }, "keep", graph)).toEqual([
      { kind: "activity", op: "contains", activity: "record_goods_receipt" },
      { kind: "activity", op: "contains", activity: "clear_invoice" },
    ]);
  });
});
