import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, buildScene, dashTokens, defaultTheme, dimensionTokens, fontTokens, opacityTokens, printTheme, radiusTokens, spaceTokens, strokeTokens, textTokens, toSVG, tokenVariables, zTokens } from "../../src/index";
import { unscaledStrokes } from "../../src/core/tokens";
import { type DrawContext, drawLegend, drawScene, prepareScene } from "../../src/canvas/index";
import { graph, positions } from "./overlay-kinds";

const stylesheet = readFileSync(new URL("../../src/react/style.css", import.meta.url), "utf8");
/** The declarations of the stylesheet's rule for exactly this selector. */
const rule = (selector: string) => stylesheet.match(new RegExp(`(?:^|\\n|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

/** A 2D context that logs assignments and calls. */
function recording() {
  const log: string[] = [];
  // Without gradients and pattern tiles: plain fills.
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createLinearGradient: undefined, createPattern: undefined } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => log.push(`${k}(${JSON.stringify(a)})`)),
    set: (t, k: string, v) => (log.push(`${k}=${JSON.stringify(v)}`), (t[k] = v), true),
  }) as unknown as DrawContext;
  return { ctx, log };
}

/** The scene with counted paths and a dimmed activity, drawn as SVG and on a Canvas. */
function drawn() {
  const counted: FlowGraph = { ...graph, edges: graph.edges.map((e) => ({ ...e, metrics: { count: 12 } })) };
  const svg = toSVG({ graph: counted, positions }, { legend: false, theme: "default" });
  const scene = prepareScene(counted, positions, { lodBySize: false });
  const { ctx, log } = recording();
  drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 600, height: 100 }, { selection: { nodes: [], edges: [], groups: [] }, bright: { nodes: new Set(["a"]), edges: new Set(["ab", "bc"]) } }, { cull: false });
  drawLegend(ctx, scene, 0, 0, 188);
  return { svg, canvas: log.join("\n") };
}

/** The Canvas calls of the scene with activity `a` (0, 0, 100 × 40) selected. */
function selected() {
  const scene = prepareScene(graph, positions, { lodBySize: false });
  const { ctx, log } = recording();
  drawScene(ctx, scene, { x: 0, y: 0, zoom: 1, width: 600, height: 100 }, { selection: { nodes: ["a"], edges: [], groups: [] } }, { cull: false });
  return log.join("\n");
}

// The values below are on the scales: text 11, 13 and 15, weights 400, 500 and 600, radii 4, 8 and full, strokes 1 and 2.
const today = {
  groupLabel: { size: 13, weight: 600 },
  nodeLabel: 13,
  pathLabel: 11,
  legendItem: { size: 11, weight: 600 },
  stroke: { node: 1, group: 1, halo: 2 },
  dash: [6, 4],
  radius: { node: 4, large: 8, band: 4 },
  dimmed: 0.35,
};

type Mutable = Record<string, unknown>;
const saved: [Mutable, string, unknown][] = [];
/** Sets a role to another value until the test ends. */
function set(table: object, role: string, value: unknown) {
  saved.push([table as Mutable, role, (table as Mutable)[role]]);
  (table as Mutable)[role] = value;
}
afterEach(() => {
  for (const [table, role, value] of saved.reverse()) table[role] = value;
  saved.length = 0;
});

/** A stylesheet without the role variables it reads only as the fallback of a mark's own size and weight. */
const markFirst = (css: string) => css.replace(/var\(--wf-text-(size|weight), var\(--wf-(text|weight)-[\w-]+\)\)/g, "");

describe("the role tables", () => {
  it("hold the values drawn today", () => {
    expect(textTokens.groupLabel).toEqual(today.groupLabel);
    expect(textTokens.nodeLabel.size).toBe(today.nodeLabel);
    expect(textTokens.pathLabel.size).toBe(today.pathLabel);
    expect(textTokens.legendItem).toEqual(today.legendItem);
    expect(textTokens.activityName).toEqual({ size: 13, weight: 500, lineHeight: 16 });
    expect(textTokens.activityNumber).toEqual({ size: 11, weight: 600, lineHeight: 14 });
    expect(textTokens.activityShare).toEqual({ size: 11 });
    expect({ node: strokeTokens.node, group: strokeTokens.group, halo: strokeTokens.halo }).toEqual(today.stroke);
    expect(dashTokens.group).toEqual(today.dash);
    expect({ reconnectedNode: dashTokens.reconnectedNode, reconnectedPath: dashTokens.reconnectedPath, note: dashTokens.note, constraint: dashTokens.constraint }).toEqual({ reconnectedNode: [4, 3], reconnectedPath: [6, 5], note: [2, 3], constraint: [2, 4] });
    expect({ node: radiusTokens.node, large: radiusTokens.large, band: radiusTokens.band }).toEqual(today.radius);
    expect(opacityTokens.dimmed).toBe(today.dimmed);
    expect(spaceTokens.unit).toBe(2);
    expect(zTokens.menu).toBe(30);
    expect(dimensionTokens.band).toBe(8);
  });

  it("hold only sizes, weights, radii and strokes of the scales, in the default look and in print", () => {
    const off: string[] = [];
    for (const theme of [defaultTheme, printTheme]) {
      for (const [role, style] of Object.entries(theme.text) as [string, { size?: number | string; weight?: number }][]) {
        if (style.size !== undefined && ![11, 13, 15].includes(style.size as number)) off.push(`text.${role}.size ${style.size}`);
        if (style.weight !== undefined && ![400, 500, 600].includes(style.weight)) off.push(`text.${role}.weight ${style.weight}`);
      }
      // A full radius: a pill's (999, which a mark resolves to half its height) or a circle's.
      for (const [role, r] of Object.entries(theme.radius)) if (![4, 8, 999, "50%"].includes(r)) off.push(`radius.${role} ${r}`);
      const ranges: readonly string[] = unscaledStrokes;
      for (const [role, w] of Object.entries(theme.stroke)) if (!ranges.includes(role) && ![1, 2].includes(w)) off.push(`stroke.${role} ${w}`);
    }
    expect(off).toEqual([]);
    // Not strokes of the scale: the range a path's width encodes its cases in, the width an arc adds for its coverage, and the pointer's width on a path.
    // How much thinner a backward path is drawn is a step of the width scale, not a stroke of it.
    expect(unscaledStrokes).toEqual(["pathMin", "pathMax", "arcCoverage", "pathHit", "backwardStep"]);
    expect(fontTokens.family.split(",")[0]).toBe("system-ui");
  });

  it("are what SVG, Canvas and the marks the interactive map draws read for a group: its label and its solid outline", () => {
    let { svg, canvas } = drawn();
    expect(svg).toContain(`stroke="#cfd4dc" stroke-width="1"/>`);
    expect(svg).toContain(`font-size="13" font-weight="600" fill="#5b6270"`);
    expect(canvas).toContain(`lineWidth=1\nsetLineDash([[]])`);
    expect(canvas).toContain(`font="600 13px`);
    set(textTokens, "groupLabel", { size: 17, weight: 800 });
    set(strokeTokens, "group", 2.75);
    // A dash means "not directly observed": the group's dash is read by nothing.
    set(dashTokens, "group", [9, 7]);
    ({ svg, canvas } = drawn());
    expect(svg).toContain(`stroke="#cfd4dc" stroke-width="2.75"/>`);
    expect(svg).not.toContain(`stroke-dasharray="9 7"`);
    expect(svg).toContain(`font-size="17" font-weight="800"`);
    expect(canvas).toContain(`lineWidth=2.75\nsetLineDash([[]])`);
    expect(canvas).toContain(`font="800 17px`);
    // The interactive map draws the group's mark, which the stylesheet no longer sizes; no group is dashed.
    const [mark] = buildScene(graph, positions).groupMarks;
    expect([mark.stroke.width, mark.stroke.dash, mark.texts[0].size, mark.texts[0].weight]).toEqual([2.75, undefined, 17, 800]);
    // The stylesheet reads the role's variables only where a text has no size or weight of its mark (`--wf-text-size`, `--wf-text-weight`).
    expect(markFirst(stylesheet)).not.toMatch(/--wf-(stroke-group|text-group-label|weight-group-label)\b/);
  });

  it("are what SVG, Canvas and the marks the interactive map draws read for an activity: its outline, radius, name and band, and the stylesheet for the band's corners", () => {
    set(strokeTokens, "node", 2.25);
    set(radiusTokens, "node", 7.5);
    set(radiusTokens, "band", 1.25);
    set(textTokens, "activityName", { size: 12.5, weight: 500, lineHeight: 16 });
    const { svg, canvas } = drawn();
    // Stage s1 hashes to the fourth of the six categorical colours, #56B4E9.
    expect(svg).toContain(`<rect x="0" y="0" width="100" height="40" rx="7.5" fill="#ffffff" stroke="#8c94a1" stroke-width="2.25"/>`);
    expect(svg).toContain(`<rect x="0" y="0" width="8" height="40" class="wf-band" rx="1.25" fill="#56B4E9"/>`);
    expect(svg).toContain(`font-size="12.5" font-weight="500"`);
    expect(canvas).toContain(`lineWidth=2.25`);
    expect(canvas).toContain(`font="500 12.5px`);
    const mark = buildScene(graph, positions).nodeMarks.find((m) => m.id === "a")!;
    expect([mark.stroke.width, mark.radius, mark.texts[0].size]).toEqual([2.25, 7.5, 12.5]);
    expect(rule(".wf-node")).toContain("border: var(--wf-node-stroke) solid var(--wf-node-outline);");
    expect(rule(".wf-node")).toContain("border-radius: var(--wf-node-radius);");
    expect(markFirst(stylesheet)).not.toMatch(/--wf-(stroke-node|text-node-label|text-activity-name)\b/);
    expect(tokenVariables().light).toMatchObject({ "--wf-radius-band": "1.25px" });
    expect(rule(".wf-node__band")).toContain("border-radius: var(--wf-radius-band) 0 0 var(--wf-radius-band);");
  });

  it("give the Canvas selection ring its own width, its inner edge on the element, whatever the stylesheet's ring", () => {
    // 2 wide, centred 1 outside the activity (0, 0, 100 × 40), with corners of 8.
    expect(selected()).toContain(`lineWidth=2\nsetLineDash([[]])\nbeginPath([])\nmoveTo([7,-1])\nlineTo([93,-1])`);
    set(strokeTokens, "selection", 5);
    expect(selected()).toContain(`lineWidth=2\nsetLineDash([[]])\nbeginPath([])\nmoveTo([7,-1])\nlineTo([93,-1])`);
    set(strokeTokens, "canvasSelection", 10);
    expect(selected()).toContain(`lineWidth=10\nsetLineDash([[]])\nbeginPath([])\nmoveTo([3,-5])\nlineTo([97,-5])`);
  });

  it("are what SVG, Canvas and the stylesheet read for a path's count and its halo, a dimmed element and a legend row", () => {
    set(textTokens, "pathLabel", { size: 10.5 });
    set(strokeTokens, "halo", 3.5);
    set(opacityTokens, "dimmed", 0.3);
    set(textTokens, "legendItem", { size: 11.5, weight: 650 });
    const { svg, canvas } = drawn();
    expect(svg).toContain(`font-size="10.5" text-anchor="middle" fill="#1f1f1f" paint-order="stroke" stroke="#ffffff" stroke-width="3.5"`);
    expect(canvas).toContain(`lineWidth=3.5\nstrokeText(["12"`);
    expect(canvas).toContain(`font="10.5px`);
    expect(canvas).toContain(`globalAlpha=0.3`);
    expect(canvas).toContain(`font="650 11.5px`);
    expect(tokenVariables().light).toMatchObject({ "--wf-text-path-label": "10.5px", "--wf-stroke-halo": "3.5px", "--wf-opacity-dimmed": "0.3", "--wf-text-legend-item": "11.5px", "--wf-weight-legend-item": "650" });
    // The label's own size (the scene's, which a theme's rule may change) comes first, the role's after it.
    expect(rule(".wf-edge-label")).toContain("font-size: var(--wf-text-size, var(--wf-text-path-label));");
    expect(rule(".wf-edge-label")).toContain("stroke-width: var(--wf-stroke-halo);");
    expect(rule(".wf-node--dimmed")).toContain("opacity: var(--wf-opacity-dimmed);");
    expect(rule(".wf-legend dt")).toContain("font-size: var(--wf-text-legend-item);");
  });
});
