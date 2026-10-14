import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { type FlowGraph, type Positions, type ShownEdges, lineEnd, readableAt, toSVG } from "../../src/index";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { recordingContext } from "./parity/canvas";
import { paint } from "./parity/drawn";

test.use({ viewport: { width: 1400, height: 900 } });

for (const renderer of ["svg", "canvas"] as const) {
  test(`${renderer}: whole-log numbered fallback agrees with SVG and PNG at fixed zoom, with a keyboard-readable full-name key`, async ({ page }) => {
    await page.addInitScript(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const clear = proto.clearRect, fill = proto.fillText;
      proto.clearRect = function (...args) { this.canvas.dataset.texts = "[]"; return clear.apply(this, args); };
      proto.fillText = function (text, x, y, ...args) {
        const texts = JSON.parse(this.canvas.dataset.texts ?? "[]");
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1]);
        texts.push({ text, x, y, size, weight: Number(/^(\d+) /.exec(this.font)?.[1] ?? 400), color: this.fillStyle, screenPx: size * Math.hypot(this.getTransform().a, this.getTransform().b) / devicePixelRatio });
        this.canvas.dataset.texts = JSON.stringify(texts);
        return fill.call(this, text, x, y, ...args);
      };
    });
    await page.goto(`/iframe.html?id=screen-numbers--whole-log&viewMode=story&args=renderer:${renderer}`);
    await expect(page.getByTestId("wf-edge-note")).toHaveText("Showing 105 of 677 flows");
    const json = await page.getByTestId("numbered-scene").textContent();
    const { graph, positions, zoom, shown } = JSON.parse(json!) as { graph: FlowGraph; positions: Positions; zoom: number; shown: ShownEdges };
    expect(zoom).toBe(0.05);
    const cards = graph.nodes.filter((n) => n.kind === "activity");
    expect(cards).toHaveLength(42);
    const key = page.getByRole("region", { name: "Activities by number" });
    await expect(key).toBeVisible();
    await expect.poll(async () => renderer === "svg" ? page.locator(".wf-map-numbers text").count() : page.locator(".wf-canvas-map canvas").evaluate((el) => JSON.parse((el as HTMLCanvasElement).dataset.texts ?? "[]").length)).toBe(42);
    const live = renderer === "svg" ? await page.locator(".wf-map-numbers text").evaluateAll((els) => els.map((el) => {
      const e = el as SVGTextElement;
      const css = getComputedStyle(e), m = e.getScreenCTM()!;
      return { text: e.textContent!, x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")), size: parseFloat(css.fontSize), weight: Number(css.fontWeight), color: css.fill, screenPx: parseFloat(css.fontSize) * Math.hypot(m.a, m.b) };
    })) : await page.locator(".wf-canvas-map canvas").evaluate((el) => JSON.parse((el as HTMLCanvasElement).dataset.texts!)) as { text: string; x: number; y: number; size: number; weight: number; color: string; screenPx: number }[];
    for (const n of live) expect(n.screenPx, n.text).toBeGreaterThanOrEqual(9 - 0.001);
    const scene = prepareScene(graph, positions);
    const readable = readableAt(scene.readable, zoom, 9);
    const options = { theme: "default" as const, lodZoom: zoom, readable, edgeBudget: shown, legend: false };
    expect(shown.edges).toHaveLength(105);
    expect(shown.total).toBe(677);
    const svg = toSVG({ graph, positions }, options);
    expect(svg).toContain("Showing 105 of 677 flows");
    const svgNumbers = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return { markers: [...doc.querySelectorAll(".wf-numbers text")].map((e) => ({ text: e.textContent!, x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")) - 0.3 * Number(e.getAttribute("font-size")), size: Number(e.getAttribute("font-size")), weight: Number(e.getAttribute("font-weight")), color: e.getAttribute("fill")! })), key: [...doc.querySelectorAll(".wf-number-key text")].map((e) => e.textContent).join(" ") };
    }, svg);
    const measure = (text: string, font: string) => text.length * 0.55 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);
    const png = recordingContext(measure);
    toPNGCanvas({ graph, positions }, { ...options, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
    expect(png.ops.filter((o) => o.op === "text").some((o) => o.text === "Showing 105 of 677 flows")).toBe(true);
    const pngNumbers = png.ops.filter((o) => o.op === "text").filter((o) => !o.halo && o.scales === 2).map((o) => ({ text: o.text, x: o.x, y: o.y, size: o.size, weight: o.weight, color: o.paint }));
    const normalized = (markers: typeof svgNumbers.markers) => markers.map((m) => [m.text, Number(m.x.toFixed(2)), Number(m.y.toFixed(2)), Number(m.size.toFixed(2)), m.weight, paint(m.color)]).sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(normalized(live)).toEqual(normalized(svgNumbers.markers));
    expect(normalized(pngNumbers)).toEqual(normalized(svgNumbers.markers));
    const keyText = await key.evaluate((el) => [...el.children].map((e) => e.textContent).join(" "));
    for (const card of cards) {
      expect(keyText).toContain(card.label);
      expect(svgNumbers.key).toContain(card.label);
    }
    const before = await key.evaluate((el) => ({ top: el.scrollTop, scroll: el.scrollHeight, height: el.clientHeight }));
    expect(before.scroll).toBeGreaterThan(before.height);
    await key.focus();
    await expect(key).toBeFocused();
    await page.keyboard.press("End");
    await expect.poll(() => key.evaluate((el) => el.scrollTop)).toBeGreaterThan(before.top);
    const axe = await new AxeBuilder({ page }).include('[data-wf-part="activity-key"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
  });

  test(`${renderer}: the protected model loop has ordinary path ink at fixed small zoom`, async ({ page }) => {
    await page.addInitScript(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const begin = proto.beginPath, move = proto.moveTo, line = proto.lineTo, stroke = proto.stroke, clear = proto.clearRect;
      const paths = new WeakMap<CanvasRenderingContext2D, number[][]>();
      proto.clearRect = function (...args) { this.canvas.dataset.paths = "[]"; return clear.apply(this, args); };
      proto.beginPath = function () { paths.set(this, []); return begin.call(this); };
      proto.moveTo = function (x, y) { paths.get(this)?.push([x, y]); return move.call(this, x, y); };
      proto.lineTo = function (x, y) { paths.get(this)?.push([x, y]); return line.call(this, x, y); };
      proto.stroke = function (path?: Path2D) {
        const all = JSON.parse(this.canvas.dataset.paths ?? "[]");
        all.push(paths.get(this));
        this.canvas.dataset.paths = JSON.stringify(all);
        return path === undefined ? (stroke as (this: CanvasRenderingContext2D) => void).call(this) : stroke.call(this, path);
      };
    });
    await page.goto(`/iframe.html?id=screen-numbers--model-loop&viewMode=story&args=renderer:${renderer}`);
    await expect(page.getByRole("region", { name: "Activities by number" })).toBeVisible();
    if (renderer === "svg") await expect(page.locator('.wf-edge[data-id="aa"] .react-flow__edge-path')).toBeAttached();
    else {
      const { graph, positions } = JSON.parse((await page.getByTestId("numbered-scene").textContent())!) as { graph: FlowGraph; positions: Positions };
      const loop = prepareScene(graph, positions).edgeById.get("aa")!;
      const points = [...loop.points.slice(0, -1), lineEnd(loop.points, loop.mark.arrow)].map((p) => [p.x, p.y]);
      await expect.poll(() => page.locator(".wf-canvas-map canvas").evaluate((el) => JSON.parse((el as HTMLCanvasElement).dataset.paths ?? "[]"))).toContainEqual(points);
    }
    await expect(page.getByTestId("wf-edge-note")).toHaveCount(0);
  });
}
