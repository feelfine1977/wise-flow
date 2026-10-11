/**
 * A searching test of the descriptions the map gives assistive technology,
 * read through the one index of the shown graph: every element of every
 * generated graph, plain, abstracted and with collapsed stages, with and
 * without activity labels, has a description in English and in German that is
 * not empty, names its label and the labels of what it refers to, and has no
 * placeholder, no "undefined" and no raw id where a label exists.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type AbstractOptions, type ActivityLabelOptions, type ElementRef, type FlowGraph, type Locale, abstract, activityReferences } from "../../src/index";
import { useElementDescriptions } from "../../src/react/map-elements";
import { type FamilyName, families } from "../support/graphs";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";

/** A searching test checks thousands of texts: the message is written only for a check that fails. */
function must(ok: boolean, message: () => string): void {
  if (!ok) expect.fail(message());
}

// The words for kinds, by hand.
const NODE_KIND: Record<Locale, Record<string, string>> = {
  en: { activity: "activity", gateway: "gateway", event: "event", note: "note", stage: "stage" },
  de: { activity: "Aktivität", gateway: "Gateway", event: "Ereignis", note: "Notiz", stage: "Phase" },
};
const EDGE_KIND: Record<Locale, Record<string, string>> = { en: { follows: "path", constraint: "constraint", flow: "sequence flow" }, de: { follows: "Pfad", constraint: "Erwartung", flow: "Sequenzfluss" } };
const GROUP_KIND: Record<Locale, Record<string, string>> = { en: { stage: "stage", lane: "lane", pool: "pool" }, de: { stage: "Phase", lane: "Bahn", pool: "Pool" } };
/** English words that a German description must not contain outside its labels. */
const ENGLISH = ["cases", "events", "transitions", "members", "activity", "path", "stage", "lane", "unavailable", "violation", "share"];
/** The English units the activity labels write in every locale (see the finding below). */
const ACTIVITY_LABEL_UNITS = ["cases", "events", "unavailable"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (w: string, flags = "") => new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(w)}($|[^\\p{L}\\p{N}_])`, `u${flags}`);

const FAMILY_NAMES = Object.keys(families) as FamilyName[];

/** What the map may show of a generated graph: the graph, its stages collapsed, or the graph above random thresholds. */
function shownOf(graph: FlowGraph, seed: number): { name: string; shown: FlowGraph }[] {
  const rng = createRandom(seed + 9_000_003);
  const out = [{ name: "plain", shown: graph }];
  if ((graph.groups ?? []).some((g) => g.kind === "stage")) out.push({ name: "collapsed", shown: abstract(graph, { collapse: "all" }) });
  const thresholds: AbstractOptions = { minNodeShare: rng.pick([0.05, 0.2, 0.5]), minEdgeShare: rng.pick([0.05, 0.2, 0.5]), keepConnected: rng.chance(0.7) };
  out.push({ name: `thresholds ${JSON.stringify(thresholds)}`, shown: abstract(graph, thresholds) });
  return out;
}

describe("descriptions of every element of random graphs", () => {
  it("name their labels in English and German, with no placeholder, no undefined and no raw id where a label exists", () => {
    let described = 0;
    for (const seed of seeds(caseCount(15))) {
      for (const family of FAMILY_NAMES) {
        const rng = createRandom(seed);
        const graph = families[family](rng.int(1, 40), seed, { mixedKinds: rng.chance(0.5) });
        for (const { name, shown } of shownOf(graph, seed)) {
          const labels = rng.chance(0.3) ? ({ mode: rng.pick(["names", "ids"] as const), references: activityReferences(shown), caseLabel: rng.pick([undefined, "items"]) } satisfies ActivityLabelOptions) : undefined;
          const nodeLabel = new Map(shown.nodes.map((n) => [n.id, n.label]));
          const groupLabel = new Map((shown.groups ?? []).map((g) => [g.id, g.label]));
          for (const locale of ["en", "de"] as const) {
            const { result } = renderHook(() => useElementDescriptions(shown, shown.overlays ?? [], locale, labels));
            const describe = result.current.describeElement;
            const elements: { ref: ElementRef; labels: string[]; ids: string[]; kind: string }[] = [
              ...shown.nodes.map((n) => {
                const group = n.group !== undefined ? groupLabel.get(n.group) : undefined;
                return { ref: { kind: "node" as const, id: n.id }, labels: [n.label, ...(group !== undefined ? [group] : [])], ids: [n.id, ...(group !== undefined ? [n.group!] : [])], kind: NODE_KIND[locale][n.kind] };
              }),
              ...shown.edges.map((e) => ({ ref: { kind: "edge" as const, id: e.id }, labels: [nodeLabel.get(e.source)!, nodeLabel.get(e.target)!], ids: [e.id, e.source, e.target], kind: EDGE_KIND[locale][e.kind] })),
              ...(shown.groups ?? []).map((g) => ({ ref: { kind: "group" as const, id: g.id }, labels: [g.label], ids: [g.id], kind: GROUP_KIND[locale][g.kind] })),
            ];
            for (const { ref, labels: own, ids, kind } of elements) {
              const text = describe(ref);
              described++;
              const label = () => caseLabel(seed, `${family} ${graph.nodes.length} nodes, ${name}, ${locale}${labels ? `, activity labels ${labels.mode}` : ""}, ${ref.kind} ${ref.id}: ${JSON.stringify(text)}`);
              must(text.trim().length > 0, () => `${label()}: empty`);
              for (const l of own) must(text.includes(l), () => `${label()}: does not name ${JSON.stringify(l)}`);
              // Outside its labels: the kind in the locale, no placeholder, no missing value, no raw id.
              const rest = own.reduce((s, l) => s.replace(l, () => " "), text);
              must(word(kind).test(rest), () => `${label()}: does not say ${JSON.stringify(kind)}`);
              must(!/\{\w+\}/.test(rest), () => `${label()}: has a placeholder`);
              for (const bad of ["undefined", "null", "NaN", "Infinity", "[object"]) must(!rest.includes(bad), () => `${label()}: has ${bad}`);
              for (const id of ids) must(!word(id).test(rest), () => `${label()}: has the raw id ${id}`);
              if (locale === "de") {
                for (const english of ENGLISH) {
                  if (labels && ref.kind === "node" && ACTIVITY_LABEL_UNITS.includes(english)) continue;
                  must(!word(english, "i").test(rest), () => `${label()}: has the English word ${english}`);
                }
              }
            }
          }
        }
      }
    }
    expect(described).toBeGreaterThan(10_000);
  });
});

describe("finding", () => {
  it("with activity labels a German description keeps the English units of its counts", () => {
    // The activity labels' counts read "cases" (or the host's `caseLabel`), "events" and "unavailable" in every
    // locale, on the node as in its description. Which words a German map should show is the owner's decision.
    const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "Rechnung prüfen", metrics: { cases: 1200 } }], edges: [] };
    const { result } = renderHook(() => useElementDescriptions(graph, [], "de", { mode: "names", references: { a: "A01" } }));
    expect(result.current.describeElement({ kind: "node", id: "a" })).toBe("A01 — Rechnung prüfen, Aktivität. 1.200 cases · events unavailable.");
  });
});
