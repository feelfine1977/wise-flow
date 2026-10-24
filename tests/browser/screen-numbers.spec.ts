import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { type FlowGraph, type Positions, type ShownEdges, lineEnd, readableAt, toSVG } from "../../src/index";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { recordingContext } from "./parity/canvas";
import { paint } from "./parity/drawn";

test.use({ viewport: { width: 1400, height: 900 } });

for (const renderer of ["svg", "canvas"] as const) {
  for (const half of [false, true]) test(`${renderer}: ${half ? "half" : "whole log"} numbered fallback agrees with SVG and PNG at fixed zoom, with a keyboard-readable full-name key`, async ({ page }) => {
    await page.addInitScript(() => {
      const proto = CanvasRenderingContext2D.prototype;
      const clear = proto.clearRect, fill = proto.fillText;
      const rect = proto.fillRect, begin = proto.beginPath, move = proto.moveTo, line = proto.lineTo, stroke = proto.stroke;
      const paths = new WeakMap<CanvasRenderingContext2D, number[]>();
      const record = (ctx: CanvasRenderingContext2D, shape: { geometry: number[]; color: string; width: number }) => {
        const shapes = JSON.parse(ctx.canvas.dataset.numberShapes ?? "[]");
        shapes.push(shape);
        ctx.canvas.dataset.numberShapes = JSON.stringify(shapes);
      };
      proto.clearRect = function (...args) { this.canvas.dataset.texts = "[]"; this.canvas.dataset.numberShapes = "[]"; return clear.apply(this, args); };
      proto.fillRect = function (x, y, w, h) { record(this, { geometry: [x, y, w, h], color: String(this.fillStyle), width: 0 }); return rect.call(this, x, y, w, h); };
      proto.beginPath = function () { paths.set(this, []); return begin.call(this); };
      proto.moveTo = function (x, y) { paths.get(this)?.push(x, y); return move.call(this, x, y); };
      proto.lineTo = function (x, y) { paths.get(this)?.push(x, y); return line.call(this, x, y); };
      proto.stroke = function (path?: Path2D) {
        const geometry = paths.get(this);
        if (geometry?.length === 4) record(this, { geometry, color: String(this.strokeStyle), width: this.lineWidth });
        return path === undefined ? (stroke as (this: CanvasRenderingContext2D) => void).call(this) : stroke.call(this, path);
      };
      proto.fillText = function (text, x, y, ...args) {
        const texts = JSON.parse(this.canvas.dataset.texts ?? "[]");
        const size = Number(/([\d.]+)px/.exec(this.font)?.[1]);
        const glyph = this.measureText(text), transform = this.getTransform();
        const k = Math.hypot(transform.a, transform.b) / devicePixelRatio;
        const p = new DOMPoint(x, y).matrixTransform(transform);
        const box = { x: p.x / devicePixelRatio - glyph.actualBoundingBoxLeft * k, y: p.y / devicePixelRatio - glyph.actualBoundingBoxAscent * k, width: (glyph.actualBoundingBoxLeft + glyph.actualBoundingBoxRight) * k, height: (glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent) * k };
        texts.push({ text, x, y, size, box, weight: Number(/^(\d+) /.exec(this.font)?.[1] ?? 400), color: this.fillStyle, screenPx: size * Math.hypot(this.getTransform().a, this.getTransform().b) / devicePixelRatio });
        this.canvas.dataset.texts = JSON.stringify(texts);
        return fill.call(this, text, x, y, ...args);
      };
    });
    await page.goto(`/iframe.html?id=screen-numbers--${half ? "half" : "whole-log"}&viewMode=story&args=renderer:${renderer}`);
    await page.getByTestId("numbered-scene").waitFor({ state: "attached", timeout: 60000 });
    if (!half) await expect(page.getByTestId("wf-edge-note")).toHaveText("Showing 105 of 677 flows");
    const json = await page.getByTestId("numbered-scene").textContent();
    const { graph, positions, zoom, shown } = JSON.parse(json!) as { graph: FlowGraph; positions: Positions; zoom: number; shown: ShownEdges };
    expect(zoom).toBe(0.05);
    const cards = graph.nodes.filter((n) => n.kind === "activity");
    if (!half) expect(cards).toHaveLength(42);
    else expect(cards.length).toBeGreaterThan(1);
    const key = page.getByRole("region", { name: "Activities by number" });
    await expect(key).toBeVisible();
    await expect.poll(async () => renderer === "svg" ? page.locator(".wf-map-numbers text").count() : page.locator(".wf-canvas-map canvas").evaluate((el) => JSON.parse((el as HTMLCanvasElement).dataset.texts ?? "[]").length)).toBe(cards.length);
    const live = renderer === "svg" ? await page.locator(".wf-map-numbers text").evaluateAll((els) => els.map((el) => {
      const e = el as SVGTextElement;
      const css = getComputedStyle(e), m = e.getScreenCTM()!;
      const r = e.getBoundingClientRect();
      return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, text: e.textContent!, x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")), size: parseFloat(css.fontSize), weight: Number(css.fontWeight), color: css.fill, screenPx: parseFloat(css.fontSize) * Math.hypot(m.a, m.b) };
    })) : await page.locator(".wf-canvas-map canvas").evaluate((el) => JSON.parse((el as HTMLCanvasElement).dataset.texts!)) as { text: string; x: number; y: number; size: number; weight: number; color: string; screenPx: number; box: { x: number; y: number; width: number; height: number } }[];
    for (const n of live) expect(n.screenPx, n.text).toBeGreaterThanOrEqual(9 - 0.001);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i].box, b = live[j].box;
      expect(a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height, `references ${live[i].text}/${live[j].text}`).toBe(true);
    }
    const scene = prepareScene(graph, positions);
    const readable = readableAt(scene.readable, zoom, 9);
    const options = { theme: "default" as const, lodZoom: zoom, readable, edgeBudget: shown, legend: false };
    if (!half) { expect(shown.edges).toHaveLength(105); expect(shown.total).toBe(677); }
    const svg = toSVG({ graph, positions }, options);
    if (!half) expect(svg).toContain("Showing 105 of 677 flows");
    const svgNumbers = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
      return {
        markers: [...doc.querySelectorAll(".wf-numbers text")].map((e) => ({ text: e.textContent!, x: Number(e.getAttribute("x")), y: Number(e.getAttribute("y")) - 0.3 * Number(e.getAttribute("font-size")), size: Number(e.getAttribute("font-size")), weight: Number(e.getAttribute("font-weight")), color: e.getAttribute("fill")! })),
        shapes: [...doc.querySelectorAll(".wf-numbers rect, .wf-numbers path")].map((e) => ({
          geometry: e.tagName === "rect" ? ["x", "y", "width", "height"].map((a) => Number(e.getAttribute(a))) : e.getAttribute("d")!.match(/-?[\d.]+/g)!.map(Number),
          color: e.getAttribute(e.tagName === "rect" ? "fill" : "stroke")!, width: Number(e.getAttribute("stroke-width")),
        })),
        key: [...doc.querySelectorAll(".wf-number-key text")].map((e) => e.textContent).join(" "),
      };
    }, svg);
    const measure = (text: string, font: string) => text.length * 0.55 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10);
    const png = recordingContext(measure);
    toPNGCanvas({ graph, positions }, { ...options, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
    if (!half) expect(png.ops.filter((o) => o.op === "text").some((o) => o.text === "Showing 105 of 677 flows")).toBe(true);
    const pngNumbers = png.ops.filter((o) => o.op === "text").filter((o) => !o.halo && o.scales === 2).map((o) => ({ text: o.text, x: o.x, y: o.y, size: o.size, weight: o.weight, color: o.paint }));
    const sorted = (markers: typeof svgNumbers.markers) => markers.sort((a, b) => Number(a.text) - Number(b.text));
    const expected = sorted(svgNumbers.markers);
    for (const markers of [live, pngNumbers]) {
      expect(sorted(markers).map((m) => [m.text, Number(m.size.toFixed(2)), m.weight, paint(m.color)])).toEqual(expected.map((m) => [m.text, Number(m.size.toFixed(2)), m.weight, paint(m.color)]));
      // SVG serializes coordinates to .01 layout units; at .05 this is under .001 screen pixel.
      for (const [i, m] of markers.entries()) {
        expect(Math.abs(m.x - expected[i].x)).toBeLessThan(0.011);
        expect(Math.abs(m.y - expected[i].y)).toBeLessThan(0.011);
      }
    }
    const liveShapes = renderer === "svg" ? await page.locator(".wf-map-numbers rect, .wf-map-numbers line").evaluateAll((els) => els.map((e) => ({
      geometry: (e.tagName === "rect" ? ["x", "y", "width", "height"] : ["x1", "y1", "x2", "y2"]).map((a) => Number(e.getAttribute(a))),
      color: e.tagName === "rect" ? getComputedStyle(e).fill : getComputedStyle(e).stroke,
      width: e.tagName === "rect" ? 0 : parseFloat(getComputedStyle(e).strokeWidth),
    }))) : await page.locator(".wf-canvas-map canvas").evaluate((el) => JSON.parse((el as HTMLCanvasElement).dataset.numberShapes!)) as typeof svgNumbers.shapes;
    const pngShapes = png.ops.flatMap((o) => o.op === "text" || o.scales !== 2 ? [] : o.op === "fill" && o.shape.points.length === 2 ? [{ geometry: [o.shape.points[0][0], o.shape.points[0][1], o.shape.points[1][0] - o.shape.points[0][0], o.shape.points[1][1] - o.shape.points[0][1]], color: o.paint, width: 0 }] : o.op === "stroke" && o.shape.lines.length === 1 ? [{ geometry: o.shape.lines[0], color: o.paint, width: o.width }] : []);
    expect(svgNumbers.shapes.filter((s) => s.width > 0).length, "displaced card links are exercised").toBeGreaterThan(0);
    if (renderer === "svg") expect(liveShapes).toHaveLength(svgNumbers.shapes.length);
    for (const shapes of [liveShapes, pngShapes]) for (const expected of svgNumbers.shapes) {
      expect(shapes.some((s) => s.geometry.every((v, i) => Math.abs(v - expected.geometry[i]) < 0.011) && Math.abs(s.width - expected.width) < 0.001 && paint(s.color) === paint(expected.color)), `backing/link ${JSON.stringify(expected)}`).toBe(true);
    }
    const keyText = await key.evaluate((el) => [...el.children].map((e) => e.textContent).join(" "));
    for (const card of cards) {
      expect(keyText).toContain(card.label);
      expect(svgNumbers.key).toContain(card.label);
    }
    const before = await key.evaluate((el) => ({ top: el.scrollTop, scroll: el.scrollHeight, height: el.clientHeight }));
    if (!half) expect(before.scroll).toBeGreaterThan(before.height);
    await key.focus();
    await expect(key).toBeFocused();
    await page.keyboard.press("End");
    if (!half) await expect.poll(() => key.evaluate((el) => el.scrollTop)).toBeGreaterThan(before.top);
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
