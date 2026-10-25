import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type ActivityLabelOptions, type FlowGraph, type Overlay, type Positions, type Readable, abstract, layout, overlaysFor, readableAt } from "../../src/index";
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

/** Every text at its size, every label drawn: the drawing as it was before texts were kept readable (a floor of 0). */
const ALL: Readable = readableAt({ levels: { full: { size: 0, floor: 0 }, name: { size: 0, floor: 0 }, line: { size: 0, floor: 0 } }, labels: { path: 0, loop: 0, event: 0, glyph: 0, note: 0 }, pills: 0 }, 1, 0);

function drawn(fixture: Fixture, options: PrepareOptions, edgeBudget?: DrawOptions["edgeBudget"], readable?: Readable): string {
  const { graph, positions: p, overlays } = fixture();
  const scene = prepareScene(graph, p, { overlays, ...options });
  const { ctx, digest } = loggingContext();
  for (const zoom of [1, 0.3, 0.1]) drawScene(ctx, scene, { x: 10, y: 10, zoom, width: 4000, height: 3000 }, undefined, { cull: false, edgeBudget, readable });
  drawLegend(ctx, scene, 0, 0, 200);
  return digest();
}

/** Flow rectangles that cut through every group of the fixture, so culling leaves out nodes, edges and marks but no group. */
type Strip = { x: number; y: number; width: number; height: number };

/** Calls of culled draws of the strip at two zooms, plain and with a selection, hover and focus of paths. */
function culled(fixture: Fixture, options: PrepareOptions, strip: Strip, edgeBudget?: DrawOptions["edgeBudget"], readable?: Readable): { digest: string; drawn: number; total: number } {
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
      const stats = drawScene(ctx, scene, view, s, { cull: true, edgeBudget, readable });
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
 * Recorded once more when activities became cards and the sizes, weights,
 * radii and strokes moved onto their scales. The Canvas map draws the scene's
 * marks, whose changes are those of the SVG export (see export-fixtures):
 * the layout of 64 high activities, the cards, hairline groups, event labels
 * below the circle, badges wholly above, the text and stroke scales and the
 * system font. Its own calls change only where hover, selection and focus are
 * drawn: a hovered node keeps its fill and is outlined in the ink, the
 * selection ring is 2 wide, its inner edge on the element, and a selected
 * group and a highlighted path are 2 wide.
 * Recorded once more when the legend became a key and the numbers honest:
 * the map's recordings hold as many calls as before, and only the stage
 * colours (Purchase order, Invoice and Payment, as in the SVG export), the
 * paths' widths (their cases) and the written numbers and the labels before
 * them changed; in `toPNG` the legend's calls, the pattern twins of those
 * stages, the caption line under the map and the figure's height changed too.
 * Recorded once more when path width took one scale per graph: the map's
 * recordings hold as many calls as before and differ only in the paths'
 * `lineWidth` (as in the SVG export); the legend's width row writes its title
 * on two lines and the three samples of the graph's scale.
 * Recorded once more when paths began to end in a head that grows with the
 * line: the recordings hold as many calls as before; only each path's last
 * `lineTo`, which ends the line inside its head, and the base and outline
 * width of the heads that grew with their path changed; every head's tip is
 * where it was. Recorded once more when paths against the reading direction
 * began to run below the flow: only the calls of the backward paths (their
 * points, heads and labels, as in the SVG export) and, in `toPNG`, the
 * figure's size and the caption's place changed. Recorded once more when the
 * legend's width row took shorter words (as in the SVG export): only those
 * two texts changed. Recorded once more when arc labels began to keep clear
 * of the paths' counts too: compared call by call, the recordings hold as many
 * calls as before and differ only in the pills and texts of arc labels (as in
 * the SVG export): seven arcs of the global map with stage lanes and of its
 * PNG, one of the unfiltered map and of its German PNG; the vendor's are the
 * same.
 */
// Recorded once more for 0.4 (M1 "instrument look"), with the SVG export's digests (see export-fixtures.test.ts): the
// terminal paths in their paint, the recorded paths over a colour domain without them, the paths and their labels
// painted the widest first, the events' outlines and glyphs, the legend's new keys and the caption's sentence.
const before = {
  mapGlobalStages: "62248c2defb5b82383502634252f6bda64fd7ae06ba8f4a95518215a26c76d5f",
  mapVendorIds: "015d6426ebd3f33dfee3cb3b38732bd161a84c417c9c027e18d9455ae349d46c",
  mapUnfiltered: "157059aec2c63f8e6d637d49862300f8a2112ed1b6558b67c4fc5056841d8c0b",
  pngGlobalTitle: "8238a39dda6463625eccdf3b5e390db35ffec552a525bd30d0f46c8fdad23373",
  pngVendorIds: "9272d09ad06747f420e7af8595fa6dc0abcf5eef18aa1902d7f052f9b9399a8f",
  pngUnfilteredGerman: "b259273cef1e77b5819f3c941441a4ec977551f16f7470cc3513d18bfb5c6740",
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
 * Recorded once more when activities became cards (as above); the layout of
 * 64 high activities moved the groups, so the strips of the global, the
 * unfiltered and the vendor fixture were moved to cut every group again and
 * to hold arcs.
 * Recorded once more when the legend became a key and the numbers honest:
 * stage colours, path widths and written numbers changed, as above.
 * Recorded once more when path width took one scale per graph: only the
 * paths' widths changed, as above. Recorded once more when paths began to end
 * in a head that grows with the line, as above. Recorded once more, for
 * the strips that hold backward paths, when those began to run below the
 * flow, as above. Recorded once more, for the two strips with arcs whose
 * labels moved, when arc labels began to keep clear of the paths' counts (as
 * above): every strip reads the same elements in the same order as before
 * (no element's drawn extent reaches into a strip beyond its box) and only
 * the arc labels' calls changed, of six arcs in the global strip and one in
 * the unfiltered one.
 * Recorded once more when the index began to hold each pill at its largest
 * size scaled up to the readable floor: drawn with the readable rule off, every
 * strip draws, call for call, what it drew before, and three draw the calls of
 * a few marks more whose scaled-up extent reaches into the strip (the badges
 * of Clear Invoice and Record Invoice Receipt below the global and the
 * unfiltered strip; three badges and the chip of the vendor's); the strip of
 * the global map with stage lanes is the same. Compared with the previous
 * code block by block, element by element.
 */
const culledBefore = {
  culledGlobal: "ec413696428227494fca97e7c3381a40ac5f97d4216024fbd2c73e098db1d0a7",
  culledGlobalStages: "47f24ce2c2175fd2ddaef6adb06cfd1ccbc4172fcd68fadf65396ef27684292c",
  culledVendorIds: "b258a035146ebc5e6061483fb60060fbe6b4e6b4a946a1c651748b8f4287644c",
  culledUnfiltered: "d14e2615bf0f24d06b4ce370f40f55731ad2c94dabc4c2ef46d1a439085c8357",
};

/**
 * SHA-256 of the same recordings with the texts kept readable, as the Canvas
 * map draws them since: the map at zooms 1, 0.3 and 0.1, the culled strips at
 * 1 and 0.3, and `toPNG` without a theme, which draws the print theme. With
 * the readable rule turned off (a floor of 0) the map's and the strips'
 * recordings are the ones above, call for call, and so are the PNGs in the
 * default theme: nothing else changed (the strips but for the marks their
 * pills' extent adds, above). With it, at zoom 1 the calls are the same (the
 * floor, 9.51, is under every text). At 0.3 (floor 32) the maps of the whole
 * log write no card text and no group title (the first eight characters of a
 * name and the ellipsis fit a line up to a boost of 2.39), the vendor's with
 * references writes each card's reference on one line, fitted for a boost of
 * 3.69, scaled up 2.46 from its start, and its stages' titles scaled up to
 * the floor; at 0.1 (floor 90.5) no card text and no title. At both, paths' counts, self-loop labels, event
 * labels and gateway glyphs are not written, and badges, chips and arcs'
 * labels are scaled up to it from their row's corner or their middle. The PNGs draw the
 * print theme (its paper, ramps and opaque patterns); `pngVendorIds` and
 * `pngUnfilteredGerman` are as wide as their map and write every text as
 * before, while `pngGlobalTitle`, 20,000 pixels wide, is laid out at that
 * width with the map scaled up 6.89 times and the title, legend and caption
 * at their sizes.
 */
const readableDrawn = {
  mapGlobalStages: "d1aac984b857b34f09bb149a379b296e2a677bb22775a231d682a6fb90f1edd2",
  mapVendorIds: "b41dfcd1e544fba746186a89cc8d72f5c5195d50e30a45201f22623518361b2a",
  mapUnfiltered: "129397a2cc848616f379d7b4653d0925c902c976d1bccc32f074a18d4a4f5b8e",
  pngGlobalTitle: "485ff1431a1921f7eb89d166f74522c868f7091f36c1412fd3863d3ce277e732",
  pngVendorIds: "ba9bee1189a65d8b0d56b03adf18fc761aaf1789b8a3d3a2fe13bf975c429877",
  pngUnfilteredGerman: "6e335940b62eb3fe32ea0e05f7d414393fa0d37329ace8a7c78ce4e513abf394",
  culledGlobal: "bfbbf480f7153c572c0ff5b4cfb095ad6fbfe64562429158143c46636495b06e",
  culledGlobalStages: "15e63c03a6b1b655b681245f81e94e3904416edcb2fbf8d37bef492a6b6b8d11",
  culledVendorIds: "9e673342bc2f4e8790ac8f8bb755d78a8990ac43486c067ddf97249bac755aa4",
  culledUnfiltered: "e13260bf50507bdada0b464751d44cf2518681769cde261ec4282f75fecca018",
};

const strips = {
  culledGlobal: [fixtures.global, {}, { x: 0, y: 200, width: 2900, height: 420 }],
  culledGlobalStages: [fixtures.global, { lanes: "stages" }, { x: 0, y: 300, width: 2900, height: 100 }],
  culledVendorIds: [fixtures.vendor, { activityLabels: ids }, { x: 0, y: 120, width: 2500, height: 130 }],
  culledUnfiltered: [fixtures.unfiltered, {}, { x: 0, y: 200, width: 2900, height: 420 }],
} as const satisfies Record<string, [Fixture, PrepareOptions, Strip]>;

/** The six recordings of the map and of toPNG; `readable` and `theme` as given. */
const recordings = (readable?: Readable, theme?: PngOptions["theme"]) => ({
  mapGlobalStages: drawn(fixtures.global, { lanes: "stages" }, undefined, readable),
  mapVendorIds: drawn(fixtures.vendor, { activityLabels: ids }, undefined, readable),
  mapUnfiltered: drawn(fixtures.unfiltered, {}, undefined, readable),
  pngGlobalTitle: exported(fixtures.global, { selfLoops: false, title: "T", lanes: "stages" }, { width: 20000, theme }),
  pngVendorIds: exported(fixtures.vendor, { activityLabels: ids }, { theme }),
  pngUnfilteredGerman: exported(fixtures.unfiltered, { selfLoops: false, locale: "de" }, { lodZoom: 1, legend: false, theme }),
});

describe("Canvas drawing on the committed fixtures", () => {
  it("records the pinned calls for the Canvas map and for toPNG, with the readable rule off and in the default theme", () => {
    expect(recordings(ALL, "default")).toEqual(before);
  });

  it("records the pinned calls for views culled through the R-tree, with the readable rule off", () => {
    const views = Object.fromEntries(Object.entries(strips).map(([k, [f, o, strip]]) => [k, culled(f, o, strip, undefined, ALL)]));
    for (const v of Object.values(views)) expect(v.drawn).toBeLessThan(v.total);
    expect(Object.fromEntries(Object.entries(views).map(([k, v]) => [k, v.digest]))).toEqual(culledBefore);
  });

  it("records the pinned calls with the texts kept readable and toPNG in the print theme (declared change)", () => {
    const views = Object.fromEntries(Object.entries(strips).map(([k, [f, o, strip]]) => [k, culled(f, o, strip).digest]));
    expect({ ...recordings(), ...views }).toEqual(readableDrawn);
  });

  it("records the same calls with the edge budget at all or above the edges in view", () => {
    for (const edgeBudget of ["all", 10_000] as const) {
      expect(drawn(fixtures.global, { lanes: "stages" }, edgeBudget, ALL)).toBe(before.mapGlobalStages);
      expect(drawn(fixtures.vendor, { activityLabels: ids }, edgeBudget, ALL)).toBe(before.mapVendorIds);
      expect(drawn(fixtures.unfiltered, {}, edgeBudget)).toBe(readableDrawn.mapUnfiltered);
      expect(culled(fixtures.global, {}, { x: 0, y: 200, width: 2900, height: 420 }, edgeBudget, ALL).digest).toBe(culledBefore.culledGlobal);
      expect(culled(fixtures.unfiltered, {}, { x: 0, y: 200, width: 2900, height: 420 }, edgeBudget).digest).toBe(readableDrawn.culledUnfiltered);
    }
    // A budget below the edges in view changes the calls.
    expect(drawn(fixtures.global, { lanes: "stages" }, 5, ALL)).not.toBe(before.mapGlobalStages);
  });

  it("records the same calls for toPNG with the edge budget at all", () => {
    expect(exported(fixtures.global, { selfLoops: false, title: "T", lanes: "stages" }, { width: 20000, edgeBudget: "all", theme: "default" })).toBe(before.pngGlobalTitle);
    expect(exported(fixtures.vendor, { activityLabels: ids }, { edgeBudget: "all" })).toBe(readableDrawn.pngVendorIds);
    expect(exported(fixtures.unfiltered, { selfLoops: false, locale: "de" }, { lodZoom: 1, legend: false, edgeBudget: "all", theme: "default" })).toBe(before.pngUnfilteredGerman);
  });
});
