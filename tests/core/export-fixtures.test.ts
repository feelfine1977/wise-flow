import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowGraph, type Positions, type Scene, type ExportOptions, abstract, layout, overlaysFor, toSVG } from "../../src/index";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const vendor = abstract(vendorScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const loops = (g: FlowGraph) => g.edges.filter((e) => e.kind === "follows" && e.source === e.target).map((e) => e.id).sort();

let positions: { global: Positions; vendor: Positions };
beforeAll(async () => {
  positions = { global: await layout(global, { engine: "dagre" }), vendor: await layout(vendor, { engine: "dagre" }) };
});

type Variant = { scene: () => Scene; options?: ExportOptions };

const variants: Record<string, Variant> = {
  overlays: { scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }), title: "P2P" }) },
  stagesGerman: { scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }), lanes: "stages", locale: "de", title: "Karte" }), options: { preset: "single-column" } },
  vendor: { scene: () => ({ graph: vendor, positions: positions.vendor, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }), title: "Vendor" }), options: { legend: false } },
  // Without `graph` the presets also target activities the abstraction removed.
  unfiltered: { scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems()), title: "P2P" }), options: { width: 800 } },
  plain: { scene: () => ({ graph: global, positions: positions.global }), options: { lodZoom: 0.1 } },
};
const observed: Variant = {
  scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }), activityLabels: { mode: "ids", references: {} } }),
};

/**
 * SHA-256 of `toSVG` for each variant, recorded from the implementation that
 * assembled bands, scales, overlays and geometry inside `toSVG`.
 */
const before: Record<string, string> = {
  overlays: "bb2acd37c69e53a41e520be7a9c9e701fa1aaa870ee4e585594ccc3e70e03610",
  stagesGerman: "9af1b735af156a864b01cf1c96d6dbea1b6b8f4f1fd74f20501174e2ae1a7912",
  vendor: "e1f8058fdbd4fac360d03f57979d31b04bb9957e354b0518ede65cc3eac0f6b0",
  unfiltered: "4dd54675243731f2639c43fa1eaf5c71a2cc2da1a9395d765a9882c2f527d91b",
  plain: "8bced1efd5897457744909465e3698a6d6df2b2d87495e0e917b3e2c62b19641",
};
const beforeObserved = "4591e5d793209b3a8dd29fa11f1ca9e3e7d82add4b68c1bd57ccf014c3617239";

describe("toSVG on the committed fixtures", () => {
  it("is byte-identical to the previous output once follows self-loops are hidden", () => {
    for (const [name, v] of Object.entries(variants)) expect(sha(toSVG({ ...v.scene(), selfLoops: false }, v.options)), name).toBe(before[name]);
  });

  it("shows every follows self-loop by default (declared change)", () => {
    expect(loops(global)).toHaveLength(3);
    expect(loops(vendor)).toHaveLength(1);
    for (const name of ["overlays", "stagesGerman", "vendor", "unfiltered"]) {
      const v = variants[name];
      const graph = v.scene().graph;
      const svg = toSVG(v.scene(), v.options);
      expect(svg, name).not.toBe(toSVG({ ...v.scene(), selfLoops: false }, v.options));
      const drawn = [...svg.matchAll(/class="wf-overlay wf-selfloop" data-edge-id="([^"]+)"/g)].map((m) => m[1].replace(/&gt;/g, ">")).sort();
      expect(drawn, name).toEqual(loops(graph));
    }
  });

  it("keeps the previous output where self-loops were already decided", () => {
    // Below their level of detail, plain self-loops stay hidden.
    expect(sha(toSVG(variants.plain.scene(), variants.plain.options))).toBe(before.plain);
    // With activity labels the observed self-loops were already drawn.
    expect(sha(toSVG(observed.scene(), observed.options))).toBe(beforeObserved);
  });

  it("drops overlays with unknown targets without changing the drawing (declared change)", () => {
    const scene = variants.unfiltered.scene();
    const known = new Set([...global.nodes.map((n) => n.id), ...(global.groups ?? []).map((g) => g.id), "__map"]);
    const isKnown = (o: { kind: string; target: string; payload?: Record<string, unknown> }) =>
      known.has(o.target) || (o.kind === "arc" && known.has(String(o.payload?.source)) && known.has(String(o.payload?.target)));
    const overlays = scene.overlays ?? [];
    expect(overlays.filter((o) => !isKnown(o)).length).toBeGreaterThan(0);
    expect(toSVG(scene)).toBe(toSVG({ ...scene, overlays: overlays.filter(isKnown) }));
  });
});
