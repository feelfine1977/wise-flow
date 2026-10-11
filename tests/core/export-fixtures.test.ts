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
 * (they were outlined all round in the neutral colour at 0.5). Recorded once
 * more when the start event took the interactive map's outline: only its
 * circle's stroke width changed, 2 where it was 1.5. Recorded once more when
 * texts began to be measured once, by the scene's measure: compared element by
 * element, only text changed. One chip's text is cut by the estimate (5.5 per
 * character at 10 px) where it was cut at 6.2 per character, so it keeps three
 * more characters ("Manual touches in the order stag…"). Activity and stage
 * labels leave the room the interactive map gives them: inside the outline and
 * before the count it writes on their line; thirteen labels of the global and
 * the vendor map are cut one to four characters shorter. `plain` writes no
 * label at its zoom, has no chip and kept its digest.
 * Recorded once more when activities became cards and the token table's
 * sizes, weights, radii and strokes moved onto their scales. The default
 * activity is 64 high (48), so the layout moves. Drawn on the positions of
 * the earlier layout and compared element by element, the five variants
 * differ only in what was named: the font stack (the system font first);
 * activities and stages as cards on the same boxes (name, number line, a
 * neutral outline, the band); stage groups and bands as hairlines without a
 * tint (bands keep theirs) with a muted title; event labels below the circle;
 * badges wholly above their activity; texts at 11, 13 and 15 px with weights
 * of 600 at most, so chips and legend keys keep fewer characters; radii and
 * strokes of 4, 8 and full, 1 and 2, and the label halo 2 wide; the hatch
 * drawn with 1 px lines. Edge routes, colours, widths and labels, arc and
 * self-loop courses, tints, hatching, the legend's rows and the figure's size
 * are the same.
 */
const before: Record<string, string> = {
  overlays: "792600df120620f8bc89704d976d6723d6d12a786a556cdb3b88217df8110d8e",
  stagesGerman: "248c37c5ec4f45a112e0920df1471a53ce4ce76cc4a872b32692d20f10878bf5",
  vendor: "d475e6b676014a43b3b5b41c2a5a4e516c3436adba6d7fe8e1ec9ac0ffe87b12",
  unfiltered: "8c27c47e30a7245a6e5324728da411119d32f139f0d841e47e72a075122c02ef",
  plain: "db4ba51be56cd160de6c9e4becc9d4fb9723661cc4e620f8194340e94813c870",
};
const beforeObserved = "bdbae0efe097ec8976b431bd0df98732974f0f91fb6ca1e3026b1a94fb2757b5";

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
