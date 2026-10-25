import { type Page, expect, test } from "@playwright/test";

/** The instrument look (WF-10): the map, the map with an activity selected, and the map pinned to the dark scheme. */
async function openStory(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
}

test("instrument map draws Start, End and their pale paths without a band on a stage-less card", async ({ page }) => {
  await openStory(page, "instrument--map");
  await expect(page.locator('[data-wf-part="edge"][data-wf-state~="start"]').first()).toBeAttached();
  await expect(page).toHaveScreenshot("instrument-map.png", { fullPage: false });
});

test("instrument map labels every path touching the selected activity with its share", async ({ page }) => {
  await openStory(page, "instrument--selected");
  await expect(page.locator(".wf-edge-label", { hasText: "%" }).first()).toBeAttached();
  await expect(page).toHaveScreenshot("instrument-selected.png", { fullPage: false });
});

test("instrument map pinned to the dark scheme draws dark on a light page", async ({ page }) => {
  await openStory(page, "instrument--dark");
  await expect(page.locator(".wf-process-map")).toHaveCSS("background-color", "rgb(21, 24, 28)");
  await expect(page).toHaveScreenshot("instrument-dark.png", { fullPage: false });
});
