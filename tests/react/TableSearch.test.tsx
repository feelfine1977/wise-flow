/**
 * Searching tests of the paged table alternative: random graphs, random page
 * sizes and random search texts. Every row appears exactly once across the
 * pages and in the graph's order, a search keeps exactly the rows a naive
 * filter keeps, the row counts announced (the status line, `aria-rowcount`,
 * `aria-rowindex`) are the true ones, and paging leaves the input focus on a
 * control that still works.
 */
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, type Locale, type Overlay, type StringKey, buildScales, defaultStyle, describeOverlay, t } from "../../src/index";
import { TableAlternative } from "../../src/react/index";
import { type FamilyName, families } from "../support/graphs";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";

afterEach(cleanup);

const FAMILY_NAMES = Object.keys(families) as FamilyName[];

/** A searching test checks thousands of rows: the message is written only for a check that fails. */
function must(ok: boolean, message: () => string): void {
  if (!ok) expect.fail(message());
}

// ---------------------------------------------------------------------------
// The rows of each table and the texts a search looks at, written out here.

interface Row {
  /** The row's first two cells, which tell the rows of a generated graph apart. */
  key: string;
  /** What the search looks at. */
  fields: string[];
}

function rowsOf(graph: FlowGraph, locale: Locale): Record<"nodes" | "edges" | "overlays", Row[]> {
  const nodeLabel = new Map(graph.nodes.map((n) => [n.id, n.label]));
  const groupLabel = new Map((graph.groups ?? []).map((g) => [g.id, g.label]));
  const kind = (k: string) => t(locale, `kind.${k}` as StringKey);
  const nodes = graph.nodes.map((n) => {
    const group = n.group ? (groupLabel.get(n.group) ?? n.group) : "";
    return { key: `${n.label}|${kind(n.kind)}`, fields: [n.label, kind(n.kind), group, ...(n.tags ?? [])] };
  });
  const edges = graph.edges.map((e) => {
    const [from, to] = [nodeLabel.get(e.source) ?? e.source, nodeLabel.get(e.target) ?? e.target];
    return { key: `${from}|${to}`, fields: [from, to, kind(e.kind), ...(e.tags ?? [])] };
  });
  const label = (id: string) => nodeLabel.get(id) ?? groupLabel.get(id) ?? id;
  const overlays = (graph.overlays ?? []).map((o: Overlay) => {
    const p = o.payload;
    const target = o.kind === "arc" && p?.source && p?.target ? `${label(String(p.source))} → ${label(String(p.target))}` : label(o.target);
    const name = t(locale, `overlay.${o.kind}` as StringKey);
    return { key: `${name}|${target}`, fields: [name, target, String(p?.label ?? p?.constraintId ?? ""), String(p?.text ?? describeOverlay(o, locale))] };
  });
  return { nodes, edges, overlays };
}

/** The naive filter: a row stays when one of its texts contains the trimmed search text, ignoring case. */
const matches = (row: Row, query: string) => {
  const q = query.trim().toLowerCase();
  return q === "" || row.fields.some((f) => f.toLowerCase().includes(q));
};

/** A count with the locale's grouping of thousands, by hand. */
const count = (n: number, locale: Locale) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, locale === "de" ? "." : ",");
const rowsText = (from: number, to: number, total: number, locale: Locale) =>
  locale === "de" ? `Zeilen ${count(from, locale)}–${count(to, locale)} von ${count(total, locale)}` : `Rows ${count(from, locale)}–${count(to, locale)} of ${count(total, locale)}`;
const nothing = (locale: Locale) => (locale === "de" ? "Nichts anzuzeigen." : "Nothing to show.");

/** A search text: none, part of a label, a kind, a group or a tag (also in capitals or with spaces around it), or text that matches little. */
function randomQuery(rng: Random, rows: Row[]): string {
  const texts = rows.flatMap((r) => r.fields).filter((f) => f.length > 0);
  const part = () => {
    if (!texts.length) return "a";
    const text = rng.pick(texts);
    const from = rng.int(0, Math.max(0, text.length - 1));
    return text.slice(from, from + rng.int(1, 6));
  };
  return rng.weighted<() => string>([
    [() => "", 2],
    [part, 6],
    [() => part().toUpperCase(), 1],
    [() => `  ${part()} `, 1],
    [() => rng.pick(["1", "0", "zz", "q", "activity", "stage", "→", "<", "&", "ä", "ß", '"', "-"]), 2],
  ])();
}

// ---------------------------------------------------------------------------

describe("the paged table over random graphs and searches", () => {
  it("lists every row once, filters as a naive filter, announces true counts and keeps the focus on a working control", () => {
    let pairs = 0;
    for (const seed of seeds(caseCount(100))) {
      const rng = createRandom(seed);
      const family = rng.pick(FAMILY_NAMES);
      const graph = families[family](rng.weighted([[0, 1], [rng.int(1, 10), 3], [rng.int(11, 60), 4]] as const), seed, { mixedKinds: rng.chance(0.4) });
      const locale = rng.pick<Locale>(["en", "de"]);
      const expectedRows = rowsOf(graph, locale);
      const most = Object.values(expectedRows).reduce((m, r) => Math.max(m, r.length), 1);
      // At most six pages a table, so that a case pages through all of them.
      const pageSize = Math.max(rng.weighted([[rng.int(1, 12), 4], [100, 1]] as const), Math.ceil(most / 6));
      // The map passes its scene's scales; given here too, a page costs only its rows.
      const view = render(<TableAlternative graph={graph} scales={buildScales(graph, defaultStyle)} pageSize={pageSize} locale={locale} onSelect={() => {}} />);
      const root = view.container.querySelector(".wf-table") as HTMLElement;
      const search = within(root).getByRole("searchbox") as HTMLInputElement;
      // Plain selectors below: the roles are those of the elements (table, row, button, status).
      const tables = [...root.querySelectorAll("table")];
      const pagers = [...root.querySelectorAll(".wf-table__pager")] as HTMLElement[];
      for (let q = 0; q < 3; q++) {
        // The same text again is no new search (the field does not change), so the page would stay: one more space.
        const drawn = randomQuery(rng, Object.values(expectedRows).flat());
        const query = drawn === search.value ? `${drawn} ` : drawn;
        fireEvent.change(search, { target: { value: query } });
        pairs++;
        (["nodes", "edges", "overlays"] as const).forEach((name, at) => {
          const label = () => caseLabel(seed, `${family} ${graph.nodes.length} nodes, ${locale}, page size ${pageSize}, ${name}, search ${JSON.stringify(query)}`);
          const table = tables[at];
          const [previous, next] = [...pagers[at].querySelectorAll("button")];
          const status = pagers[at].querySelector('[role="status"]')!;
          const expected = expectedRows[name].filter((row) => matches(row, query)).map((row) => row.key);
          must(table.getAttribute("aria-rowcount") === String(expected.length + 1), () => `${label()}: aria-rowcount ${table.getAttribute("aria-rowcount")}, ${expected.length} rows match`);
          // Page through with the keyboard on Next: the rows of every page, the status line, the row indices and the focus.
          const seen: string[] = [];
          for (let page = 0; ; page++) {
            const rows = [...table.querySelectorAll("tbody > tr")].filter((row) => row.hasAttribute("aria-rowindex"));
            const keys = rows.map((row) => [...row.children].slice(0, 2).map((cell) => cell.textContent).join("|"));
            const from = page * pageSize + 1;
            must(rows.every((row, i) => row.getAttribute("aria-rowindex") === String(from + i + 1)), () => `${label()}: page ${page + 1} has row indices ${rows.map((row) => row.getAttribute("aria-rowindex")).join(" ")}`);
            const said = expected.length ? rowsText(from, from + rows.length - 1, expected.length, locale) : nothing(locale);
            must(status.textContent === said, () => `${label()}: page ${page + 1} says "${status.textContent}", not "${said}"`);
            seen.push(...keys);
            if (next.disabled) break;
            must(page < expected.length, () => `${label()}: Next is enabled after ${page + 1} pages`);
            next.focus();
            fireEvent.click(next);
            const focused = document.activeElement as HTMLElement | null;
            must(!!focused && root.contains(focused) && !(focused as HTMLButtonElement).disabled, () => `${label()}: after Next to page ${page + 2} the focus is on ${focused?.outerHTML.slice(0, 80)}`);
          }
          must(JSON.stringify(seen) === JSON.stringify(expected), () => `${label()}: the pages list ${JSON.stringify(seen)}; the filter keeps ${JSON.stringify(expected)}`);
          // Back to the first page with the keyboard on Previous, after the first search.
          while (q === 0 && !previous.disabled) {
            previous.focus();
            fireEvent.click(previous);
            const focused = document.activeElement as HTMLElement | null;
            must(!!focused && root.contains(focused) && !(focused as HTMLButtonElement).disabled, () => `${label()}: after Previous the focus is on ${focused?.outerHTML.slice(0, 80)}`);
          }
        });
      }
      cleanup();
    }
    expect(pairs).toBeGreaterThanOrEqual(300);
  });
});
