import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Host stylesheets against the styling contract, in the Storybook build, which
 * loads the stylesheets as `@wise/flow/style.css` ships them (in the cascade
 * layer `wf`). A host stylesheet goes in at the start of the head, before them.
 */
const UNLAYERED = readFileSync(fileURLToPath(new URL("../../src/react/style.css", import.meta.url)), "utf8");

async function openMap(page: Page) {
  await page.goto("/iframe.html?id=interaction--select-and-menu&viewMode=story");
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
}

/** An unlayered stylesheet as the first one of the page; `last` puts it after all others. */
const addSheet = (page: Page, css: string, last = false) =>
  page.evaluate(({ css, last }) => {
    const style = document.createElement("style");
    style.textContent = css;
    if (last) document.head.append(style);
    else document.head.prepend(style);
  }, { css, last });

const computed = (page: Page, selector: string, properties: string[]) =>
  page.locator(selector).first().evaluate((element, properties) => properties.map((p) => getComputedStyle(element).getPropertyValue(p)), properties);

const SELECTED = '.react-flow__node[data-id="clear_invoice"] [data-wf-part="node"]';
const OTHER = '.react-flow__node[data-id="record_goods_receipt"] [data-wf-part="node"]';
const PATH = '[data-wf-part="edge"][data-wf-kind="follows"] [data-wf-part="edge-path"]';

test("a host rule of data attributes alone, loaded before the library, outlines a selected activity and strokes a path", async ({ page }) => {
  await openMap(page);
  await page.locator('.react-flow__node[data-id="clear_invoice"]').click();
  await expect(page.locator(SELECTED)).toHaveAttribute("data-wf-state", /\bselected\b/);
  const before = { selected: await computed(page, SELECTED, ["outline-style", "outline-color"]), path: await computed(page, PATH, ["stroke", "stroke-width"]) };
  expect(before.selected[1]).not.toBe("rgb(255, 0, 255)");
  expect(before.path[0]).not.toBe("rgb(0, 128, 0)");
  await addSheet(page, `
    [data-wf-part="node"][data-wf-state~="selected"] { outline: 3px solid rgb(255, 0, 255); }
    [data-wf-part="edge-path"] { stroke: rgb(0, 128, 0); }
  `);
  expect(await computed(page, SELECTED, ["outline-style", "outline-width", "outline-color"])).toEqual(["solid", "3px", "rgb(255, 0, 255)"]);
  expect(await computed(page, OTHER, ["outline-style"])).toEqual(["none"]);
  // Only the stroke changes; the width is still the scene's.
  expect(await computed(page, PATH, ["stroke", "stroke-width"])).toEqual(["rgb(0, 128, 0)", before.path[1]]);
});

test("an unlayered reset wins over the layered stylesheet, and the unlayered stylesheet after it wins again", async ({ page }) => {
  await openMap(page);
  const node = '.react-flow__node[data-id="clear_invoice"] .wf-node';
  const border = ["border-top-width", "border-top-style"];
  expect(await computed(page, node, border)).toEqual(["2px", "solid"]);
  // The part of Tailwind 3's preflight that every element meets.
  await addSheet(page, "*, ::before, ::after { box-sizing: border-box; border-width: 0; border-style: solid; border-color: #e5e7eb; }");
  expect(await computed(page, node, border)).toEqual(["0px", "solid"]);
  // `@wise/flow/style.unlayered.css` (a copy of the source) after the reset.
  await addSheet(page, UNLAYERED, true);
  expect(await computed(page, node, border)).toEqual(["2px", "solid"]);
});

test("a focused path is drawn at least 3 wide in the focus colour", async ({ page }) => {
  await openMap(page);
  const map = page.locator(".wf-process-map");
  await map.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Alt+ArrowRight");
  await expect(map).toHaveAttribute("aria-activedescendant", /^wf-edge-/);
  const id = (await map.getAttribute("aria-activedescendant"))!;
  const [stroke, width] = await computed(page, `[id="${id}"] [data-wf-part="edge-path"]`, ["stroke", "stroke-width"]);
  const focus = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--wf-focus").trim());
  expect(stroke).toBe(`rgb(${[1, 3, 5].map((i) => parseInt(focus.slice(i, i + 2), 16)).join(", ")})`);
  expect(parseFloat(width)).toBeGreaterThanOrEqual(3);
});
