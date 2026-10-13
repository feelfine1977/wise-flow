/**
 * Malformed input at `<ProcessMap/>` and `<ViewSwitcher/>`: each renders once
 * per malformed case (see `tests/core/malformed-input.test.ts`), in the SVG or
 * the Canvas renderer or as the table, with junk props a host may compute
 * (limits, budgets, thresholds, a focus, a selection and filters naming
 * nothing, a filter preview as a backend sends it). Nothing may throw or be
 * logged as an error; no drawn element may carry a coordinate or size that is
 * not a finite number, and the Canvas map draws with finite numbers only, for
 * input that validation accepts and sound props; the texts the map says aloud
 * hold no number that went wrong.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FilterClause, type Locale, activityReferences, resolveViews } from "../../src/index";
import { ProcessMap, ViewSwitcher } from "../../src/react/index";
import { Calls, caseSettled, eachCase, type MalformedCase, failure, junkNumber, junkString, junkValue, malformedCase, nonFinite } from "../support/malformed";
import { caseCount, seeds } from "../support/random";

afterEach(async () => {
  await caseSettled();
  cleanup();
  vi.restoreAllMocks();
});

const CASES = seeds(caseCount(300)).map((seed) => malformedCase(seed, { maxSize: 5 }));
const fail = (message: string): never => expect.fail(message);
function must(ok: boolean, c: MalformedCase, what: () => string): void {
  if (!ok) expect.fail(failure(c, what()));
}

/** A 2D context that keeps the arguments of every call. */
function recordingCanvas(): unknown[][] {
  const calls: unknown[][] = [];
  const ctx = new Proxy({ measureText: (text: string) => ({ width: String(text).length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : (...args: unknown[]) => void calls.push(args)),
    set: (target, key, value) => {
      if (typeof value === "number") calls.push([key, value]);
      target[key] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return calls;
}

/** What React and the map log as errors while a case renders. */
function errorsLogged(): string[] {
  const logged: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ").slice(0, 300)));
  return logged;
}

const GEOMETRY = ["x", "y", "width", "height", "cx", "cy", "r", "d", "points", "transform", "viewBox", "x1", "x2", "y1", "y2", "stroke-width"];

/** Attributes and inline styles of drawn elements that hold a number that went wrong. */
function brokenGeometry(root: Element): string[] {
  const out: string[] = [];
  for (const el of root.querySelectorAll("*")) {
    for (const name of GEOMETRY) {
      const v = el.getAttribute(name);
      if (v && /NaN|Infinity/.test(v)) out.push(`<${el.tagName.toLowerCase()} ${name}="${v.slice(0, 60)}">`);
    }
    const style = (el as HTMLElement).style?.cssText;
    if (style && /NaN|Infinity/.test(style)) out.push(`<${el.tagName.toLowerCase()} style="${style.slice(0, 80)}">`);
  }
  return out;
}

const readable = (s: string | null | undefined) => !s || !/\bNaN\b|Infinity|\[object /.test(s);

/**
 * What may be logged (all in the findings): React's warnings about keys where validation reports an id twice
 * or an element has no id at all (which validation does not report), and about a `NaN` attribute where the
 * host's own numbers are not finite (a slider showing an abstraction threshold of `NaN`).
 */
function unexpected(logged: string[], c: MalformedCase, soundProps = true): string[] {
  const duplicates = c.issues.some((i) => i.message.startsWith("duplicate"));
  const missing = [...c.graph.nodes, ...c.graph.edges].some((e) => e.id === undefined);
  return logged.filter(
    (m) =>
      !(duplicates && m.startsWith("Encountered two children with the same key")) &&
      !(missing && /^Each child in a list should have a unique "key" prop|^Encountered two children with the same key/.test(m)) &&
      !(!soundProps && m.startsWith("Received NaN for the `%s` attribute")),
  );
}

function junkClauses(c: MalformedCase): FilterClause[] {
  const id = () => c.rng.pick([...c.graph.nodes.map((n) => n.id), "gone"]);
  return [
    { kind: "activity", op: c.rng.pick(["contains", "never", "sometimes"]), activity: id() },
    { kind: "lag", a: id(), b: id(), min: junkValue(c.rng), unit: c.rng.pick(["D", "W"]) },
    { kind: c.rng.pick(["unknown", "any"]) },
  ] as unknown as FilterClause[];
}

describe("malformed input at the process map", () => {
  it("renders every case in each renderer and as the table without an error, a broken coordinate or a broken text", async ({ signal }) => {
    const calls = new Calls(fail, 20_000);
    // The checks of what the Canvas map drew hold only if it drew.
    let drawn = 0;
    await eachCase(CASES, signal, async (c) => {
      const canvas = recordingCanvas();
      const logged = errorsLogged();
      const renderer = c.rng.pick(["svg", "canvas", "auto"] as const);
      const view = c.rng.chance(0.2) ? "table" : "map";
      const locale: Locale = c.rng.chance() ? "en" : "de";
      const ids = [...c.graph.nodes.map((n) => n.id), "gone", junkString(c.rng)];
      const numbers = { describedLimit: c.rng.chance(0.3) ? junkNumber(c.rng) : undefined, canvasThreshold: c.rng.chance(0.3) ? junkNumber(c.rng) : undefined, edgeBudget: c.rng.pick([junkNumber(c.rng), "all" as const, "adaptive" as const, 3]) };
      const abstraction = c.rng.chance(0.3) ? { minNodeShare: junkNumber(c.rng), minEdgeShare: junkNumber(c.rng), collapse: c.rng.pick([false, "all"] as const) } : undefined;
      const soundProps = [numbers.describedLimit, numbers.canvasThreshold, abstraction?.minNodeShare, abstraction?.minEdgeShare].every((v) => v === undefined || Number.isFinite(v));
      const sound = c.accepted && soundProps;
      const layoutStatus = await calls.callAsync("ProcessMap", c, async () => {
        const { container } = render(
          <div style={{ width: 800, height: 600 }}>
            <ProcessMap
              graph={c.graph}
              positions={c.rng.chance(0.8) ? c.positions : undefined}
              renderer={renderer}
              view={view}
              locale={locale}
              overlays={c.rng.chance() ? c.graph.overlays : [{ kind: "badge", target: "gone" }]}
              selection={{ nodes: c.rng.sample(ids, 2), edges: ["gone"], groups: [] }}
              defaultFocus={c.rng.chance() ? c.rng.pick(ids) : undefined}
              filters={c.rng.chance() ? junkClauses(c) : undefined}
              filterPreview={c.rng.chance() ? { cases_in: junkValue(c.rng), cases_out: junkValue(c.rng), per_clause: c.rng.pick([[{ clause: 0, removed_marginally: 3 }], 12, null]) } : undefined}
              lanes={c.rng.pick(["none", "stages", "roles"] as const)}
              defaultAbstraction={abstraction}
              activityLabels={c.rng.chance() ? { mode: c.rng.pick(["names", "ids"] as const), references: activityReferences(c.graph), showCounts: true } : undefined}
              paths={c.rng.chance(0.3) ? c.graph.paths : undefined}
              announce={c.rng.chance(0.2) ? junkString(c.rng) : undefined}
              layout={{ engine: "dagre" }}
              {...numbers}
            />
          </div>,
        );
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          // The Canvas map draws on the next animation frame.
          await new Promise((resolve) => requestAnimationFrame(resolve));
        });
        const map = container.querySelector(".wf-process-map");
        must(!!map, c, () => "no map rendered");
        if (sound) {
          must(brokenGeometry(container).length === 0, c, () => `${renderer}/${view}: ${brokenGeometry(container).slice(0, 3).join(" ")}`);
          must(nonFinite(canvas).length === 0, c, () => `the Canvas map drew at ${nonFinite(canvas).join(", ")}`);
        }
        drawn += canvas.length;
        const spoken = [...container.querySelectorAll("[aria-label], [aria-live], .wf-sr-only, [role=note], caption, td, th")].map((el) => el.getAttribute("aria-label") ?? el.textContent);
        must(spoken.every(readable), c, () => `a text that went wrong: ${spoken.find((s) => !readable(s))}`);
        return map?.getAttribute("data-layout-status");
      });
      must(unexpected(logged, c, soundProps).length === 0, c, () => `logged: ${unexpected(logged, c, soundProps)[0]}`);
      cleanup();
      vi.restoreAllMocks();
      must(layoutStatus !== null, c, () => "the map has no layout status");
    });
    expect(drawn).toBeGreaterThan(CASES.length);
    expect(calls.ranAtLeast(["ProcessMap"], CASES.length)).toEqual([]);
    expect(calls.unknown({}), "plain errors").toEqual([]);
  });

  it("renders every case's views in the view switcher, side by side and one at a time", async ({ signal }) => {
    const calls = new Calls(fail, 20_000);
    await eachCase(CASES, signal, async (c) => {
      recordingCanvas();
      const logged = errorsLogged();
      const columns = c.rng.chance(0.3) ? junkNumber(c.rng) : undefined;
      await calls.callAsync("ViewSwitcher", c, async () => {
        const views = resolveViews(c.graph, [{ id: "a", label: junkString(c.rng) }, { id: "b", label: "B", nodeMetrics: Object.fromEntries(c.graph.nodes.slice(0, 2).map((n) => [n.id, { cases: junkValue(c.rng) }])), overlays: c.graph.overlays }], c.positions);
        const { container } = render(
          <div style={{ width: 900, height: 600 }}>
            <ViewSwitcher views={views} mode={c.rng.pick(["single", "grid"] as const)} columns={columns} activeView={c.rng.pick(["a", "b", "gone"])} edgeBudget="all" locale={c.rng.chance() ? "en" : "de"} />
          </div>,
        );
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        // A number of columns that is not a positive whole number reaches the grid's CSS: in the findings.
        if (c.accepted && (columns === undefined || (Number.isInteger(columns) && columns > 0 && columns < 100))) must(brokenGeometry(container).length === 0, c, () => `view switcher: ${brokenGeometry(container).slice(0, 3).join(" ")}`);
      });
      must(unexpected(logged, c).length === 0, c, () => `logged: ${unexpected(logged, c)[0]}`);
      cleanup();
      vi.restoreAllMocks();
    });
    expect(calls.ranAtLeast(["ViewSwitcher"], CASES.length)).toEqual([]);
    expect(calls.unknown({}), "plain errors").toEqual([]);
  });
});
