import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const story of [
  { id: "table-alternative--tables", root: ".wf-table" },
  { id: "trace-timeline--table", root: ".wf-trace-timeline" },
]) {
  test(`${story.id}: accessible tables`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
    await expect(page.locator(story.root)).toBeVisible();
    const result = await new AxeBuilder({ page }).include(story.root).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await testInfo.attach("accessibility", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    expect(result.violations).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("the graph table is usable by keyboard without opening the map", async ({ page }) => {
  await page.goto("/iframe.html?id=table-alternative--tables&viewMode=story");
  const row = page.locator('.wf-table tbody tr[tabindex="0"]').first();
  await row.focus();
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(row).toHaveClass(/wf-row--selected/);
});

test("paged tables keep their rows, search and pages accessible", async ({ page }, testInfo) => {
  await page.goto("/iframe.html?id=table-alternative--paged&viewMode=story");
  const tables = page.locator(".wf-table");
  await expect(tables).toBeVisible();
  const first = page.locator(".wf-table table").first();
  await expect(first.locator("tbody tr")).toHaveCount(10);
  await page.getByRole("button", { name: "Next rows" }).first().click();
  await expect(first.locator("tbody tr").first()).toHaveAttribute("aria-rowindex", "12");
  await page.getByRole("searchbox", { name: "Search the tables" }).fill("invoice");
  await expect(first.locator("tbody tr").first()).toHaveAttribute("aria-rowindex", "2");
  const result = await new AxeBuilder({ page }).include(".wf-table").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  await testInfo.attach("accessibility", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
  expect(result.violations).toEqual([]);
});
