import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import {
  type FilterClause,
  type FlowGraph,
  addClause,
  canonicalClause,
  canonicalFilter,
  changesCases,
  clauseForTarget,
  clauseKey,
  abstract,
  collapseGroups,
  defaultActions,
  menuTargetFor,
  describeClause,
  describePreview,
  emptyFilter,
  emptySelection,
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
  const nested: FlowGraph = {
    nodes: [{ id: "a", kind: "activity", label: "A", group: "parent" }, { id: "b", kind: "activity", label: "B", group: "child" }, { id: "c", kind: "activity", label: "C" }],
    edges: [{ id: "ac", source: "a", target: "c", kind: "follows" }],
    groups: [{ id: "parent", label: "Parent", kind: "stage" }, { id: "child", label: "Child", kind: "stage", parent: "parent" }, { id: "empty", label: "Empty", kind: "stage" }],
  };

  it("emits equivalent original activity clauses for nested, partial and repeated collapse", () => {
    const keep = { kind: "any", clauses: ["a", "b"].map((activity) => ({ kind: "activity", op: "contains", activity })) };
    const exclude = ["a", "b"].map((activity) => ({ kind: "activity", op: "never", activity }));
    const child = collapseGroups(nested, ["child"]);
    for (const shown of [nested, child, collapseGroups(nested, ["parent"]), collapseGroups(child, ["parent"]), abstract(nested, { collapse: ["parent"] }), collapseGroups(nested, ["parent", "child"])]) {
      const kind = shown.nodes.some((n) => n.id === "parent") ? "node" : "group";
      const target = menuTargetFor(shown, { kind, id: "parent" }, { nodes: [], edges: [], groups: [] });
      const actions = defaultActions(shown, target);
      expect(actions.find((a) => a.id === "filter-to")?.clause).toEqual(keep);
      expect(actions.find((a) => a.id === "exclude")?.clause).toEqual(exclude);
      expect(clauseForTarget({ kind: "group", ids: ["parent"] }, "keep", shown)).toEqual(keep);
    }
  });

  it("disables filters for an empty collapsed stage and unsupported collapsed routes", () => {
    const shown = collapseGroups(nested, ["parent", "empty"]);
    expect(clauseForTarget({ kind: "node", ids: ["empty"] }, "keep", shown)).toBeUndefined();
    expect(clauseForTarget({ kind: "edge", ids: ["ac"] }, "keep", shown)).toBeUndefined();
    expect(clauseForTarget({ kind: "pair", ids: ["parent", "c"] }, "exclude", shown)).toBeUndefined();
  });

  it("keeps each selected stage as an any-member condition in a set", () => {
    const shown = collapseGroups(nested, ["parent"]);
    expect(clauseForTarget({ kind: "set", ids: ["parent", "c"] }, "keep", shown)).toEqual([
      { kind: "any", clauses: ["a", "b"].map((activity) => ({ kind: "activity", op: "contains", activity })) },
      { kind: "activity", op: "contains", activity: "c" },
    ]);
    expect(clauseForTarget({ kind: "set", ids: ["parent", "c"] }, "exclude", shown)).toEqual(["a", "b", "c"].map((activity) => ({ kind: "activity", op: "never", activity })));
  });

  it("retains opaque stage IDs through serialization and excludes structural members", () => {
    const graph: FlowGraph = { nodes: [{ id: "a", label: "A", kind: "activity", group: "__proto__" }, { id: "start", label: "Start", kind: "event", group: "__proto__" }], edges: [], groups: [{ id: "__proto__", kind: "stage", label: "Stage" }] };
    const expected = { kind: "any", clauses: [{ kind: "activity", op: "contains", activity: "a" }] };
    expect(clauseForTarget({ kind: "group", ids: ["__proto__"] }, "keep", graph)).toEqual(expected);
    const shown = JSON.parse(JSON.stringify(abstract(graph, { collapse: "all" }))) as FlowGraph;
    expect(clauseForTarget({ kind: "node", ids: ["__proto__"] }, "keep", shown)).toEqual(expected);
    expect(clauseForTarget({ kind: "node", ids: ["__proto__"] }, "keep", { ...shown, meta: undefined })).toBeUndefined();
  });
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

  it("reads the marginal removals only from a list, and only its entries that name a clause by number", () => {
    // A backend may send anything under per_clause; what is not a list of entries with a numeric clause is not read.
    for (const per of [12, "0", {}, true, null]) {
      expect(normalizeFilterPreview({ cases_in: 5, per_clause: per })).toEqual({ casesIn: 5, casesOut: undefined, casesTotal: undefined, perClause: undefined, inScopeByConstraint: undefined });
    }
    const p = normalizeFilterPreview({ perClause: [null, 3, { clause: "1", removedMarginally: 4 }, { clause: 2, removed_marginally: "7" }, { clause: 0, removedMarginally: 9 }] });
    expect(p?.perClause).toEqual([{ clause: 2, removedMarginally: 0 }, { clause: 0, removedMarginally: 9 }]);
  });

  it("keeps a clause of a kind it does not know as it is, and reads a group without clauses as an empty group", () => {
    const future = { kind: "future", window: 3 } as unknown as FilterClause;
    const bare = { kind: "any" } as unknown as FilterClause;
    expect(canonicalClause(future)).toEqual({ kind: "future", window: 3 });
    expect(canonicalClause(bare)).toEqual({ kind: "any", clauses: [] });
    // Sorted by key: '{"clauses":[],"kind":"any"}' before '{"kind":"future","window":3}'.
    expect(canonicalFilter([future, bare, future])).toEqual({ and: [{ kind: "any", clauses: [] }, { kind: "future", window: 3 }] });
    expect(filterEquals([future, bare], [bare, future])).toBe(true);
  });

  it("describes a group without clauses as an empty group, which changes no cases", () => {
    const bare = { kind: "any" } as unknown as FilterClause;
    for (const locale of ["en", "de"] as const) expect(describeClause(bare, locale)).toBe(describeClause({ kind: "any", clauses: [] }, locale));
    expect(changesCases(bare)).toBe(false);
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

describe("the time clause that cuts events out of cases", () => {
  const inside: FilterClause = { kind: "time", field: "events_inside", from: "2018-01-01", to: "2018-03-31" };
  const contains: FilterClause = { kind: "activity", op: "contains", activity: "clear_invoice" };

  it("is made by no map action: every action on every element, pair and set adds activity, path or open-case clauses", () => {
    const kinds = new Set<string>();
    const flat = (c: FilterClause | FilterClause[] | undefined): FilterClause[] => (c === undefined ? [] : Array.isArray(c) ? c.flatMap(flat) : c.kind === "any" ? [c, ...flat(c.clauses ?? [])] : [c]);
    for (const shown of [globalScene, collapseGroups(globalScene, "all")]) {
      const targets = [
        ...shown.nodes.map((n) => menuTargetFor(shown, { kind: "node", id: n.id }, emptySelection)),
        ...shown.edges.map((e) => menuTargetFor(shown, { kind: "edge", id: e.id }, emptySelection)),
        ...(shown.groups ?? []).map((g) => menuTargetFor(shown, { kind: "group", id: g.id }, emptySelection)),
        menuTargetFor(shown, { kind: "node", id: shown.nodes[2].id }, { nodes: [shown.nodes[1].id, shown.nodes[2].id], edges: [], groups: [] }),
        menuTargetFor(shown, { kind: "node", id: shown.nodes[1].id }, { nodes: shown.nodes.slice(1, 5).map((n) => n.id), edges: [], groups: [] }),
      ];
      for (const target of targets) for (const action of defaultActions(shown, target)) for (const c of flat(action.clause)) kinds.add(c.kind);
    }
    expect([...kinds].sort()).toEqual(["activity", "any", "follows", "open"]);
  });

  it("is passed on as the host gave it, marked as changing cases", () => {
    const given = { and: [inside, contains] };
    expect(changesCases(inside)).toBe(true);
    expect(canonicalClause(inside)).toEqual(inside);
    expect(removeClause(given, 1)).toEqual({ and: [inside] });
    expect(addClause(given, { kind: "open", value: false }).and.slice(0, 2)).toEqual([inside, contains]);
    expect(describeClause(inside)).toBe("events inside 2018-01-01 – 2018-03-31");
  });
});
