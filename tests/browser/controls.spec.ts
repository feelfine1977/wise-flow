import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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
    // This check measures the fit control; readable opening is checked in opening.spec.ts.
    for (const fit of await page.getByRole("button", { name: "Fit the map", exact: true }).all()) await fit.click();
    await page.waitForTimeout(400);
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

/** What the library's components render carries a part of the styling contract, the BPMN view its status; a story's own controls carry neither. */
const ROOTS = "[data-wf-part], [data-bpmn-status]";

/** Every CSS variable of the token table. */
const TOKENS = [...new Set(readFileSync(fileURLToPath(new URL("../../src/tokens.css", import.meta.url)), "utf8").match(/--wf-[a-z0-9-]+(?=:)/g))];

/**
 * The text, border and outline colours of every form control inside the library's roots under `scope`, each
 * compared with the colours of the tokens resolved where it is drawn and with the colours the browser gives the
 * same control in the same state and scheme outside the library (a bare copy). `focused` asks for the colours of
 * the control focused by keyboard, which the copy cannot show. A control's placeholder is checked as its text.
 */
const paints = (page: Page, scope: string, state: string) =>
  page.evaluate(
    ({ roots, tokens, scope, state }) => {
      const colour = (value: string, where: Element) => {
        const probe = where.appendChild(document.createElement("i"));
        probe.style.color = value;
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      };
      const properties = ["color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "outline-color"];
      const form = "input, button, select, textarea";
      const controls = [...document.querySelectorAll(scope)].flatMap((s) => (s.matches(form) ? [s] : [...s.querySelectorAll(form)])).filter((el) => el.closest(roots));
      const outside = document.body.appendChild(document.createElement("div"));
      const found = controls.map((el) => {
        const root = el.closest(roots)!;
        const rootStyle = getComputedStyle(root);
        const values = tokens.map((t) => rootStyle.getPropertyValue(t).trim()).filter((v) => v && CSS.supports("color", v));
        // `transparent` is a colour the stylesheet writes (an icon button's border until it is hovered).
        const allowed = new Set([...values.map((v) => colour(v, root)), "rgba(0, 0, 0, 0)"]);
        const copy = outside.appendChild(el.cloneNode(false) as HTMLElement);
        copy.removeAttribute("class");
        copy.removeAttribute("style");
        const style = getComputedStyle(el);
        // The browser's own colours differ by scheme (a check box is black in the light one, white in the dark one).
        copy.style.colorScheme = style.colorScheme;
        const bare = getComputedStyle(copy);
        const name = `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""}.${[...el.classList].join(".")} "${el.getAttribute("aria-label") ?? el.textContent?.trim()}" (${state})`;
        const wrong: string[] = [];
        const check = (property: string, value: string, browser: string | undefined) => {
          if (!allowed.has(value)) wrong.push(`${property} ${value} is no token`);
          else if (browser !== undefined && value === browser && value !== "rgba(0, 0, 0, 0)") wrong.push(`${property} ${value} is the browser's own`);
        };
        for (const p of properties) check(p, style.getPropertyValue(p), state === "focused" ? undefined : bare.getPropertyValue(p));
        if (state === "focused") {
          if (!el.matches(":focus-visible")) wrong.push("not focused by keyboard");
          if (style.outlineStyle === "auto" || style.outlineColor !== colour("var(--wf-focus)", root) && style.outlineStyle !== "none") wrong.push(`outline ${style.outlineStyle} ${style.outlineColor} is not the focus colour`);
        }
        if (el.matches("input:not([type=range], [type=checkbox], [type=radio]), textarea")) check("::placeholder color", getComputedStyle(el, "::placeholder").color, getComputedStyle(copy, "::placeholder").color);
        copy.remove();
        return { name, wrong };
      });
      outside.remove();
      return found;
    },
    { roots: ROOTS, tokens: TOKENS, scope, state },
  );

/** The stories that show the controls of the panels, each with the part of the page whose controls it shows and the states it shows them in. */
const CONTROLS: { id: string; scope?: string; act?: (page: Page) => Promise<void>; expect: string[] }[] = [
  // The detail sliders, the kept paths' part of the statement, the stage toggle, the zoom control and the legend's toggle.
  { id: "process-map--map", expect: ['input[type="range"]', ".wf-controls__kept", ".wf-button--icon", '[data-wf-part="legend"] .wf-button'] },
  { id: "interaction--filters", expect: [".wf-filter-chip__remove", ".wf-filters__clear"] },
  { id: "interaction--paths", expect: [".wf-paths__sort", ".wf-paths__close"] },
  {
    id: "interaction--select-and-menu",
    scope: ".wf-menu",
    act: async (page) => {
      await page.locator('.react-flow__node[data-id="clear_invoice"]').click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
    },
    expect: [".wf-menu__item"],
  },
  // The search field and the pager, its first button disabled.
  { id: "table-alternative--paged", expect: [".wf-table__search", ".wf-button:disabled"] },
  // The table toggle pressed.
  { id: "table-alternative--inside-map", expect: ['.wf-button[aria-pressed="true"]'] },
  { id: "canvas--p-2-p-on-canvas", expect: ['input[type="range"]', ".wf-button--icon"] },
  { id: "bpmn--overlays-on-model", expect: [".wf-bpmn .wf-button", ".wf-button--icon"] },
  { id: "views--four-views", expect: ['.wf-button[aria-pressed], [role="tab"][aria-selected="true"]'] },
];

for (const scheme of ["light", "dark"] as const) {
  for (const { id, scope = "body", act, expect: shown } of CONTROLS) {
    test(`${id}: every control paints its text, border and outline in the tokens, in every state shown (${scheme})`, async ({ page }) => {
      await open(page, id, scheme);
      await act?.(page);
      for (const selector of shown) await expect(page.locator(scope).locator(selector).first()).toBeAttached();
      const wrong = (await paints(page, scope, "as shown")).filter((c) => c.wrong.length);
      // The check box unchecked as well as checked.
      // The library's controls: those inside its roots (the menu is one).
      const within = scope === "body" ? `:is(${ROOTS})` : scope;
      for (const box of await page.locator(`${within} input[type="checkbox"]`).all()) {
        await box.click();
        wrong.push(...(await paints(page, scope, "toggled")).filter((c) => c.wrong.length));
        await box.click();
      }
      // Each control focused by keyboard: a key press first, so that focusing from a script shows the focus.
      const controls = page.locator(`${within} :is(input, button, select, textarea)`);
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;
        await page.keyboard.press("Shift");
        await control.evaluate((el: HTMLElement) => el.focus());
        const focused = await paints(page, `${scope} :focus`, "focused");
        expect(focused, "the control has the focus").toHaveLength(1);
        wrong.push(...focused.filter((c) => c.wrong.length));
      }
      expect(wrong).toEqual([]);
    });
  }
}

// The detail panel's sliders set no colour of their own: they take the ink (#1f1f1f, dark #ececec) and the strong
// line (#8c94a1, dark #6b7280), where the browser gave them #9d968e on Linux and #101010 on macOS.
for (const [scheme, ink, line] of [
  ["light", "rgb(31, 31, 31)", "rgb(140, 148, 161)"],
  ["dark", "rgb(236, 236, 236)", "rgb(107, 114, 128)"],
] as const) {
  test(`the detail sliders are drawn in the ink and the strong line (${scheme})`, async ({ page }) => {
    await open(page, "process-map--map", scheme);
    const colours = await page.locator('[data-wf-part="abstraction-panel"] input').evaluateAll((inputs) =>
      inputs.map((el) => {
        const style = getComputedStyle(el);
        return { type: (el as HTMLInputElement).type, color: style.color, border: style.borderTopColor, outline: style.outlineColor };
      }),
    );
    expect(colours).toEqual([
      { type: "range", color: ink, border: line, outline: ink },
      { type: "range", color: ink, border: line, outline: ink },
    ]);
  });
}
