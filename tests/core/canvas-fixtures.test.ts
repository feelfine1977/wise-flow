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
 * Recorded once more when the drawing began to read the token table; compared
 * the same way, only the edge arrowheads changed: the live map's arrow, 3 long
 * and 4.8 wide with the tip on the route's end, filled and outlined by 0.6 in
 * the edge's colour, where it was a triangle of 8 plus the edge width (at most
 * 16). Overlay arrowheads and the line pattern tiles drew the same calls.
 */
const before = {
  mapGlobalStages: "289e040ab8d80b68f04a386f3379fac23abc233dc68c7b68e45e25ca7a13dfd4",
  mapVendorIds: "4457b26e673fbcbfe6b7db6febfbb12c2fe5e744e2b7caf7222635f93b6389d2",
  mapUnfiltered: "18b7d1c99b4ae46a1cf4da33485579f087194eba1a3bc0876c6e665e693716b1",
  pngGlobalTitle: "5632b925998708cb3b82c87b0bd96e77175310f00e6876f61ce4bff4838fce03",
  pngVendorIds: "12e3741749edf5c1525023b6e3336bf81cfba61e48a7d5ff67bc73b39f66a068",
  pngUnfilteredGerman: "a128bd5ac5e03630189b933c3b6fa84630e28f7d4b6ba8e61324def43c445918",
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
});
