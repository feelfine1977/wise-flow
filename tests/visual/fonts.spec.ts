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
  // A card shows the block of texts of the map's level of detail; the others are not drawn.
  const name = page.locator(".wf-activity-name:visible").first();
  const counts = page.locator(".wf-activity-counts:visible").first();
  await expect(heading).toHaveText("Detail");
  // Fitted, the map is too small for the cards' number lines, which the level of detail sheds: once the map has fitted
  // itself to its measured nodes (its zoom holds for half a second), zoomed in until they show.
  const zoom = () => page.locator(".react-flow__viewport").evaluate((el) => getComputedStyle(el).transform);
  let fitted = "";
  await expect.poll(async () => {
    const before = fitted;
    await page.waitForTimeout(500);
    fitted = await zoom();
    return fitted === before;
  }, { timeout: 30_000 }).toBe(true);
  const zoomIn = page.getByRole("button", { name: "Zoom in" });
  await expect(async () => {
    if (!(await counts.count())) await zoomIn.click();
    expect(await counts.count()).toBe(1);
  }).toPass({ timeout: 30_000 });
  const fonts = { heading: await drawnFonts(page, heading), name: await drawnFonts(page, name), counts: await drawnFonts(page, counts) };
  test.info().annotations.push({ type: "drawn fonts", description: JSON.stringify(fonts) });
  expect(fonts).toEqual({ heading: ["LiberationSans-Bold"], name: ["LiberationSans"], counts: ["LiberationSans", "LiberationSans-Bold"] });
  // A card's count is bold beside its regular share. Both are drawn with digits of one width: each in its own font,
  // numeric variant and kerning, set at 100px outside the map so that neither the zoom the story fits to nor hinting
  // at a few pixels decides, draws as many ones as wide as as many eights and noughts. A face with proportional digits
  // fails (FreeSans Bold with proportional-nums: 168 against 233.2px), and so does one whose ones kern unless the
  // counts turn kerning off (Liberation Sans 2 Bold: 205.9 against 222.5px). (A canvas cannot stand in: the computed `font`
  // shorthand is empty when a numeric variant is set.)
  const advances = await counts.evaluate((element) => Array.from(element.children, (run) => {
    const drawn = getComputedStyle(run);
    const probe = document.createElement("span");
    for (const name of ["fontFamily", "fontWeight", "fontStyle", "fontStretch", "fontVariantNumeric", "fontKerning", "fontFeatureSettings", "letterSpacing"] as const) {
      probe.style[name] = drawn[name];
    }
    probe.style.fontSize = "100px";
    probe.style.whiteSpace = "pre";
    document.body.append(probe);
    const widths = ["1111", "8888", "0000"].map((digits) => {
      probe.textContent = digits;
      return probe.getBoundingClientRect().width;
    });
    probe.remove();
    return widths;
  }));
  test.info().annotations.push({ type: "digit advances at 100px", description: JSON.stringify(advances) });
  // The count and its share.
  expect(advances).toHaveLength(2);
  for (const widths of advances) {
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[0]).toBe(widths[1]);
    expect(widths[2]).toBe(widths[1]);
  }
  await expect(counts).toHaveCSS("font-variant-numeric", "tabular-nums");
  await expect(counts).toHaveCSS("font-kerning", "none");
});
