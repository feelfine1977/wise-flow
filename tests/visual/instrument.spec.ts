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

test("instrument lanes head each stage band with its count and keep its name in view when panned", async ({ page }) => {
  await openStory(page, "instrument--lanes");
  await expect(page.locator('[data-wf-part="group-header"]').first()).toBeAttached();
  await expect(page).toHaveScreenshot("instrument-lanes.png", { fullPage: false });
  // Pan the map left until the first band starts left of the view: its name stays at the view's left edge.
  const pane = page.locator(".react-flow__pane");
  const box = (await pane.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 400, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const shown = await page.evaluate(() => {
    const map = document.querySelector(".wf-process-map")!.getBoundingClientRect();
    return [...document.querySelectorAll(".wf-group--band-main > .wf-group__label")].some((l) => {
      const r = l.getBoundingClientRect();
      const band = l.parentElement!.getBoundingClientRect();
      return band.left < map.left && band.right > map.left + r.width && r.left >= map.left - 1;
    });
  });
  expect(shown).toBe(true);
});

test("trace timeline draws a single case down a vertical ruler with the SRM minute as one ring", async ({ page }) => {
  await page.goto("/iframe.html?id=trace-timeline--single-case-vertical&viewMode=story");
  await page.waitForSelector('[data-wf-part="timeline-cluster"]', { timeout: 60_000 });
  await expect(page.locator('[data-wf-part="timeline-cluster"]')).toContainText("7 events · SRM: Created");
  await expect(page).toHaveScreenshot("trace-vertical.png", { fullPage: false });
});

test("instrument thumbnail draws the scene into the overview instead of card outlines", async ({ page }) => {
  await openStory(page, "instrument--thumbnail");
  await expect(page.locator('[data-testid="wf-overview-thumbnail"]')).toBeVisible();
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  await expect(page).toHaveScreenshot("instrument-thumbnail.png", { fullPage: false });
});
