import { type Page, expect, test } from "@playwright/test";

async function openStory(page: Page, id: string) {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector(".react-flow__node", { timeout: 60_000 });
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
}

test("P2P map story renders the fixture with overlays", async ({ page }) => {
  await openStory(page, "process-map--map");
  await expect(page.locator(".react-flow__node")).not.toHaveCount(0);
  await expect(page.locator(".wf-badge").first()).toBeVisible();
  await expect(page.locator(".wf-overlay-layer path").first()).toBeAttached();
  await expect(page.locator(".wf-legend")).toBeVisible();
  await expect(page).toHaveScreenshot("p2p-map.png", { fullPage: false });
});

test("stable layout story keeps shared activities at identical positions", async ({ page }) => {
  await openStory(page, "stable-layout--union");
  const check = page.getByTestId("position-check");
  await expect(check).toHaveAttribute("data-moved", "0");
  await expect(page).toHaveScreenshot("stable-layout.png", { fullPage: false });
});
