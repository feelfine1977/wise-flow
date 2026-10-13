/**
 * The paths a map draws at a small zoom, written out for the tests without
 * the library: the width of a path on the whole log's scale, the paths that
 * keep every activity between a start and an end, the rule's set, and whether
 * every activity lies between a start and an end through given paths.
 */
import type { FlowEdge, FlowGraph, FlowScene } from "../../src/index";

/** The scale's upper end on the whole log: its strongest path, 194,821 cases (counted from the fixture). */
export const UPPER = 194_821;

/** A path's width on the whole log's scale: √(cases / 194,821) × 8, in hundredths, never under the thinnest line, 1. */
export const widthOf = (cases: number) => Math.max(1, Math.round(Math.sqrt(cases / UPPER) * 8 * 100) / 100);

/**
 * Every activity's strongest path (by its count) from a start or an activity ranked before it (by cases, then events,
 * then id) that a start reaches, and to an end or such an activity that reaches an end, ties by id. Throws for an
 * activity without such a direct path (on the whole log each activity has one).
 */
export function connecting(graph: FlowGraph): Set<string> {
  const paths = graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target);
  const measured = (id: string, name: string) => graph.nodes.find((n) => n.id === id)?.metrics?.[name] ?? 0;
  const terminal = (tag: string) => new Set(graph.nodes.filter((n) => n.kind === "event" && n.tags?.includes(tag)).map((n) => n.id));
  const [starts, ends] = [terminal("start"), terminal("end")];
  const [fromStart, toEnd] = [reach(paths, [...starts], false), reach(paths, [...ends], true)];
  const rank = graph.nodes
    .filter((n) => n.kind === "activity")
    .sort((a, b) => measured(b.id, "cases") - measured(a.id, "cases") || measured(b.id, "events") - measured(a.id, "events") || (a.id < b.id ? -1 : 1))
    .map((n) => n.id);
  const out = new Set<string>();
  for (const v of rank) {
    for (const back of [true, false]) {
      const anchoring = (id: string) => (back ? starts : ends).has(id) || ((back ? fromStart : toEnd).has(id) && (!rank.includes(id) || rank.indexOf(id) < rank.indexOf(v)));
      const strongest = paths
        .filter((e) => (back ? e.target : e.source) === v && anchoring(back ? e.source : e.target))
        .sort((a, b) => (b.metrics!.count ?? 0) - (a.metrics!.count ?? 0) || (a.id < b.id ? -1 : 1))[0];
      if (!strongest) throw new Error(`${v} has no direct path ${back ? "in" : "out"}`);
      out.add(strongest.id);
    }
  }
  return out;
}

/** The nodes reached from `from` along `edges`, or backwards from them. */
export function reach(edges: readonly FlowEdge[], from: readonly string[], back: boolean): Set<string> {
  const out = new Set(from);
  for (const id of out) for (const e of edges) if ((back ? e.target : e.source) === id) out.add(back ? e.source : e.target);
  return out;
}

/** The ids of the whole log's lines the rule draws at `zoom`: half a pixel wide on the screen, or connecting an activity. */
export function ruleAt(scene: Pick<FlowScene, "edgeMarks" | "graph">, zoom: number): string[] {
  const keep = connecting(scene.graph);
  return scene.edgeMarks.filter((m) => widthOf(m.edge.metrics!.cases!) * zoom >= 0.5 || keep.has(m.id)).map((m) => m.id).sort();
}

/** The activities of `graph` that do not lie between a start and an end through `edges`. */
export function offWay(graph: FlowGraph, edges: readonly FlowEdge[]): string[] {
  const tagged = (tag: string) => graph.nodes.filter((n) => n.tags?.includes(tag)).map((n) => n.id);
  const [fromStart, toEnd] = [reach(edges, tagged("start"), false), reach(edges, tagged("end"), true)];
  return graph.nodes.filter((n) => n.kind === "activity" && !(fromStart.has(n.id) && toEnd.has(n.id))).map((n) => n.id);
}
