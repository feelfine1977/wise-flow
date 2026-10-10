import { expect, test } from "@playwright/test";

/**
 * Paint order of the React Flow map in a real browser: along every constraint
 * arc, the elements under a point (topmost first) put an activity above the
 * arc and the arc above a path, so a crossing never hides a node or its badge.
 */
test("constraint arcs lie above the paths and below the activities", async ({ page }) => {
  await page.goto("/iframe.html?id=process-map--map&viewMode=story");
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"]', { timeout: 60_000 });
  await expect(page.locator('.react-flow__edgelabel-renderer [data-overlay-id^="arc:"]').first()).toBeAttached();
  const seen = await page.evaluate(() => {
    const counts = { nodeOverArc: 0, arcOverNode: 0, arcOverPath: 0, pathOverArc: 0 };
    for (const path of document.querySelectorAll<SVGPathElement>('[data-overlay-id^="arc:"] path:first-of-type')) {
      const matrix = path.getScreenCTM();
      if (!matrix) continue;
      const length = path.getTotalLength();
      for (let i = 0; i <= 200; i++) {
        const p = path.getPointAtLength((length * i) / 200).matrixTransform(matrix);
        const stack = document.elementsFromPoint(p.x, p.y);
        const arc = stack.findIndex((el) => el === path);
        if (arc < 0) continue;
        const node = stack.findIndex((el) => el.closest(".react-flow__node:not(.react-flow__node-wfGroup)"));
        const edge = stack.findIndex((el) => el.classList.contains("react-flow__edge-path") || el.closest(".react-flow__edge"));
        if (node >= 0) counts[node < arc ? "nodeOverArc" : "arcOverNode"]++;
        if (edge >= 0) counts[edge < arc ? "pathOverArc" : "arcOverPath"]++;
      }
    }
    return counts;
  });
  // Every arc starts and ends on an activity, and many cross a path.
  expect(seen.nodeOverArc).toBeGreaterThan(0);
  expect(seen.arcOverPath).toBeGreaterThan(0);
  expect(seen.arcOverNode).toBe(0);
  expect(seen.pathOverArc).toBe(0);
});
