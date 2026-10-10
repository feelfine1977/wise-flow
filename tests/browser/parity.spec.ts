import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { type FlowGraph, type LaneMode, type Overlay, type Positions, buildScene, estimateTextWidth, toSVG } from "../../src/index";
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
 * and so does a listed one that is gone.
 */

const STORIES = { small: "parity--small", global: "parity--global", stageBands: "parity--stage-bands", stages: "parity--stages", roleLanes: "parity--role-lanes" };

interface StoryScene {
  graph: FlowGraph;
  overlays: Overlay[];
  lanes?: LaneMode;
  positions: Positions;
}

/** Widths as the core estimates them, in the font the Canvas context is set to. */
const measure = (text: string, font: string) => estimateTextWidth(text, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) });

const expected = (): Listed[] => JSON.parse(readFileSync(new URL("./parity/expected.json", import.meta.url), "utf8")).differences;

test("the DOM map, the Canvas map, the SVG export and the PNG export draw the committed fixtures alike, but for the listed differences", async ({ page }, info) => {
  const fixtures: Parameters<typeof differences>[0] = [];
  for (const [name, id] of Object.entries(STORIES)) {
    await page.goto(`/iframe.html?id=${id}&viewMode=story`);
    const json = await page.locator('[data-testid="wf-parity-scene"]').textContent({ timeout: 60_000 });
    const { graph, overlays, lanes, positions } = JSON.parse(json!) as StoryScene;
    const given = { graph, positions, overlays, lanes };
    const scene = buildScene(graph, positions, { overlays, lanes });
    const kinds = kindsOf(scene);
    await expect(page.locator(".react-flow__node")).toHaveCount(scene.nodeMarks.length + Object.keys(scene.positions.groups).length);
    await expect(page.locator("g.wf-edge")).toHaveCount(scene.edgeMarks.length);

    const svg = readSvg(toSVG(given), exportedMarks(scene));
    const tints = scene.marks.filter((m) => m.kind === "tint").map((m) => ({ id: m.id, target: m.overlay.target }));
    const dom = readDom(await page.evaluate(readDomInPage, tints), kinds);
    const canvas = readCanvasMap(prepareScene(graph, positions, { overlays, lanes }), kinds, measure);
    const png = readPng((createCanvas) => toPNGCanvas(given, { scale: 1, createCanvas }), prepareScene(graph, positions, { overlays, lanes, lodBySize: false }), kinds, measure);
    for (const [renderer, drawing] of Object.entries({ svg, dom, canvas, png }) as [string, Drawing][]) {
      expect(drawing.size, `${name}: ${renderer} drew elements`).toBeGreaterThan(0);
    }
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
