import { expect, test } from "@playwright/test";

/**
 * The paths the DOM map draws at a small zoom, in a real browser: the P2P
 * log with every path selected, at the story's fixed zoom of 0.1, draws the
 * 86 lines the rule lets through (a line at least half a pixel wide on the
 * screen, or keeping an activity between the start and the end; counted in
 * the core's tests, the same at any layout) and says so; zooming in with the
 * zoom control never draws fewer, and from 0.5 draws all 656 and no note.
 */
test("draws only the paths that can be told apart at a small zoom, and more as it zooms in", async ({ page }) => {
  await page.goto("/iframe.html?id=process-map--paths-at-a-small-zoom&viewMode=story");
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  const lines = () => page.locator(".react-flow__edge").count();
  const note = page.getByTestId("wf-edge-note");
  await expect(note).toHaveText("Showing 107 of 677 flows", { timeout: 30_000 });
  expect(await lines()).toBe(86);
  await expect(page.locator(".wf-controls__note--drawn")).toHaveText("677 selected · 107 drawn at this zoom");
  // Nine steps of 1.2 reach 0.52: every step at rest draws at least as many lines as the one before.
  let before = 86;
  for (let step = 0; step < 9; step++) {
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(600);
    const now = await lines();
    expect(now, `step ${step + 1}`).toBeGreaterThanOrEqual(before);
    before = now;
  }
  expect(before).toBe(656);
  await expect(note).toHaveCount(0);
});
