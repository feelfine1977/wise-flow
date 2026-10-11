import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { textMeasures } from "../../fixtures/text-measures";
import { type ActivityLabelOptions, type ColorScheme, type FlowGraph, type LaneMode, type Locale, type Overlay, type Positions, type Theme, buildScene, estimateTextWidth, toSVG } from "../../src/index";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { readCanvasMap, readPng } from "./parity/canvas";
import { readDom, readDomInPage } from "./parity/dom";
import { type Drawing, type Listed, checkExpected, differences, exportedMarks, kindsOf } from "./parity/drawn";
import { readSvg } from "./parity/svg";

/**
 * The four renderers draw one scene: the interactive DOM map of the parity
 * stories, and the same scene (written by the story beside the map) drawn by
 * the SVG export, the Canvas map and the PNG export. What they drew is
 * compared element by element with the SVG export's; every difference must be
 * listed in `parity/expected.json` exactly as found, so a new difference fails
 * and so does a listed one that is gone. Some stories are drawn again in the
 * dark scheme: the map in a page that prefers it, the scene resolved in it.
 */

const FIXTURES: { name: string; story: string; scheme?: ColorScheme }[] = [
  { name: "small", story: "parity--small" },
  { name: "global", story: "parity--global" },
  { name: "stageBands", story: "parity--stage-bands" },
  { name: "stages", story: "parity--stages" },
  { name: "roleLanes", story: "parity--role-lanes" },
  { name: "kinds", story: "parity--element-kinds" },
  { name: "secondTheme", story: "parity--second-theme" },
  { name: "names", story: "parity--names" },
  { name: "namesGerman", story: "parity--names-german" },
  { name: "smallDark", story: "parity--small", scheme: "dark" },
  { name: "roleLanesDark", story: "parity--role-lanes", scheme: "dark" },
  { name: "kindsDark", story: "parity--element-kinds", scheme: "dark" },
];

interface StoryScene {
  graph: FlowGraph;
  overlays: Overlay[];
  lanes?: LaneMode;
  theme?: Theme;
  activityLabels?: ActivityLabelOptions;
  locale?: Locale;
  measure?: string;
  positions: Positions;
}

/** Widths as the core estimates them, in the font the Canvas context is set to. */
const measure = (text: string, font: string) => estimateTextWidth(text, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) });

const expected = (): Listed[] => JSON.parse(readFileSync(new URL("./parity/expected.json", import.meta.url), "utf8")).differences;

test("the DOM map, the Canvas map, the SVG export and the PNG export draw the committed fixtures alike, but for the listed differences", async ({ page }, info) => {
  const fixtures: Parameters<typeof differences>[0] = [];
  for (const { name, story, scheme = "light" } of FIXTURES) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/iframe.html?id=${story}&viewMode=story`);
    const json = await page.locator('[data-testid="wf-parity-scene"]').textContent({ timeout: 60_000 });
    const { graph, overlays, lanes, theme, activityLabels, locale, measure: named, positions } = JSON.parse(json!) as StoryScene;
    const given = { graph, positions, overlays, lanes, activityLabels, locale };
    // The scene in the story's theme and scheme, its texts measured by the measure the story gave the map.
    const look = { theme, scheme, textMeasure: textMeasures[named ?? "estimate"] };
    const scene = buildScene(graph, positions, { overlays, lanes, activityLabels, locale, ...look });
    const kinds = kindsOf(scene);
    await expect(page.locator(".react-flow__node")).toHaveCount(scene.nodeMarks.length + Object.keys(scene.positions.groups).length);
    await expect(page.locator("g.wf-edge")).toHaveCount(scene.edgeMarks.length);

    const svg = readSvg(toSVG(given, look), exportedMarks(scene));
    const tints = scene.marks.filter((m) => m.kind === "tint").map((m) => ({ id: m.id, target: m.overlay.target }));
    const dom = readDom(await page.evaluate(readDomInPage, tints), kinds);
    const canvas = readCanvasMap(prepareScene(graph, positions, { overlays, lanes, activityLabels, locale, ...look }), kinds, measure);
    const png = readPng((createCanvas) => toPNGCanvas(given, { scale: 1, createCanvas, ...look }), prepareScene(graph, positions, { overlays, lanes, activityLabels, locale, lodBySize: false, ...look }), kinds, measure);
    for (const [renderer, drawing] of Object.entries({ svg, dom, canvas, png }) as [string, Drawing][]) {
      expect(drawing.size, `${name}: ${renderer} drew elements`).toBeGreaterThan(0);
    }
    // The scheme and the theme reached what was compared: the paper of an activity, the outline of the second theme.
    const activity = scene.nodeMarks.find((m) => m.kind === "activity") ?? scene.nodeMarks.find((m) => m.fill === "paper")!;
    expect(svg.get(`node:${activity.id}`)!.props.fill, `${name}: the scheme's paper`).toBe(scheme === "dark" ? "#16181d" : "#ffffff");
    if (theme) expect([svg, dom].map((d) => d.get(`node:${activity.id}`)!.props.outlineWidth), `${name}: the theme's outline`).toEqual(["3", "3"]);
    // The measure reached what was compared: it wraps the activity names into more lines than the estimate.
    const lines = (s: typeof scene) => s.nodeMarks.flatMap((m) => m.texts.filter((t) => t.role === "nameLine")).length;
    if (named) expect(lines(scene), `${name}: the measure's lines`).toBeGreaterThan(lines(buildScene(graph, positions, { overlays, lanes, activityLabels, locale })));
    fixtures.push({ name, kinds, svg, others: { dom, canvas, png } });
  }
  const found = differences(fixtures);
  const body = `${JSON.stringify({ differences: found }, null, 2)}\n`;
  await info.attach("parity-found.json", { body, contentType: "application/json" });
  // To review what was found as a whole, write it to a file of your choice.
  if (process.env.FLOW_PARITY_FOUND) writeFileSync(process.env.FLOW_PARITY_FOUND, body);
  const { added, gone, changed } = checkExpected(found, expected());
  expect({ added, gone, changed }, "differences between the renderers that parity/expected.json does not list as found").toEqual({ added: [], gone: [], changed: [] });
});
