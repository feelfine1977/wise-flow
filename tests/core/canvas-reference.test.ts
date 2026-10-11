import { describe, expect, it } from "vitest";
import { type Box, type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Overlay, type OverlayMark, HitIndex, createPositions } from "../../src/index";
import { type DrawOptions, type DrawState, type PreparedScene, type PrepareOptions, type SceneEdge, type SceneGroup, type SceneNode, type View, CanvasRenderer, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { type FamilyName, families } from "../support/graphs";
import { type InkContext, type ListName, type Visit, drawn, inkContext, keyOf, watch } from "../support/ink";
import { caseCount, caseLabel, createRandom, seeds, type Random } from "../support/random";
import { type PositionKind, SIDES, VIEWPORT_KINDS, oddPositionsOf, positionsOf, viewportAtSide, viewportOf } from "../support/scenes";

// ---------------------------------------------------------------------------
// The extent a culled draw reads an element for, derived by hand from the
// drawing routines and the token table. It is generous: it counts every
// stroke, ring, arrowhead and text an element can draw, whether or not the
// level of detail or the interaction state draws it at the moment, with a
// glyph allowed 0.7 em. What an element actually inks (recorded through the
// context) must lie inside it; the renderer must read exactly the elements
// whose extent, rounded outwards to whole units as the index holds it, meets
// the view.

interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EM = 0.7;

const extentOf = (b: Box, by = 0): Extent => ({ minX: b.x - by, minY: b.y - by, maxX: b.x + b.width + by, maxY: b.y + b.height + by });
const join = (a: Extent, b: Extent): Extent => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) });
const touch = (a: Extent, b: Extent): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** A text's extent: its anchor, baseline and halo as the drawing writes it; a limited text is cut to its width, but keeps a character and the ellipsis (three glyphs). */
function textExtent(t: { text: string; lead?: string; x: number; y: number; size: number; anchor: "start" | "middle" | "end"; baseline: "middle" | "alphabetic"; halo: boolean; maxWidth?: number }): Extent {
  const w = Math.min(Array.from((t.lead ?? "") + t.text).length * EM * t.size, Math.max(t.maxWidth ?? Infinity, 3 * EM * t.size));
  const x0 = t.anchor === "start" ? t.x : t.anchor === "middle" ? t.x - w / 2 : t.x - w;
  const [up, down] = t.baseline === "middle" ? [0.6 * t.size, 0.6 * t.size] : [t.size, 0.35 * t.size];
  const pad = t.halo ? 1.5 : 0;
  return { minX: x0 - pad, minY: t.y - up - pad, maxX: x0 + w + pad, maxY: t.y + down + pad };
}

/**
 * The outline is at most 3 wide; the selection ring reaches 6 outside the box and the focus rectangle 5; the texts
 * sit inside but count too. A gateway's diamond spans half the box's width up and down, so a box wider than tall is counted that tall.
 */
function nodeExtent(n: SceneNode): Extent {
  const b = n.box;
  const shape = n.mark.shape === "diamond" && b.width > b.height ? { x: b.x, y: b.y + b.height / 2 - b.width / 2, width: b.width, height: b.width } : b;
  return n.mark.texts.reduce((e, t) => join(e, textExtent(t)), extentOf(shape, 6));
}

/** A band's coloured line is 3 wide along one edge, a group's dashed outline 1.5 (2.5 selected); the title sits 12 from the left on a baseline 22 below the top, 14 px. */
const groupExtent = (g: SceneGroup): Extent => join(extentOf(g.box, 1.5), textExtent({ text: g.group.label, x: g.box.x + 12, y: g.box.y + 22, size: 14, anchor: "start", baseline: "alphabetic", halo: false }));

/** Half the stroke; an arrowhead 12 long and 12 wide with its tip 1.2 beyond the path's end has its base 10.8 behind it, farther than its half width of 6. */
const markExtent = (m: OverlayMark): Extent => m.texts.reduce((e, t) => join(e, textExtent(t)), extentOf(m.box, Math.max(m.stroke ? m.stroke.width / 2 : 0, m.arrow ? 10.8 : 0)));

/** The segment on which the route's half-length point lies, the first of two at a corner. */
function midSegment(points: readonly { x: number; y: number }[]): number {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let remaining = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) return i;
    remaining -= lengths[i];
  }
  return 0;
}

/**
 * Every segment grown by half the stroke, at least by the hit tolerance of 4,
 * which also covers the arrowhead (3 long and 2.4 wide, outlined by 0.6); the
 * segment at the route's middle also by the count label written 4 above it.
 */
function edgeExtents(e: SceneEdge): Extent[] {
  const pts = e.mark.points;
  const by = Math.max(4, e.mark.width / 2);
  const out: Extent[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    out.push({ minX: Math.min(a.x, b.x) - by, minY: Math.min(a.y, b.y) - by, maxX: Math.max(a.x, b.x) + by, maxY: Math.max(a.y, b.y) + by });
  }
  if (e.mark.texts.length && out.length) {
    const k = midSegment(pts);
    out[k] = join(out[k], textExtent(e.mark.texts[0]));
  }
  return out;
}

/** The index holds whole units: an extent is rounded outwards. */
const whole = (e: Extent): Extent => ({ minX: Math.floor(e.minX), minY: Math.floor(e.minY), maxX: Math.ceil(e.maxX), maxY: Math.ceil(e.maxY) });

function extentsOf(scene: PreparedScene, v: Pick<Visit, "list" | "index">): Extent[] {
  switch (v.list) {
    case "nodes":
      return [whole(nodeExtent(scene.nodes[v.index]))];
    case "groups":
      return [whole(groupExtent(scene.groups[v.index]))];
    case "marks":
      return [whole(markExtent(scene.marks[v.index]))];
    case "edges":
      return edgeExtents(scene.edges[v.index]).map(whole);
  }
}

/** The flow rectangle a view shows: screen = flow × zoom + offset, inverted. */
const visibleExtent = (view: View): Extent => {
  const x = -view.x / view.zoom;
  const y = -view.y / view.zoom;
  return { minX: x, minY: y, maxX: x + view.width / view.zoom, maxY: y + view.height / view.zoom };
};

// ---------------------------------------------------------------------------
// The edge budget, by hand: protected edges, then the heaviest by the width metric, then the id.

function keptEdges(scene: PreparedScene, inView: readonly number[], budget: number, state: DrawState): Set<number> | undefined {
  const name = scene.style.edgeWidth?.metric ?? "count";
  const weight = (e: FlowEdge) => {
    const v = e.metrics?.[name];
    return typeof v === "number" && Number.isFinite(v) ? v : -Infinity;
  };
  const marked = (e: FlowEdge) => scene.marks.some((m) => m.edgeId === e.id || (m.overlay.kind === "arc" && m.overlay.payload?.source === e.source && m.overlay.payload?.target === e.target));
  const kept = new Set<number>();
  const rest: number[] = [];
  for (const i of inView) {
    const e = scene.edges[i].edge;
    if (marked(e) || state.selection.edges.includes(e.id) || state.focused === e.id || state.highlighted?.has(e.id)) kept.add(i);
    else rest.push(i);
  }
  rest.sort((a, b) => weight(scene.edges[b].edge) - weight(scene.edges[a].edge) || (scene.edges[a].edge.id < scene.edges[b].edge.id ? -1 : 1));
  for (const i of rest.slice(0, Math.max(0, Math.floor(budget) - kept.size))) kept.add(i);
  return kept.size < inView.length ? kept : undefined;
}

// ---------------------------------------------------------------------------
// Recording a draw.

interface Recording {
  visits: Visit[];
  stats: ReturnType<typeof drawScene>;
}

function record(scene: PreparedScene, view: View, state: DrawState, options: DrawOptions): Recording {
  const ink = inkContext();
  const stats = drawScene(ink.ctx, watch(scene, ink.begin), view, state, options);
  return { visits: ink.visits, stats };
}

/** `list:index#n` for the n-th visit of an element with ink, so that an edge's line and its label are told apart. */
function labels(visits: readonly Visit[]): string[] {
  const seen = new Map<string, number>();
  return visits.map((v) => {
    const k = keyOf(v);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}#${n}`;
  });
}

/** Whether a box of canvas pixels reaches into the canvas, allowing for rounding at the boundary. */
function inkShows(ink: Box, view: View): boolean {
  const eps = 1e-6 * Math.max(1, Math.abs(ink.x), Math.abs(ink.y), Math.abs(ink.x + ink.width), Math.abs(ink.y + ink.height));
  return ink.x + ink.width - eps >= 0 && ink.x + eps <= view.width && ink.y + ink.height - eps >= 0 && ink.y + eps <= view.height;
}

/**
 * What a culled draw should draw, from what an uncull draw of the same view and state
 * inked: the visits of elements whose extent meets the view, in the uncull order,
 * less the edges a budget withholds among those.
 */
function expected(scene: PreparedScene, view: View, state: DrawState, oracle: readonly Visit[], budget?: number): { visits: Visit[]; shown?: number; total?: number } {
  const visible = visibleExtent(view);
  let visits = drawn(oracle).filter((v) => extentsOf(scene, v).some((e) => touch(e, visible)));
  if (budget === undefined) return { visits };
  const inView = [...new Set(visits.filter((v) => v.list === "edges").map((v) => v.index))].sort((a, b) => a - b);
  const kept = keptEdges(scene, inView, budget, state);
  if (kept) visits = visits.filter((v) => v.list !== "edges" || kept.has(v.index));
  return { visits, ...(kept ? { shown: kept.size, total: inView.length } : {}) };
}

/**
 * `list:index` of every element whose extent meets the view, found by walking
 * the scene's lists: every group and node, every mark on the map at or above
 * its zoom, and every edge the budget keeps among those in view.
 */
function bruteForce(scene: PreparedScene, view: View, state: DrawState, budget?: number): string[] {
  const visible = visibleExtent(view);
  const meets = (list: ListName, index: number) => extentsOf(scene, { list, index }).some((e) => touch(e, visible));
  const found: string[] = [];
  scene.groups.forEach((_, i) => meets("groups", i) && found.push(`groups:${i}`));
  scene.marks.forEach((m, i) => m.inMap && view.zoom >= m.minZoom && meets("marks", i) && found.push(`marks:${i}`));
  scene.nodes.forEach((_, i) => meets("nodes", i) && found.push(`nodes:${i}`));
  const inView = scene.edges.flatMap((_, i) => (meets("edges", i) ? [i] : []));
  const kept = budget === undefined ? undefined : keptEdges(scene, inView, budget, state);
  for (const i of inView) if (!kept || kept.has(i)) found.push(`edges:${i}`);
  return found.sort();
}

// ---------------------------------------------------------------------------
// Random scenes, states and views.

const FAMILIES: readonly (readonly [FamilyName, number])[] = [["layered", 3], ["cyclic", 3], ["stages", 3], ["lanes", 2], ["nested", 2], ["overlaid", 5], ["hub", 1], ["components", 1], ["chain", 1], ["tree", 1], ["longLabels", 1], ["germanLabels", 1], ["rtlLabels", 1], ["markupLabels", 1]];
const ARRANGEMENTS: readonly (PositionKind | "odd")[] = ["grid", "layered", "overlapping", "extreme", "odd"];

interface Case {
  scene: PreparedScene;
  detail: string;
}

function sceneCase(seed: number, size = 40): Case {
  const rng = createRandom(seed);
  const family = rng.weighted(FAMILIES);
  const n = rng.int(1, size);
  const graph = families[family](n, seed, { mixedKinds: rng.chance(0.3) });
  const arrangement = rng.pick(ARRANGEMENTS);
  const routes = rng.pick([false, true, "bent", "bent"] as const);
  const positions = arrangement === "odd" ? oddPositionsOf(graph, seed, { routes }).positions : positionsOf(graph, arrangement, seed, { routes });
  const options: PrepareOptions = {
    locale: rng.pick(["en", "de"]),
    lanes: rng.pick(["none", "stages", "roles"]),
    lodBySize: rng.chance(0.5),
    selfLoops: rng.chance(0.8),
    activityLabels: rng.chance(0.25) ? { mode: rng.pick(["ids", "names"]), references: {} } : undefined,
  };
  return { scene: prepareScene(graph, positions, options), detail: `${family} ${n} ${arrangement}${routes === "bent" ? " bent" : routes ? " routed" : ""} ${options.lanes}${options.activityLabels ? ` ${options.activityLabels.mode}` : ""}` };
}

function stateCase(scene: PreparedScene, rng: Random): DrawState {
  const ids = <T>(items: readonly T[], id: (it: T) => string, p: number) => items.filter(() => rng.chance(p)).map(id);
  const state: DrawState = { selection: { nodes: ids(scene.nodes, (n) => n.node.id, 0.1), edges: ids(scene.edges, (e) => e.edge.id, 0.1), groups: ids(scene.groups, (g) => g.group.id, 0.2) } };
  if (rng.chance(0.4)) state.hovered = rng.pick([...scene.nodes.map((n) => n.node.id), ...scene.edges.map((e) => e.edge.id), ...scene.marks.map((m) => m.id), null]);
  if (rng.chance(0.4) && scene.nodes.length) state.focused = rng.pick(scene.nodes).node.id;
  if (rng.chance(0.3)) state.bright = { nodes: new Set(ids(scene.nodes, (n) => n.node.id, 0.5)), edges: new Set(ids(scene.edges, (e) => e.edge.id, 0.5)) };
  if (rng.chance(0.3)) state.highlighted = new Set(ids(scene.edges, (e) => e.edge.id, 0.3));
  return state;
}

/** The boxes of the scene's elements a view can be placed against. */
function elementBoxes(scene: PreparedScene): Box[] {
  return [...scene.nodes.map((n) => n.box), ...scene.groups.map((g) => g.box), ...scene.marks.filter((m) => m.inMap).map((m) => m.box)];
}

/** The views of a scene: one of every kind over its bounds, and views whose edges cut an element. */
function viewsOf(scene: PreparedScene, seed: number): { view: View; detail: string }[] {
  const out: { view: View; detail: string }[] = VIEWPORT_KINDS.map((kind, i) => ({ view: viewportOf(kind, scene.bounds, seed + i), detail: kind }));
  const rng = createRandom(seed + 700_001);
  const boxes = elementBoxes(scene);
  if (boxes.length) {
    for (const side of SIDES) {
      const box = rng.pick(boxes);
      // Straddling, just inside, just outside; outside by more than any extent allows.
      for (const offset of [rng.float(0.1, 0.9) * (side === "left" || side === "right" ? box.width : box.height), 0.5, -0.5, -40]) {
        out.push({ view: viewportAtSide(box, side, offset, rng.int(1, 1e9)), detail: `${side} ${offset.toFixed(1)}` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

describe("the culled Canvas draw against a naive reference", () => {
  it("draws exactly the elements whose extent meets the view, in paint order, and skips nothing that shows", () => {
    let pairs = 0;
    for (const seed of seeds(caseCount(30))) {
      const { scene, detail } = sceneCase(seed);
      const rng = createRandom(seed + 800_003);
      for (const { view, detail: viewDetail } of viewsOf(scene, seed)) {
        const state = stateCase(scene, rng);
        const budget = rng.chance(0.25) ? rng.int(0, scene.edges.length) : undefined;
        const label = caseLabel(seed, `${detail}; ${viewDetail}${budget === undefined ? "" : `; budget ${budget}`}`);
        const oracle = record(scene, view, state, { cull: false });
        // The extent is not too tight anywhere: what an element inks, in flow units, lies inside the extent the index holds it for.
        for (const v of drawn(oracle.visits)) {
          const ink = v.ink!;
          const inked = { minX: (ink.x - view.x) / view.zoom, minY: (ink.y - view.y) / view.zoom, maxX: (ink.x + ink.width - view.x) / view.zoom, maxY: (ink.y + ink.height - view.y) / view.zoom };
          const e = extentsOf(scene, v).reduce(join);
          const eps = 1e-9 * Math.max(1, Math.abs(inked.minX), Math.abs(inked.minY), Math.abs(inked.maxX), Math.abs(inked.maxY));
          expect(inked.minX + eps >= e.minX && inked.minY + eps >= e.minY && inked.maxX - eps <= e.maxX && inked.maxY - eps <= e.maxY, `${label}: ${v.list} ${v.id} inks ${JSON.stringify(inked)} beyond its extent ${JSON.stringify(e)}`).toBe(true);
        }
        const culled = record(scene, view, state, { cull: true, edgeBudget: budget });
        const want = expected(scene, view, state, oracle.visits, budget);
        // The elements of the reference are those of a brute-force search over the scene's lists, so that one both draws leave out is missed too.
        expect([...new Set(want.visits.map(keyOf))].sort(), `${label}: the uncull draw inks other elements than the search finds`).toEqual(bruteForce(scene, view, state, budget));
        const got = drawn(culled.visits);
        // Nothing that shows is skipped: every visit that inked the canvas in the uncull draw is drawn by the culled one, except a withheld edge.
        const gotLabels = new Set(labels(got));
        const withheld = new Set(drawn(oracle.visits).filter((v) => v.list === "edges" && !want.visits.includes(v)).map((v) => keyOf(v)));
        for (const [i, v] of drawn(oracle.visits).entries()) {
          if (!inkShows(v.ink!, view) || withheld.has(keyOf(v))) continue;
          expect(gotLabels.has(labels(drawn(oracle.visits))[i]), `${label}: ${v.list} ${v.id} shows at ${JSON.stringify(v.ink)} but is not drawn`).toBe(true);
        }
        // The drawn sequence equals the reference, element for element and call for call.
        expect(got.map((v) => `${v.list}:${v.id}`), label).toEqual(want.visits.map((v) => `${v.list}:${v.id}`));
        for (const [i, v] of got.entries()) expect(v.calls, `${label}: ${v.list} ${v.id}`).toEqual(want.visits[i].calls);
        // And it is in paint order: groups, tints, edges, arcs, nodes, the other marks, then the edges' labels; within a layer by position in the list.
        const ranks = labels(got).map((l, i) => [got[i].list === "groups" ? 0 : got[i].list === "marks" ? { below: 1, between: 3, above: 5 }[scene.marks[got[i].index].layer] : got[i].list === "nodes" ? 4 : l.endsWith("#0") ? 2 : 6, got[i].index]);
        for (let i = 1; i < ranks.length; i++) expect(ranks[i][0] > ranks[i - 1][0] || (ranks[i][0] === ranks[i - 1][0] && ranks[i][1] > ranks[i - 1][1]), `${label}: ${got[i - 1].list} ${got[i - 1].id} is painted before ${got[i].list} ${got[i].id}`).toBe(true);
        expect(culled.stats.culled, label).toBe(true);
        expect(culled.stats.withheld ? { shown: culled.stats.withheld.shown, total: culled.stats.withheld.total } : undefined, label).toEqual(want.shown === undefined ? undefined : { shown: want.shown, total: want.total });
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(500);
  });
});

// ---------------------------------------------------------------------------
// Hit testing against a naive reference.

interface Candidate {
  rank: number;
  area: number;
  id: string;
  kind: string;
}

/**
 * Every element within `tol` of a flow point: a box when the point is within
 * `tol` of it, an edge when the point is within `tol` of one of its segments.
 * The one painted on top first: marks above the nodes (badges, chips, hatching,
 * self-loops), nodes, arcs, edges, tints, groups; among them the smaller box
 * first (a segment's box with the tolerance of 4 added); then the id.
 */
function referenceHits(scene: PreparedScene, x: number, y: number, tol: number, withheld: Set<number> | undefined): Candidate[] {
  const near = (b: Box) => b.x - tol <= x && x <= b.x + b.width + tol && b.y - tol <= y && y <= b.y + b.height + tol;
  const out: Candidate[] = [];
  for (const [i, m] of scene.marks.entries()) {
    if (m.inMap && near(scene.shapes[i])) out.push({ rank: m.kind === "tint" ? 4 : m.kind === "arc" ? 2 : 0, area: m.box.width * m.box.height, id: m.overlay.target, kind: "overlay" });
  }
  for (const n of scene.nodes) if (near(n.box)) out.push({ rank: 1, area: n.box.width * n.box.height, id: n.node.id, kind: "node" });
  for (const [i, e] of scene.edges.entries()) {
    if (withheld && !withheld.has(i)) continue;
    const pts = e.mark.points;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k], pts[k + 1]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
      if (Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) <= tol) out.push({ rank: 3, area: (Math.abs(dx) + 8) * (Math.abs(dy) + 8), id: e.edge.id, kind: "edge" });
    }
  }
  for (const g of scene.groups) if (near(g.box)) out.push({ rank: 5, area: g.box.width * g.box.height, id: g.group.id, kind: "group" });
  return out.sort((a, b) => a.rank - b.rank || a.area - b.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

describe("hit testing against a naive reference", () => {
  it("returns the best element of the reference under the point, within the tolerance", () => {
    let points = 0;
    for (const seed of seeds(caseCount(50))) {
      const { scene, detail } = sceneCase(seed);
      const rng = createRandom(seed + 900_007);
      const view = viewportOf(rng.pick(["ordinary", "tiny", "extremeZoom"]), scene.bounds, seed);
      const state = stateCase(scene, rng);
      const budget = rng.chance(0.3) ? rng.int(0, scene.edges.length) : undefined;
      const ink = inkContext();
      const canvas = { width: 0, height: 0, style: {}, getContext: () => ink.ctx } as unknown as HTMLCanvasElement;
      // The zoom limits are opened so that the extreme views are tested as given; the reference reads the viewport the renderer holds.
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, minZoom: 1e-9, maxZoom: 1e9, draw: { cull: true, edgeBudget: budget } });
      renderer.setScene(scene);
      renderer.resize(view.width, view.height);
      renderer.setViewport(view);
      renderer.setState(state);
      renderer.draw();
      const held = renderer.getViewport();
      expect(held, caseLabel(seed, detail)).toEqual({ x: view.x, y: view.y, zoom: view.zoom });
      const withheld = renderer.lastDraw?.withheld?.drawn;
      const boxes = elementBoxes(scene);
      for (let k = 0; k < 40; k++) {
        // Half the points anywhere on the canvas and just beyond it, half near an element's border.
        let sx: number;
        let sy: number;
        if (k % 2 === 0 || !boxes.length) {
          sx = rng.float(-20, view.width + 20);
          sy = rng.float(-20, view.height + 20);
        } else {
          const b = rng.pick(boxes);
          const fx = rng.chance() ? rng.pick([b.x, b.x + b.width]) : rng.float(b.x, b.x + b.width);
          const fy = rng.chance() ? rng.pick([b.y, b.y + b.height]) : rng.float(b.y, b.y + b.height);
          sx = fx * view.zoom + view.x + rng.float(-6, 6);
          sy = fy * view.zoom + view.y + rng.float(-6, 6);
        }
        const tolPx = rng.pick([0, 4, 12]);
        const hit = renderer.hitAt(sx, sy, tolPx);
        const want = referenceHits(scene, (sx - held.x) / held.zoom, (sy - held.y) / held.zoom, tolPx / held.zoom, withheld);
        const label = caseLabel(seed, `${detail}; point ${k} at ${sx.toFixed(2)}, ${sy.toFixed(2)} tolerance ${tolPx}`);
        if (!want.length) expect(hit, label).toBeUndefined();
        else {
          expect(hit, label).toBeDefined();
          // Any candidate tied with the first on kind, size and id is as good.
          const first = want[0];
          const got = { kind: hit!.kind, id: hit!.id };
          expect(want.filter((c) => c.rank === first.rank && c.area === first.area && c.id === first.id).map((c) => ({ kind: c.kind, id: c.id })), label).toContainEqual(got);
        }
        points++;
      }
    }
    expect(points).toBeGreaterThanOrEqual(2000);
  });
});

// ---------------------------------------------------------------------------
// The area query of the index itself, as a host builds it from positions and
// overlay geometry alone, against a brute-force search over every item.

describe("the area query of the hit index against a brute-force search", () => {
  it("finds exactly the items whose bounds, rounded outwards to whole units, meet the box", () => {
    let queries = 0;
    for (const seed of seeds(caseCount(20))) {
      const { scene, detail } = sceneCase(seed);
      const rng = createRandom(seed + 500_009);
      const { positions, geometry } = scene;
      const index = HitIndex.fromScene(positions, geometry);
      // Every item with its key and the bounds the index holds: a box, a segment grown by the tolerance of 4, a shape.
      const items: { key: string; e: Extent }[] = [];
      for (const [id, b] of Object.entries(positions.groups)) items.push({ key: `group:${id}`, e: whole(extentOf(b)) });
      for (const [id, b] of Object.entries(positions.nodes)) items.push({ key: `node:${id}`, e: whole(extentOf(b)) });
      for (const [id, r] of Object.entries(positions.edges)) {
        for (let i = 0; i + 1 < r.points.length; i++) {
          const [a, b] = [r.points[i], r.points[i + 1]];
          items.push({ key: `edge:${id}:${a.x},${a.y}-${b.x},${b.y}`, e: whole({ minX: Math.min(a.x, b.x) - 4, minY: Math.min(a.y, b.y) - 4, maxX: Math.max(a.x, b.x) + 4, maxY: Math.max(a.y, b.y) + 4 }) });
        }
      }
      for (const s of geometry.shapes) items.push({ key: `overlay:${s.id}`, e: whole(extentOf(s)) });
      const keyOfItem = (it: { kind: string; id: string; shapeId?: string; segment?: [{ x: number; y: number }, { x: number; y: number }] }) =>
        it.kind === "edge" ? `edge:${it.id}:${it.segment![0].x},${it.segment![0].y}-${it.segment![1].x},${it.segment![1].y}` : `${it.kind}:${it.shapeId ?? it.id}`;
      const boxes: Box[] = [...Object.values(positions.nodes), ...Object.values(positions.groups), ...geometry.shapes];
      const bounds = scene.bounds;
      for (let k = 0; k < 20; k++) {
        let q: Box;
        if (k % 2 === 0 || !boxes.length) {
          // Anywhere over the bounds and a margin, up to a third of them on a side; every fifth has no width or no height.
          const x = rng.float(bounds.x - 50, bounds.x + bounds.width + 50);
          const y = rng.float(bounds.y - 50, bounds.y + bounds.height + 50);
          q = { x, y, width: k % 10 === 0 ? 0 : rng.float(0, (bounds.width + 100) / 3), height: k % 10 === 5 ? 0 : rng.float(0, (bounds.height + 100) / 3) };
        } else {
          // Its left or top edge exactly at, half a unit from or one unit from an element's right or bottom edge.
          const b = rng.pick(boxes);
          const d = rng.pick([0, 0.5, 1, -0.5, -1]);
          q = rng.chance() ? { x: b.x + b.width + d, y: b.y - 10, width: 300, height: b.height + 20 } : { x: b.x - 10, y: b.y + b.height + d, width: b.width + 20, height: 300 };
        }
        const label = caseLabel(seed, `${detail}; box ${k} ${JSON.stringify(q)}`);
        const got = index.within(q).map(keyOfItem).sort();
        const want = items.filter((it) => touch(it.e, extentOf(q))).map((it) => it.key).sort();
        expect(got, label).toEqual(want);
        queries++;
      }
    }
    expect(queries).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// The work of a draw across sizes.

/**
 * A grid of 50 columns of activities, 160 × 60 at 240 × 120 apart, each joined
 * to its left and upper neighbour, filled row by row until nodes and edges
 * number exactly `size`; every row a stage group, every third row tinted,
 * every seventh activity with a badge and every eleventh hatched.
 */
function grid(size: number): PreparedScene {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = [];
  const overlays: Overlay[] = [];
  const boxes: Record<string, Box> = {};
  const groupBoxes: Record<string, Box> = {};
  const edge = (source: number, target: number) => edges.push({ id: `e${source}-${target}`, kind: "follows", source: `n${source}`, target: `n${target}`, metrics: { count: 10 + (target % 89) } });
  for (let i = 0; nodes.length + edges.length < size; i++) {
    const [row, col] = [Math.floor(i / 50), i % 50];
    const id = `n${i}`;
    if (col === 0) {
      groups.push({ id: `r${row}`, kind: "stage", label: `Row ${row}` });
      if (row % 3 === 0) overlays.push({ kind: "tint", target: `r${row}`, payload: { constraintId: "balance", value: 0.5 } });
    }
    nodes.push({ id, kind: "activity", label: `Activity ${i}`, group: `r${row}`, metrics: { cases: 1000 + (i % 97) } });
    boxes[id] = { x: col * 240, y: row * 120, width: 160, height: 60 };
    groupBoxes[`r${row}`] = { x: -20, y: row * 120 - 20, width: col * 240 + 200, height: 100 };
    if (i % 7 === 0) overlays.push({ kind: "badge", target: id, payload: { constraintId: "presence", glyph: "≥1", value: 0.25 } });
    if (i % 11 === 0) overlays.push({ kind: "hatch", target: id, payload: { constraintId: "scope" } });
    if (col > 0 && nodes.length + edges.length < size) edge(i - 1, i);
    if (row > 0 && nodes.length + edges.length < size) edge(i - 50, i);
  }
  const graph: FlowGraph = { nodes, edges, groups };
  return prepareScene(graph, createPositions({ nodes: boxes, groups: groupBoxes, edges: {} }, "given", "RIGHT"), { overlays, lodBySize: false, selfLoops: false });
}

/** The scene with every element read from a list or a lookup counted. */
function counting(scene: PreparedScene): { scene: PreparedScene; reads: { count: number } } {
  const reads = { count: 0 };
  const list = <T extends object>(items: T[]): T[] =>
    new Proxy(items, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.count++;
        return Reflect.get(target, key, receiver);
      },
    });
  const lookup = <K, V>(map: Map<K, V>): Map<K, V> =>
    new Proxy(map, {
      get(target, key) {
        if (key === "get" || key === "has") return (k: K) => (reads.count++, target[key](k));
        if (key === "size") return target.size;
        const v = Reflect.get(target, key);
        return typeof v === "function" ? (...a: unknown[]) => (reads.count += target.size, (v as (...x: unknown[]) => unknown).apply(target, a)) : v;
      },
    });
  return {
    reads,
    scene: { ...scene, nodes: list(scene.nodes), edges: list(scene.edges), groups: list(scene.groups), marks: list(scene.marks), shapes: list(scene.shapes), nodeMarks: list(scene.nodeMarks), edgeMarks: list(scene.edgeMarks), nodeById: lookup(scene.nodeById), edgeById: lookup(scene.edgeById), groupById: lookup(scene.groupById), shapeById: lookup(scene.shapeById) },
  };
}

describe("the work of a culled draw", () => {
  it("reads a number of elements bounded by the candidates, the same for 2,000, 20,000 and 200,000 elements", () => {
    // Columns 4 to 7 and rows 4 to 6 of the grid, away from its edges; the row 7 group begins 20 above its nodes, at 820.
    const view = { x: -1000, y: -500, zoom: 1, width: 900, height: 330 };
    const box = { x: 1000, y: 500, width: 900, height: 330 };
    const state: DrawState = { selection: { nodes: ["n204"], edges: ["e204-205"], groups: ["r4"] }, hovered: "e205-255", focused: "n255" };
    const results = [2_000, 20_000, 200_000].map((size) => {
      const scene = grid(size);
      expect(scene.size).toBe(size);
      const candidates = scene.hit.within(box).length;
      const { scene: watched, reads } = counting(scene);
      const ink = inkContext();
      const stats = drawScene(ink.ctx, watch(watched, ink.begin), view, state, { cull: true });
      const groups = drawn(ink.visits).filter((v) => v.list === "groups").map((v) => v.id);
      return { candidates, reads: reads.count, stats, groups };
    });
    // Nodes: columns 4–7 × rows 4–6; edges: between boxes, four horizontal per row and three vertical per column.
    for (const r of results) {
      expect(r.stats).toMatchObject({ culled: true, nodes: 12, edges: 24 });
      expect(r.groups).toEqual(["r4", "r5", "r6", "r7"]);
      expect(r.reads).toBeLessThanOrEqual(2 * r.candidates);
    }
    expect(results.map((r) => r.candidates)).toEqual([results[0].candidates, results[0].candidates, results[0].candidates]);
    expect(results.map((r) => r.reads)).toEqual([results[0].reads, results[0].reads, results[0].reads]);
    expect(results.map((r) => r.stats)).toEqual([results[0].stats, results[0].stats, results[0].stats]);
  });
});

// ---------------------------------------------------------------------------
// The PNG export draws the same sequence.

describe("the PNG export against the reference", () => {
  it("draws the map with the calls of an uncull draw: every element that inks, once, in paint order, and under a budget the kept edges", () => {
    let cases = 0;
    for (const seed of seeds(caseCount(10))) {
      const rng = createRandom(seed);
      const family = rng.weighted(FAMILIES);
      const n = rng.int(1, 25);
      const graph = families[family](n, seed, { mixedKinds: rng.chance(0.3) });
      const arrangement = rng.pick(ARRANGEMENTS);
      const routes = rng.pick([false, true, "bent"] as const);
      const positions = arrangement === "odd" ? oddPositionsOf(graph, seed, { routes }).positions : positionsOf(graph, arrangement, seed, { routes });
      const input = { graph, positions, overlays: graph.overlays, locale: rng.pick(["en", "de"] as const), lanes: rng.pick(["none", "stages", "roles"] as const), selfLoops: rng.chance(0.8), activityLabels: rng.chance(0.25) ? { mode: rng.pick(["ids", "names"] as const), references: {} } : undefined };
      const budget = rng.chance(0.4) ? rng.int(0, graph.edges.length) : undefined;
      const options = { legend: rng.chance(), scale: 1, lodZoom: rng.pick([1, 0.5, 0.1]), padding: rng.pick([undefined, 0, 24, 60]), edgeBudget: budget };
      const label = caseLabel(seed, `${family} ${n} ${arrangement}${routes === "bent" ? " bent" : routes ? " routed" : ""}${budget === undefined ? "" : `; budget ${budget}`}; ${JSON.stringify(options)}`);
      // The export prepares its own scene from the input; a direct uncull draw of the same preparation gives the
      // calls of every element, which do not depend on the view: the export's calls must hold them all, in order, as one block.
      const png = inkContext();
      const out = toPNGCanvas(input, { ...options, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
      const prepared = prepareScene(graph, positions, { overlays: input.overlays, locale: input.locale, lanes: input.lanes, selfLoops: input.selfLoops, activityLabels: input.activityLabels, lodBySize: false });
      const view = { x: 0, y: 0, zoom: 1, width: 1, height: 1 };
      const direct = record(prepared, view, { selection: { nodes: [], edges: [], groups: [] } }, { cull: false, lodZoom: options.lodZoom, edgeBudget: budget });
      const block = direct.visits.flatMap((v) => v.calls).join("\n");
      expect(png.outside.join("\n").includes(block), `${label}: the export does not draw the elements as the direct draw does`).toBe(true);
      // Every element with ink once, in paint order: groups, marks below, edges, marks between, nodes, marks above, edge labels.
      const order = (v: Visit) => (v.list === "groups" ? 0 : v.list === "marks" ? { below: 1, between: 3, above: 5 }[prepared.marks[v.index].layer] : v.list === "edges" ? 2 : 4);
      const inked = drawn(direct.visits);
      const lines = inked.filter((v) => v.list !== "edges" || inked.indexOf(v) === inked.findIndex((w) => w.list === "edges" && w.index === v.index));
      for (let i = 1; i < lines.length; i++) expect(order(lines[i]) > order(lines[i - 1]) || (order(lines[i]) === order(lines[i - 1]) && lines[i].index > lines[i - 1].index), `${label}: ${lines[i - 1].list} ${lines[i - 1].id} before ${lines[i].list} ${lines[i].id}`).toBe(true);
      const once = new Map<string, number>();
      for (const v of lines) once.set(keyOf(v), (once.get(keyOf(v)) ?? 0) + 1);
      expect([...once.values()].every((c) => c === 1), label).toBe(true);
      // Under a budget the edges drawn are the kept ones by the hand ranking; only marks protect edges in a figure.
      const want = expected(prepared, { x: 1e12, y: 1e12, zoom: 1, width: 2e12, height: 2e12 }, { selection: { nodes: [], edges: [], groups: [] } }, record(prepared, view, { selection: { nodes: [], edges: [], groups: [] } }, { cull: false, lodZoom: options.lodZoom }).visits, budget);
      expect(inked.filter((v) => v.list === "edges").map((v) => v.id), label).toEqual(want.visits.filter((v) => v.list === "edges").map((v) => v.id));
      expect(out.cssWidth, label).toBeGreaterThan(0);
      cases++;
    }
    expect(cases).toBeGreaterThanOrEqual(10);
  });
});
