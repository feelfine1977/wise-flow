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
 * Recorded once more when activities became cards and the sizes, weights,
 * radii and strokes moved onto their scales. The Canvas map draws the scene's
 * marks, whose changes are those of the SVG export (see export-fixtures):
 * the layout of 64 high activities, the cards, hairline groups, event labels
 * below the circle, badges wholly above, the text and stroke scales and the
 * system font. Its own calls change only where hover, selection and focus are
 * drawn: a hovered node keeps its fill and is outlined in the ink, the
 * selection ring is 2 wide, its inner edge on the element, and a selected
 * group and a highlighted path are 2 wide.
 */
const before = {
  mapGlobalStages: "6797b367f88f826df46440763dc744a7c430801b34ce93afdba591383a3dfb2b",
  mapVendorIds: "300783281e8f70460dd9895489e8b43fdd3bcf7a102f2ac35be1b221f5a5ae92",
  mapUnfiltered: "91eadf802c95b2fae1bb6a826671daab26be3a96dcc9ad85469f720bdbad29db",
  pngGlobalTitle: "f4e24d590a65dbb9ba2bde7118c8a5146bd462a23394a687b1acea82f265819f",
  pngVendorIds: "57c433689478afa8044ea6c961f9a77d97e4377579bd472322943c9039a038ca",
  pngUnfilteredGerman: "e18147039a66245d7f6601214e001519989cc7c7b1dc89fdabcf0ac187e204c6",
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
 * Recorded once more when activities became cards (as above); the layout of
 * 64 high activities moved the groups, so the strips of the global, the
 * unfiltered and the vendor fixture were moved to cut every group again and
 * to hold arcs.
 */
const culledBefore = {
  culledGlobal: "eb3a557ecda64e36bbb6bab4fd4e96b8bf731b1d6c5b7358b61f27e02e2a0582",
  culledGlobalStages: "6ad33db337da24634a0a9d89c39cbd9b80acbfdfea092b309b78499e6ca4dc50",
  culledVendorIds: "745d25444473f24eeb2b29bc9b3b41f767e8a2efa6304d5737a5a2b602b62a5e",
  culledUnfiltered: "125bb0fddc9684eff0756fea91a667ed8aa7227f252ebfb40368cbb17890f012",
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
      culledGlobal: culled(fixtures.global, {}, { x: 0, y: 200, width: 2900, height: 420 }),
      culledGlobalStages: culled(fixtures.global, { lanes: "stages" }, { x: 0, y: 300, width: 2900, height: 100 }),
      culledVendorIds: culled(fixtures.vendor, { activityLabels: ids }, { x: 0, y: 120, width: 2500, height: 130 }),
      culledUnfiltered: culled(fixtures.unfiltered, {}, { x: 0, y: 200, width: 2900, height: 420 }),
    };
    for (const v of Object.values(views)) expect(v.drawn).toBeLessThan(v.total);
    expect(Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.digest]))).toEqual(culledBefore);
  });

  it("records the same calls with the edge budget at all or above the edges in view", () => {
    for (const edgeBudget of ["all", 10_000] as const) {
      expect(drawn(fixtures.global, { lanes: "stages" }, edgeBudget)).toBe(before.mapGlobalStages);
      expect(drawn(fixtures.vendor, { activityLabels: ids }, edgeBudget)).toBe(before.mapVendorIds);
      expect(drawn(fixtures.unfiltered, {}, edgeBudget)).toBe(before.mapUnfiltered);
      expect(culled(fixtures.global, {}, { x: 0, y: 200, width: 2900, height: 420 }, edgeBudget).digest).toBe(culledBefore.culledGlobal);
      expect(culled(fixtures.unfiltered, {}, { x: 0, y: 200, width: 2900, height: 420 }, edgeBudget).digest).toBe(culledBefore.culledUnfiltered);
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
