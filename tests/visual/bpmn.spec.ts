import { expect, test } from "@playwright/test";

test("BPMN from the stage model renders on bpmn-js with lanes and gateways", async ({ page }) => {
  await page.goto("/iframe.html?id=bpmn--from-stages&viewMode=story");
  await page.waitForSelector('[data-bpmn-status="ready"]', { timeout: 60_000 });
  await expect(page.locator('.djs-element[data-element-id="clear_invoice"]')).toBeVisible();
  await expect(page.locator('.djs-element[data-element-id="Lane_order"]')).toBeAttached();
  await expect(page.locator('.djs-element[data-element-id="gw_receipt_split"]')).toBeAttached();
  await expect(page.locator(".bjs-powered-by")).toBeVisible();
  await expect(page.getByTestId("lite-counts")).toContainText("11 tasks");
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("bpmn-from-stages.png", { fullPage: false });
});

test("overlays on a model keep the viewport while the dataset switches", async ({ page }) => {
  await page.goto("/iframe.html?id=bpmn--overlays-on-model&viewMode=story");
  await page.waitForSelector('[data-bpmn-status="ready"]', { timeout: 60_000 });
  await expect(page.locator(".djs-overlay .wf-badge").first()).toBeVisible();
  await expect(page.locator(".wf-bpmn-overlays path").first()).toBeAttached();
  await expect(page.locator('.djs-element[data-element-id="Task_CreatePO"]')).toBeVisible();
  const viewbox = page.getByTestId("viewbox");
  // Refresh the initial readout after the viewer is ready; onImport can run earlier.
  await page.getByRole("button", { name: "All items", exact: true }).click();
  await expect(viewbox).toHaveText(/^viewport x -?\d+ · y -?\d+ · zoom \d+\.\d{2}$/);
  const before = await viewbox.textContent();
  await page.getByRole("button", { name: "Vendor 0128" }).click();
  await page.waitForTimeout(300);
  expect(await viewbox.textContent()).toBe(before);
  await expect(page.locator('.djs-element[data-element-id="Task_CreatePO"]')).toBeVisible();
  await page.getByRole("button", { name: "All items" }).click();
  await page.waitForTimeout(300);
  expect(await viewbox.textContent()).toBe(before);
});

test("four views of one map share positions and width scales", async ({ page }) => {
  await page.goto("/iframe.html?id=views--four-views&viewMode=story");
  await page.waitForSelector('[data-testid="views"]', { timeout: 60_000 });
  await page.waitForSelector('[data-layout-status="given"] .react-flow__node', { timeout: 60_000 });
  await expect(page.getByTestId("views")).toHaveAttribute("data-shared-width", "true");
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(4);
  const position = async () => page.locator('.react-flow__node[data-id="clear_invoice"]').evaluate((el) => (el as HTMLElement).style.transform);
  const finance = await position();
  await tabs.nth(1).click();
  await page.waitForTimeout(600);
  expect(await position()).toBe(finance);
  await page.getByRole("button", { name: "All views" }).click();
  await expect(page.locator(".wf-views__cell")).toHaveCount(4);
  await page.waitForTimeout(1200);
  await expect(page).toHaveScreenshot("views-grid.png", { fullPage: false });
});
