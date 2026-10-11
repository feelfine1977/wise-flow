import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { textMeasures } from "../../fixtures/text-measures";
import { type ActivityLabelOptions, type ColorScheme, type FlowGraph, type LaneMode, type Locale, type Overlay, type Positions, type Theme, buildScene, estimateTextWidth, themeColors, toSVG } from "../../src/index";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { readCanvasMap, readPng } from "./parity/canvas";
import { readDom, readDomInPage } from "./parity/dom";
import { type Drawing, type Listed, checkExpected, differences, exportedMarks, kindsOf, paint } from "./parity/drawn";
import { readSvg } from "./parity/svg";

/**
 * The four renderers draw one scene: the interactive DOM map of the parity
 * stories, and the same scene (written by the story beside the map) drawn by
 * the SVG export, the Canvas map and the PNG export. What they drew is
 * compared element by element with the SVG export's; every difference must be
 * listed in `parity/expected.json` exactly as found, so a new difference fails
 * and so does a listed one that is gone. Some stories are drawn again in the
 * dark scheme: the map in a page that prefers it, the scene resolved in it.
 * One story gives the map no theme but sets four CSS variables on its
 * container; it writes the scene in the theme `useFlowTheme` resolves there.
 */

const FIXTURES: { name: string; story: string; scheme?: ColorScheme }[] = [
  { name: "small", story: "parity--small" },
  { name: "global", story: "parity--global" },
  { name: "stageBands", story: "parity--stage-bands" },
  { name: "stages", story: "parity--stages" },
  { name: "roleLanes", story: "parity--role-lanes" },
  { name: "kinds", story: "parity--element-kinds" },
  { name: "secondTheme", story: "parity--second-theme" },
  { name: "hostVariables", story: "parity--host-variables" },
  { name: "rules", story: "parity--rules" },
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
    expect(svg.get(`node:${activity.id}`)!.props.fill, `${name}: the scheme's paper`).toBe(name === "hostVariables" ? "#fdf6e3" : scheme === "dark" ? "#16181d" : "#ffffff");
    if (name === "secondTheme") expect([svg, dom].map((d) => d.get(`node:${activity.id}`)!.props.outlineWidth), `${name}: the theme's outline`).toEqual(["3", "3"]);
    // The frequency cue reached what was compared: all 1,000 cases of the small P2P on its first activity, the inner width
    // 180 − 8 − 1 long; the second theme draws only the foot, inside its outline of 3.
    if (name === "small") expect([svg, dom].map((d) => [d.get("node:create_po")!.props.cue, d.get("node:create_po")!.props.cueFoot]), `${name}: the cue`).toEqual([["#e6e8ec 171", "#5f6672 171"], ["#e6e8ec 171", "#5f6672 171"]]);
    if (name === "secondTheme") expect([svg, dom].map((d) => [d.get("node:create_po")!.props.cue, d.get("node:create_po")!.props.cueFoot]), `${name}: the cue's place`).toEqual([["none", "#5f6672 169"], ["none", "#5f6672 169"]]);
    if (name === "hostVariables") await hostVariablesReached(page, theme!, toSVG(given, look), dom.get(`node:${activity.id}`)!.props);
    if (name === "rules") rulesReached({ svg, dom, canvas, png });
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

/**
 * The container's paper, ink, focus colour and font reached the theme the
 * story wrote, as literals, and from it the SVG export; the DOM map, which
 * reads the variables itself, paints its focus and writes its labels in them.
 */
async function hostVariablesReached(page: import("@playwright/test").Page, theme: Theme, svg: string, activity: Record<string, string>) {
  const colors = themeColors(theme);
  expect([colors.paper, colors.ink, colors.focus, theme.font.family], "hostVariables: the theme the container's variables resolve to").toEqual(["#fdf6e3", "#2f4f4f", "#663399", "Georgia, serif"]);
  for (const literal of ['fill="#fdf6e3"', 'fill="#2f4f4f"', 'font-family="Georgia, serif"']) expect(svg, `hostVariables: the SVG export draws ${literal}`).toContain(literal);
  for (const word of ["var(", "oklch(", "color-mix("]) expect(svg).not.toContain(word);
  expect(activity.fill).toBe("#fdf6e3");
  const drawn = await page.evaluate(() => {
    const map = document.querySelector(".wf-process-map")!;
    const probe = map.appendChild(document.createElement("span"));
    probe.style.color = "var(--wf-focus)";
    const focus = getComputedStyle(probe).color;
    probe.remove();
    return { focus, font: getComputedStyle(document.querySelector('[data-wf-part="node-label"]')!).fontFamily };
  });
  expect([paint(drawn.focus), drawn.font], "hostVariables: the DOM map's focus and font").toEqual(["#663399", "Georgia, serif"]);
}

/**
 * The theme's rules reached all four renderers: the gateway's fill and
 * outline (by kind), the manual activity's outline 2 wide with corners of 8,
 * its name at 600 in the rule's colour and its cue only as the foot, 1,234 of
 * 2,000 cases of 180 − 8 − 2 long (by tag), the re-added path's colour at half
 * its opacity and the re-added activity's fill at 0.6 (by state).
 */
function rulesReached(drawings: Record<string, Drawing>) {
  for (const [renderer, d] of Object.entries(drawings)) {
    const props = (key: string, ...names: string[]) => names.map((n) => d.get(key)?.props[n]);
    expect(props("node:split", "fill", "outline"), `rules: ${renderer} by kind`).toEqual(["#fff3c4", "#8a6d00"]);
    expect([...props("node:check", "outlineWidth", "radius", "cue", "cueFoot"), d.get("node:check")!.texts[0]], `rules: ${renderer} by tag`).toEqual(["2", "8", "none", "#5f6672 105", { text: "Check invoice", size: 13, weight: 600, paint: "#1d4ed8" }]);
    expect([...props("edge:split->readded", "outline"), ...props("node:readded", "fill")], `rules: ${renderer} by state`).toEqual(["#b42318@0.5", "#f3f4f6@0.6"]);
  }
}

/**
 * The DOM map and the Canvas map draw the rules of the interactive states
 * alike, through the core's state style: the selected activity's outline,
 * fill and name in the rules' colours (not the focus colour), and every path
 * away from it at the rule's opacity 0.2 (not the dimmed look's 0.25), while
 * the dimmed activities keep the dimmed look.
 */
test("the DOM map and the Canvas map draw the theme's rules of the interactive states alike", async ({ page }) => {
  await page.addInitScript(() => {
    const log: { op: string; text?: string; fill: unknown; stroke: unknown; alpha: number }[] = [];
    (window as unknown as { wfCanvas: typeof log }).wfCanvas = log;
    const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const op of ["fill", "stroke", "fillText"]) {
      const own = proto[op];
      proto[op] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        log.push({ op, text: op === "fillText" ? String(args[0]) : undefined, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha });
        return own.apply(this, args);
      };
    }
  });
  await page.goto("/iframe.html?id=parity--state-rules&viewMode=story");
  const label = "Check invoice";
  await expect.poll(() => page.evaluate((text) => (window as unknown as { wfCanvas: { text?: string }[] }).wfCanvas.some((e) => e.text === text), label), { timeout: 60_000 }).toBe(true);
  await expect(page.locator('.wf-process-map[data-renderer="svg"] g.wf-edge').first()).toBeVisible();
  const dom = await page.evaluate(() => {
    const map = document.querySelector('.wf-process-map[data-renderer="svg"]')!;
    const node = map.querySelector("#wf-node-check")!;
    const box = getComputedStyle(node);
    const text = getComputedStyle(node.querySelector('[data-wf-part="node-label"] > span')!);
    const dimmed = [...map.querySelectorAll('g.wf-edge[data-wf-state~="dimmed"]')].map((g) => Number(getComputedStyle(g).opacity) * Number(getComputedStyle(g.querySelector(".react-flow__edge-path")!).opacity));
    return { outline: box.borderTopColor, fill: box.backgroundColor, name: text.color, dimmed };
  });
  const canvas = await page.evaluate((text) => {
    const log = (window as unknown as { wfCanvas: { op: string; text?: string; fill: string; stroke: string; alpha: number }[] }).wfCanvas;
    const at = log.map((e) => e.text).lastIndexOf(text);
    const before = log.slice(0, at);
    return { outline: before.filter((e) => e.op === "stroke").at(-1)!.stroke, fill: before.filter((e) => e.op === "fill").at(-1)!.fill, name: log[at].fill, alphas: [...new Set(log.filter((e) => e.op === "stroke").map((e) => Number(e.alpha.toFixed(2))))].sort() };
  }, label);
  expect({ outline: paint(dom.outline), fill: paint(dom.fill), name: paint(dom.name) }, "the DOM map's selected activity").toEqual({ outline: "#c2410c", fill: "#fff7ed", name: "#7c2d12" });
  expect({ outline: paint(canvas.outline), fill: paint(canvas.fill), name: paint(canvas.name) }, "the Canvas map's selected activity").toEqual({ outline: "#c2410c", fill: "#fff7ed", name: "#7c2d12" });
  expect(dom.dimmed.length, "paths away from the selection are dimmed").toBeGreaterThan(0);
  expect(dom.dimmed.map((a) => Number(a.toFixed(2))), "the DOM map's dimmed paths").toEqual(dom.dimmed.map(() => 0.2));
  // Strokes at full opacity, the dimmed paths' at the rule's 0.2 (none at the dimmed look's 0.25), and the dimmed
  // activities' at the dimmed look's 0.35, for which the theme has no rule.
  expect(canvas.alphas, "the Canvas map's strokes").toEqual([0.2, 0.35, 1]);
});

/**
 * The live Canvas map, which reads the host's variables itself, draws the
 * activity in the paints the DOM map draws it in: its paper, its outline in
 * the focus colour (it is selected), and its name in the ink and the font.
 */
test("the live Canvas map draws a host's CSS variables as the DOM map does", async ({ page }) => {
  await page.addInitScript(() => {
    const log: { op: string; text?: string; fill: unknown; stroke: unknown; font: string }[] = [];
    (window as unknown as { wfCanvas: typeof log }).wfCanvas = log;
    const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const op of ["fill", "stroke", "fillText"]) {
      const own = proto[op];
      proto[op] = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        log.push({ op, text: op === "fillText" ? String(args[0]) : undefined, fill: this.fillStyle, stroke: this.strokeStyle, font: this.font });
        return own.apply(this, args);
      };
    }
  });
  await page.goto("/iframe.html?id=parity--host-variables-live&viewMode=story");
  const label = "Check invoice";
  await expect.poll(() => page.evaluate((text) => (window as unknown as { wfCanvas: { text?: string }[] }).wfCanvas.some((e) => e.text === text), label), { timeout: 60_000 }).toBe(true);
  const dom = await page.evaluate(() => {
    const node = document.querySelector('.wf-process-map[data-renderer="svg"] #wf-node-check')!;
    // The outline is an SVG shape where a border cannot draw it, otherwise the node's border.
    const shape = node.querySelector(":scope > .wf-node__outline > *");
    const box = getComputedStyle(shape ?? node);
    const text = getComputedStyle(node.querySelector('[data-wf-part="node-label"] > span')!);
    return { paper: shape ? box.fill : box.backgroundColor, focus: shape ? box.stroke : box.borderTopColor, ink: text.color, font: text.fontFamily };
  });
  const canvas = await page.evaluate((text) => {
    const log = (window as unknown as { wfCanvas: { op: string; text?: string; fill: string; stroke: string; font: string }[] }).wfCanvas;
    const at = log.map((e) => e.text).lastIndexOf(text);
    const before = log.slice(0, at);
    return { paper: before.filter((e) => e.op === "fill").at(-1)!.fill, focus: before.filter((e) => e.op === "stroke").at(-1)!.stroke, ink: log[at].fill, font: log[at].font };
  }, label);
  expect({ paper: paint(dom.paper), focus: paint(dom.focus), ink: paint(dom.ink), font: dom.font }, "the DOM map in the host's variables").toEqual({ paper: "#fdf6e3", focus: "#663399", ink: "#2f4f4f", font: "Georgia, serif" });
  expect({ paper: paint(canvas.paper), focus: paint(canvas.focus), ink: paint(canvas.ink), font: canvas.font.endsWith(" Georgia, serif") ? dom.font : canvas.font }, "the Canvas map in the DOM map's paints").toEqual({ paper: paint(dom.paper), focus: paint(dom.focus), ink: paint(dom.ink), font: dom.font });
});
