import { type Locator, type Page, expect, test } from "@playwright/test";

// The fonts the browser actually drew a node's text in, as Chromium reports them.
async function drawnFonts(page: Page, locator: Locator) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const marker = "data-drawn-font-probe";
  await locator.evaluate((element, name) => element.setAttribute(name, ""), marker);
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[${marker}]` });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  await locator.evaluate((element, name) => element.removeAttribute(name), marker);
  await cdp.detach();
  return fonts.map((font) => font.postScriptName).sort();
}

test("the map's text is drawn in the lane's own font, bold where bold and with digits of one width", async ({ page }) => {
  test.skip(process.platform !== "linux", "Only Linux takes its fonts from tests/visual/fonts.conf; macOS draws system-ui in its system font.");
  await page.goto("/iframe.html?id=process-map--map&viewMode=story");
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  const heading = page.locator(".wf-controls h3");
  const name = page.locator(".wf-activity-name").first();
  const counts = page.locator(".wf-activity-counts").first();
  await expect(heading).toHaveText("Detail");
  const fonts = { heading: await drawnFonts(page, heading), name: await drawnFonts(page, name), counts: await drawnFonts(page, counts) };
  test.info().annotations.push({ type: "drawn fonts", description: JSON.stringify(fonts) });
  expect(fonts).toEqual({ heading: ["LiberationSans-Bold"], name: ["LiberationSans"], counts: ["LiberationSans", "LiberationSans-Bold"] });
  // A card's count is bold beside its regular share. Counts ask for tabular digits:
  // drawn as the count is, in its font and with its numeric variant, as many ones
  // are as wide as as many eights. (A canvas cannot stand in: the computed `font`
  // shorthand is empty when a numeric variant is set, so it would measure its own
  // default font.)
  const advances = await counts.evaluate((element) => ["1111", "8888"].map((digits) => {
    const probe = element.firstElementChild!.cloneNode() as HTMLElement;
    probe.textContent = digits;
    element.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return width;
  }));
  expect(advances[0]).toBeGreaterThan(0);
  expect(advances[0]).toBe(advances[1]);
  await expect(counts).toHaveCSS("font-variant-numeric", "tabular-nums");
});
