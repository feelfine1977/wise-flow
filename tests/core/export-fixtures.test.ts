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
 * Recorded once more when paths began to be drawn in neutrals by their count
 * and deviations in the one accent; compared group by group, with the colours
 * (`fill`, `stroke`), the pattern twins and the dashes of nodes, groups and
 * edges left out, every node, group and edge is the same: paths take the
 * grey of their count, constraint edges the accent; activities, stage nodes
 * and groups take the colour and twin of the six-colour stage palette, and
 * groups lose their dash. Every overlay group changed (the accent, arcs one
 * width with their label in a pill, badges as pills above their activity,
 * labels placed apart), the legend (the path colour's ramp and values, the
 * stage swatches, the key texts and the reverse-order glyph ⇐), and the
 * figure's height where the marks' extent moved it (962 where it was 963).
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
 * are the same. Recorded together with the deviations in the one accent,
 * since both changed the same overlay marks.
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
 * Recorded once more when path width took one scale per graph: compared group
 * by group, every node, group and overlay group is the same, and an edge group
 * differs only in its path's `stroke-width` (the square root from 0 to the
 * strongest path of the log, 194,821 cases, onto 0 to 8, never under 1); the
 * legend's width row names the scale "scale of the whole graph" on a second
 * line and writes "≤ 3,044 (thinnest)", "62,000" and "195k" at 1,
 * 4.51 and 8 (it wrote the shown paths' ends and middle), so the rows below it
 * and the figure's height move 16.
 * Recorded once more when paths began to end in a head that grows with the
 * line: compared group by group, an edge group differs only in its path's
 * `d`, whose last point moved back along the last segment by the head's
 * overhang (2.25 for the heads of 12, up to 6 for the 8 wide path), and its
 * `marker-end`, the marker of its head's size; the definitions hold the rule's
 * head with its triangle 2.25 beyond the line's end and one marker per larger
 * head (`wf-arrow-<size>`, 4 times the path's width rounded up). Everything
 * else is the same.
 */

const before: Record<string, string> = {
  overlays: "37e17b8d11b7aa7587a67ea16bee4f1397170521d919131b9ee51f86900a9abe",
  stagesGerman: "9b70c7893a4a22bcb08c9df56bf357fa6c150a87a186d66de9fc6b51aabb1571",
  vendor: "a1d5acbacb1e5c39c370627584f65e62b4c341be6187003ae5da185233b06eda",
  unfiltered: "dd0ab5b1e0a9ca96b12ec263bba5761dad5f1b8cbe83864f12f6f092098f8704",
  plain: "7593df57c901d6d4e54b44f7bb3fe482082f7af9e21235e9fabb38fa1a70e483",
};
const beforeObserved = "cd000ec8bd501dd8831717c8d2e315979813e8d8e8a97b239e6a023a0de750ac";

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
