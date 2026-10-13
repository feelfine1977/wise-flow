import { describe, expect, it } from "vitest";
import { vendorScene } from "../../fixtures/bpic2019";
import { type DrawContext, drawScene, emptyState, prepareScene } from "../../src/canvas/index";
import { sceneTokens } from "../../src/canvas/tokens";
import { abstract, checkTheme, defaultTheme, layout, printTheme, toSVG } from "../../src/index";

const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
const style = { nodeColor: { by: "group" as const } };

/** The inks of the pattern twins (`wf-pattern-*` other than the hatching) of an SVG export. */
function patternInks(svg: string): Set<string> {
  const inks = new Set<string>();
  for (const m of svg.matchAll(/<pattern id="wf-pattern-(?!outofscope)[^"]*"[^>]*>(.*?)<\/pattern>/g)) {
    for (const paint of m[1].matchAll(/ (?:stroke|fill)="([^"]+)"/g)) inks.add(paint[1]);
  }
  return inks;
}

describe("the pattern ink", () => {
  it("is the scheme's own in the SVG export: the ink of the light scheme, and a dark ink on the stage colours in the dark", async () => {
    const positions = await layout(graph, { engine: "dagre" });
    expect(patternInks(toSVG({ graph, positions, style }, { theme: "default" }))).toEqual(new Set(["#1f1f1f"]));
    expect(patternInks(toSVG({ graph, positions, style }, { theme: "default", scheme: "dark" }))).toEqual(new Set(["#101114"]));
  });

  it("is the scheme's own on the Canvas", async () => {
    const scene = prepareScene(graph, await layout(graph, { engine: "dagre" }), { style, scheme: "dark" });
    expect(sceneTokens(scene).patternInk).toBe("#101114");
    // The tiles of the pattern twins are drawn in it.
    const tiles: string[] = [];
    const noop = () => {};
    const context = (record: boolean): DrawContext =>
      new Proxy({} as Record<string, unknown>, {
        get: (_t, key: string) => (key === "createPattern" ? () => ({}) : key === "measureText" ? () => ({ width: 10 }) : noop),
        set: (_t, key: string, value) => {
          if (record && key === "strokeStyle") tiles.push(value);
          return true;
        },
      }) as unknown as DrawContext;
    drawScene(context(false), scene, { x: 0, y: 0, zoom: 1, width: 4000, height: 4000 }, emptyState, { createCanvas: () => ({ width: 0, height: 0, getContext: () => context(true) }) });
    expect(tiles.length).toBeGreaterThan(0);
    expect(new Set(tiles)).toEqual(new Set(["#101114"]));
  });

  it("has 3 : 1 on every stage colour in both schemes of the presets, and checkTheme says when it has not", () => {
    for (const theme of [defaultTheme, printTheme]) expect(checkTheme(theme).filter((d) => d.subject.startsWith("patternInk"))).toEqual([]);
    // The light ink in the dark scheme, as before: on yellow #F0E442 1.12 : 1, on sky blue #56B4E9 1.95 : 1.
    const deviations = checkTheme({ ...defaultTheme, dark: { ...defaultTheme.dark, patternInk: "#ececec" } }).filter((d) => d.subject.startsWith("patternInk"));
    expect(deviations.map((d) => [d.scheme, d.subject, d.value])).toEqual([
      ["dark", "patternInk on #009E73", 2.9],
      ["dark", "patternInk on #CC79A7", 2.59],
      ["dark", "patternInk on #56B4E9", 1.95],
      ["dark", "patternInk on #F0E442", 1.12],
      ["dark", "patternInk on #999999", 2.41],
    ]);
  });
});
