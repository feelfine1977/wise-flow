import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowEdge, type FlowGraph, type FlowNode, type FlowScene, type Overlay, abstract, buildScene, createPositions, fitViewport, layout, pathsAtZoom, viewTokens } from "../../src/index";

const follows = (id: string, source: string, target: string, cases?: number): FlowEdge => ({ id, kind: "follows", source, target, metrics: cases === undefined ? {} : { cases } });

/**
 * start → a → b → end, a → c → b and a weaker b → c. On the width scale (√(cases / 100) × 8, never under 1): 8, 7.59,
 * 8, 2.53, 2.53, 1.79. A constraint from a to the end. Activity c's strongest way in is a → c, out c → b, so b → c is
 * the one path no activity needs.
 */
function small(overlays: Overlay[] = []): FlowScene {
  const node = (id: string, kind: FlowNode["kind"], cases?: number, tags?: string[]): FlowNode => ({ id, kind, label: id, tags, metrics: cases === undefined ? undefined : { cases } });
  const graph: FlowGraph = {
    nodes: [node("start", "event", undefined, ["start"]), node("a", "activity", 100), node("b", "activity", 100), node("c", "activity", 15), node("end", "event", undefined, ["end"])],
    edges: [
      follows("start->a", "start", "a", 100),
      follows("a->b", "a", "b", 90),
      follows("b->end", "b", "end", 100),
      follows("a->c", "a", "c", 10),
      follows("c->b", "c", "b", 10),
      follows("b->c", "b", "c", 5),
      { id: "a=>end", kind: "constraint", source: "a", target: "end" },
    ],
    overlays,
  };
  const boxes = Object.fromEntries(graph.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 120, height: 48 }]));
  return buildScene(graph, createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false });
}

const through = (scene: FlowScene, zoom: number, minPx: number = viewTokens.pathPx, protection = {}) => {
  const r = pathsAtZoom(scene, zoom, minPx, protection);
  return r && { ids: r.through.map((i) => scene.edgeMarks[i].id).sort(), withheld: r.withheld };
};

describe("the paths a map draws at a zoom", () => {
  const scene = small();
  const all = scene.edgeMarks.map((m) => m.id).sort();

  it("draws a path while its line is at least half a pixel wide on the screen, and keeps the paths that connect every activity", () => {
    expect(viewTokens.pathPx).toBe(0.5);
    expect(scene.edgeMarks.find((m) => m.id === "b->c")!.width).toBe(1.79);
    // At 0.1 only lines of 5 and more are wide enough; a → c and c → b connect c, the constraint is no path: b → c goes.
    expect(through(scene, 0.1)).toEqual({ ids: all.filter((id) => id !== "b->c"), withheld: 1 });
    // 1.79 × 0.28 = 0.5012: drawn; 1.79 × 0.27 = 0.4833: not.
    expect(through(scene, 0.27)?.withheld).toBe(1);
    expect(through(scene, 0.28)).toBeUndefined();
    expect(through(scene, 1)).toBeUndefined();
    // A rule of 0 draws every path at every zoom.
    expect(through(scene, 0.01, 0)).toBeUndefined();
  });

  it("always draws a path that is marked, selected, focused or on a highlighted path", () => {
    expect(through(small([{ kind: "arc", target: "b->c", payload: { source: "b", target: "c", value: 0.2 } }]), 0.1)).toBeUndefined();
    expect(through(scene, 0.1, 0.5, { selection: { edges: ["b->c"] } })).toBeUndefined();
    expect(through(scene, 0.1, 0.5, { focused: "b->c" })).toBeUndefined();
    expect(through(scene, 0.1, 0.5, { highlighted: new Set(["b->c"]) })).toBeUndefined();
  });
});

describe("the paths drawn of the whole log at a small zoom", () => {
  /** Every activity and every path of the whole log, as the map shows them at the detail shares 1 and 1, laid out by ELK. */
  const whole = (async () => {
    const shown = abstract(globalScene, { activityDetail: 1, pathDetail: 1 });
    return buildScene(shown, await layout(shown), {});
  })();
  /** The scale's upper end: the strongest path of the log, 194,821 cases (counted from the fixture). */
  const UPPER = 194_821;
  const widthOf = (cases: number) => Math.max(1, Math.round(Math.sqrt(cases / UPPER) * 8 * 100) / 100);

  /**
   * Every activity's strongest path (by its count) from a start or an activity ranked before it (by cases, then events,
   * then id) that a start reaches, and to an end or such an activity that reaches an end, ties by id: on the whole log
   * each activity has such a direct path.
   */
  function connecting(graph: FlowGraph): Set<string> {
    const paths = graph.edges.filter((e) => e.kind === "follows" && e.source !== e.target);
    const measured = (id: string, name: string) => graph.nodes.find((n) => n.id === id)?.metrics?.[name] ?? 0;
    const terminal = (tag: string) => new Set(graph.nodes.filter((n) => n.kind === "event" && n.tags?.includes(tag)).map((n) => n.id));
    const reached = (from: Set<string>, back: boolean) => {
      const out = new Set(from);
      for (const id of out) for (const e of paths) if ((back ? e.target : e.source) === id) out.add(back ? e.source : e.target);
      return out;
    };
    const [starts, ends] = [terminal("start"), terminal("end")];
    const [fromStart, toEnd] = [reached(starts, false), reached(ends, true)];
    const rank = graph.nodes.filter((n) => n.kind === "activity").sort((a, b) => measured(b.id, "cases") - measured(a.id, "cases") || measured(b.id, "events") - measured(a.id, "events") || (a.id < b.id ? -1 : 1)).map((n) => n.id);
    const out = new Set<string>();
    for (const v of rank) {
      for (const back of [true, false]) {
        const anchoring = (id: string) => (back ? starts : ends).has(id) || ((back ? fromStart : toEnd).has(id) && (!rank.includes(id) || rank.indexOf(id) < rank.indexOf(v)));
        const strongest = paths
          .filter((e) => (back ? e.target : e.source) === v && anchoring(back ? e.source : e.target))
          .sort((a, b) => (b.metrics!.count ?? 0) - (a.metrics!.count ?? 0) || (a.id < b.id ? -1 : 1))[0];
        expect(strongest, `${v} ${back ? "in" : "out"}`).toBeDefined();
        out.add(strongest!.id);
      }
    }
    return out;
  }

  it("lets through the paths the rule gives at the fitted zoom, and every path at zoom 1", async () => {
    const scene = await whole;
    // The view of 1400 × 900 fitted with the React map's 4 % around the map.
    const zoom = fitViewport(scene.positions.bounds, { width: 1400, height: 900 }, { padding: 0.04 }).zoom;
    expect(zoom).toBeLessThan(0.1);
    const keep = connecting(scene.graph);
    // The hand rule: wide enough on the screen, or connecting an activity; no path of the log carries a mark.
    const expected = scene.edgeMarks.filter((m) => widthOf(m.edge.metrics!.cases!) * zoom >= 0.5 || keep.has(m.id)).map((m) => m.id).sort();
    const got = pathsAtZoom(scene, zoom, 0.5)!;
    expect(got.through.map((i) => scene.edgeMarks[i].id).sort()).toEqual(expected);
    expect(got.withheld).toBe(scene.edgeMarks.length - expected.length);
    // 656 paths between two activities (the 21 self-loops are drawn as loops, never withheld); 84 let through.
    expect([scene.edgeMarks.length, expected.length]).toEqual([656, 84]);
    expect(pathsAtZoom(scene, 1, 0.5)).toBeUndefined();
  }, 60_000);

  it("lets through more paths as the zoom grows, and keeps every activity between the start and the end", async () => {
    const scene = await whole;
    const ids = (zoom: number) => new Set((pathsAtZoom(scene, zoom, 0.5)?.through ?? scene.edgeMarks.map((_, i) => i)).map((i) => scene.edgeMarks[i].id));
    const nodes = scene.graph.nodes;
    const reach = (edges: FlowEdge[], from: string[], back: boolean) => {
      const out = new Set(from);
      for (const id of out) for (const e of edges) if ((back ? e.target : e.source) === id) out.add(back ? e.source : e.target);
      return out;
    };
    const tagged = (tag: string) => nodes.filter((n) => n.tags?.includes(tag)).map((n) => n.id);
    let before = new Set<string>();
    for (let zoom = 0.02; zoom <= 1.0001; zoom *= 1.2) {
      const now = ids(zoom);
      expect([...before].filter((id) => !now.has(id)), `zoom ${zoom}`).toEqual([]);
      before = now;
      const drawn = scene.graph.edges.filter((e) => now.has(e.id));
      const [fromStart, toEnd] = [reach(drawn, tagged("start"), false), reach(drawn, tagged("end"), true)];
      expect(nodes.filter((n) => n.kind === "activity" && !(fromStart.has(n.id) && toEnd.has(n.id))).map((n) => n.id), `zoom ${zoom}`).toEqual([]);
    }
    expect(before.size).toBe(656);
  }, 60_000);
});
