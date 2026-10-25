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

// Pinned in the default theme, which draws the figure as one picture scaled to its width, as every export did before
// exports drew the print theme by default.
const variants: Record<string, Variant> = {
  overlays: { scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }), title: "P2P" }), options: { theme: "default" } },
  stagesGerman: { scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }), lanes: "stages", locale: "de", title: "Karte" }), options: { preset: "single-column", theme: "default" } },
  vendor: { scene: () => ({ graph: vendor, positions: positions.vendor, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }), title: "Vendor" }), options: { legend: false, theme: "default" } },
  // Without `graph` the presets also target activities the abstraction removed.
  unfiltered: { scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems()), title: "P2P" }), options: { width: 800, theme: "default" } },
  plain: { scene: () => ({ graph: global, positions: positions.global }), options: { lodZoom: 0.1, theme: "default" } },
};
const observed: Variant = {
  scene: () => ({ graph: global, positions: positions.global, overlays: overlaysFor(constraintItems(), { graph: global }), activityLabels: { mode: "ids", references: {} } }),
  options: { theme: "default" },
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
 * Recorded once more when paths against the reading direction began to run
 * below the flow they return over: compared group by group, only the edge
 * groups of the backward paths differ (three of the global fixture, back to
 * Record Goods Receipt; one of the vendor's, Clear Invoice → Record Invoice
 * Receipt), in their course and their label's place, and the figure, whose
 * map grew by the lowest of their lines (40.28; not with stage bands, which
 * reach below it), is that much taller with its caption and legend rule.
 * No path of these fixtures runs both ways without one of them backward.
 * Recorded once more when the legend's width row took shorter words, so
 * that the live map's panel keeps it on two lines: only the texts "whole
 * graph" (it read "scale of the whole graph") and "≤ 3,044" (it read "≤ 3,044
 * (thinnest)") changed.
 * Recorded once more when arc labels began to keep clear of the paths' counts
 * too: compared element by element, only the pill and the text of arc labels
 * changed; no arc's course and nothing else. Of the global map's twelve arcs
 * two labels had their pill on a count ("80,164" and "112k") and four more
 * moved along their arcs as the places nearest their middle were freed or
 * taken; with stage bands in German three were on a count ("80.164", "108k",
 * "112k") and five more moved; of `unfiltered`'s three, the one on "80,164".
 * The vendor's and `plain` are the same.
 */

// Recorded once more for 0.4 (M1 "instrument look"), against the output at f8c45d4 compared group by group: only
// these changed. Paths from the start event and to the end event are terminal paths in the terminal paint (seven of
// the global maps', five of the vendor's), colour only; the recorded paths take the grey of their cases over a colour
// domain without the terminal paths (26 of the default theme's, 27 of print's), colour only; every renderer paints the
// paths the widest first, so the edge groups come in that order; the start and end events are outlined in lineStrong
// with ▶ and ■ in their middle; the legend lists the keys of the terminal paths (─) and the events (▶, ■); the caption
// adds what the terminal paths count; in the narrow print figures the key of numbered names moves down under the
// taller legend. The observed self-loops of `observed` take their paths' new colour. Nothing else changed.
// Supplied activity times now appear in node titles. Compared with the preceding
// output: scene marks are identical except titles, SVG is byte-identical after
// removing titles, and all recorded Canvas operations are identical.
const before: Record<string, string> = {
  overlays: "78b3ba779437523cf4f815a0b30a265e43c8b3161cf8a91ad00e974e2cf4291b",
  stagesGerman: "2072787b63c5726a3553310efedb9b46887f799733843bad9276e823d6f5be80",
  vendor: "bfebcdae010a6c2388409e77a43aa3dedee8173836d27e801c59036380e41bf3",
  unfiltered: "c5ae8088019cee71f424c6dd4347b100406fa03e3fa16d23b61edf7ebde129d5",
  plain: "28992010e352e2927fbe9fe7255f75e6aeae2d2a499f42309183bd6d7ca76c28",
};
const beforeObserved = "a9e23da4d644af079aac3b770e4eaa59d25e74124ca19b9d90ee6e0f704474e8";

/**
 * SHA-256 of `toSVG` for each variant without a theme, which draws the print
 * theme since exports stopped drawing the default one: white paper, no tints,
 * an opaque pattern on every stage colour, the print ramps of the paths, and
 * no text under 7 pt at the figure's width. `overlays`, `vendor` and `plain`
 * are as wide as their map and keep every text at its size (the floor, 9⅓
 * units, is under the smallest text); `stagesGerman` (1,000 wide) and
 * `unfiltered` (800 wide) are laid out at that width, the map scaled into it
 * beside the legend, so that the title, legend and caption keep their sizes:
 * the map's texts follow the readable rule at that scale (0.25 and 0.19),
 * where no card shows its name, so the cards are numbered and keyed under the
 * legend, the paths' labels are shed and the pills scaled up to the floor.
 */
// Fractional font sizes are serialized to twelve decimal places. Only the references
// and boosted deviation texts in the two narrow figures differ; all other SVG bytes are unchanged.
const printed: Record<string, string> = {
  overlays: "f469226a7b6c2cda29b4644515dbb2e6d2ab94c94c9812467fd7e3851ed5dbe3",
  stagesGerman: "d369e09679f90c52ec085c87acd5555fd45d32074ed60ae6827befe287dbc584",
  vendor: "b309092023bd82a5cd8379cbc303b0e0d74d15b95c248d2253def49687d8eeea",
  unfiltered: "af7a1022641ecfb7564f5e5dd3b7b43ed1226f371c181840885682130280f721",
  plain: "c752268bed8e3c92e66a0cffac4465ef47ad3a34c14d274c71b9ca89f8c3c9a6",
};

describe("toSVG on the committed fixtures", () => {
  it("draws the print theme without a theme (declared change)", () => {
    const print = (o?: ExportOptions) => (o ? { ...o, theme: undefined } : o);
    expect(Object.fromEntries(Object.entries(variants).map(([name, v]) => [name, sha(toSVG({ ...v.scene(), selfLoops: false }, print(v.options)))]))).toEqual(printed);
  });

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
