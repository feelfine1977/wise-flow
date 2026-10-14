import { expect, test } from "@playwright/test";

test("time cards keep their size with long names in both directions and both interactive renderers", async ({ page }, info) => {
  for (const direction of ["right", "down"]) for (const [format, expected] of [["previous", "3.4 d from previous"], ["next", "2 min to next"], ["both", "prev 3.4 d · next 2 min"]]) for (const renderer of ["svg", "canvas"]) {
    await page.addInitScript(() => {
      const texts: string[] = [];
      Object.assign(window, { timedTexts: texts });
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
        texts.push(text);
        return original.call(this, text, ...args);
      };
    });
    const name = `${format}-${direction}${renderer === "canvas" ? "-canvas" : ""}`;
    await page.goto(`/iframe.html?id=parity--${name}&viewMode=story`);
    if (renderer === "svg") {
      const node = page.locator('.react-flow__node[data-id="a"]');
      await expect(node).toContainText(expected);
      const box = await node.boundingBox();
      expect([box?.width, box?.height]).toEqual([180, 64]);
      await expect(node).toHaveAttribute("aria-label", /median time from previous event.*8 passages.*mean time to next event.*7 passages/);
      await expect(page.locator('.react-flow__node[data-id="s"]')).toContainText("–");
    } else {
      await expect.poll(() => page.evaluate(() => (window as unknown as { timedTexts: string[] }).timedTexts)).toContain(expected);
      const texts = await page.evaluate(() => (window as unknown as { timedTexts: string[] }).timedTexts);
      expect(texts).toContain(format === "next" ? "0 min to next" : format === "both" ? "prev < 1 min · next 0 min" : "< 1 min from previous");
    }
    await info.attach(name, { body: await page.screenshot(), contentType: "image/png" });
  }
});
