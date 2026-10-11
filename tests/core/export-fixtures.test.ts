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
 * SHA-256 of `toSVG` for each variant. Recorded from the implementation that
 * assembled bands, scales, overlays and geometry inside `toSVG`, and recorded
 * again when `toSVG` began to draw the scene's overlay marks. Compared element
 * by element, that step changed only: the overlay arrowhead marker (12 px, as on
 * the map), the hatch fill (opacity 0.55, no outline), chip text 0.5 px higher,
 * and the figure size, map offset and activity key position, because map-level
 * chips no longer count towards the bounds. Recorded once more when chips began
 * to show what the live map shows; compared element by element, only the chip
 * groups changed: the glyph, the gauge and the label in bold before the text.
 * Recorded once more when `toSVG` began to draw the scene's node and edge
 * marks; compared element by element, only text elements changed: node labels
 * 2 px further in and on the Canvas baseline (0.4 px higher), stage labels
 * semibold, counts in the muted ink and a stage's members before its cases,
 * event labels inside the circle at 9 px, edge counts at half the route's
 * length, and labels, legend rows and chips shortened by the core rule (0.55 em
 * per character). Recorded once more when `toSVG` began to draw the scene's
 * legend in the shared figure frame; compared element by element, only the
 * legend changed: its rows are 188 wide (they were 204), so the second width
 * sample, the gradient and its right label moved 16 left and long key and chip
 * rows keep fewer characters; only the overlay kinds present are listed; and
 * reverse-order arcs show "⌒┄" as on the map (it was "⌒ ┄").
 * Recorded once more when `toSVG` began to read the token table; compared
 * element by element, only the definitions changed and everything after
 * `</defs>` is the same: pattern twins in 6-unit tiles (stroke 1 at 0.6, a dot
 * of radius 1 at 0.7) where they were 8 units (stroke 1.2 at 0.55, a dot of
 * 1.3 at 0.6), the edge marker the live map's arrow (3 long, 4.8 wide, outlined
 * by 0.6, in user units) where it was 7 stroke widths, and the overlay marker
 * written in user units with the same triangle.
 * Recorded once more when arcs began to be drawn between the edges and the
 * nodes; with the arc groups taken out the output is the same, and the arc
 * groups, unchanged, now follow the last edge instead of the last node
 * (`plain` has no arcs and kept its digest). Recorded once more when arcs
 * began to keep clear of the other activities; with the arc groups taken out
 * the output is the same (the figure's size too). Of the twelve arcs of the
 * global fixture four take another course and four more move their label
 * along the arc; of the vendor's four, two and one; of `unfiltered`'s three,
 * one moves its label.
 * Recorded once more when groups became marks of the scene; with the group
 * elements taken out the output is the same. Stage groups are outlined at full
 * opacity (they were at 0.5), as the Canvas map and the interactive map draw
 * them; bands are outlined in the line colour on the two sides between bands
 * (they were outlined all round in the neutral colour at 0.5).
 */
const before: Record<string, string> = {
  overlays: "9c124aad12f2801947edaaa48e1d365df35efe179a19aefb3e5cc2c514008ac6",
  stagesGerman: "2d40dab4cf1a69b9b051f14a02ef85a35efc9009c1f76a16ba62e2740b5cb3cc",
  vendor: "69962d6fc2f92e270bacdd40e02e5324a0f06f8fbcd502f3b91d777d67c95dee",
  unfiltered: "2672238a6b4b8c386465d17289ad82fccaa17c70f52bcc42051c79ab4e9b0451",
  plain: "e4f17efdeef5174c01b79b34ed7296776059b40de01771e2d0b148b0ed440de6",
};
const beforeObserved = "3e423ac703f8bebd502733d987665eccd2d713e9a1a7948a20ae429650426de3";

describe("toSVG on the committed fixtures", () => {
  it("matches the recorded output once follows self-loops are hidden", () => {
    expect(Object.fromEntries(Object.entries(variants).map(([name, v]) => [name, sha(toSVG({ ...v.scene(), selfLoops: false }, v.options))]))).toEqual(before);
  });

  it("matches the recorded output with the edge budget at all", () => {
    expect(Object.fromEntries(Object.entries(variants).map(([name, v]) => [name, sha(toSVG({ ...v.scene(), selfLoops: false }, { ...v.options, edgeBudget: "all" }))]))).toEqual(before);
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

  it("keeps the recorded output where self-loops were already decided", () => {
    // Below their level of detail, plain self-loops stay hidden; the legend lists them.
    const plain = { ...variants.plain.options, legend: false };
    expect(toSVG(variants.plain.scene(), plain)).toBe(toSVG({ ...variants.plain.scene(), selfLoops: false }, plain));
    expect(toSVG(variants.plain.scene(), variants.plain.options)).toContain("Repeated execution");
    // With activity labels the observed self-loops were already drawn.
    expect(sha(toSVG(observed.scene(), observed.options))).toBe(beforeObserved);
  });

  it("drops overlays with unknown targets without changing the drawing (declared change)", () => {
    const scene = variants.unfiltered.scene();
    const known = new Set([...global.nodes.map((n) => n.id), ...(global.groups ?? []).map((g) => g.id), "__map"]);
    const isKnown = (o: { kind: string; target: string; payload?: Record<string, unknown> }) =>
      o.kind === "arc" ? known.has(String(o.payload?.source)) && known.has(String(o.payload?.target)) : known.has(o.target);
    const overlays = scene.overlays ?? [];
    expect(overlays.filter((o) => !isKnown(o)).length).toBeGreaterThan(0);
    expect(toSVG(scene)).toBe(toSVG({ ...scene, overlays: overlays.filter(isKnown) }));
  });
});
