import { type Page, expect, test } from "@playwright/test";

async function openStory(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
}

test("paths of a focused activity are highlighted, the rest dimmed, and listed at the side", async ({ page }) => {
  await openStory(page, "interaction--paths");
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  const map = page.locator(".wf-process-map");
  await expect(map).toHaveAttribute("data-focus", "record_invoice_receipt");
  const list = page.getByRole("region", { name: "Paths of Record Invoice Receipt" });
  await expect(list).toBeVisible();
  await expect(list).toHaveAttribute("data-source", "payload");
  await expect(list.locator("tbody tr[data-edge]").first()).toBeVisible();
  expect(await page.locator(".wf-node--dimmed").count()).toBeGreaterThan(0);
  await expect(page.locator('[data-id="record_invoice_receipt"] .wf-node')).not.toHaveClass(/wf-node--dimmed/);
  await expect(page).toHaveScreenshot("paths-for-activity.png", { fullPage: false });
  // A row selects its path on the map.
  await list.locator("tbody tr[data-edge]").first().click();
  await expect(page.locator(".react-flow__edge.selected")).toHaveCount(1);
});

test("stage lanes render the stage groups as ordered bands along the flow", async ({ page }) => {
  await openStory(page, "layout--stage-lanes");
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  await expect(page.locator(".wf-process-map")).toHaveAttribute("data-lanes", "stages");
  const bands = page.locator(".wf-group--band");
  expect(await bands.count()).toBeGreaterThanOrEqual(4);
  const lefts = await bands.evaluateAll((els) => els.map((el) => (el.parentElement as HTMLElement).getBoundingClientRect().left));
  const sorted = [...lefts].sort((a, b) => a - b);
  expect(lefts).toEqual(sorted);
  await expect(page).toHaveScreenshot("stage-lanes.png", { fullPage: false });
  await page.getByLabel("none").check();
  await expect(page.locator(".wf-group--band")).toHaveCount(0);
  await expect(page.locator(".wf-group").first()).toBeVisible();
});

test("the actions menu opens on a right click and with Enter, and is fully keyboard-operable", async ({ page }) => {
  await openStory(page, "interaction--select-and-menu");
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  const node = page.locator('.react-flow__node[data-id="clear_invoice"]');
  await node.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu).toContainText("Actions for Clear Invoice");
  await expect(page.getByRole("menuitem")).toHaveCount(8);
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("o");
  await expect(menu).toBeHidden();
  await expect(page.getByTestId("last-action")).toHaveText("profile on Clear Invoice");
  // Keyboard only: focus the map, move to an activity, open the menu with Enter, close with Escape.
  const map = page.locator(".wf-process-map");
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await expect(map).toHaveAttribute("aria-activedescendant", /^wf-node-/);
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(map).toBeFocused();
  // Shift-click makes a pair; the menu offers the pair actions.
  await page.locator('.react-flow__node[data-id="record_goods_receipt"]').click();
  await node.click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("selection")).toContainText("Record Goods Receipt, Clear Invoice");
  await node.click({ button: "right" });
  await expect(menu).toContainText("Actions for Clear Invoice and Record Goods Receipt");
  await page.keyboard.press("Escape");
});

test("filter chips show the clauses with cases in and out and the map calls back on changes", async ({ page }) => {
  await openStory(page, "interaction--filters");
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  await expect(page.locator(".wf-filter-chip")).toHaveCount(2);
  await expect(page.getByTestId("wf-filters-count")).toContainText("of 251,734 cases");
  await page.locator('.react-flow__node[data-id="clear_invoice"]').click({ button: "right" });
  await page.keyboard.press("f");
  await expect(page.locator(".wf-filter-chip")).toHaveCount(3);
  await expect(page.getByTestId("filter-count")).toContainText("cases with Clear Invoice");
  await page.getByRole("button", { name: /Remove filter: case start/ }).click();
  await expect(page.locator(".wf-filter-chip")).toHaveCount(2);
  await expect(page.getByTestId("filter-json")).not.toContainText('"time"');
});

test("a map above the element threshold is drawn on the canvas with hover and the actions menu", async ({ page }) => {
  await page.goto("/iframe.html?id=canvas--large-map&viewMode=story");
  const map = page.locator(".wf-process-map");
  await expect(map).toHaveAttribute("data-renderer", "canvas", { timeout: 60_000 });
  await expect(page.getByTestId("canvas-renderer")).toHaveText("renderer: canvas");
  await expect(page.getByTestId("canvas-size")).toContainText("5,000 activities");
  const canvas = page.locator(".wf-canvas-map canvas");
  await expect(canvas).toBeAttached();
  await page.waitForTimeout(500);
  // The hidden element list serves assistive technology; the first activity is described.
  const first = page.locator('[data-testid="wf-canvas-descendants"] [data-id="a_0_0"]');
  await expect(first).toHaveAttribute("aria-label", /Activity 1\.1, activity/);
  // Home focuses the first activity and centres it; zoom in, then hover it: the tooltip carries its description.
  await map.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 12; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(300);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.waitForTimeout(200);
  await expect(page.getByRole("tooltip")).toContainText("Activity 1.1");
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: "right" });
  await expect(page.getByRole("menu")).toContainText("Actions for Activity 1.1");
  await page.keyboard.press("Escape");
});
