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

/**
 * In the BPMN view, tints and hatching cover their element: a click or a hover
 * there reaches the element under them, as everywhere else on the diagram.
 */
test("a click on a task under hatching or a tint selects the task", async ({ page }) => {
  await page.goto("/iframe.html?id=bpmn--overlays-on-model&viewMode=story");
  await page.waitForSelector('[data-bpmn-status="ready"]', { timeout: 60_000 });
  const covers = ".wf-bpmn .djs-overlay > .wf-hatch, .wf-bpmn .djs-overlay > .wf-tint";
  await expect(page.locator(covers).first()).toBeAttached();
  const points = [[0.25, 0.75], [0.5, 0.5], [0.75, 0.3]];
  // At no point does a cover take the pointer.
  const taking = await page.evaluate(([selector, at]) => {
    let n = 0;
    for (const cover of document.querySelectorAll(selector as string)) {
      const r = cover.getBoundingClientRect();
      for (const [fx, fy] of at as number[][]) if (document.elementsFromPoint(r.x + r.width * fx, r.y + r.height * fy).includes(cover)) n++;
    }
    return n;
  }, [covers, points] as const);
  expect(taking).toBe(0);
  // A point of a covered task where the task itself is hit (not a panel or an arc's label); a click there selects it.
  const point = await page.evaluate(([selector, at]) => {
    for (const cover of document.querySelectorAll(selector as string)) {
      const id = cover.closest(".djs-overlays")?.getAttribute("data-container-id");
      const r = cover.getBoundingClientRect();
      for (const [fx, fy] of at as number[][]) {
        const [x, y] = [r.x + r.width * fx, r.y + r.height * fy];
        if (id && document.elementFromPoint(x, y)?.closest(".djs-element")?.getAttribute("data-element-id") === id) return { x, y };
      }
    }
    return undefined;
  }, [covers, points] as const);
  expect(point).toBeDefined();
  await page.mouse.click(point!.x, point!.y);
  await expect(page.getByTestId("bpmn-selection")).not.toContainText("selected tasks []");
});
