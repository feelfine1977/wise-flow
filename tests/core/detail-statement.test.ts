import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { ANCHOR_TAG, INDIRECT_TAG, type FlowEdge, type FlowGraph, type Locale, type Overlay, abstract, detailNotes, detailStatement, hasTag, overlaysFor } from "../../src/index";

const isActivity = (n: FlowGraph["nodes"][number]) => n.kind === "activity" || n.kind === "stage";
const isPath = (e: FlowEdge) => e.kind !== "constraint" && !hasTag(e, INDIRECT_TAG);
const labelOf = (id: string) => globalScene.nodes.find((n) => n.id === id)?.label ?? id;

/** Numbers as the locale groups them, written with the platform's formatter. */
const count = (v: number, locale: Locale) => v.toLocaleString(locale === "de" ? "de-DE" : "en-US");
/** A share with one decimal, never "100.0" for a part of the whole. */
function share(part: number, whole: number, locale: Locale) {
  const pct = (100 * part) / whole;
  const text = part < whole && pct >= 99.95 ? ">99.9" : pct.toFixed(1);
  return `${locale === "de" ? text.replace(".", ",") : text} %`;
}

/** The words of the statements, written out for each language. */
const WORDS = {
  en: {
    of: (a: string, b: string) => `${a} of ${b}`,
    events: (s: string) => `${s} of events`,
    activities: (a: string, b: string, s: string) => `${a} of ${b} activities shown, carrying ${s} of the events`,
    rarest: (h: number, locale: Locale) => (h === 1 ? "; the rarest is not shown" : `; the ${count(h, locale)} rarest are not shown`),
    kept: (k: string) => `${k} kept`,
    strongest: (s: string) => `strongest not shown: ${s}`,
    paths: (a: string, b: string, f: string) => `${a} of ${b} paths: ${f} by frequency`,
    pathsKept: (k: string) => `, ${k} kept so that every activity lies on a way from start to end`,
    strongestFull: (s: string) => ` Strongest path not shown: ${s}.`,
  },
  de: {
    of: (a: string, b: string) => `${a} von ${b}`,
    events: (s: string) => `${s} der Ereignisse`,
    activities: (a: string, b: string, s: string) => `${a} von ${b} Aktivitäten gezeigt, mit ${s} der Ereignisse`,
    rarest: (h: number, locale: Locale) => (h === 1 ? "; die seltenste wird nicht gezeigt" : `; die ${count(h, locale)} seltensten werden nicht gezeigt`),
    kept: (k: string) => `${k} behalten`,
    strongest: (s: string) => `stärkster nicht gezeigt: ${s}`,
    paths: (a: string, b: string, f: string) => `${a} von ${b} Pfaden: ${f} nach Häufigkeit`,
    pathsKept: (k: string) => `, ${k} behalten, damit jede Aktivität auf einem Weg vom Start zum Ende liegt`,
    strongestFull: (s: string) => ` Stärkster nicht gezeigter Pfad: ${s}.`,
  },
};

/** The statements, computed from the graph before and after the abstraction: what is drawn, not what `meta` says. */
function expected(input: FlowGraph, result: FlowGraph, locale: Locale) {
  const w = WORDS[locale];
  const n = (v: number) => count(v, locale);
  const all = input.nodes.filter(isActivity);
  const shown = result.nodes.filter(isActivity);
  const events = (nodes: typeof all) => nodes.reduce((sum, v) => sum + v.metrics!.events!, 0);
  const s = share(events(shown), events(all), locale);
  const paths = input.edges.filter(isPath);
  const drawn = result.edges.filter(isPath);
  const kept = drawn.filter((e) => hasTag(e, ANCHOR_TAG)).length;
  const ids = new Set(drawn.map((e) => e.id));
  const hidden = paths.filter((e) => !ids.has(e.id)).map((e) => e.metrics!.count!);
  const strongest = hidden.length ? Math.max(...hidden) : undefined;
  const weakest = Math.min(...drawn.map((e) => e.metrics!.count!));
  return {
    activities: {
      short: `${w.of(n(shown.length), n(all.length))} · ${w.events(s)}`,
      full: `${w.activities(n(shown.length), n(all.length), s)}${all.length > shown.length ? w.rarest(all.length - shown.length, locale) : ""}.`,
    },
    paths: {
      short: [w.of(n(drawn.length), n(paths.length)), ...(kept ? [w.kept(n(kept))] : []), ...(strongest !== undefined && strongest > weakest ? [w.strongest(n(strongest))] : [])].join(" · "),
      full: `${w.paths(n(drawn.length), n(paths.length), n(drawn.length - kept))}${kept ? w.pathsKept(n(kept)) : ""}.${strongest !== undefined ? w.strongestFull(n(strongest)) : ""}`,
    },
  };
}

/** Five pairs of positions: the lowest, two between, the stories' opening and every path. */
const PAIRS: [number, number][] = [
  [0, 0],
  [0.2, 0.05],
  [0.38, 0.05],
  [0.8, 0.5],
  [1, 1],
];

describe("the statements of the detail sliders", () => {
  it.each(["en", "de"] as const)("say what the whole log shows at five pairs of positions, as the graph counts it (%s)", (locale) => {
    const seen = new Set<string>();
    for (const [a, p] of PAIRS) {
      const result = abstract(globalScene, { activityDetail: a, pathDetail: p });
      const statement = detailStatement(result, { locale, labelOf })!;
      const { activities, paths } = expected(globalScene, result, locale);
      expect(statement.activities, `${a} ${p}`).toEqual(activities);
      expect({ short: statement.paths.short, full: statement.paths.full }, `${a} ${p}`).toEqual(paths);
      expect(statement.paths.parts.join(" · ")).toBe(paths.short);
      expect(statement.paths.keptPart).toBe(statement.kept.length ? WORDS[locale].kept(count(statement.kept.length, locale)) : undefined);
      expect(statement.kept.sort(), `${a} ${p}`).toEqual(result.edges.filter((e) => hasTag(e, ANCHOR_TAG)).map((e) => e.id).sort());
      expect(statement.marks).toBeUndefined();
      expect(statement.protected).toBeUndefined();
      seen.add(paths.short);
    }
    // The pairs cover kept paths, a strongest path not shown that is stronger than a kept one, and every path shown.
    expect([...seen].some((s) => s.includes(locale === "de" ? "stärkster" : "strongest"))).toBe(true);
    expect([...seen].some((s) => s === WORDS[locale].of(count(677, locale), count(677, locale)))).toBe(true);
  });

  it("write the numbers of the lowest and the highest position by hand", () => {
    // At the lowest position one activity, "Create Purchase Order Item" (251,734 of 1,595,923 events: 15.8 %), and
    // its two anchors, the strongest paths from the start and to the end; at the highest everything.
    const lowest = detailStatement(abstract(globalScene, { activityDetail: 0, pathDetail: 0 }))!;
    expect(lowest.activities).toEqual({ short: "1 of 42 · 15.8 % of events", full: "1 of 42 activities shown, carrying 15.8 % of the events; the 41 rarest are not shown." });
    expect(lowest.paths.short).toMatch(/^2 of 677 · 2 kept · strongest not shown: [\d,]+$/);
    expect(lowest.paths.full).toMatch(/^2 of 677 paths: 0 by frequency, 2 kept so that every activity lies on a way from start to end\. Strongest path not shown: [\d,]+\.$/);
    const highest = detailStatement(abstract(globalScene, { activityDetail: 1, pathDetail: 1 }))!;
    expect(highest.activities).toEqual({ short: "42 of 42 · 100.0 % of events", full: "42 of 42 activities shown, carrying 100.0 % of the events." });
    expect(highest.paths).toEqual({ short: "677 of 677", full: "677 of 677 paths: 677 by frequency.", parts: ["677 of 677"] });
  });

  it("print no share of events where the graph does not count them, and count the paths alone for thresholds", () => {
    const bare: FlowGraph = { ...globalScene, nodes: globalScene.nodes.map((v) => ({ ...v, metrics: v.metrics && { cases: v.metrics.cases! } })) };
    // 40 % of 42 is 16.8: the 17 most frequent, down to "Cancel Goods Receipt" (2,470 cases), which ties with none.
    const statement = detailStatement(abstract(bare, { activityDetail: 0.4, pathDetail: 0.1 }))!;
    expect(statement.activities.short).toBe("17 of 42");
    expect(statement.activities.full).toBe("17 of 42 activities shown; the 25 rarest are not shown.");
    const thresholds = detailStatement(abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03 }))!;
    expect(thresholds.paths).toEqual({ short: "38 of 677", full: "38 of 677 paths shown.", parts: ["38 of 677"] });
    expect(detailStatement(globalScene)).toBeUndefined();
  });

  it.each(["en", "de"] as const)("name the marks not shown and the element shown for a protected deviation (%s)", (locale) => {
    const marks = overlaysFor(constraintItems(), { graph: globalScene });
    const exclusion = (m: Overlay) => m.kind === "badge" && m.target === "cancel_invoice_receipt";
    const given = marks.map((m) => (exclusion(m) ? { ...m, protected: true } : m));
    const result = abstract(globalScene, { activityDetail: 0, pathDetail: 0, marks: given });
    const statement = detailStatement(result, { locale, marks: given, labelOf })!;
    // Counted here: the marks whose element (an activity, or both of an arc's) is not shown.
    const shown = new Set(result.nodes.map((v) => v.id));
    const hidden = given.filter((m) => (m.kind === "arc" ? !shown.has(String(m.payload?.source)) || !shown.has(String(m.payload?.target)) : m.target !== "__map" && !shown.has(m.target) && !result.edges.some((e) => e.id === m.target) && !(result.groups ?? []).some((g) => g.id === m.target)));
    const short = locale === "de" ? `${hidden.length} Markierungen nicht gezeigt` : `${hidden.length} marks not shown`;
    expect(statement.marks!.short).toBe(short);
    // What they are, the most frequent first: a hatch is outside a scope, another mark is named by its constraint.
    const what = (m: Overlay) => (m.kind === "hatch" ? (locale === "de" ? "außerhalb des Geltungsbereichs" : "outside scope") : String(m.payload!.label));
    expect(hidden.some((m) => m.kind === "hatch") && hidden.some((m) => m.kind !== "hatch")).toBe(true);
    const groups = new Map<string, number>();
    for (const m of hidden) groups.set(what(m), (groups.get(what(m)) ?? 0) + 1);
    const listed = [...groups].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
    expect(statement.marks!.full).toBe(`${short}: ${listed.map(([label, n]) => `${n} ${label}`).join(", ")}.`);
    expect(statement.marks!.items).toHaveLength(hidden.length);
    expect(statement.protected).toEqual(
      locale === "de"
        ? { short: "1 für eine geschützte Abweichung gezeigt", full: "1 für eine geschützte Abweichung gezeigt: Cancel Invoice Receipt." }
        : { short: "1 shown for a protected deviation", full: "1 shown for a protected deviation: Cancel Invoice Receipt." },
    );
    // "Cancel Invoice Receipt" is shown out of its rank: the 40 activities not shown are not the rarest.
    expect(statement.activities.full).toMatch(locale === "de" ? /^2 von 42 Aktivitäten gezeigt, .*; 40 weitere werden nicht gezeigt\.$/ : /^2 of 42 activities shown, .*; 40 others are not shown\.$/);
    // Without the marks given, the statement counts them.
    expect(detailStatement(result, { locale })!.marks).toEqual({ short, full: `${short}.`, items: [] });
    // At the stories' opening the marks not shown are the hatches of the activities outside the constraints' scope.
    const opening = abstract(globalScene, { activityDetail: 16 / 42, pathDetail: 31 / 677, marks });
    const hatches = marks.filter((m) => m.kind === "hatch" && !opening.nodes.some((v) => v.id === m.target)).length;
    expect(hatches).toBe(opening.meta!.shown!.marksNotShown.length);
    expect(detailStatement(opening, { locale, marks })!.marks!.full).toBe(locale === "de" ? `${hatches} Markierungen nicht gezeigt: ${hatches} außerhalb des Geltungsbereichs.` : `${hatches} marks not shown: ${hatches} outside scope.`);
    // With every mark's element shown there is no line.
    expect(detailStatement(abstract(globalScene, { activityDetail: 1, pathDetail: 1, marks: given }), { locale, marks: given })!.marks).toBeUndefined();
  });
});

describe("the activities not shown", () => {
  it("are the rarest where every activity shown is shown by its rank, also beside one that nothing measured", () => {
    // "a" (10 cases), "b" (5), "c" (2) and "u", which carries no count and is always shown; "c" is marked.
    const graph: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "a", kind: "activity", label: "A", metrics: { cases: 10 } },
        { id: "b", kind: "activity", label: "B", metrics: { cases: 5 } },
        { id: "c", kind: "activity", label: "C", metrics: { cases: 2 } },
        { id: "u", kind: "activity", label: "U" },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: ([["start", "a", 10], ["a", "b", 5], ["a", "c", 2], ["b", "end", 5], ["c", "end", 2], ["a", "end", 3], ["a", "u", 1], ["u", "end", 1]] as const).map(([source, target, n]) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count: n } })),
    };
    // One by rank, "a", and "u": "b" and "c" are the rarest.
    expect(detailStatement(abstract(graph, { activityDetail: 0, pathDetail: 0 }))!.activities.full).toBe("2 of 4 activities shown; the 2 rarest are not shown.");
    // With a protected mark on "c", "c" is shown and "b", which is more frequent, is not.
    const marks: Overlay[] = [{ kind: "badge", target: "c", payload: { glyph: "!" }, protected: true }];
    expect(detailStatement(abstract(graph, { activityDetail: 0, pathDetail: 0, marks }))!.activities.full).toBe("3 of 4 activities shown; 1 other is not shown.");
    expect(detailStatement(abstract(graph, { activityDetail: 0, pathDetail: 0, marks }), { locale: "de" })!.activities.full).toBe("3 von 4 Aktivitäten gezeigt; 1 weitere wird nicht gezeigt.");
    // A host's thresholds with an activity it keeps: the same.
    expect(detailStatement(abstract(graph, { minNodeShare: 0.6, keep: ["c"] }))!.activities.full).toBe("3 of 4 activities shown; 1 other is not shown.");
  });
});

describe("the sliders' positions", () => {
  it("stand where thresholds put them, and the share of that position shows the same activities and paths by frequency", () => {
    const thresholds = abstract(globalScene, { minNodeShare: 0.01, minEdgeShare: 0.03, keepConnected: false });
    const { positions } = thresholds.meta!.shown!;
    // 16 activities have at least 1 % of the most frequent one's cases, 31 paths at least 3 % of the strongest's count.
    const most = Math.max(...globalScene.nodes.filter(isActivity).map((v) => v.metrics!.cases!));
    const strongest = Math.max(...globalScene.edges.filter((e) => e.source !== e.target).map((e) => e.metrics!.count!));
    expect(positions.at).toEqual({
      activities: globalScene.nodes.filter((v) => isActivity(v) && v.metrics!.cases! >= 0.01 * most).length,
      paths: globalScene.edges.filter((e) => e.metrics!.count! >= 0.03 * strongest).length,
    });
    expect(positions.at).toEqual({ activities: 16, paths: 31 });
    // Every activity ends a tie of its own but five "SRM" activities with 1,440 cases and 1,628 events, which end one
    // together, and "SRM: Held" and "SRM: Incomplete" with 6 and 6: 42 - 4 - 1 positions.
    expect(positions.activities).toHaveLength(42 - 4 - 1);
    expect(positions.paths).toBe(677);
    const byShares = abstract(globalScene, { activityDetail: 16 / 42, pathDetail: 31 / 677 });
    expect(byShares.nodes.filter(isActivity).map((v) => v.id).sort()).toEqual(thresholds.nodes.filter(isActivity).map((v) => v.id).sort());
    expect(byShares.meta!.shown!.byFrequency).toBe(31);
    expect(byShares.meta!.shown!.positions.at).toEqual({ activities: 16, paths: 31 });
  });
});

describe("the notes of the tooltips", () => {
  it("add up an activity's passages drawn and not drawn, and say what a kept path keeps", () => {
    const result = abstract(globalScene, { activityDetail: 0.38, pathDetail: 0.05 });
    const notes = detailNotes(globalScene, result, { labelOf });
    const drawn = new Set(result.edges.map((e) => e.id));
    for (const v of result.nodes.filter(isActivity)) {
      const into = globalScene.edges.filter((e) => e.target === v.id && e.kind !== "constraint");
      const out = globalScene.edges.filter((e) => e.source === v.id && e.kind !== "constraint");
      const hidden = (list: FlowEdge[]) => list.filter((e) => !drawn.has(e.id)).reduce((sum, e) => sum + e.metrics!.count!, 0);
      const all = (list: FlowEdge[]) => list.reduce((sum, e) => sum + e.metrics!.count!, 0);
      const shown = (list: FlowEdge[]) => list.filter((e) => drawn.has(e.id)).reduce((sum, e) => sum + e.metrics!.count!, 0);
      expect(shown(into) + hidden(into)).toBe(all(into));
      expect(notes.get(v.id), v.id).toBe(hidden(into) + hidden(out) ? `Passages on paths not shown: ${count(hidden(into), "en")} in, ${count(hidden(out), "en")} out.` : undefined);
    }
    const keeps = result.meta!.shown!.keeps!;
    expect(Object.keys(keeps).length).toBeGreaterThan(0);
    for (const [id, kept] of Object.entries(keeps)) expect(notes.get(id)).toBe(`Keeps ${kept.map(labelOf).join(", ")} on a way from start to end.`);
  });

  it("name the activities an indirect path passes, and an element shown for a protected deviation", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "busy", kind: "activity", label: "Busy", metrics: { cases: 100 } },
        { id: "late", kind: "activity", label: "Late", metrics: { cases: 90 } },
        { id: "rare", kind: "activity", label: "Rare", metrics: { cases: 5 } },
        { id: "rarer", kind: "activity", label: "Rarer", metrics: { cases: 3 } },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: ([["start", "busy", 100], ["busy", "end", 100], ["start", "rarer", 3], ["rarer", "rare", 3], ["rare", "late", 5], ["late", "end", 90]] as const).map(([source, target, n]) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count: n } })),
      overlays: [{ kind: "badge", target: "rare", payload: { glyph: "∅" }, protected: true }],
    };
    const label = (id: string) => graph.nodes.find((v) => v.id === id)!.label;
    // "rare" is shown for its protected badge; "late" stays entered through it, "rare" through "rarer", which is not shown.
    const result = abstract(graph, { activityDetail: 0.5, pathDetail: 0 });
    const notes = detailNotes(graph, result, { labelOf: label, locale: "de" });
    expect(result.edges.filter((e) => hasTag(e, INDIRECT_TAG)).map((e) => e.id)).toEqual(["start->rarer->rare:indirect"]);
    expect(notes.get("start->rarer->rare:indirect")).toBe("Steht für einen Weg über nicht gezeigte Aktivitäten: Rarer.");
    // The 3 passages from "rarer" into "rare" run on a path not shown; the indirect path stands for it.
    expect(notes.get("rare")).toBe("Übergänge auf nicht gezeigten Pfaden: 3 hinein, 0 hinaus. Für eine geschützte Abweichung gezeigt.");
    expect(detailStatement(result, { labelOf: label })!.paths.full).toBe("4 of 6 paths: 0 by frequency, 4 kept so that every activity lies on a way from start to end. 1 dashed path stands for a way through activities not shown. Strongest path not shown: 3.");
  });
});

describe("the notes of the tooltips on a map that hides nothing", () => {
  it("count no passage of a path to a node that is not in the graph", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "a", kind: "activity", label: "A", metrics: { cases: 10 } },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: [
        { id: "start->a", kind: "follows", source: "start", target: "a", metrics: { count: 10 } },
        { id: "a->end", kind: "follows", source: "a", target: "end", metrics: { count: 5 } },
        { id: "a->gone", kind: "follows", source: "a", target: "gone", metrics: { count: 5 } },
      ],
    };
    expect([...detailNotes(graph, abstract(graph))]).toEqual([]);
  });
});
