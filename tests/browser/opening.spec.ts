import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import type { Box, FlowGraph, Positions } from "../../src/index";

const AREA = { width: 1400, height: 900 };
test.use({ viewport: AREA });
type Renderer = "svg" | "canvas";
type View = { x: number; y: number; zoom: number };
const overview = (page: Page) => page.getByRole("application", { name: "Overview of the map" });

async function open(page: Page, renderer: Renderer, story = "whole-log", opening = "readable") {
  // Record the view of each live Canvas frame independently of the overview.
  await page.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect, translate = proto.translate, scale = proto.scale;
    const pending = new WeakMap<CanvasRenderingContext2D, { x?: number; y?: number }>();
    proto.clearRect = function (...args) { pending.set(this, {}); return clear.apply(this, args); };
    proto.translate = function (x, y) {
      const p = pending.get(this);
      if (p && p.x === undefined) Object.assign(p, { x, y });
      return translate.call(this, x, y);
    };
    proto.scale = function (x, y) {
      const p = pending.get(this);
      if (p?.x !== undefined) {
        this.canvas.dataset.view = JSON.stringify({ ...p, zoom: x });
        pending.delete(this);
      }
      return scale.call(this, x, y);
    };
  });
  await page.goto(`/iframe.html?id=opening--${story}&viewMode=story&args=renderer:${renderer};opening:${opening}`);
  await page.locator('[data-layout-status="given"]').waitFor();
  await page.waitForTimeout(800);
}

async function view(page: Page): Promise<View> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".wf-canvas-map canvas");
    if (canvas) return JSON.parse(canvas.dataset.view!);
    const m = document.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
  });
}
const centre = (v: View) => ({ x: (AREA.width / 2 - v.x) / v.zoom, y: (AREA.height / 2 - v.y) / v.zoom });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function boxes(page: Page) {
  const v = await view(page);
  return page.evaluate((v) => {
    const { graph, positions } = JSON.parse(document.querySelector('[data-testid="opening-scene"]')!.textContent!) as { graph: FlowGraph; positions: Positions };
    const screen = (b: Box): Box => ({ x: b.x * v.zoom + v.x, y: b.y * v.zoom + v.y, width: b.width * v.zoom, height: b.height * v.zoom });
    const panels = [...document.querySelectorAll(".wf-overlay-panel, .react-flow__panel")].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }).filter((b) => b.width > 0 && b.height > 0);
    return { panels, activities: graph.nodes.filter((n) => n.kind === "activity").map((n) => ({ id: n.id, ...screen(positions.nodes[n.id]) })), start: screen(positions.nodes.__start) };
  }, v);
}

// A point of the pane, near the one preferred, where a press reaches the pane itself and not a node, group or
// panel drawn over it: text metrics differ between platforms, so a fixed point can fall on a group's edge.
async function emptyPoint(page: Page, preferred: { x: number; y: number }) {
  return page.evaluate((preferred) => {
    for (let r = 0; r <= 400; r += 10) {
      for (const [dx, dy] of [[0, r], [0, -r], [r, 0], [-r, 0]]) {
        const x = preferred.x + dx, y = preferred.y + dy;
        if (document.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
      }
    }
    throw new Error(`no empty point of the pane near ${preferred.x}, ${preferred.y}`);
  }, preferred);
}

// React Flow rounds its DOM transform to 0.001 px: at the fixed zoom 0.75,
// compare map coordinates within 0.005 units (less than 0.004 screen pixels).
const COORDINATE_PRECISION = 2;

async function checkMarkedView(page: Page) {
  const v = await view(page);
  const marked = await overview(page).locator("rect").evaluate((el) => Object.fromEntries(["x", "y", "width", "height"].map((a) => [a, Number(el.getAttribute(a))])));
  expect(marked.x).toBeCloseTo(-v.x / v.zoom, COORDINATE_PRECISION);
  expect(marked.y).toBeCloseTo(-v.y / v.zoom, COORDINATE_PRECISION);
  expect(marked.width).toBeCloseTo(AREA.width / v.zoom, COORDINATE_PRECISION);
  expect(marked.height).toBeCloseTo(AREA.height / v.zoom, COORDINATE_PRECISION);
}

for (const renderer of ["svg", "canvas"] as const) {
  test(`${renderer}: opens the whole log at 0.75 on the start with a free overview; every panel clears activities`, async ({ page }) => {
    await open(page, renderer);
    expect((await view(page)).zoom).toBe(0.75);
    await expect(overview(page)).toBeVisible();
    const { panels, activities, start } = await boxes(page);
    expect(activities.length).toBeGreaterThan(10);
    expect(activities.filter((a) => panels.some((p) => overlaps(a, p)))).toEqual([]);
    // Reading edge: 8 px inside the free area's left, either the area's edge
    // or the detail panel's right edge plus the two 8 px gaps.
    expect([8, ...panels.map((p) => p.x + p.width + 16)].some((x) => Math.abs(start.x - x) < 0.01)).toBe(true);
    const at = (await overview(page).boundingBox())!;
    expect(at.x + at.width).toBe(1392);
    expect(at.y).toBe(8);
    expect(panels.filter((p) => p.x !== at.x).some((p) => overlaps(at, p))).toBe(false);
    await checkMarkedView(page);
    const result = await new AxeBuilder({ page }).include('[data-wf-part="overview"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations).toEqual([]);
  });

  for (const story of ["vendor", "half"]) {
    test(`${renderer}: ${story} opens fitted with no overview and no covered activity`, async ({ page }) => {
      await open(page, renderer, story);
      expect((await view(page)).zoom).toBeGreaterThanOrEqual(0.75);
      await expect(overview(page)).toHaveCount(0);
      const { panels, activities } = await boxes(page);
      expect(activities.length).toBeGreaterThan(0);
      expect(activities.filter((a) => panels.some((p) => overlaps(a, p)))).toEqual([]);
      expect(activities.filter((a) => a.x < 0 || a.y < 0 || a.x + a.width > AREA.width || a.y + a.height > AREA.height)).toEqual([]);
    });
  }

  test(`${renderer}: the overview centres by click and drag and moves by keyboard, marking each view exactly`, async ({ page }) => {
    await open(page, renderer);
    const svg = overview(page).locator("svg");
    const at = (await svg.boundingBox())!;
    const [bx, by, bw, bh] = (await svg.getAttribute("viewBox"))!.split(" ").map(Number);
    await page.mouse.click(at.x + at.width * 0.75, at.y + at.height / 2);
    await expect.poll(async () => centre(await view(page)).x).toBeCloseTo(bx + bw * 0.75, COORDINATE_PRECISION);
    expect(centre(await view(page)).y).toBeCloseTo(by + bh / 2, COORDINATE_PRECISION);
    await checkMarkedView(page);
    await page.mouse.move(at.x + at.width * 0.25, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width * 0.5, at.y + at.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => centre(await view(page)).x).toBeCloseTo(bx + bw * 0.5, COORDINATE_PRECISION);
    expect(centre(await view(page)).y).toBeCloseTo(by + bh * 0.6, COORDINATE_PRECISION);
    await checkMarkedView(page);
    await overview(page).focus();
    for (const [key, dx, dy] of [["ArrowRight", 1, 0], ["ArrowDown", 0, 1], ["ArrowLeft", -1, 0], ["ArrowUp", 0, -1]] as const) {
      const before = centre(await view(page));
      await page.keyboard.press(key);
      await expect.poll(async () => centre(await view(page)).x).toBeCloseTo(before.x + dx * AREA.width / 0.75 / 10, COORDINATE_PRECISION);
      await expect.poll(async () => centre(await view(page)).y).toBeCloseTo(before.y + dy * AREA.height / 0.75 / 10, COORDINATE_PRECISION);
      await expect(overview(page)).toBeFocused();
      await checkMarkedView(page);
    }
  });

  test(`${renderer}: pan and zoom survive control changes; replacing the graph reopens; fit still shows everything`, async ({ page }) => {
    await open(page, renderer);
    const original = await view(page);
    const pane = renderer === "svg" ? page.locator(".react-flow__pane") : page.locator(".wf-canvas-map canvas");
    const area = (await pane.boundingBox())!;
    const from = renderer === "svg" ? await emptyPoint(page, { x: area.x + 700, y: area.y + 750 }) : { x: area.x + 700, y: area.y + 750 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 120, from.y - 50, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => (await view(page)).x).not.toBe(original.x);
    const pan = await view(page);
    const slider = page.getByRole("slider", { name: "Paths" });
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    expect(await view(page)).toEqual(pan);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(async () => (await view(page)).zoom).toBeGreaterThan(0.75);
    const zoomed = await view(page);
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    expect(await view(page)).toEqual(zoomed);
    await page.getByRole("button", { name: "Replace the graph" }).click();
    await expect.poll(async () => (await view(page)).zoom).toBe(0.75);
    await page.getByRole("button", { name: "Fit the map", exact: true }).click();
    await expect.poll(async () => (await view(page)).zoom).toBeLessThan(0.75);
    const { activities } = await boxes(page);
    expect(activities.filter((a) => a.x < 0 || a.y < 0 || a.x + a.width > AREA.width || a.y + a.height > AREA.height)).toEqual([]);
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    expect((await view(page)).zoom).toBeLessThan(0.75);
  });

  test(`${renderer}: a host can ask for plain fit on opening`, async ({ page }) => {
    await open(page, renderer, "whole-log", "fit");
    expect((await view(page)).zoom).toBeLessThan(0.75);
    await expect(overview(page)).toHaveCount(0);
  });
}
