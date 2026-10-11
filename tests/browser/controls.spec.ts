import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";

/**
 * The controls around the maps in a real browser: at the fitted zoom no panel
 * covers an activity in the stories the strict screenshots take; in the dark
 * scheme no panel, control or table cell is lighter than the surface and the
 * pattern ink stands out from every stage colour; the controls pass the
 * accessibility checks and every one has a name, in English and German.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PANELS = '[data-wf-part="legend"], [data-wf-part="abstraction-panel"], [data-wf-part="controls"], [data-wf-part="status"], [data-wf-part="path-list"], .wf-bpmn__panel';

async function open(page: Page, id: string, scheme: "light" | "dark" = "light") {
  await page.mouse.move(0, 0);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.waitForSelector('[data-layout-status="ready"], [data-layout-status="given"], [data-bpmn-status="ready"], .wf-table, .wf-trace-timeline', { timeout: 60_000 });
  // The map is fitted 50 and 400 ms after its nodes render.
  await page.waitForTimeout(1200);
}

/** The boxes of the panels and of the activities (cards of the map, tasks of the BPMN diagram) in the page. */
const boxes = (page: Page) =>
  page.evaluate((panels) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, name: el.getAttribute("data-id") ?? el.closest("[data-id]")?.getAttribute("data-id") ?? el.getAttribute("data-element-id") ?? el.className.toString() };
    };
    const cards = [...document.querySelectorAll('[data-wf-part="node"][data-wf-kind="activity"], [data-wf-part="node"][data-wf-kind="stage"]')];
    const tasks = [...document.querySelectorAll(".djs-element.djs-shape")].filter((el) => el.querySelector(':scope > .djs-visual > rect[rx="10"]'));
    return { panels: [...document.querySelectorAll(panels)].map(rect).filter((r) => r.width > 0), activities: [...cards, ...tasks].map(rect).filter((r) => r.width > 0) };
  }, PANELS);

const meets = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The stories of the strict screenshots, as each is taken, and the story whose menu and hover the computed styles take. */
const FITTED: { id: string; act?: (page: Page) => Promise<void> }[] = [
  { id: "process-map--map" },
  { id: "layout--stage-lanes" },
  { id: "interaction--paths" },
  { id: "interaction--select-and-menu" },
  { id: "stable-layout--union" },
  {
    id: "views--four-views",
    act: async (page) => {
      await page.getByRole("button", { name: "All views" }).click();
      await expect(page.locator(".wf-views__cell")).toHaveCount(4);
      await page.waitForTimeout(1200);
    },
  },
  { id: "bpmn--from-stages" },
];

for (const { id, act } of FITTED) {
  test(`${id}: at the fitted zoom no panel covers an activity`, async ({ page }) => {
    await open(page, id);
    await act?.(page);
    // The legend is the one-line strip and the abstraction panel is open where the story has one.
    for (const legend of await page.locator('[data-wf-part="legend"]').all()) await expect(legend.getByRole("button", { name: "Show the whole legend" })).toBeVisible();
    const { panels, activities } = await boxes(page);
    expect(panels.length).toBeGreaterThan(1);
    expect(activities.length).toBeGreaterThan(4);
    const covered = panels.flatMap((p) => activities.filter((a) => meets(p, a)).map((a) => `${p.name} covers ${a.name}`));
    expect(covered).toEqual([]);
  });
}

test("the legend no longer takes the right click meant for Clear Invoice at 1280 × 800", async ({ page }) => {
  await open(page, "interaction--select-and-menu");
  await page.locator('.react-flow__node[data-id="clear_invoice"]').click({ button: "right" });
  await expect(page.getByRole("menu")).toContainText("Actions for Clear Invoice");
});

test("a pressed toggle and a selected tab keep their fill under the pointer, in both schemes", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    await open(page, "views--four-views", scheme);
    const tab = page.getByRole("tab").first();
    await page.getByRole("button", { name: "All views" }).click();
    const pressed = page.getByRole("button", { name: "One view" });
    await expect(pressed).toHaveAttribute("aria-pressed", "true");
    const fill = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style.background = "var(--wf-pressed)";
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    await pressed.hover();
    await expect(pressed).toHaveCSS("background-color", fill);
    await pressed.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await tab.hover();
    await expect(tab).toHaveCSS("background-color", fill);
  }
});

/** The relative luminance of a CSS colour as `getComputedStyle` writes it, over the colours behind it. */
const luminanceScript = () => {
  const channels = (css: string) => {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  };
  const luminance = ([r, g, b]: number[]) => {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  /** The background an element shows: its own over its ancestors', down to the first opaque one (white without one). */
  const ground = (el: Element | null) => {
    const layers: number[][] = [];
    for (let at = el; at; at = at.parentElement) {
      const c = channels(getComputedStyle(at).backgroundColor);
      if (c[3] > 0) layers.unshift(c);
      if (c[3] >= 1) break;
    }
    return layers.reduce((under, [r, g, b, a]) => [r * a + under[0] * (1 - a), g * a + under[1] * (1 - a), b * a + under[2] * (1 - a), 1], [255, 255, 255, 1]);
  };
  return { channels, luminance, ground };
};

const DARK: { id: string; act?: (page: Page) => Promise<void> }[] = [
  {
    id: "interaction--select-and-menu",
    act: async (page) => {
      await page.getByRole("button", { name: "Show the whole legend" }).click();
    },
  },
  { id: "interaction--filters" },
  {
    id: "canvas--p-2-p-on-canvas",
    act: async (page) => {
      const box = (await page.locator(".wf-canvas-map canvas").boundingBox())!;
      // A point on the main flow: the tooltip of what is under it.
      for (let dx = 0; dx < 200; dx += 4) {
        await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2);
        if (await page.locator(".wf-canvas-map__tooltip").count()) break;
      }
      await expect(page.locator(".wf-canvas-map__tooltip")).toBeVisible();
    },
  },
  { id: "table-alternative--tables" },
  { id: "table-alternative--paged" },
  { id: "bpmn--from-stages" },
  {
    id: "trace-timeline--anchored",
    act: async (page) => {
      await page.locator(".wf-trace-timeline .wf-event").first().hover();
      await expect(page.locator(".wf-trace-timeline .wf-tooltip")).toBeVisible();
    },
  },
];

for (const { id, act } of DARK) {
  test(`${id}: in the dark scheme no panel, control or table cell is lighter than the surface`, async ({ page }) => {
    await open(page, id, "dark");
    await act?.(page);
    const found = await page.evaluate((script) => {
      const { channels, luminance, ground } = new Function(`return (${script})()`)() as ReturnType<typeof luminanceScript>;
      const probe = document.body.appendChild(document.createElement("div"));
      probe.style.background = "var(--wf-surface)";
      const surface = luminance(channels(getComputedStyle(probe).backgroundColor));
      probe.remove();
      const selector = '.wf-panel, .wf-panel *, .wf-button, .wf-panel-chip, .wf-tooltip, .wf-filters, [data-wf-part="table"] th, [data-wf-part="table"] td, [data-wf-part="table"] input, .react-flow__panel';
      // The legend's samples and swatches and a table's stage swatches are marks drawn in the data's colours, not grounds.
      const marks = ".wf-legend__width, .wf-legend__swatch, .wf-legend__gradient, .wf-swatch, .wf-map-chips";
      const elements = [...document.querySelectorAll(selector)].filter((el) => el.getBoundingClientRect().width > 0 && !el.closest(marks));
      const lighter = elements.flatMap((el) => {
        const l = luminance(ground(el));
        return l > surface + 1e-4 ? [`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} ${getComputedStyle(el).backgroundColor} (${l.toFixed(4)} > ${surface.toFixed(4)})`] : [];
      });
      return { count: elements.length, lighter, surface };
    }, luminanceScript.toString());
    expect(found.surface).toBeLessThan(0.05);
    expect(found.count).toBeGreaterThan(0);
    expect(found.lighter).toEqual([]);
  });
}

test("in the dark scheme the pattern ink stands out at 3 : 1 from every stage colour it is drawn on", async ({ page }) => {
  await open(page, "interaction--select-and-menu", "dark");
  await page.getByRole("button", { name: "Show the whole legend" }).click();
  const pairs = await page.evaluate((script) => {
    const { channels, luminance } = new Function(`return (${script})()`)() as ReturnType<typeof luminanceScript>;
    const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    return [...document.querySelectorAll(".wf-node__band, .wf-legend__swatch")].flatMap((el) => {
      const ink = el.querySelector("pattern > path, pattern > circle");
      if (!ink) return [];
      const paint = ink.getAttribute(ink.tagName === "path" ? "stroke" : "fill")!;
      const probe = document.body.appendChild(document.createElement("i"));
      probe.style.color = paint;
      const inkColour = channels(getComputedStyle(probe).color);
      probe.remove();
      const stage = getComputedStyle(el).backgroundColor;
      return [{ stage, ink: paint, contrast: contrast(luminance(inkColour), luminance(channels(stage))) }];
    });
  }, luminanceScript.toString());
  expect(pairs.length).toBeGreaterThan(4);
  // Bands and swatches of more than one stage colour.
  expect(new Set(pairs.map((p) => p.stage)).size).toBeGreaterThan(2);
  expect(pairs.filter((p) => p.contrast < 3)).toEqual([]);
  // The dark scheme's own ink, not the light scheme's.
  expect(new Set(pairs.map((p) => p.ink))).toEqual(new Set(["#101114"]));
});

for (const { id, lang, expand } of [
  { id: "interaction--select-and-menu", lang: "en", expand: "Show the whole legend" },
  { id: "process-map--german", lang: "de", expand: "Ganze Legende zeigen" },
  { id: "canvas--p-2-p-on-canvas", lang: "en", expand: "Show the whole legend" },
  { id: "bpmn--from-stages", lang: "en", expand: "Show the whole legend" },
]) {
  test(`${id}: the controls pass the accessibility checks and each has a name (${lang})`, async ({ page }, testInfo) => {
    await open(page, id);
    const toggle = page.getByRole("button", { name: expand });
    // The legend expands and collapses by keyboard, and says so.
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: expand })).toHaveCount(0);
    const collapse = page.locator('[data-wf-part="legend"] [data-wf-part="button"]');
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[aria-live]").filter({ hasText: lang === "de" ? "Die ganze Legende wird gezeigt." : "The whole legend is shown." }).first()).toBeAttached();
    const result = await new AxeBuilder({ page }).include(".wf-panel").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await testInfo.attach("accessibility", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    expect(result.violations).toEqual([]);
    for (const control of await page.locator(".wf-panel button, .wf-panel input").all()) await expect(control).toHaveAccessibleName(/\S/);
    await collapse.press("Space");
    await expect(page.getByRole("button", { name: expand })).toBeVisible();
  });
}
