import { type Page, expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * What the map and its panels draw, as computed styles: for every element of
 * a set of stories and interaction states, the properties that paint it. The
 * expected values were recorded once from the stylesheet and components before
 * the library's CSS moved into a cascade layer and the inline paints moved into
 * classes; the test proves that this move draws nothing differently. They were
 * recorded again when nodes and groups began to be drawn from their marks:
 * nodes cast no shadow and their texts take their size and weight from the
 * mark (a stage's count is no longer semibold, and the node itself no longer
 * sets a font size its descendants inherit); an event's radius is its mark's
 * 18px where it was 50% of its 36px box; a box group draws its dashed outline
 * as an SVG rectangle (`svg.wf-group__outline`) instead of a border; a group
 * covered by a tint keeps its own tint below it; a band sets the border style
 * of all four sides and the width of the two it outlines. They were recorded
 * once more when the legend began to list only the kinds of marks the map
 * draws: the legends of the stage map, the overlay catalogue and the BPMN view
 * lost their row for re-added paths (a `dd` and its glyph), which those maps do
 * not draw; every other element is the same. They were recorded once more
 * when paths began to be drawn in the grey of their count and deviations in
 * the one accent: paths, arcs, badges, chips, self-loops and tints changed
 * their paints, arcs and badges gained their label pills, groups lost their
 * dash, and activities, groups, legend swatches and table swatches took the
 * six-colour stage palette and its pattern twins (compared with every story
 * of the old and the new build in both schemes). They were recorded once more
 * when activities became cards and the token table's sizes, weights, radii
 * and strokes moved onto their scales: activities and stages are cards (a
 * 1px outline in the strong line colour, corners of 4, the frequency cue's
 * two spans, the name's lines and the number line with the cases semibold and
 * the share muted), hovered nodes are outlined in the ink with their fill
 * kept, groups are hairlines without a tint with a muted title, the dot grid
 * behind the map is gone, every font is the system stack and every text 11,
 * 13 or 15px at 400 to 600, and the hovered and right-clicked activity is
 * "Record Invoice Receipt", since the legend now covers "Clear Invoice" at the
 * fitted view. Tables, the timeline, the Canvas map and the BPMN view have
 * their elements as before, in the new font and text sizes. They were recorded
 * once more when the legend became a key and the numbers honest: the legends
 * (a line naming the measure, the stages flowing side by side by their labels,
 * the keys in a row that wraps, one per badge glyph and for the start and the
 * end), the paths' stroke widths, now their cases, and the colours of the
 * stages Purchase order, Invoice and Payment wherever they are painted changed.
 * They were recorded once more when the controls became one set: React Flow's
 * controls are gone and every map, the Canvas map and the BPMN view draw one
 * zoom control (icon buttons, the current zoom), the legend is a one-line
 * strip until it is expanded, buttons are paper with the control radius (a
 * pressed one in the pressed colour), the sliders are drawn from the tokens
 * and their readouts say what they keep, tooltips (the timeline's too) are
 * panels, the tables have the paper as their ground, React Flow's attribution
 * has none of its own, and the hovered and right-clicked activity is "Clear
 * Invoice" again, which the legend no longer covers at the fitted view.
 * They were recorded once more when path width took one scale per graph: only
 * the paths' stroke widths changed, and the legend's width samples, each a
 * stroke span with its value inside a span of its own
 * (`span.wf-legend__sample`, `span.wf-legend__stroke`), so that the samples
 * wrap whole and keep their length. They were recorded once more when paths
 * began to end in a head that grows with the line: a path's `marker-end` is
 * the map's marker of its head's size (`#wf-edge-arrow-12`, …) in the map's
 * definitions (`svg.wf-mark-defs`, a `defs` with a `marker` and its `path`
 * per size), where it was one of React Flow's markers per colour
 * (`svg.react-flow__marker`, `marker.react-flow__arrowhead` and its
 * `polyline`); every other element is the same. They were recorded once more
 * when the record began to hold only the elements inside the library's roots and
 * every form control took its colours from the tokens: the elements a story draws
 * around the library (its frame, captions, its own select, check boxes, buttons
 * and table) are gone from the record, the detail sliders' text, border and
 * outline colour is the ink and the line-strong colour where it was the browser's
 * (#9d968e on Linux, #101010 on macOS), and the check box's the ink where it was
 * the browser's black; every other element is the same. They were recorded
 * once more when the abstraction panel became the detail panel and the
 * stories opened at detail shares: the panel's sliders each with their named
 * ends and their statement (`div.wf-controls__slider`, `div.wf-controls__ends`,
 * `p.wf-controls__statement`, the kept paths' button `.wf-controls__kept`),
 * a disclosure listing the marks not shown (`details.wf-controls__note--marks`)
 * where the map hides some, and no check box or `output`; on the whole log the
 * paths that keep an activity on a way from start to end instead of the
 * re-added ones (41 paths where there were 38: two re-added paths gone, five
 * kept ones added, five that were re-added and dashed now solid, and 26 more
 * in another shade, as the grey runs over the counts of the paths shown); in
 * the vendor's tables three more rows. After the right click on
 * "Clear Invoice" the pointer rests on the menu's first item, which the
 * record held before. Every other element is the same.
 * They were recorded once more when the map began to keep its texts readable
 * at every zoom. Matched element by element, every element the record held is
 * there with the same computed styles, except that what a story's zoom sheds
 * is not displayed (`display: none`): paths' labels, self-loop labels, the
 * labels of events, gateways and notes, and a card's own block of texts
 * where the map's level shows another (the P2P map, its lanes, the selection,
 * hover, focus and filter states at the name level; the overlays at the full
 * level scaled up; the paths, narrowed by their list, at the box level, where
 * the stages' titles go too). New elements: an arc's pill and
 * label in a group (`g.wf-arc-pill`) and an element's badges in a row
 * (`g.wf-pill-row`). The stage view and the table in the map draw at a zoom
 * where nothing is shed. Texts and pills are scaled up with `transform`,
 * which the record does not hold; `readable.spec.ts` measures it. A card's
 * blocks of the other levels are left out of the record (`LEVELS`): how many
 * lines they hold depends on the font.
 * They were recorded again for readable opening: the map, lanes, paths and
 * Canvas scenes gain the overview's five elements; the DOM roots carry the
 * full readable level at 0.75 instead of their fitted levels. The 38 path
 * labels in each DOM scene regain visibility from the LOD class (the readable
 * classes still shed their texts below the floor). Matching the existing
 * elements after removing each overview subtree, every other style is equal.
 * Selection/menu, focus, hover and filters explicitly open fitted and their
 * records stay identical.
 * They were recorded once more when the map began to say the part in view:
 * the map, lanes, paths and Canvas scenes gain the controls' note of what is
 * in view (`p.wf-controls__note--in-view`) and the overview's spoken name of
 * the part in view (a `span.wf-sr-only`). Matching the existing elements in
 * every scene, no style of another element changed. Geometry
 * that depends on the fonts of the machine (widths, heights, positions) is left
 * out, so the record holds on every operating system.
 */
const RECORD = fileURLToPath(new URL("./computed-styles.json", import.meta.url));

const PROPERTIES = [
  "display", "visibility", "opacity", "position", "z-index", "box-sizing", "overflow-x", "overflow-y",
  "color", "background-color", "background-image",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "outline-style", "outline-width", "outline-color", "outline-offset", "box-shadow",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-transform", "text-align", "white-space", "font-variant-numeric", "text-decoration-line",
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "stroke-linejoin", "paint-order", "marker-end",
  "cursor", "pointer-events", "mix-blend-mode", "accent-color",
];

interface Scene {
  name: string;
  story: string;
  map?: boolean;
  act?: (page: Page) => Promise<void>;
}

const SCENES: Scene[] = [
  { name: "map", story: "process-map--map", map: true },
  { name: "stages", story: "process-map--stages", map: true },
  { name: "overlays", story: "overlays--all", map: true },
  { name: "lanes", story: "layout--stage-lanes", map: true },
  {
    name: "selected, hovered and the menu",
    story: "interaction--select-and-menu",
    map: true,
    act: async (page) => {
      await page.locator('.react-flow__node[data-id="record_goods_receipt"]').click();
      await page.locator('.react-flow__node[data-id="clear_invoice"]').click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
      // The menu opens kept inside the map, over the pointer where the activity lies near the map's edge: the
      // pointer rests on its first item, so that the item hovered does not depend on how far down the story's
      // own text pushes the map.
      await page.getByRole("menuitem").first().hover();
    },
  },
  {
    name: "focused by keyboard",
    story: "interaction--select-and-menu",
    map: true,
    act: async (page) => {
      await page.locator(".wf-process-map").focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.locator(".wf-process-map")).toHaveAttribute("aria-activedescendant", /^wf-node-/);
      await expect(page.locator(".wf-node--focused")).toHaveCount(1);
    },
  },
  {
    name: "hovered",
    story: "interaction--select-and-menu",
    map: true,
    act: async (page) => {
      await page.mouse.move(0, 0);
      await page.locator('.react-flow__node[data-id="clear_invoice"]').hover();
      await expect(page.locator('.react-flow__node[data-id="clear_invoice"] .wf-node--hovered')).toHaveCount(1);
    },
  },
  {
    name: "paths, dimmed and a selected path",
    story: "interaction--paths",
    map: true,
    act: async (page) => {
      await page.getByRole("region", { name: "Paths of Record Invoice Receipt" }).locator("tbody tr[data-edge]").first().click();
      await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
    },
  },
  { name: "filters", story: "interaction--filters", map: true },
  { name: "tables", story: "table-alternative--tables" },
  { name: "table in the map", story: "table-alternative--inside-map" },
  {
    name: "timeline",
    story: "trace-timeline--anchored",
    act: async (page) => {
      await page.locator(".wf-trace-timeline .wf-event").first().hover();
      await expect(page.locator(".wf-trace-timeline .wf-tooltip")).toBeVisible();
    },
  },
  { name: "timeline table", story: "trace-timeline--table" },
  { name: "canvas", story: "canvas--p-2-p-on-canvas", map: true },
  {
    name: "bpmn",
    story: "bpmn--overlays-on-model",
    act: async (page) => {
      await expect(page.locator('[data-bpmn-status="ready"]')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(500);
    },
  },
];

/**
 * The library's roots: what its components render carries a part of the styling contract (`data-wf-part`), the
 * BPMN view its status (`data-bpmn-status`). What a story draws around them (a frame, a caption, its own inputs,
 * buttons and a table in the library's classes) is not the library's and takes the browser's defaults or the
 * story's, which differ by system (the default font is "Times New Roman" on Linux and "Times" on macOS), so it is
 * not compared.
 */
const ROOTS = "[data-wf-part], [data-bpmn-status]";

/**
 * A card's blocks of texts for the levels of detail below its own: their lines are fitted by the text measure for a
 * larger size, so how many there are depends on the font, as geometry does. Left out; `readable.spec.ts` measures them.
 */
const LEVELS = ".wf-copy--full, .wf-copy--name, .wf-copy--line";

/** Each element inside the library's roots as its tag, classes and id, with the values of its computed style in the order of `PROPERTIES` (bpmn-js names its markers at random). */
async function computedStyles(page: Page, properties: string[]): Promise<[string, string][]> {
  return page.evaluate(({ properties, roots, levels }) => {
    const root = document.querySelector("#storybook-root")!;
    return [...root.querySelectorAll("*")].filter((element) => element.closest(roots) && !element.closest(levels)).map((element) => {
      const style = getComputedStyle(element);
      const name = `${element.tagName.toLowerCase()}${[...element.classList].filter((c) => c.startsWith("wf-") || c.startsWith("react-flow__")).map((c) => `.${c}`).join("")}${element.getAttribute("data-id") ? `[${element.getAttribute("data-id")}]` : ""}`;
      return [name, properties.map((p) => style.getPropertyValue(p).replace(/#marker-[a-z0-9]+/, "#marker")).join("; ")] as [string, string];
    });
  }, { properties, roots: ROOTS, levels: LEVELS });
}

/** An element's name without the classes that carry the paints of marks, which name no element. */
const named = (element: string) => element.replace(/\.wf-(fill|stroke)-[a-z-]+/g, "");

/** The record: every distinct style once, and per scene each element with the index of its style. */
interface Record {
  styles: string[];
  scenes: { [scene: string]: string[] };
}

/** Opens the scene's story in its state. */
async function open(page: Page, scene: Scene) {
  // A pointer left over the map by the previous scene would hover what is drawn under it.
  await page.mouse.move(0, 0);
  await page.goto(`/iframe.html?id=${scene.story}&viewMode=story`);
  await settle(page, scene);
}

/** Waits until the scene's map is laid out and drawn. */
async function settle(page: Page, scene: Scene) {
  if (scene.map) await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  else await page.waitForSelector("#storybook-root *", { state: "attached" });
  await page.waitForTimeout(800);
}

/** The elements of a scene whose computed style differs from the record, each with the properties that differ. */
function changes(expected: Record, scene: string, after: [string, string][]): string[] {
  const before = expected.scenes[scene].map((line) => {
    const cut = line.lastIndexOf(" ");
    return [line.slice(0, cut), expected.styles[Number(line.slice(cut + 1))]];
  });
  expect(after.map(([element]) => named(element)), `${scene}: the elements`).toEqual(before.map(([element]) => element));
  return after.flatMap(([element, style], i) => {
    if (style === before[i][1]) return [];
    const was = before[i][1].split("; ");
    return [`${i} ${element}: ${style.split("; ").flatMap((value, p) => (value === was[p] ? [] : [`${PROPERTIES[p]}: ${value} (was ${was[p]})`])).join("; ")}`];
  });
}

const readRecord = (): Record => JSON.parse(readFileSync(RECORD, "utf8"));

test("the map and its panels draw the computed styles they drew before", async ({ page }) => {
  test.setTimeout(300_000);
  const record = process.env.FLOW_RECORD_STYLES === "1";
  const actual: { [scene: string]: [string, string][] } = {};
  for (const scene of SCENES) {
    await open(page, scene);
    await scene.act?.(page);
    actual[scene.name] = await computedStyles(page, PROPERTIES);
  }
  if (record) {
    const styles = [...new Set(Object.values(actual).flatMap((elements) => elements.map(([, style]) => style)))];
    const scenes = Object.fromEntries(Object.entries(actual).map(([name, elements]) => [name, elements.map(([element, style]) => `${named(element)} ${styles.indexOf(style)}`)]));
    writeFileSync(RECORD, JSON.stringify({ styles, scenes } satisfies Record, null, 1) + "\n");
    return;
  }
  const expected = readRecord();
  for (const scene of SCENES) {
    const changed = changes(expected, scene.name, actual[scene.name]);
    expect(changed.slice(0, 8), `${scene.name}: elements whose computed style changed (first eight of ${changed.length})`).toEqual([]);
  }
});

test("what a story draws outside the library's roots is not compared: in another font and colour the record holds", async ({ page }) => {
  test.setTimeout(300_000);
  const expected = readRecord();
  for (const scene of SCENES) {
    await open(page, scene);
    // The page and every element of the story outside the library's roots in a font and colour of their own, as
    // another system's defaults would draw them; and one more such element, before the library's first root.
    const outside = await page.evaluate((roots) => {
      const story = document.querySelector("#storybook-root")!;
      const elements = [document.body, story, ...story.querySelectorAll("*")].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.closest(roots));
      for (const el of elements) el.style.setProperty("font-family", '"Courier New", monospace');
      for (const el of elements) el.style.setProperty("color", "rgb(128, 0, 128)");
      const first = story.querySelector(roots)!;
      const note = first.parentElement!.insertBefore(document.createElement("small"), first);
      note.textContent = "A note of the story";
      note.style.setProperty("font-family", "fantasy");
      note.style.setProperty("position", "absolute");
      return [...elements, note].map((el) => getComputedStyle(el).fontFamily);
    }, ROOTS);
    expect(outside.length, `${scene.name}: elements outside the library`).toBeGreaterThan(2);
    expect(outside.filter((font) => font === '"Courier New", monospace' || font === "fantasy")).toEqual(outside);
    // The story reflows in the other font, and the map draws its paths again.
    await settle(page, scene);
    await scene.act?.(page);
    const changed = changes(expected, scene.name, await computedStyles(page, PROPERTIES));
    expect(changed.slice(0, 8), `${scene.name}: elements whose computed style changed (first eight of ${changed.length})`).toEqual([]);
  }
});
