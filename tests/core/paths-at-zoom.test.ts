import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowEdge, type FlowGraph, type FlowNode, type FlowScene, type Overlay, abstract, buildScene, createPositions, fitViewport, layout, pathsAtZoom, viewTokens } from "../../src/index";
import { CanvasRenderer, drawScene, prepareScene } from "../../src/canvas/index";
import { inkContext, watch } from "../support/ink";
import { offWay, ruleAt } from "./zoom-cases";

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

  it("keeps connecting and protected paths under a budget, even when the zoom rule withholds nothing", () => {
    const prepared = prepareScene(scene.graph, scene.positions, { selfLoops: false });
    const ink = inkContext();
    const frame = (zoom: number, protection = {}, minPx = 0.5) => drawScene(ink.ctx, prepared, { x: 0, y: 0, zoom, width: 1400, height: 900 }, { selection: { nodes: [], edges: [], groups: [] }, ...protection }, { edgeBudget: 0, pathRule: { minPx } }).withheld;
    // Five paths connect a, b and c between the terminals; the constraint also stays. Only b → c may go.
    for (const zoom of [0.1, 0.3, 1]) {
      expect(frame(zoom, {}, 0)).toMatchObject({ shown: 5, total: 6 });
      expect(frame(zoom)).toMatchObject({ shown: 5, total: 6, pathsNotShown: 1 });
      expect([...frame(zoom)!.drawn].map((i) => prepared.edgeMarks[i].id).sort()).toEqual(all.filter((id) => id !== "b->c"));
      expect(frame(zoom, { selection: { nodes: [], edges: ["b->c"], groups: [] } })).toBeUndefined();
      expect(frame(zoom, { focused: "b->c" })).toBeUndefined();
      expect(frame(zoom, { highlighted: new Set(["b->c"]) })).toBeUndefined();
    }
  });
});

describe("the paths drawn of the whole log at a small zoom", () => {
  /** Every activity and every path of the whole log, as the map shows them at the detail shares 1 and 1, laid out by ELK. */
  const whole = (async () => {
    const shown = abstract(globalScene, { activityDetail: 1, pathDetail: 1 });
    const positions = await layout(shown);
    return { scene: buildScene(shown, positions, {}), prepared: prepareScene(shown, positions) };
  })();
  /** The view of 1400 × 900 fitted with the React map's 4 % around the map: its zoom. */
  const fitted = (scene: FlowScene) => fitViewport(scene.positions.bounds, { width: 1400, height: 900 }, { padding: 0.04 }).zoom;

  it("lets through the paths the rule gives at the fitted zoom, and every path at zoom 1", async () => {
    const { scene } = await whole;
    const zoom = fitted(scene);
    expect(zoom).toBeLessThan(0.1);
    // The hand rule: wide enough on the screen, or connecting an activity; no path of the log carries a mark.
    const expected = ruleAt(scene, zoom);
    const got = pathsAtZoom(scene, zoom, 0.5)!;
    expect(got.through.map((i) => scene.edgeMarks[i].id).sort()).toEqual(expected);
    expect(got.withheld).toBe(scene.edgeMarks.length - expected.length);
    // 656 paths between two activities (the 21 self-loops are drawn as loops, never withheld); 84 let through.
    expect([scene.edgeMarks.length, expected.length]).toEqual([656, 84]);
    expect(pathsAtZoom(scene, 1, 0.5)).toBeUndefined();
  }, 60_000);

  it("lets through more paths as the zoom grows, and keeps every activity between the start and the end", async () => {
    const { scene } = await whole;
    const ids = (zoom: number) => new Set((pathsAtZoom(scene, zoom, 0.5)?.through ?? scene.edgeMarks.map((_, i) => i)).map((i) => scene.edgeMarks[i].id));
    let before = new Set<string>();
    for (let zoom = 0.02; zoom <= 1.0001; zoom *= 1.2) {
      const now = ids(zoom);
      expect([...before].filter((id) => !now.has(id)), `zoom ${zoom}`).toEqual([]);
      before = now;
      expect(offWay(scene.graph, scene.graph.edges.filter((e) => now.has(e.id))), `zoom ${zoom}`).toEqual([]);
    }
    expect(before.size).toBe(656);
  }, 60_000);

  it("draws on the Canvas map the paths let through that are in view, counts them over the whole map, and changes them only at rest", async () => {
    const { prepared } = await whole;
    const ink = inkContext();
    const canvas = { getContext: () => ink.ctx, width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement;
    // Culled as a large map is, so that only what is in view is drawn.
    const r = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { cull: true, edgeBudget: "all", pathRule: { minPx: 0.5 } } });
    r.resize(1400, 900);
    r.setScene(watch(prepared, ink.begin));
    const loops = scene21(prepared);
    /** One frame: the paths it drew (lines with ink), the paths it lets through over the whole map, and its note's numbers. */
    const frame = () => {
      ink.visits.length = 0;
      r.draw();
      const drawn = [...new Set(ink.visits.filter((v) => v.list === "edges" && v.ink).map((v) => v.id))].sort();
      const drawnLoops = [...new Set(ink.visits.filter((v) => v.list === "marks" && v.ink).map((v) => prepared.marks.find((m) => m.id === v.id)).filter((m) => m?.kind === "selfLoop").map((m) => m!.edgeId!))].sort();
      const w = r.lastDraw!.withheld;
      const through = w ? [...w.drawn].map((i) => prepared.edgeMarks[i].id).sort() : prepared.edgeMarks.map((m) => m.id).sort();
      return { drawn, drawnLoops, through, note: w && { shown: w.shown, total: w.total } };
    };
    /** The paths whose drawn extent (the hit index's) reaches into the view. */
    const inView = () => {
      const v = r.getViewport();
      const box = { x: -v.x / v.zoom, y: -v.y / v.zoom, width: 1400 / v.zoom, height: 900 / v.zoom };
      return new Set(prepared.hit.within(box).filter((it) => it.kind === "edge").map((it) => it.id));
    };
    const check = (label: string) => {
      const f = frame();
      expect(f.drawn, label).toEqual(f.through.filter((id) => inView().has(id)));
      const v = r.getViewport();
      const found = new Set(prepared.hit.within({ x: -v.x / v.zoom, y: -v.y / v.zoom, width: 1400 / v.zoom, height: 900 / v.zoom }).filter((it) => it.kind === "overlay").map((it) => it.shapeId));
      const expectedLoops = prepared.marks.filter((m) => m.kind === "selfLoop" && m.edgeId && found.has(m.id)).map((m) => m.edgeId!).sort();
      expect(f.drawnLoops, label).toEqual(expectedLoops);
      // At rest the rule is decided at the view's zoom.
      expect(f.through, label).toEqual(ruleAt(prepared, r.getViewport().zoom));
      expect(offWay(prepared.graph, prepared.graph.edges.filter((e) => f.through.includes(e.id))), label).toEqual([]);
      return f;
    };
    // Fitted, the whole map is in view: 84 lines and the 21 loops of 656 and 21.
    r.setViewport(fitViewport(prepared.positions.bounds, { width: 1400, height: 900 }, { padding: 0.04 }));
    const first = check("fitted");
    expect(first.note).toEqual({ shown: 84 + loops, total: 656 + loops });
    expect(first.drawn).toHaveLength(84);
    // A shown export uses the same drawing routine, with a report instead of a live path rule: all 21 named loops stay.
    ink.visits.length = 0;
    drawScene(ink.ctx, watch(prepared, ink.begin), { ...r.getViewport(), width: 1400, height: 900 }, undefined, {
      cull: false,
      edgeBudget: { edges: [...first.through, ...prepared.graph.edges.filter((e) => e.source === e.target).map((e) => e.id)], total: 677 },
    });
    const exportedLoops = new Set(ink.visits.filter((v) => v.list === "marks" && v.ink && prepared.marks.find((m) => m.id === v.id)?.kind === "selfLoop").map((v) => v.id));
    expect(exportedLoops.size).toBe(21);
    // Zoomed in step by step around a point and out again, each step at rest: the number never falls going in, never
    // rises going out; the lines drawn are those let through in view.
    const centre = { x: 700, y: 450 };
    let shown = first.note!.shown;
    for (const step of [...Array(12).fill(1.25), ...Array(12).fill(0.8)]) {
      r.zoomBy(step, centre);
      const f = check(`zoom ${r.getViewport().zoom}`);
      const now = f.note?.shown ?? 656 + loops;
      if (step > 1) expect(now, `in to ${r.getViewport().zoom}`).toBeGreaterThanOrEqual(shown);
      else expect(now, `out to ${r.getViewport().zoom}`).toBeLessThanOrEqual(shown);
      shown = now;
    }
    // At 0.2 part of the map is in view: a pan changes the lines drawn, not the numbers.
    r.setViewport({ x: 0, y: 0, zoom: 0.2 });
    const here = check("0.2");
    expect(here.drawn.length).toBeLessThan(here.through.length);
    r.panBy(-900, -300);
    const there = check("0.2, panned");
    expect(there.note).toEqual(here.note);
    expect(there.drawn).not.toEqual(here.drawn);
    // During a gesture the paths stay those of the view at rest; they change once it ends.
    r.beginGesture();
    r.zoomBy(3, centre);
    expect(frame().note).toEqual(here.note);
    r.endGesture();
    expect(frame().note).not.toEqual(here.note);
    // At zoom 1 every path is drawn and nothing is noted.
    r.setViewport({ x: 0, y: 0, zoom: 1 });
    expect(frame().note).toBeUndefined();
  }, 60_000);

  it("keeps the budget's whole-map selection through pans, with connected activities and monotone zoom counts", async () => {
    const { prepared } = await whole;
    const ink = inkContext();
    const canvas = { getContext: () => ink.ctx, width: 0, height: 0, style: {} } as unknown as HTMLCanvasElement;
    const r = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { cull: true, edgeBudget: 100, pathRule: { minPx: 0.5 } } });
    r.resize(1400, 900);
    r.setScene(watch(prepared, ink.begin));
    const check = (x: number, zoom: number) => {
      r.setViewport({ x, y: 0, zoom });
      ink.visits.length = 0;
      r.draw();
      const w = r.lastDraw!.withheld!;
      const ids = [...w.drawn].map((i) => prepared.edgeMarks[i].id).sort();
      const v = r.getViewport();
      const box = { x: -v.x / v.zoom, y: -v.y / v.zoom, width: 1400 / v.zoom, height: 900 / v.zoom };
      const visible = new Set(prepared.hit.within(box).filter((it) => it.kind === "edge").map((it) => it.id));
      const inked = [...new Set(ink.visits.filter((v) => v.list === "edges" && v.ink).map((v) => v.id))].sort();
      expect(inked).toEqual(ids.filter((id) => visible.has(id)));
      expect(offWay(prepared.graph, prepared.graph.edges.filter((e) => ids.includes(e.id)))).toEqual([]);
      expect(w.total).toBe(677);
      return { ids, shown: w.shown };
    };
    let before = 0;
    for (const zoom of [0.02, 0.05, 0.1, 0.2, 0.5, 1]) {
      const here = check(0, zoom);
      expect(here.shown).toBeGreaterThanOrEqual(before);
      expect(check(-900, zoom)).toEqual(here);
      before = here.shown;
    }
    // 100 let-through lines plus all 21 loops, independent of the view.
    expect(before).toBe(121);
    r.dispose();
  }, 60_000);

  it("keeps adaptive counts through pans and never moves the budget against the zoom direction", async () => {
    const { prepared: base } = await whole;
    // Four disjoint copies of the committed log: 2,624 lines and 84 loops. The first budget lets 2,000 lines through.
    const copies = [0, 1, 2, 3];
    const graph: FlowGraph = {
      nodes: copies.flatMap((k) => base.graph.nodes.map((n) => ({ ...n, id: `${k}:${n.id}`, group: undefined }))),
      edges: copies.flatMap((k) => base.graph.edges.map((e) => ({ ...e, id: `${k}:${e.id}`, source: `${k}:${e.source}`, target: `${k}:${e.target}` }))),
    };
    const nodes = Object.fromEntries(copies.flatMap((k) => Object.entries(base.positions.nodes).map(([id, b]) => [`${k}:${id}`, { ...b, y: b.y + k * 5000 }])));
    const prepared = prepareScene(graph, createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT"));
    const ink = inkContext();
    let now = 0, ms = 25;
    const r = new CanvasRenderer({ getContext: () => ink.ctx, style: {} } as unknown as HTMLCanvasElement, { clock: () => (now += ms), draw: { cull: false, edgeBudget: "adaptive", pathRule: { minPx: 0.5 } } });
    r.resize(1400, 900);
    r.setScene(prepared);
    r.setViewport({ x: 0, y: 0, zoom: 0.75 });
    r.draw();
    const count = () => r.lastDraw!.withheld!.shown;
    expect(count()).toBe(2084);
    const gesture = (zoom: number, duration: number) => {
      ms = duration;
      const before = count();
      r.beginGesture();
      r.setViewport({ ...r.getViewport(), zoom });
      for (let k = 0; k < 6; k++) {
        r.panBy(10, 0);
        r.draw();
        expect(count()).toBe(before);
      }
      r.endGesture();
      r.draw();
      const ids = new Set([...r.lastDraw!.withheld!.drawn].map((i) => prepared.edgeMarks[i].id));
      expect(offWay(graph, graph.edges.filter((e) => ids.has(e.id)))).toEqual([]);
      return count();
    };
    // Pure pans of slow and fast frames cannot change N. Slow zooming in cannot shrink the budget.
    expect(gesture(0.75, 25)).toBe(2084);
    expect(gesture(0.75, 2)).toBe(2084);
    expect(gesture(0.9, 25)).toBe(2084);
    // Zooming out can shrink it; fast zooming out cannot grow it. Fast zooming in can grow it again.
    expect(gesture(0.6, 25)).toBe(1084);
    expect(gesture(0.55, 2)).toBe(1084);
    expect(gesture(0.8, 2)).toBe(2084);
    r.dispose();
  }, 60_000);
});

/** The paths that loop on one activity of a scene: drawn as loops, never withheld. */
const scene21 = (scene: FlowScene) => scene.graph.edges.filter((e) => e.source === e.target).length;
