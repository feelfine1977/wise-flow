import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type ActivityLabelOptions, type FlowGraph, type Overlay, type Positions, abstract, layout, overlaysFor } from "../../src/index";
import { type DrawContext, type DrawOptions, type PrepareOptions, type PngOptions, drawLegend, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import type { Scene } from "../../src/index";

/** A 2D context that logs every call and assignment with its arguments. */
function loggingContext() {
  const log: string[] = [];
  const own: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 6 }),
    createPattern: () => null,
    createLinearGradient: (...a: unknown[]) => {
      log.push(`grad(${JSON.stringify(a)})`);
      return { addColorStop: (...b: unknown[]) => log.push(`stop(${JSON.stringify(b)})`) };
    },
  };
  const ctx = new Proxy(own, {
    get: (target, key: string) => (key in target ? target[key] : (...a: unknown[]) => log.push(`${key}(${JSON.stringify(a)})`)),
    set: (target, key: string, value) => {
      log.push(`${key}=${JSON.stringify(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as DrawContext;
  return { ctx, digest: () => createHash("sha256").update(log.join("\n")).digest("hex") };
}

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const vendor = abstract(vendorScene, { minEdgeShare: 0.02 });
const ids: ActivityLabelOptions = { mode: "ids", references: {} };
let positions: { global: Positions; vendor: Positions };
beforeAll(async () => {
  positions = { global: await layout(global, { engine: "dagre" }), vendor: await layout(vendor, { engine: "dagre" }) };
});

type Fixture = () => { graph: FlowGraph; positions: Positions; overlays: Overlay[] };
const fixtures: Record<string, Fixture> = {
  global: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }) }),
  vendor: () => ({ graph: vendor, positions: positions.vendor, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }) }),
  // Without `graph` the presets also target activities the abstraction removed.
  unfiltered: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems()) }),
};

function drawn(fixture: Fixture, options: PrepareOptions, edgeBudget?: DrawOptions["edgeBudget"]): string {
  const { graph, positions: p, overlays } = fixture();
  const scene = prepareScene(graph, p, { overlays, ...options });
  const { ctx, digest } = loggingContext();
  for (const zoom of [1, 0.3, 0.1]) drawScene(ctx, scene, { x: 10, y: 10, zoom, width: 4000, height: 3000 }, undefined, { cull: false, edgeBudget });
  drawLegend(ctx, scene, 0, 0, 200);
  return digest();
}

/** Flow rectangles that cut through every group of the fixture, so culling leaves out nodes, edges and marks but no group. */
type Strip = { x: number; y: number; width: number; height: number };

/** Calls of culled draws of the strip at two zooms, plain and with a selection, hover and focus of paths. */
function culled(fixture: Fixture, options: PrepareOptions, strip: Strip, edgeBudget?: DrawOptions["edgeBudget"]): { digest: string; drawn: number; total: number } {
  const { graph, positions: p, overlays } = fixture();
  const scene = prepareScene(graph, p, { overlays, ...options });
  const { ctx, digest } = loggingContext();
  const [first, second] = scene.edges;
  const state = {
    selection: { nodes: [scene.nodes[1].node.id], edges: [first.edge.id], groups: [scene.groups[0].group.id] },
    hovered: second.edge.id,
    focused: scene.nodes[2].node.id,
    bright: { nodes: new Set([scene.nodes[1].node.id, first.edge.source, first.edge.target]), edges: new Set([first.edge.id]) },
  };
  let drawn = 0;
  for (const zoom of [1, 0.3]) {
    const view = { x: -strip.x * zoom, y: -strip.y * zoom, zoom, width: strip.width * zoom, height: strip.height * zoom };
    for (const s of [undefined, state]) {
      const stats = drawScene(ctx, scene, view, s, { cull: true, edgeBudget });
      drawn = Math.max(drawn, stats.nodes + stats.edges + stats.shapes);
    }
  }
  return { digest: digest(), drawn, total: scene.nodes.length + scene.edges.length + scene.marks.length };
}

function exported(fixture: Fixture, scene: Partial<Scene>, options: PngOptions): string {
  const { ctx, digest } = loggingContext();
  toPNGCanvas({ ...fixture(), ...scene }, { scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => ctx }), ...options });
  return digest();
}

/**
 * SHA-256 of the recorded Canvas calls. Recorded from the implementation that
 * assembled its own scales, overlays and geometry in `prepareScene`, and
 * recorded again when the Canvas drawing began to draw the scene's overlay marks.
 * Compared as filled, stroked and written operations with their colour, alpha,
 * width, dash and transform, that step changed only: overlay arrowheads (12 px,
 * the tip 1.2 px beyond the path's end), the group tint filled once, hatching
 * drawn per hatch overlay after the nodes, and in `toPNG` the figure size, map
 * offset and activity key position, because map-level chips no longer count
 * towards the bounds. Recorded once more when chips began to show what the live
 * map shows; only the chips' calls changed: the glyph written apart, the gauge
 * (track, fill and tick) and the label in bold before the text.
 * Recorded once more when the Canvas drawing began to draw the scene's node
 * and edge marks; compared the same way, only the text of activity labels
 * changed: they are cut to the node's width less its padding and no longer
 * leave room for the case count, which sits below them.
 * Recorded once more when the Canvas legend began to draw the scene's legend;
 * compared the same way, only the glyph of reverse-order arcs changed, to "⌒┄"
 * as on the map (it was "⌒ ┄").
 * Recorded once more when the drawing began to read the token table; compared
 * the same way, only the edge arrowheads changed: the live map's arrow, 3 long
 * and 4.8 wide with the tip on the route's end, filled and outlined by 0.6 in
 * the edge's colour, where it was a triangle of 8 plus the edge width (at most
 * 16). Overlay arrowheads and the line pattern tiles drew the same calls.
 * Recorded once more when arcs began to be drawn between the edges and the
 * nodes: every recording holds the same calls as before, and only the calls of
 * the arcs (stroke, arrowhead and label) moved from after the nodes to after
 * the edges. Recorded once more when arcs began to keep clear of the other
 * activities: the scenes differ only in arc marks (in the global fixture four
 * arcs take another course and four more move their label along the arc; in
 * the vendor fixture two and one; in the unfiltered one, one label), so only
 * the arcs' calls changed. Recorded once more when the start event took the
 * interactive map's outline: only its stroke's width changed, 2 where it was
 * 1.5. Recorded once more when the drawing began to write the texts the
 * scene's measure fitted instead of measuring them with the context: node
 * labels and legend rows are cut by the estimate, no longer by this context's
 * 6 px per character, and chip texts by the estimate instead of 6.2 px per
 * character, and activity and stage labels leave the room the interactive map
 * gives them (inside the outline, before the count on their line). Recorded
 * again with a context that measures by the estimate, every recording here and
 * every culled one holds the same calls as before but written texts: that chip's
 * text keeps three more characters ("Manual touches in the order stag…", where
 * it was "… s…"), and thirteen labels are cut shorter, as in the SVG export.
 * Recorded once more when paths began to be drawn in neutrals by their count
 * and deviations in the one accent. The drawing routines changed only in
 * drawing an arc label's pill; the scenes they draw differ, compared field by
 * field, only in the colours and pattern twins of activities and groups (the
 * six-colour stage palette), the colours of paths (the grey of their count;
 * constraint edges the accent), the dashes of notes, constraint edges and
 * groups (none), the overlay marks and the legend's rows; so only those calls
 * changed, with the pattern tiles of the twins now drawn.
 */
const before = {
  mapGlobalStages: "39987ea44bdcba0534122850e90344d0b10d8f8a01e15d61b0054abb09b2a404",
  mapVendorIds: "f0fdc0759a44ff795910be11a7cde616f7fc044e7ce691d2d3d0d673698a3361",
  mapUnfiltered: "bc65d2022688d6f6581523ccb035f497e1a2ef42ab2df982a35b5c435c0b5eb2",
  pngGlobalTitle: "191f75284f4023aabc1307b4df41c7868f3384d1963c2e4b9e0b662174f33dd4",
  pngVendorIds: "7e471d385a0bcf5aba7c4d6fba5cb938ae19c2cefa361ae9b9662e556538bcbd",
  pngUnfilteredGerman: "e817d3e10754b79694acc0e2a22953ca15ed85523a08307f02dfd98ee58f6587",
};

/**
 * SHA-256 of the recorded calls of culled draws, recorded while the drawing
 * still walked every element and tested it against the R-tree's result, and
 * recorded again for the two strips with arcs when arcs began to be drawn
 * between the edges and the nodes; their calls moved as in the uncull draws.
 * Recorded once more, for the three strips with arcs, when arcs began to keep
 * clear of the other activities; only the arcs' calls changed. Recorded once
 * more, for the strips with the start event, when it took the interactive
 * map's outline: only its stroke's width changed, 2 where it was 1.5.
 * Recorded once more, for the three strips with the labels this changes, when
 * the drawing began to write the texts the scene's measure fitted (as above).
 * Recorded once more, for all four, when paths began to be drawn in neutrals
 * and deviations in the one accent (as above). Two arcs of the global
 * fixture reached into its strip with their label's box; now no arc does, so
 * the strips of the global and the unfiltered fixture, which differ only in
 * their arcs, draw the same calls.
 */
const culledBefore = {
  culledGlobal: "d7018d1ae0f47fb1de25bb9123039a53d844272ecf3b09081358c1fe8e07144a",
  culledGlobalStages: "a7a20a53bea7dd4f9ae9811548cd9b5993e2f355737edeca3275e56b81a8de96",
  culledVendorIds: "7432a62bf97e1e1c6ae86c164a967535b76fa4df59bf9d612604386217c00610",
  culledUnfiltered: "d7018d1ae0f47fb1de25bb9123039a53d844272ecf3b09081358c1fe8e07144a",
};

describe("Canvas drawing on the committed fixtures", () => {
  it("records the pinned calls for the Canvas map and for toPNG", () => {
    expect({
      mapGlobalStages: drawn(fixtures.global, { lanes: "stages" }),
      mapVendorIds: drawn(fixtures.vendor, { activityLabels: ids }),
      mapUnfiltered: drawn(fixtures.unfiltered, {}),
      pngGlobalTitle: exported(fixtures.global, { selfLoops: false, title: "T", lanes: "stages" }, { width: 20000 }),
      pngVendorIds: exported(fixtures.vendor, { activityLabels: ids }, {}),
      pngUnfilteredGerman: exported(fixtures.unfiltered, { selfLoops: false, locale: "de" }, { lodZoom: 1, legend: false }),
    }).toEqual(before);
  });

  it("records the pinned calls for views culled through the R-tree", () => {
    const views = {
      culledGlobal: culled(fixtures.global, {}, { x: 0, y: 150, width: 2900, height: 330 }),
      culledGlobalStages: culled(fixtures.global, { lanes: "stages" }, { x: 0, y: 300, width: 2900, height: 100 }),
      culledVendorIds: culled(fixtures.vendor, { activityLabels: ids }, { x: 0, y: 100, width: 2500, height: 120 }),
      culledUnfiltered: culled(fixtures.unfiltered, {}, { x: 0, y: 150, width: 2900, height: 330 }),
    };
    for (const v of Object.values(views)) expect(v.drawn).toBeLessThan(v.total);
    expect(Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.digest]))).toEqual(culledBefore);
  });

  it("records the same calls with the edge budget at all or above the edges in view", () => {
    for (const edgeBudget of ["all", 10_000] as const) {
      expect(drawn(fixtures.global, { lanes: "stages" }, edgeBudget)).toBe(before.mapGlobalStages);
      expect(drawn(fixtures.vendor, { activityLabels: ids }, edgeBudget)).toBe(before.mapVendorIds);
      expect(drawn(fixtures.unfiltered, {}, edgeBudget)).toBe(before.mapUnfiltered);
      expect(culled(fixtures.global, {}, { x: 0, y: 150, width: 2900, height: 330 }, edgeBudget).digest).toBe(culledBefore.culledGlobal);
      expect(culled(fixtures.unfiltered, {}, { x: 0, y: 150, width: 2900, height: 330 }, edgeBudget).digest).toBe(culledBefore.culledUnfiltered);
    }
    // A budget below the edges in view changes the calls.
    expect(drawn(fixtures.global, { lanes: "stages" }, 5)).not.toBe(before.mapGlobalStages);
  });

  it("records the same calls for toPNG with the edge budget at all", () => {
    expect(exported(fixtures.global, { selfLoops: false, title: "T", lanes: "stages" }, { width: 20000, edgeBudget: "all" })).toBe(before.pngGlobalTitle);
    expect(exported(fixtures.vendor, { activityLabels: ids }, { edgeBudget: "all" })).toBe(before.pngVendorIds);
    expect(exported(fixtures.unfiltered, { selfLoops: false, locale: "de" }, { lodZoom: 1, legend: false, edgeBudget: "all" })).toBe(before.pngUnfilteredGerman);
  });
});
