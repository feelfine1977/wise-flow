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
 * not draw; every other element is the same. Geometry
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

/** Each element as its tag, classes and id, with the values of its computed style in the order of `PROPERTIES` (bpmn-js names its markers at random). */
async function computedStyles(page: Page, properties: string[]): Promise<[string, string][]> {
  return page.evaluate((properties) => {
    const root = document.querySelector("#storybook-root")!;
    return [...root.querySelectorAll("*")].map((element) => {
      const style = getComputedStyle(element);
      const name = `${element.tagName.toLowerCase()}${[...element.classList].filter((c) => c.startsWith("wf-") || c.startsWith("react-flow__")).map((c) => `.${c}`).join("")}${element.getAttribute("data-id") ? `[${element.getAttribute("data-id")}]` : ""}`;
      return [name, properties.map((p) => style.getPropertyValue(p).replace(/#marker-[a-z0-9]+/, "#marker")).join("; ")] as [string, string];
    });
  }, properties);
}

/** An element's name without the classes that carry the paints of marks, which name no element. */
const named = (element: string) => element.replace(/\.wf-(fill|stroke)-[a-z-]+/g, "");

/** The record: every distinct style once, and per scene each element with the index of its style. */
interface Record {
  styles: string[];
  scenes: { [scene: string]: string[] };
}

test("the map and its panels draw the computed styles they drew before", async ({ page }) => {
  test.setTimeout(300_000);
  const record = process.env.FLOW_RECORD_STYLES === "1";
  const actual: { [scene: string]: [string, string][] } = {};
  for (const scene of SCENES) {
    // A pointer left over the map by the previous scene would hover what is drawn under it.
    await page.mouse.move(0, 0);
    await page.goto(`/iframe.html?id=${scene.story}&viewMode=story`);
    if (scene.map) await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
    else await page.waitForSelector("#storybook-root *");
    await page.waitForTimeout(800);
    await scene.act?.(page);
    actual[scene.name] = await computedStyles(page, PROPERTIES);
  }
  if (record) {
    const styles = [...new Set(Object.values(actual).flatMap((elements) => elements.map(([, style]) => style)))];
    const scenes = Object.fromEntries(Object.entries(actual).map(([name, elements]) => [name, elements.map(([element, style]) => `${named(element)} ${styles.indexOf(style)}`)]));
    writeFileSync(RECORD, JSON.stringify({ styles, scenes } satisfies Record, null, 1) + "\n");
    return;
  }
  const expected: Record = JSON.parse(readFileSync(RECORD, "utf8"));
  for (const scene of SCENES) {
    const before = expected.scenes[scene.name].map((line) => {
      const cut = line.lastIndexOf(" ");
      return [line.slice(0, cut), expected.styles[Number(line.slice(cut + 1))]];
    });
    const after = actual[scene.name];
    expect(after.map(([element]) => named(element)), `${scene.name}: the elements`).toEqual(before.map(([element]) => element));
    const changed = after.flatMap(([element, style], i) => {
      if (style === before[i][1]) return [];
      const was = before[i][1].split("; ");
      return [`${i} ${element}: ${style.split("; ").flatMap((value, p) => (value === was[p] ? [] : [`${PROPERTIES[p]}: ${value} (was ${was[p]})`])).join("; ")}`];
    });
    expect(changed.slice(0, 8), `${scene.name}: elements whose computed style changed (first eight of ${changed.length})`).toEqual([]);
  }
});
