import { type Page, expect, test } from "@playwright/test";

/**
 * The detail panel in a real browser: moving "Activities" to the left by
 * keyboard draws fewer activities and fewer paths at each step, leaves the
 * "Paths" thumb where it is and rewrites its statement, on the whole log and
 * on the comparison of a vendor with it.
 */

async function open(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
}

/** What the map draws: its activity cards and its paths. */
const drawn = (page: Page) =>
  page.evaluate(() => ({
    activities: document.querySelectorAll('[data-wf-part="node"][data-wf-kind="activity"]').length,
    paths: document.querySelectorAll('[data-wf-part="edge"][data-wf-kind="follows"]').length,
  }));

/** What the map draws once its layout is in place and its cards and paths have stopped changing: two reads alike, a quarter second apart. */
async function settled(page: Page) {
  let last = "";
  await expect
    .poll(
      async () => {
        const status = await page.locator(".wf-process-map").getAttribute("data-layout-status");
        const now = await drawn(page);
        const key = `${status} ${now.activities} ${now.paths}`;
        const still = key === last && (status === "ready" || status === "given") && now.paths > 0;
        last = key;
        return still;
      },
      { intervals: [250], timeout: 60_000 },
    )
    .toBe(true);
  return drawn(page);
}

for (const id of ["process-map--map", "process-map--diff"]) {
  test(`${id}: each step of Activities to the left draws fewer activities and paths, and Paths stays`, async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, id);
    const activities = page.getByRole("slider", { name: "Activities" });
    const paths = page.getByRole("slider", { name: "Paths" });
    const thumb = await paths.inputValue();
    let before = await settled(page);
    expect(before.activities).toBeGreaterThan(4);
    for (let step = 0; step < 4; step++) {
      const [value, statement] = [await activities.inputValue(), await paths.getAttribute("aria-valuetext")];
      await activities.focus();
      await page.keyboard.press("ArrowLeft");
      await expect(activities).not.toHaveValue(value);
      // The map draws the new selection once its layout is in place.
      await expect.poll(async () => (await drawn(page)).activities, { timeout: 60_000 }).toBeLessThan(before.activities);
      const now = await settled(page);
      expect(now.activities, `step ${step + 1}`).toBeLessThan(before.activities);
      expect(now.paths, `step ${step + 1}`).toBeLessThan(before.paths);
      // The paths' thumb has not moved; their statement says what the fewer activities leave.
      await expect(paths).toHaveValue(thumb);
      expect(await paths.getAttribute("aria-valuetext")).not.toBe(statement);
      before = now;
    }
  });
}
