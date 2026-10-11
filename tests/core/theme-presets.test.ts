import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Theme, buildScene, checkTheme, contrastRatio, defaultTheme, printTheme, resolveTheme, themeColors, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { themeFromVariables, themeStyle, themeVariables } from "../../src/core/theme";
import { graph, positions } from "./element-kinds";
import * as kinds from "./overlay-kinds";

/** WCAG relative luminance of `#rrggbb`, written out here so that the checks below do not read the code under test. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The variables `tokens.css` sets, by block. */
function tokensCss(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(new URL("../../src/tokens.css", import.meta.url), "utf8");
  const block = (selector: string) => Object.fromEntries([...css.slice(css.indexOf(selector)).split("}")[0].matchAll(/(--wf-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  return { light: block(":root {"), dark: block(':root[data-theme="dark"] {') };
}

describe("the presets", () => {
  it("names the default theme and the print theme", () => {
    expect(resolveTheme()).toBe(defaultTheme);
    expect(resolveTheme("default")).toBe(defaultTheme);
    expect(resolveTheme("print")).toBe(printTheme);
    expect(resolveTheme({ preset: "print" })).toBe(printTheme);
  });

  it("draws print on white paper with no tints, a pattern on every stage colour, and no text under 7 pt nor stroke under 0.75 pt, in both schemes", () => {
    expect([printTheme.color.paper, printTheme.color.surface]).toEqual(["#ffffff", "#ffffff"]);
    expect(themeColors(printTheme, "dark")).toEqual(themeColors(printTheme, "light"));
    expect([printTheme.opacity.tint, printTheme.opacity.groupFill, printTheme.opacity.bandFill, printTheme.opacity.bandOddFill]).toEqual([0, 0, 0, 0]);
    expect(printTheme.patterns).not.toContain("solid");
    expect(printTheme.minimum).toEqual({ text: 7, stroke: 0.75 });
    // 7 pt is 9⅓ px: the default's 9 px counts and 9.5 px legend keys are 10 px in print.
    expect([printTheme.text.nodeCount.size, printTheme.text.legendKey.size, printTheme.stroke.legendGradient]).toEqual([10, 10, 1]);
    // Everything else is the default's.
    expect([printTheme.text.nodeLabel, printTheme.radius, printTheme.font]).toEqual([defaultTheme.text.nodeLabel, defaultTheme.radius, defaultTheme.font]);
  });

  it("keeps print's patterns apart in greyscale: every stage colour has its own pattern, drawn in ink that stands out from it, and the path ramp's greys differ step by step", () => {
    // The greyscale check: converted by luminance, two stage colours may look alike, so each must carry a pattern no
    // other carries, and the pattern's ink must differ from the colour it is drawn on (3 : 1). The path ramp must
    // darken step by step, each step at least 1.5 : 1 from the next, and start at 3 : 1 against the paper.
    const { categorical, neutral } = printTheme.palette;
    const patterns = categorical.map((_, i) => printTheme.patterns[i % printTheme.patterns.length]);
    expect(new Set(patterns).size).toBe(categorical.length);
    expect(patterns).not.toContain("solid");
    for (const c of categorical) expect(contrast(printTheme.color.ink, c.toLowerCase()), c).toBeGreaterThanOrEqual(3);
    expect(neutral.map(luminance)).toEqual([...neutral.map(luminance)].sort((a, b) => b - a));
    for (let i = 1; i < neutral.length; i++) expect(contrast(neutral[i - 1], neutral[i])).toBeGreaterThanOrEqual(1.5);
    expect(contrast(neutral[0], printTheme.color.paper)).toBeGreaterThanOrEqual(3);
  });

  it("gives print's stage colours their patterns in the scene and drops the tints", () => {
    const scene = buildScene(kinds.graph, kinds.positions, { overlays: kinds.overlays, theme: printTheme, style: { nodeColor: { by: "group" } } });
    expect(scene.marks.some((m) => m.kind === "tint")).toBe(true);
    expect(scene.groupMarks.every((m) => m.fill.opacity === 0)).toBe(true);
    expect(scene.marks.filter((m) => m.kind === "tint").every((m) => m.fill?.opacity === 0)).toBe(true);
    expect(scene.nodeMarks.map((m) => m.pattern).filter((p) => p === "solid")).toEqual([]);
  });
});

describe("a theme set as changes over a preset", () => {
  it("changes only what it names, entry by entry, over the preset it names", () => {
    const theme = resolveTheme({ preset: "print", density: "compact", radius: { node: 4 }, text: { nodeLabel: { size: 13 } }, color: { ink: "#111111" } });
    expect([theme.density, theme.radius.node, theme.radius.large, theme.text.nodeLabel.size, theme.text.nodeCount.size]).toEqual(["compact", 4, 10, 13, 10]);
    expect([theme.color.ink, theme.color.paper, theme.color.surface]).toEqual(["#111111", "#ffffff", "#ffffff"]);
    // A list replaces the preset's.
    expect(resolveTheme({ palette: { neutral: ["#777777", "#444444"] } }).palette.neutral).toEqual(["#777777", "#444444"]);
  });

  it("puts the setting over the CSS variables over the preset", () => {
    const css = { color: { paper: "#fdf6e3", ink: "#222222" } };
    // The preset alone, the variables over it, the setting over both.
    expect(themeColors(resolveTheme("print")).paper).toBe("#ffffff");
    expect([themeColors(resolveTheme("print", css)).paper, themeColors(resolveTheme("print", css)).ink]).toEqual(["#fdf6e3", "#222222"]);
    const set = resolveTheme({ preset: "print", color: { ink: "#000000" } }, css);
    expect([set.color.paper, set.color.ink]).toEqual(["#fdf6e3", "#000000"]);
  });

  it("leaves out colours that are not literals, so every paint of an export is one", () => {
    const theme = resolveTheme({ color: { paper: "oklch(0.98 0.01 90)", ink: "rgb(20 20 20)", focus: "var(--brand)" } });
    expect([theme.color.paper, theme.color.ink, theme.color.focus]).toEqual(["#ffffff", "rgb(20 20 20)", "#0072b2"]);
    // Palettes are interpolated from hex stops: a palette with another stop is left out, the preset's stays.
    const palette = { categorical: ["#123456", "oklch(0.6 0.1 200)"], shortfall: ["rgb(250 250 250)", "#a00"], neutral: ["#ccc", "#333333"] };
    expect(resolveTheme({ palette }).palette).toEqual({ ...defaultTheme.palette, neutral: ["#ccc", "#333333"] });
    const svg = toSVG({ graph: kinds.graph, positions: kinds.positions, overlays: kinds.overlays, style: { nodeColor: { by: "group" } } }, { theme: { palette } });
    for (const word of ["oklch(", "rgb("]) expect(svg).not.toContain(word);
  });
});

describe("the CSS variables of a theme", () => {
  it("are the variables of tokens.css for the default theme, in both schemes", () => {
    const css = tokensCss();
    const light = themeStyle(defaultTheme, "light");
    expect(Object.keys(light).length).toBeGreaterThan(40);
    for (const [name, value] of Object.entries(light)) expect(value, name).toBe(css.light[name]);
    for (const [name, value] of Object.entries(css.dark)) expect(themeStyle(defaultTheme, "dark")[name], name).toBe(value);
  });

  it("read back as the parts of a theme, lengths in px, leaving out what tokens.css sets", () => {
    const css = tokensCss();
    const set: Record<string, string> = { ...css.light, "--wf-paper": "#fdf6e3", "--wf-font": "Georgia, serif", "--wf-stroke-node": "3px", "--wf-radius": "4px", "--wf-text-node-label": "13px", "--wf-weight-group-label": "700", "--wf-opacity-tint": "0", "--wf-text-panel": "1rem" };
    const read = themeFromVariables((name) => set[name] ?? "", "light", (c) => c);
    expect(read).toEqual({
      color: { paper: "#fdf6e3" },
      font: { family: "Georgia, serif" },
      text: { nodeLabel: { size: 13 }, groupLabel: { weight: 700 } },
      radius: { node: 4 },
      stroke: { node: 3 },
      opacity: { tint: 0 },
    });
    // What tokens.css sets in the dark scheme is not the host's either; the host's colours there are the dark roles.
    const dark: Record<string, string> = { ...css.light, ...css.dark, "--wf-ink": "#dddddd" };
    expect(themeFromVariables((name) => dark[name] ?? "", "dark", (c) => c)).toEqual({ dark: { ink: "#dddddd" } });
    // A colour the conversion cannot read is left out.
    expect(themeFromVariables((name) => (name === "--wf-paper" ? "oklch(0.98 0.01 90)" : ""), "light", () => undefined)).toEqual({});
  });

  it("write every part of a theme", () => {
    const theme = resolveTheme({ font: { family: "'Iowan Old Style', serif" }, stroke: { node: 3 }, color: { paper: "#FDF6E3" } });
    const vars = themeVariables(theme, "light");
    expect([vars["--wf-font"], vars["--wf-stroke-node"], vars["--wf-paper"], vars["--wf-radius"], vars["--wf-weight-stage-label"]]).toEqual(['"Iowan Old Style", serif', "3px", "#fdf6e3", "6px", "600"]);
  });
});

describe("checkTheme", () => {
  it("measures contrast between literal colours of any syntax, and nothing else", () => {
    expect([contrastRatio("rgb(255, 255, 255)", "#000"), contrastRatio("rgba(255 255 255 / 1)", "#000000ff"), contrastRatio("fff", "000")]).toEqual([21, 21, 21]);
    expect(contrastRatio("oklch(0.2 0 0)", "#ffffff")).toBeNaN();
  });

  it("finds nothing in either preset, in either scheme", () => {
    expect(checkTheme(defaultTheme)).toEqual([]);
    expect(checkTheme(printTheme)).toEqual([]);
  });

  it("reports each kind of shortfall of a theme built by hand", () => {
    const bad: Theme = {
      ...printTheme,
      color: { ...printTheme.color, inkMuted: "#9a9a9a", lineStrong: "#d0d0d0" },
      dark: { paper: "oklch(0.2 0 0)" },
      palette: { ...printTheme.palette, neutral: ["#eeeeee", "#999999", "#dddddd"] },
      text: { ...printTheme.text, nodeCount: { size: 8 } },
      stroke: { ...printTheme.stroke, node: 0.5 },
    };
    expect(checkTheme(bad)).toEqual([
      { kind: "color", subject: "dark.paper", value: "oklch(0.2 0 0)" },
      { kind: "rampOrder", subject: "palette.neutral", value: "#eeeeee #999999 #dddddd" },
      { kind: "text", scheme: "light", subject: "inkMuted on paper", value: 2.81, minimum: 4.5 },
      { kind: "text", scheme: "light", subject: "inkMuted on surface", value: 2.81, minimum: 4.5 },
      { kind: "line", scheme: "light", subject: "lineStrong on paper", value: 1.54, minimum: 3 },
      { kind: "rampStart", scheme: "light", subject: "palette.neutral", value: 1.16, minimum: 3 },
      // In the dark scheme the paper is not a literal, so nothing is measured against it.
      { kind: "text", scheme: "dark", subject: "inkMuted on surface", value: 2.81, minimum: 4.5 },
      { kind: "textSize", subject: "text.nodeCount", value: 6, minimum: 7 },
      { kind: "strokeWidth", subject: "stroke.node", value: 0.375, minimum: 0.75 },
    ]);
  });
});

/** A 2D context that logs assignments. */
function recording() {
  const log: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createLinearGradient: undefined, createPattern: undefined } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => {}),
    set: (t, k: string, v) => (log.push(`${k}=${JSON.stringify(v)}`), (t[k] = v), true),
  }) as unknown as DrawContext;
  return { ctx, log };
}

describe("the exports in a theme", () => {
  it("take a preset's name or changes over a preset", () => {
    const svg = toSVG({ graph, positions }, { theme: { color: { paper: "#fdf6e3", ink: "#222222" }, font: { family: "Georgia, serif" } }, legend: false });
    expect(svg).toContain('font-family="Georgia, serif"');
    expect(svg).toContain('fill="#fdf6e3"');
    expect(svg).toContain('fill="#222222">Check invoice</text>');
    expect(toSVG({ graph, positions }, { theme: "print", legend: false })).toBe(toSVG({ graph, positions }, { theme: printTheme, legend: false }));
    const { ctx, log } = recording();
    toPNGCanvas({ graph, positions }, { theme: { color: { paper: "#fdf6e3" } }, scale: 1, createCanvas: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    expect(log).toContain('fillStyle="#fdf6e3"');
    const prepared = prepareScene(graph, positions, { theme: "print" });
    expect(prepared.theme).toBe(printTheme);
  });

  it("draw a theme's literal colours in the light scheme unless told to draw the dark one", () => {
    const theme = resolveTheme(undefined, { dark: { paper: "#101010" } });
    const light = toSVG({ graph, positions }, { theme, legend: false });
    expect(light).toContain('fill="#ffffff"');
    expect(light).not.toContain("#101010");
    expect(toSVG({ graph, positions }, { theme, scheme: "dark", legend: false })).toContain('fill="#101010"');
    for (const svg of [light, toSVG({ graph, positions }, { theme: "print" })]) for (const word of ["var(", "oklch(", "color-mix("]) expect(svg).not.toContain(word);
  });

  it("draw the theme's opacities: the legend's rule in the exports, dimmed elements on the Canvas", () => {
    const theme = resolveTheme({ opacity: { legendRule: 0.8, dimmed: 0.2, dimmedPath: 0.1 } });
    const scene = { graph: kinds.graph, positions: kinds.positions, overlays: kinds.overlays };
    expect(toSVG(scene)).toContain('stroke-opacity="0.4"/>');
    expect(toSVG(scene, { theme })).toContain('stroke-opacity="0.8"/>');
    const png = recording();
    toPNGCanvas(scene, { theme, scale: 1, createCanvas: () => ({ width: 0, height: 0, getContext: () => png.ctx }) });
    expect(png.log).toContain("globalAlpha=0.8");
    const { ctx, log } = recording();
    const bright = { nodes: new Set<string>(), edges: new Set<string>() };
    drawScene(ctx, prepareScene(graph, positions, { theme, lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 900, height: 200 }, { selection: { nodes: [], edges: [], groups: [] }, bright }, { cull: false });
    expect([log.includes("globalAlpha=0.2"), log.includes("globalAlpha=0.1")]).toEqual([true, true]);
  });

  it("draw the scheme's neutral into the paths", () => {
    const { ctx, log } = recording();
    const theme = resolveTheme(undefined, { dark: { neutral: "#777777" } });
    drawScene(ctx, prepareScene(graph, positions, { theme, scheme: "dark", lodBySize: false }), { x: 0, y: 0, zoom: 1, width: 900, height: 200 }, undefined, { cull: false });
    expect(log).toContain('strokeStyle="#777777"');
    expect(buildScene(graph, positions, { theme }).edgeMarks.every((m) => m.color !== "#777777")).toBe(true);
  });
});
