import { type Page, expect, test } from "@playwright/test";

/**
 * Readable at every zoom, measured in a real browser: every text the DOM map
 * of the P2P story draws, at its fitted zoom and zoomed out step by step with
 * its zoom control, is at least 9 px on the screen. A text's size on the
 * screen is its computed font size times the scale of everything around it:
 * React Flow's zoom and the stylesheet's scaling of a card's texts, a group's
 * title and a pill (`getScreenCTM` for SVG, the computed transforms of the
 * ancestors for HTML). Texts that are not rendered (a card's blocks of other
 * levels, labels shed) are left out.
 */

/** The size on the screen of every text drawn on the map, with the map's zoom and level. */
async function measured(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(".react-flow__viewport")!;
    const zoom = new DOMMatrixReadOnly(getComputedStyle(viewport).transform).a;
    const level = [...document.querySelector(".wf-process-map")!.classList].find((c) => c.startsWith("wf-text--"));
    const out: { text: string; px: number }[] = [];
    const walker = document.createTreeWalker(viewport, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement as Element | null;
      const text = node.textContent?.trim();
      if (!el || !text || el.closest("title")) continue;
      const style = getComputedStyle(el);
      // Not rendered: no box (display: none, here or above), or hidden.
      if (!el.getClientRects().length || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      let scale = 1;
      if (el instanceof SVGGraphicsElement) {
        const m = el.getScreenCTM()!;
        scale = Math.hypot(m.a, m.b);
      } else {
        for (let a: Element | null = el; a; a = a.parentElement) {
          const t = getComputedStyle(a).transform;
          if (t && t !== "none") scale *= new DOMMatrixReadOnly(t).a;
        }
      }
      out.push({ text, px: parseFloat(style.fontSize) * scale });
    }
    return { zoom, level, texts: out };
  });
}

test("no text of the DOM map is smaller than 9 px on the screen, at the fitted zoom and zoomed out", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/iframe.html?id=process-map--map&viewMode=story");
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  // The map fits itself again once React Flow has measured its nodes: wait until its zoom holds for half a second.
  let settled = NaN;
  await expect.poll(async () => {
    const before = settled;
    await page.waitForTimeout(500);
    settled = (await measured(page)).zoom;
    return settled === before;
  }, { timeout: 30_000 }).toBe(true);
  const zoomOut = page.getByRole("button", { name: "Zoom out" });
  const seen: { zoom: number; level?: string; texts: number }[] = [];
  for (let step = 0; step <= 6; step++) {
    if (step) await zoomOut.click();
    // Wait for the zoom to settle and the root to take its classes.
    await expect.poll(async () => (await measured(page)).zoom).toBeLessThan(seen.at(-1)?.zoom ?? Infinity);
    const { zoom, level, texts } = await measured(page);
    const small = texts.filter((t) => t.px < 9 - 0.01).map((t) => `"${t.text}" ${t.px.toFixed(2)} px`);
    expect(small, `zoom ${zoom.toFixed(3)} (${level})`).toEqual([]);
    seen.push({ zoom, level, texts: texts.length });
  }
  test.info().annotations.push({ type: "zooms", description: JSON.stringify(seen) });
  // The steps reach the levels without the number line and without names, and texts were measured at each.
  expect(seen.some((s) => s.level === "wf-text--box")).toBe(true);
  expect(seen[0].texts).toBeGreaterThan(0);
});
