import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type ActivityLabelOptions, type FlowGraph, type Overlay, type Positions, abstract, layout, overlaysFor } from "../../src/index";
import { type DrawContext, type PrepareOptions, type PngOptions, drawLegend, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
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

function drawn(fixture: Fixture, options: PrepareOptions): string {
  const { graph, positions: p, overlays } = fixture();
  const scene = prepareScene(graph, p, { overlays, ...options });
  const { ctx, digest } = loggingContext();
  for (const zoom of [1, 0.3, 0.1]) drawScene(ctx, scene, { x: 10, y: 10, zoom, width: 4000, height: 3000 }, undefined, { cull: false });
  drawLegend(ctx, scene, 0, 0, 200);
  return digest();
}

/** Flow rectangles that cut through every group of the fixture, so culling leaves out nodes, edges and marks but no group. */
type Strip = { x: number; y: number; width: number; height: number };

/** Calls of culled draws of the strip at two zooms, plain and with a selection, hover and focus of paths. */
function culled(fixture: Fixture, options: PrepareOptions, strip: Strip): { digest: string; drawn: number; total: number } {
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
      const stats = drawScene(ctx, scene, view, s, { cull: true });
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
 * the edges.
 */
const before = {
  mapGlobalStages: "41a7b0aa1ccc6fc4ffbdac164c00d27ad897a0e09dde5baeaeedb97ef5aefd20",
  mapVendorIds: "8342138ee0aec0605df384aed83877b549d2b9594829e8477d90327b2b9142c8",
  mapUnfiltered: "b72e8a1d76f7647a17fb06e3839b434a21b1e6cc021974feb671655ffeeea5b4",
  pngGlobalTitle: "845401687f0c9093e507e0803cac227b35e81208e4f7a8bb1f431d67017c00e3",
  pngVendorIds: "d111edbb9b2a36d29d0ea321ffce30311626062f20e0f4d9780d36760570546c",
  pngUnfilteredGerman: "e6391a6dcc7155c570ed4a8e5ba799dc9959b24fe84d76678db8447e88bb869b",
};

/**
 * SHA-256 of the recorded calls of culled draws, recorded while the drawing
 * still walked every element and tested it against the R-tree's result, and
 * recorded again for the two strips with arcs when arcs began to be drawn
 * between the edges and the nodes; their calls moved as in the uncull draws.
 */
const culledBefore = {
  culledGlobal: "129a9323ca7964675cb3397fd2a2aeda4bc3a14e3c77bef01afed0430056c0e0",
  culledGlobalStages: "177a0be9328cdbf9a1cc424a40e746527754015b2143b598312387fe30a6b1e2",
  culledVendorIds: "efcf4c49628e24cbd7d4421dec5e5a21d8e30375f294796862da0751ba871f36",
  culledUnfiltered: "d7060d0bfb1109996132693d55950e32d8978e10004f40c87fc75e5a60fd1ba2",
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
});
