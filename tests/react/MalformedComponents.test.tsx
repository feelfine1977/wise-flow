/**
 * Malformed input at the components, hooks and description functions of
 * `@wise/flow/react` other than the map: each runs once per malformed case
 * (see `tests/core/malformed-input.test.ts`) with the case's graph,
 * positions and overlays, and with junk traces, cohorts, filters, previews,
 * paths, actions and numbers a host may compute. Nothing may throw an untyped
 * error or be logged as an error but React's key warnings for ids that are
 * missing or there twice (in the findings); every text read aloud or shown in a
 * cell holds no number that went wrong where the input is accepted.
 */
import { ReactFlowProvider } from "@xyflow/react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ConstraintDescription,
  type FilterClause,
  type Locale,
  type MenuAction,
  PATTERNS,
  activityReferences,
  buildScales,
  buildScene,
  defaultActions,
  emptySelection,
  menuTargetFor,
} from "../../src/index";
import {
  AbstractionControls,
  Badges,
  Chip,
  ContextMenu,
  FilterChips,
  FlowComparison,
  Legend,
  OverlayLayer,
  PathList,
  PatternSwatch,
  TableAlternative,
  TraceTimeline,
  describeEdge,
  describeGroup,
  describeMap,
  describeNode,
  groupNodeId,
  midpoint,
  useFlowGraph,
  useOverlays,
  useStableLayout,
} from "../../src/react/index";
import { families } from "../support/graphs";
import { Calls, type MalformedCase, failure, junkCoordinate, junkNumber, junkString, junkValue, malformedCase } from "../support/malformed";
import { caseCount, seeds } from "../support/random";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CASES = seeds(caseCount(300)).map((seed) => malformedCase(seed, { maxSize: 8 }));
const fail = (message: string): never => expect.fail(message);
function must(ok: boolean, c: MalformedCase, what: () => string): void {
  if (!ok) expect.fail(failure(c, what()));
}
const readable = (s: string | null | undefined) => !s || !/\bNaN\b|Infinity|\[object /.test(s);

/** React's key warnings for a graph with an id twice or an element without one; anything else logged fails. */
function quietLog(c: MalformedCase, twice = false, junkProps = false): string[] {
  const logged: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ").slice(0, 300)));
  const keys = twice || c.issues.some((i) => i.message.startsWith("duplicate")) || [...c.graph.nodes, ...c.graph.edges].some((e) => e.id === undefined || e.id === "");
  return new Proxy(logged, {
    get: (target, key) =>
      key === "unexpected"
        ? target.filter((m) => !(keys && /^Each child in a list should have a unique "key" prop|^Encountered two children with the same key/.test(m)) && !(junkProps && /^Received NaN for the `%s` attribute|is an invalid value for the `%s` css style property/.test(m)))
        : Reflect.get(target, key),
  });
}

/** Renders, lets effects run, reads the texts a user meets and unmounts. */
/**
 * `sound`: check the texts; `twice`: an id twice among the host's items (React's key warning is in the
 * findings); `junkProps`: the host's own numbers are junk (React's warnings about NaN attributes and
 * invalid style values are in the findings).
 */
async function show(calls: Calls, name: string, c: MalformedCase, element: () => React.ReactElement, sound = c.accepted, twice = false, junkProps = false): Promise<void> {
  const logged = quietLog(c, twice, junkProps) as string[] & { unexpected: string[] };
  await calls.callAsync(name, c, async () => {
    const { container } = render(element());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (sound) {
      const texts = [...container.querySelectorAll("[aria-label], [title], td, th, caption, dt, dd, li, [role=status], [role=note], text, title, button")].map((el) => el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent);
      must(texts.every(readable), c, () => `${name}: a text that went wrong: ${texts.find((s) => !readable(s))}`);
    }
  });
  cleanup();
  vi.restoreAllMocks();
  must(logged.unexpected.length === 0, c, () => `${name} logged: ${logged.unexpected[0]}`);
}

function Hooks({ c }: { c: MalformedCase }) {
  const shown = useFlowGraph(c.graph, c.rng.chance() ? { minNodeShare: junkNumber(c.rng), collapse: c.rng.pick([false, "all"] as const) } : undefined);
  const stable = useStableLayout(c.rng.chance() ? shown : [shown, families.chain(2, 1)], { engine: "dagre" });
  const description: ConstraintDescription = { id: junkString(c.rng), type: c.rng.pick(["presence", "lag", "balance", "applicability", "unknown"]) as ConstraintDescription["type"], activities: c.graph.nodes.slice(0, 2).map((n) => n.id), a: ["gone"], b: [c.graph.nodes[0]?.id ?? "x"] };
  const overlays = useOverlays(c.rng.chance(0.8) ? [{ description, stats: { cases: junkValue(c.rng), violations: junkValue(c.rng), violationShare: junkValue(c.rng) } }] : undefined, { graph: c.graph });
  return <span data-status={stable.status}>{overlays.length}</span>;
}

describe("malformed input at the components of @wise/flow/react", () => {
  it("tables, path lists, filter chips, legends and overlay layers", async () => {
    const calls = new Calls(fail, 20_000);
    for (const c of CASES) {
      const g = c.graph;
      const locale: Locale = c.rng.chance() ? "en" : "de";
      const ids = [...g.nodes.map((n) => n.id), "gone", junkString(c.rng)];
      const scales = buildScales(g);
      await show(calls, "TableAlternative", c, () => (
        <TableAlternative graph={g} overlays={g.overlays} scales={c.rng.chance() ? scales : undefined} locale={locale} selection={{ nodes: c.rng.sample(ids, 2), edges: ["gone"], groups: [] }} pageSize={c.rng.chance(0.5) ? junkNumber(c.rng) : undefined} tables={c.rng.chance(0.8) ? undefined : ["edges", "overlays"]} />
      ), c.accepted);
      const focus = c.rng.chance(0.7) ? c.rng.pick(ids) : ([c.rng.pick(ids), c.rng.pick(ids)] as [string, string]);
      await show(calls, "PathList", c, () => <PathList graph={g} focus={focus} paths={c.rng.chance(0.3) ? g.paths : undefined} locale={locale} sort={c.rng.pick(["count", "label", "share", "violationShare"] as const)} ascending={c.rng.chance()} />);
      const clauses = [{ kind: "activity", op: c.rng.pick(["contains", "sometimes"]), activity: c.rng.pick(ids) }, { kind: "lag", a: c.rng.pick(ids), b: c.rng.pick(ids), min: junkValue(c.rng), unit: c.rng.pick(["D", "W"]) }, { kind: c.rng.pick(["any", "unknown"]) }] as unknown as FilterClause[];
      await show(calls, "FilterChips", c, () => <FilterChips filter={c.rng.chance() ? clauses : { and: clauses }} preview={{ cases_in: junkValue(c.rng), cases_total: junkValue(c.rng), per_clause: c.rng.pick([[{ clause: 1, removed_marginally: junkValue(c.rng) }], "x", null]) }} locale={locale} labelOf={(id) => (c.rng.chance(0.8) ? (g.nodes.find((n) => n.id === id)?.label ?? id) : junkString(c.rng))} clearable={c.rng.chance()} />, false);
      await show(calls, "Legend", c, () => <Legend scales={scales} overlays={g.overlays} locale={locale} />);
      const scene = buildScene(g, c.positions, { locale });
      await show(calls, "OverlayLayer", c, () => (
        <ReactFlowProvider>
          <svg>
            <OverlayLayer marks={c.rng.chance(0.8) ? scene.marks : undefined} shapes={scene.geometry.shapes} locale={locale} zoom={c.rng.chance() ? junkNumber(c.rng) : undefined} hoveredId={c.rng.chance() ? c.rng.pick(ids) : null} />
          </svg>
        </ReactFlowProvider>
      ));
      const overlays = g.overlays?.length ? g.overlays : [{ kind: "chip" as const, target: "__map", payload: { label: junkString(c.rng), text: junkString(c.rng), value: junkValue(c.rng) } }];
      await show(calls, "Badges", c, () => <svg><Badges badges={overlays} locale={locale} /></svg>);
      await show(calls, "Chip", c, () => <Chip chip={c.rng.pick(overlays)} locale={locale} />);
      await show(calls, "PatternSwatch", c, () => <PatternSwatch pattern={c.rng.pick(PATTERNS)} ink={junkString(c.rng)} />);
    }
    expect(calls.ranAtLeast(["TableAlternative", "PathList", "FilterChips", "Legend", "OverlayLayer", "Badges", "Chip", "PatternSwatch"], CASES.length)).toEqual([]);
    expect(calls.unknown({}), "plain errors").toEqual([]);
  });

  it("menus, controls, timelines, comparisons, hooks and descriptions", async () => {
    const calls = new Calls(fail, 20_000);
    for (const c of CASES) {
      const g = c.graph;
      const locale: Locale = c.rng.chance() ? "en" : "de";
      const ids = [...g.nodes.map((n) => n.id), "gone", junkString(c.rng)];
      const target = menuTargetFor(g, { kind: c.rng.pick(["node", "edge", "group"] as const), id: c.rng.pick(ids) }, emptySelection);
      const actions: MenuAction[] = [...defaultActions(g, target, locale), { id: junkString(c.rng), label: junkString(c.rng), group: c.rng.pick(["filter", "unknown" as "filter"]), accelerator: junkString(c.rng).slice(0, 2), disabled: c.rng.chance() }];
      await show(calls, "ContextMenu", c, () => <ContextMenu x={junkCoordinate(c.rng, 100)} y={junkCoordinate(c.rng, 100)} title={junkString(c.rng)} subtitle={c.rng.chance() ? junkString(c.rng) : undefined} note={c.rng.chance() ? junkString(c.rng) : undefined} actions={actions} locale={locale} onAction={() => {}} onClose={() => {}} />, false, false, true);
      await show(calls, "AbstractionControls", c, () => <AbstractionControls value={{ minNodeShare: junkNumber(c.rng), minEdgeShare: junkNumber(c.rng), collapse: c.rng.pick([false, "all", ["gone"]] as const) }} onChange={() => {}} locale={locale} hasStages={c.rng.chance()} view={c.rng.pick(["map", "table"] as const)} />, false, false, true);
      const stamp = () => c.rng.pick<unknown>([junkValue(c.rng), "garbage", "", "2024-02-30T25:00:00Z", "2024-01-01T08:00:00Z", new Date(NaN), new Date(2024, 0, 2), null, undefined]) as string;
      const traces = Array.from({ length: c.rng.int(0, 4) }, () => ({
        caseId: c.rng.pick(["c1", "c1", junkString(c.rng)]),
        attributes: c.rng.chance() ? { amount: junkValue(c.rng) } : undefined,
        events: Array.from({ length: c.rng.int(0, 5) }, () => ({ activity: c.rng.pick([...g.nodes.map((n) => n.label), junkString(c.rng)]), timestamp: stamp(), resource: c.rng.chance() ? junkString(c.rng) : undefined, violates: c.rng.chance() ? [junkString(c.rng)] : undefined })),
      }));
      await show(calls, "TraceTimeline", c, () => (
        <TraceTimeline traces={traces} anchor={c.rng.chance() ? c.rng.pick([...g.nodes.map((n) => n.label), "gone"]) : undefined} annotations={c.rng.chance() ? [{ caseId: c.rng.pick(["c1", "gone"]), constraintId: junkString(c.rng), label: junkString(c.rng), from: junkValue(c.rng), to: c.rng.chance() ? junkValue(c.rng) : undefined }] : undefined} locale={locale} width={c.rng.chance(0.3) ? junkNumber(c.rng) : undefined} rowHeight={c.rng.chance(0.3) ? junkNumber(c.rng) : undefined} colorKey={() => junkString(c.rng)} table={c.rng.chance()} />
      ), false, new Set(traces.map((x) => x.caseId)).size < traces.length, true);
      // Two cohorts with one id: React warns about their keys (in the findings).
      const cohorts = [{ id: "a", label: junkString(c.rng), cases: junkValue(c.rng), graph: g }, { id: c.rng.pick(["a", "b"]), label: "B", cases: c.rng.pick([0, 12, junkValue(c.rng)]), graph: c.rng.chance() ? g : families.stages(4, c.seed) }];
      await show(calls, "FlowComparison", c, () => <FlowComparison cohorts={cohorts} noun={junkString(c.rng)} />, false, cohorts[0].id === cohorts[1].id);
      await show(calls, "useFlowGraph", c, () => <Hooks c={c} />);
      calls.call("useStableLayout", c, () => undefined);
      calls.call("useOverlays", c, () => undefined);
      const activityLabels = c.rng.chance() ? { mode: c.rng.pick(["names", "ids"] as const), references: activityReferences(g), showCounts: true } : undefined;
      const groupLabel = new Map((g.groups ?? []).map((x) => [x.id, x.label]));
      for (const n of g.nodes.slice(0, 4)) calls.call("describeNode", c, () => must(!c.accepted || readable(describeNode(n, g.overlays ?? [], locale, n.group ? groupLabel.get(n.group) : undefined, activityLabels)), c, () => `describeNode: ${describeNode(n, g.overlays ?? [], locale, undefined, activityLabels)}`));
      if (!g.nodes.length) calls.call("describeNode", c, () => describeNode({ id: junkString(c.rng), kind: "zz" as "activity", label: junkString(c.rng) }, [], locale));
      for (const e of g.edges.length ? g.edges.slice(0, 4) : [{ id: "e", kind: "follows" as const, source: "gone", target: "gone" }]) calls.call("describeEdge", c, () => must(!c.accepted || readable(describeEdge(e, g, locale)), c, () => `describeEdge: ${describeEdge(e, g, locale)}`));
      for (const x of g.groups?.length ? g.groups : [{ id: "g", kind: "stage" as const, label: junkString(c.rng) }]) calls.call("describeGroup", c, () => describeGroup(x, junkNumber(c.rng), g.overlays ?? [], locale));
      calls.call("describeMap", c, () => must(!c.accepted || readable(describeMap(g, g.overlays ?? [], locale)), c, () => `describeMap: ${describeMap(g, g.overlays ?? [], locale)}`));
      calls.call("groupNodeId", c, () => groupNodeId(junkString(c.rng)));
      calls.call("midpoint", c, () => midpoint(c.rng.pick([[], [{ x: junkNumber(c.rng), y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: junkNumber(c.rng) }]])));
    }
    expect(calls.ranAtLeast(["ContextMenu", "AbstractionControls", "TraceTimeline", "FlowComparison", "useFlowGraph", "useStableLayout", "useOverlays", "describeNode", "describeEdge", "describeGroup", "describeMap", "groupNodeId", "midpoint"], CASES.length)).toEqual([]);
    expect(calls.unknown({}), "plain errors").toEqual([]);
  });
});
