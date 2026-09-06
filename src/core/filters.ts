/**
 * Filter clauses of the workbench contract (`{"and": [clause, …]}`) as typed
 * data, their canonical form, plain-word descriptions for chips, and the
 * clauses that map actions produce. The map never filters data itself: it
 * renders the chips and calls back with the changed filter.
 */
import { type Locale, formatCount, formatNumber } from "./format";
import { type FlowGraph } from "./model";
import { type StringKey, t } from "./strings";

export type TimeMode = "case_start" | "case_end" | "active" | "events_inside";

export interface TimeClause {
  kind: "time";
  /** Which timestamp the window applies to; `mode` is accepted as an alias. */
  field?: TimeMode;
  mode?: TimeMode;
  from?: string;
  to?: string;
}

export interface AttributeClause {
  kind: "attribute";
  field: string;
  in?: (string | number | boolean)[];
  not_in?: (string | number | boolean)[];
  range?: { min?: number | null; max?: number | null } | [number | null, number | null];
  missing?: boolean;
}

export type ActivityOp = "contains" | "not_contains" | "starts_with" | "ends_with" | "never";

export interface ActivityClause {
  kind: "activity";
  op: ActivityOp;
  activity: string;
}

export interface FollowsClause {
  kind: "follows";
  a: string;
  b: string;
  /** Directly follows (true) or eventually follows (false, default). */
  directly?: boolean;
  /** Cases where `b` never follows `a`. */
  never?: boolean;
}

export interface LagClause {
  kind: "lag";
  a: string;
  b: string;
  unit?: "D" | "H" | "M" | "S";
  min?: number;
  max?: number;
  directly?: boolean;
}

export interface CountClause {
  kind: "count";
  activity: string;
  min?: number;
  max?: number;
}

export interface OpenClause {
  kind: "open";
  value: boolean;
}

export interface ConstraintClause {
  kind: "constraint";
  constraint: string;
  state: "violating" | "satisfied" | "in_scope" | "out_of_scope";
  label?: string;
}

export interface SliceClause {
  kind: "slice";
  slicing: string;
  key: unknown;
}

export interface AnyClause {
  kind: "any";
  clauses: FilterClause[];
}

export type FilterClause = TimeClause | AttributeClause | ActivityClause | FollowsClause | LagClause | CountClause | OpenClause | ConstraintClause | SliceClause | AnyClause;

export interface Filter {
  and: FilterClause[];
}

/** Cases in and out under the filter, as `GET …/filters/preview` returns them (snake_case accepted). */
export interface FilterPreview {
  casesIn?: number;
  casesOut?: number;
  casesTotal?: number;
  /** Cases that only this clause removes, by clause index. */
  perClause?: { clause: number; removedMarginally: number }[];
  inScopeByConstraint?: Record<string, number>;
}

export const emptyFilter: Filter = { and: [] };

/** A filter from the prop forms a component accepts. */
export function asFilter(f: Filter | FilterClause[] | undefined | null): Filter {
  if (!f) return { and: [] };
  if (Array.isArray(f)) return { and: f };
  return { and: f.and ?? [] };
}

/** Accepts the contract's snake_case preview or the camelCase form. */
export function normalizeFilterPreview(raw: Record<string, unknown> | FilterPreview | undefined): FilterPreview | undefined {
  if (!raw) return undefined;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const per = (r.perClause ?? r.per_clause) as { clause: number; removedMarginally?: number; removed_marginally?: number }[] | undefined;
  const casesIn = n(r.casesIn ?? r.cases_in);
  const casesOut = n(r.casesOut ?? r.cases_out);
  return {
    casesIn,
    casesOut,
    casesTotal: n(r.casesTotal ?? r.cases_total) ?? (casesIn !== undefined && casesOut !== undefined ? casesIn + casesOut : undefined),
    perClause: per?.map((p) => ({ clause: p.clause, removedMarginally: n(p.removedMarginally ?? p.removed_marginally) ?? 0 })),
    inScopeByConstraint: (r.inScopeByConstraint ?? r.in_scope_by_constraint) as Record<string, number> | undefined,
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A clause with aliases resolved (`mode` → `field`, `not_contains` → `never`, sorted lists, nested groups canonical). */
export function canonicalClause(c: FilterClause): FilterClause {
  switch (c.kind) {
    case "time":
      return { kind: "time", field: c.field ?? c.mode ?? "case_start", from: c.from, to: c.to };
    case "attribute": {
      const sortValues = (v: (string | number | boolean)[] | undefined) => (v ? [...v].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)) : undefined);
      const range = Array.isArray(c.range) ? { min: c.range[0], max: c.range[1] } : c.range;
      return { kind: "attribute", field: c.field, in: sortValues(c.in), not_in: sortValues(c.not_in), range, missing: c.missing };
    }
    case "activity":
      return { kind: "activity", op: c.op === "not_contains" ? "never" : c.op, activity: c.activity };
    case "follows":
      return { kind: "follows", a: c.a, b: c.b, directly: c.directly ?? false, never: c.never || undefined };
    case "lag":
      return { kind: "lag", a: c.a, b: c.b, unit: c.unit ?? "D", min: c.min, max: c.max, directly: c.directly || undefined };
    case "count":
      return { kind: "count", activity: c.activity, min: c.min, max: c.max };
    case "open":
      return { kind: "open", value: c.value };
    case "constraint":
      return { kind: "constraint", constraint: c.constraint, state: c.state };
    case "slice":
      return { kind: "slice", slicing: c.slicing, key: c.key };
    case "any":
      return { kind: "any", clauses: c.clauses.map(canonicalClause).sort((a, b) => (clauseKey(a) < clauseKey(b) ? -1 : 1)) };
  }
}

/** Stable key of a clause: the same clause in any spelling yields the same key. */
export function clauseKey(c: FilterClause): string {
  return stable(canonicalClause(c));
}

/**
 * Canonical filter: aliases resolved, clauses sorted by key, duplicates
 * removed. Two orderings of the same clauses give byte-identical JSON.
 */
export function canonicalFilter(f: Filter | FilterClause[] | undefined): Filter {
  const seen = new Map<string, FilterClause>();
  for (const c of asFilter(f).and) {
    const canon = canonicalClause(c);
    seen.set(clauseKey(canon), canon);
  }
  return { and: [...seen.keys()].sort().map((k) => seen.get(k)!) };
}

export function filterEquals(a: Filter | FilterClause[] | undefined, b: Filter | FilterClause[] | undefined): boolean {
  return stable(canonicalFilter(a)) === stable(canonicalFilter(b));
}

/** The filter with a clause appended, unless the same clause is already there. */
export function addClause(f: Filter | FilterClause[] | undefined, clause: FilterClause): Filter {
  const current = asFilter(f);
  const key = clauseKey(clause);
  if (current.and.some((c) => clauseKey(c) === key)) return current;
  return { and: [...current.and, clause] };
}

export function removeClause(f: Filter | FilterClause[] | undefined, index: number): Filter {
  const current = asFilter(f);
  return { and: current.and.filter((_, i) => i !== index) };
}

/** True for clauses that change the content of cases rather than their selection. */
export function changesCases(c: FilterClause): boolean {
  if (c.kind === "time") return (c.field ?? c.mode) === "events_inside";
  if (c.kind === "any") return c.clauses.some(changesCases);
  return false;
}

function formatUnit(value: number, unit: LagClause["unit"], locale: Locale): string {
  const u = unit ?? "D";
  const suffix = u === "D" ? t(locale, "unit.days") : u === "H" ? t(locale, "unit.hours") : u === "M" ? t(locale, "unit.minutes") : t(locale, "unit.seconds");
  return `${formatNumber(value, Number.isInteger(value) ? 0 : 1, locale)} ${suffix}`;
}

/** The clause in plain words for a chip; `labelOf` maps activity ids to labels. */
export function describeClause(c: FilterClause, locale: Locale = "en", labelOf: (id: string) => string = (id) => id): string {
  switch (c.kind) {
    case "time": {
      const field = c.field ?? c.mode ?? "case_start";
      const key = `clause.time.${field}` as StringKey;
      return t(locale, key, { from: c.from ?? "…", to: c.to ?? "…" });
    }
    case "attribute": {
      if (c.missing) return t(locale, "clause.attribute.missing", { field: c.field });
      if (c.in) return t(locale, "clause.attribute.in", { field: c.field, values: c.in.map(String).join(", ") });
      if (c.not_in) return t(locale, "clause.attribute.not_in", { field: c.field, values: c.not_in.map(String).join(", ") });
      if (c.range) {
        const r = Array.isArray(c.range) ? { min: c.range[0], max: c.range[1] } : c.range;
        const f = (v: number | null | undefined) => (typeof v === "number" ? formatNumber(v, Number.isInteger(v) ? 0 : 1, locale) : "…");
        return t(locale, "clause.attribute.range", { field: c.field, min: f(r.min), max: f(r.max) });
      }
      return c.field;
    }
    case "activity": {
      const op = c.op === "not_contains" ? "never" : c.op;
      return t(locale, `clause.activity.${op}` as StringKey, { activity: labelOf(c.activity) });
    }
    case "follows": {
      const key: StringKey = c.never ? "clause.follows.never" : c.directly ? "clause.follows.directly" : "clause.follows.eventually";
      return t(locale, key, { a: labelOf(c.a), b: labelOf(c.b) });
    }
    case "lag": {
      const vars = { a: labelOf(c.a), b: labelOf(c.b), min: c.min !== undefined ? formatUnit(c.min, c.unit, locale) : "", max: c.max !== undefined ? formatUnit(c.max, c.unit, locale) : "" };
      if (c.min !== undefined && c.max !== undefined) return t(locale, "clause.lag.range", vars);
      if (c.max !== undefined) return t(locale, "clause.lag.max", { ...vars, value: vars.max });
      return t(locale, "clause.lag.min", { ...vars, value: vars.min });
    }
    case "count": {
      const vars = { activity: labelOf(c.activity), min: c.min ?? 0, max: c.max ?? "" };
      if (c.min !== undefined && c.max !== undefined) return t(locale, "clause.count.range", vars);
      if (c.max !== undefined) return t(locale, "clause.count.max", vars);
      return t(locale, "clause.count.min", vars);
    }
    case "open":
      return t(locale, c.value ? "clause.open.true" : "clause.open.false");
    case "constraint":
      return t(locale, `clause.constraint.${c.state}` as StringKey, { constraint: c.label ?? c.constraint });
    case "slice":
      return t(locale, "clause.slice", { slicing: c.slicing, key: Array.isArray(c.key) ? c.key.map(String).join(" · ") : String(c.key) });
    case "any":
      return t(locale, "clause.any", { clauses: c.clauses.map((x) => describeClause(x, locale, labelOf)).join(" | ") });
    default:
      return t(locale, "clause.unknown", { kind: String((c as { kind: string }).kind) });
  }
}

/** Reading of a preview line: "N_in of N_total cases". */
export function describePreview(preview: FilterPreview | undefined, locale: Locale = "en"): string | undefined {
  if (!preview || preview.casesIn === undefined) return undefined;
  const total = preview.casesTotal ?? (preview.casesOut !== undefined ? preview.casesIn + preview.casesOut : undefined);
  return total !== undefined ? t(locale, "filters.cases", { in: formatCount(preview.casesIn, locale), total: formatCount(total, locale) }) : formatCount(preview.casesIn, locale);
}

/** What a filter action refers to: an activity, a path, a stage, two activities or a set. */
export interface FilterTarget {
  kind: "node" | "edge" | "group" | "pair" | "set";
  ids: string[];
}

/**
 * The clause that "filter to" (`keep`) or "exclude" produces for a target:
 * activities → `contains` / `never`; a path → `follows` directly / never
 * directly; a stage → `any` of its members; two activities → eventually
 * follows; a set → one `contains` clause per activity (combined by the AND
 * of the filter) or `never` for each.
 */
export function clauseForTarget(target: FilterTarget, action: "keep" | "exclude", graph?: FlowGraph): FilterClause | FilterClause[] | undefined {
  const [first, second] = target.ids;
  switch (target.kind) {
    case "node": {
      if (!first) return undefined;
      const node = graph?.nodes.find((n) => n.id === first);
      if (node?.kind === "event") {
        // Cases that reach the end event are closed; excluding them keeps the open ones.
        // A start event has no clause of its own (every case starts somewhere).
        if (!node.tags?.includes("end")) return undefined;
        return { kind: "open", value: action === "exclude" } as OpenClause;
      }
      return { kind: "activity", op: action === "keep" ? "contains" : "never", activity: first };
    }
    case "edge": {
      const e = graph?.edges.find((x) => x.id === first);
      if (!e) return undefined;
      return { kind: "follows", a: e.source, b: e.target, directly: true, never: action === "exclude" || undefined };
    }
    case "pair":
      if (!first || !second) return undefined;
      return { kind: "follows", a: first, b: second, directly: false, never: action === "exclude" || undefined };
    case "group": {
      const members = graph?.nodes.filter((n) => n.group === first).map((n) => n.id) ?? [];
      if (members.length === 0) return undefined;
      if (action === "keep") return { kind: "any", clauses: members.map((id) => ({ kind: "activity", op: "contains", activity: id })) };
      return members.map((id) => ({ kind: "activity", op: "never", activity: id }) as ActivityClause);
    }
    case "set":
      return target.ids.map((id) => ({ kind: "activity", op: action === "keep" ? "contains" : "never", activity: id }) as ActivityClause);
  }
}
