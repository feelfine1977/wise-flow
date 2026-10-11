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
 * Recorded once more when the legend became a key and the numbers honest;
 * compared element by element, only these changed, and every overlay group
 * is the same: paths are as wide as their cases (they were as wide as their
 * transitions; most move by under 0.05, the two paths between Record Goods
 * Receipt and Record Service Entry Sheet from 3.75 to 1.98) and labelled with
 * them in full up to 99,999, then "112k" (they read "31k", "1.0k"); activity
 * counts and observed self-loop labels are grouped in full ("234,479" where it
 * read "234k"), so the labels before them leave more room, and three labels are
 * cut one to three characters shorter; the stages Purchase order, Invoice and
 * Payment take other colours with their pattern twins (Purchase order shared
 * grey with Requisition); the legend names the measure, the metric and the
 * unit, writes three width samples, a key per badge glyph and the start and
 * end; and a caption line under the map gives the label, cases, period and
 * how much of the model is shown, which makes the figure 40 taller.
 */
const before: Record<string, string> = {
  overlays: "7874b3305582ccf5d97ee1b303b622cb45cf8fcbb74955dbfb3e6f44a82e0b7e",
  stagesGerman: "dec6bfa27dd2fd43b5a5748220865b63fb81a911173d71578981df4f28967c2a",
  vendor: "de61d068329b4952b356f258076760d044dca6ddd88032a87307c3088b93a654",
  unfiltered: "9b8950b1104db78b128f63d547acb67e502621ce5e60d6cbd8256d9679d97257",
  plain: "9541fbef043162a55c5c5ca56a12159e8b7e2d4a6e54fc5ff957cb03c542c99a",
};
const beforeObserved = "102fa52420086eb9a1b9da00a448899a1718cd3dd7a7afbd887e076402bf0d30";

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
