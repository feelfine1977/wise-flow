import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { type FlowGraph, buildScene, dashTokens, dimensionTokens, opacityTokens, radiusTokens, spaceTokens, strokeTokens, textTokens, toSVG, tokenVariables, zTokens } from "../../src/index";
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
  const svg = toSVG({ graph: counted, positions }, { legend: false });
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

// The values below are the ones the renderers drew before the table named them.
const today = {
  groupLabel: { size: 14, weight: 600 },
  nodeLabel: 12,
  pathLabel: 10,
  legendItem: { size: 11, weight: 600 },
  stroke: { node: 2, group: 1.5, halo: 3 },
  dash: [6, 4],
  radius: { node: 6, large: 10, band: 3 },
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

describe("the role tables", () => {
  it("hold the values drawn today", () => {
    expect(textTokens.groupLabel).toEqual(today.groupLabel);
    expect(textTokens.nodeLabel.size).toBe(today.nodeLabel);
    expect(textTokens.pathLabel.size).toBe(today.pathLabel);
    expect(textTokens.legendItem).toEqual(today.legendItem);
    expect(textTokens.activityName).toEqual({ size: 14, weight: 500, lineHeight: 18 });
    expect(textTokens.activityNumber).toEqual({ size: 12, lineHeight: 16 });
    expect({ node: strokeTokens.node, group: strokeTokens.group, halo: strokeTokens.halo }).toEqual(today.stroke);
    expect(dashTokens.group).toEqual(today.dash);
    expect({ reconnectedNode: dashTokens.reconnectedNode, reconnectedPath: dashTokens.reconnectedPath, note: dashTokens.note, constraint: dashTokens.constraint }).toEqual({ reconnectedNode: [4, 3], reconnectedPath: [6, 5], note: [2, 3], constraint: [2, 4] });
    expect({ node: radiusTokens.node, large: radiusTokens.large, band: radiusTokens.band }).toEqual(today.radius);
    expect(opacityTokens.dimmed).toBe(today.dimmed);
    expect(spaceTokens.unit).toBe(2);
    expect(zTokens.menu).toBe(30);
    expect(dimensionTokens.band).toBe(8);
  });

  it("are what SVG, Canvas and the marks the interactive map draws read for a group: its label and outline, never a dash", () => {
    let { svg, canvas } = drawn();
    expect(svg).toContain(`rx="10" fill="#0072B2" fill-opacity="0.06" stroke="#0072B2" stroke-width="1.5"/>`);
    expect(svg).toContain(`font-size="14" font-weight="600"`);
    expect(canvas).toContain(`lineWidth=1.5\nsetLineDash([[]])`);
    expect(canvas).toContain(`font="600 14px`);
    set(textTokens, "groupLabel", { size: 17, weight: 800 });
    set(strokeTokens, "group", 2.75);
    // A dash means "not directly observed": the group's dash is read by nothing.
    set(dashTokens, "group", [9, 7]);
    ({ svg, canvas } = drawn());
    expect(svg).toContain(`rx="10" fill="#0072B2" fill-opacity="0.06" stroke="#0072B2" stroke-width="2.75"/>`);
    expect(svg).not.toContain(`stroke-dasharray="9 7"`);
    expect(svg).toContain(`font-size="17" font-weight="800"`);
    expect(canvas).toContain(`lineWidth=2.75\nsetLineDash([[]])`);
    expect(canvas).toContain(`font="800 17px`);
    // The interactive map draws the group's mark, which the stylesheet no longer sizes.
    const [mark] = buildScene(graph, positions).groupMarks;
    expect([mark.stroke.width, mark.stroke.dash, mark.texts[0].size, mark.texts[0].weight]).toEqual([2.75, undefined, 17, 800]);
    expect(stylesheet).not.toMatch(/--wf-(stroke-group|text-group-label|weight-group-label)\b/);
  });

  it("are what SVG, Canvas and the marks the interactive map draws read for an activity: its outline, radius, label and band, and the stylesheet for the band's corners", () => {
    set(strokeTokens, "node", 2.25);
    set(radiusTokens, "node", 7.5);
    set(radiusTokens, "band", 1.25);
    set(textTokens, "nodeLabel", { size: 12.5 });
    const { svg, canvas } = drawn();
    // Stage s1 hashes to the fourth of the six categorical colours, #56B4E9.
    expect(svg).toContain(`<rect x="0" y="0" width="100" height="40" rx="7.5" fill="#ffffff" stroke="#56B4E9" stroke-width="2.25"/>`);
    expect(svg).toContain(`<rect x="0" y="0" width="8" height="40" rx="1.25" fill="#56B4E9"/>`);
    expect(svg).toContain(`font-size="12.5"`);
    expect(canvas).toContain(`lineWidth=2.25`);
    expect(canvas).toContain(`font="12.5px`);
    const mark = buildScene(graph, positions).nodeMarks.find((m) => m.id === "a")!;
    expect([mark.stroke.width, mark.radius, mark.texts[0].size]).toEqual([2.25, 7.5, 12.5]);
    expect(rule(".wf-node")).toContain("border: var(--wf-node-stroke) solid var(--wf-node-outline);");
    expect(rule(".wf-node")).toContain("border-radius: var(--wf-node-radius);");
    expect(stylesheet).not.toMatch(/--wf-(stroke-node|text-node-label)\b/);
    expect(tokenVariables().light).toMatchObject({ "--wf-radius-band": "1.25px" });
    expect(rule(".wf-node__band")).toContain("border-radius: var(--wf-radius-band) 0 0 var(--wf-radius-band);");
  });

  it("give the Canvas selection ring its own width, its inner edge on the element, whatever the stylesheet's ring", () => {
    // Today: 6 wide, centred 3 outside the activity, with corners of 8.
    expect(selected()).toContain(`lineWidth=6\nsetLineDash([[]])\nbeginPath([])\nmoveTo([5,-3])\nlineTo([95,-3])`);
    set(strokeTokens, "selection", 5);
    expect(selected()).toContain(`lineWidth=6\nsetLineDash([[]])\nbeginPath([])\nmoveTo([5,-3])\nlineTo([95,-3])`);
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
    expect(rule(".wf-edge-label")).toContain("font-size: var(--wf-text-path-label);");
    expect(rule(".wf-edge-label")).toContain("stroke-width: var(--wf-stroke-halo);");
    expect(rule(".wf-node--dimmed")).toContain("opacity: var(--wf-opacity-dimmed);");
    expect(rule(".wf-legend dt")).toContain("font-size: var(--wf-text-legend-item);");
  });
});
