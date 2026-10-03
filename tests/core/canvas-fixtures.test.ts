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
 * SHA-256 of the recorded Canvas calls, recorded from the implementation that
 * assembled its own scales, overlays and geometry in `prepareScene`.
 */
const before = {
  mapGlobalStages: "befa8c7a8a54623aba7f2a319e07498b41d3cd86d4f2835cd8e09163d600bd52",
  mapVendorIds: "d6dd1b2a4099ab304b5bc4c3d29b0806effcc00f96d96ba0bbe46a6c23732e77",
  mapUnfiltered: "10199828bd59575962adb1ab769178b8f94f8f08cb1792b018f212283e3bc135",
  pngGlobalTitle: "197b026c7ec6d5d31a6640236408a7f08bdbbc4d014e642c6065c72e9b1cb8f9",
  pngVendorIds: "56bd6cda6d5ebea93a334ded6c6c839656b657469d80f6d60ca2aa87868f73e0",
  pngUnfilteredGerman: "679342791f34eb4e46762ec6537a01f440e06cb40f1573366553782e5ac15c70",
};

describe("Canvas drawing on the committed fixtures", () => {
  it("records the same calls as before for the Canvas map and for toPNG outside the declared changes", () => {
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
