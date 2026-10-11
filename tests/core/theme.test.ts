import { describe, expect, it } from "vitest";
import { type FlowGraph, type Theme, buildScene, createPositions, defaultTheme, themeColors, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";
import { graph, positions } from "./element-kinds";

/** A 2D context that logs assignments and calls. */
function recording() {
  const log: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createLinearGradient: undefined, createPattern: undefined } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => log.push(`${k}(${JSON.stringify(a)})`)),
    set: (t, k: string, v) => (log.push(`${k}=${JSON.stringify(v)}`), (t[k] = v), true),
  }) as unknown as DrawContext;
  return { ctx, log };
}

const at = { x: 0, y: 0, zoom: 1, width: 900, height: 200 };

/** Outline 3, radius 9 and labels at 15 instead of 2, 6 and 12. */
const second: Theme = {
  ...defaultTheme,
  stroke: { ...defaultTheme.stroke, node: 3 },
  radius: { ...defaultTheme.radius, node: 9 },
  text: { ...defaultTheme.text, nodeLabel: { size: 15 } },
};

describe("the theme of a scene", () => {
  it("is the default theme in the light scheme unless one is given", () => {
    const scene = buildScene(graph, positions);
    expect(scene.theme).toBe(defaultTheme);
    expect(scene.scheme).toBe("light");
    expect([scene.colors.paper, scene.colors.ink, scene.colors.line, scene.colors.neutral]).toEqual(["#ffffff", "#1f1f1f", "#cfd4dc", "#8c8c8c"]);
  });

  it("gives the marks, the SVG export and the Canvas calls a second theme's outline, radius and text size", () => {
    const scene = buildScene(graph, positions, { theme: second });
    const activity = scene.nodeMarks.find((m) => m.id === "a")!;
    expect([activity.stroke.width, activity.radius, activity.texts[0].size]).toEqual([3, 9, 15]);
    // The stage keeps its own outline (3) and its label the node label's size.
    const stage = scene.nodeMarks.find((m) => m.id === "s")!;
    expect([stage.stroke.width, stage.radius, stage.texts[0].size]).toEqual([3, 9, 15]);

    const svg = toSVG({ graph, positions }, { theme: second, legend: false });
    expect(svg).toContain('<rect x="100" y="0" width="180" height="40" rx="9" fill="#ffffff" stroke="#8c8c8c" stroke-width="3"/>');
    expect(svg).toContain('<text x="116" y="24.5" font-size="15" fill="#1f1f1f">Check invoice</text>');

    const { ctx, log } = recording();
    drawScene(ctx, prepareScene(graph, positions, { theme: second, lodBySize: false }), at, undefined, { cull: false });
    const calls = log.join("\n");
    // The activity's corner arcs have radius 9, its outline is 3 wide and its label is written at 15.
    expect(calls).toContain("arc([271,9,9,");
    expect(calls).toContain('strokeStyle="#8c8c8c"\nlineWidth=3');
    expect(calls).toContain(`font="15px ${defaultTheme.font.family}"`);
  });

  it("resolves the dark scheme's colour roles in the scene, the SVG export and the Canvas calls", () => {
    const scene = buildScene(graph, positions, { scheme: "dark" });
    expect([scene.colors.paper, scene.colors.surface, scene.colors.ink, scene.colors.inkMuted, scene.colors.line]).toEqual(["#16181d", "#1f2229", "#ececec", "#a7adb8", "#3a3f49"]);
    // Roles the dark scheme does not change keep their light colour.
    expect([scene.colors.neutral, scene.colors.focus, scene.colors.outOfScope]).toEqual(["#8c8c8c", "#0072b2", "#b0b0b0"]);
    expect(themeColors(defaultTheme, "light")).toBe(defaultTheme.color);

    const svg = toSVG({ graph, positions }, { scheme: "dark", legend: false });
    expect(svg).toMatch(/^<svg[^>]*><defs>.*<\/defs><rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="#16181d"\/>/);
    expect(svg).toContain('<rect x="100" y="0" width="180" height="40" rx="6" fill="#16181d" stroke="#8c8c8c" stroke-width="2"/>');
    expect(svg).toContain('fill="#ececec">Check invoice</text>');
    expect(svg).toContain('fill="#a7adb8">1,234</text>');

    const { ctx, log } = recording();
    drawScene(ctx, prepareScene(graph, positions, { scheme: "dark", lodBySize: false }), at, undefined, { cull: false });
    const calls = log.join("\n");
    expect(calls.split("\n").slice(0, 8)).toContain('fillStyle="#16181d"');
    expect(calls).toContain('fillStyle="#ececec"\nfont="12px');
  });

  it("resolves the data colours through the theme's palettes and colour roles", () => {
    const g: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "x" },
        { id: "b", kind: "activity", label: "B", group: "y" },
      ],
      edges: [
        { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 4, violationShare: 0.5 } },
        { id: "ba", kind: "constraint", source: "b", target: "a" },
      ],
      groups: [
        { id: "x", kind: "stage", label: "X" },
        { id: "y", kind: "stage", label: "Y" },
      ],
      overlays: [{ kind: "badge", target: "a", payload: { value: 0.25 } }],
    };
    const p = createPositions(
      {
        nodes: { a: { x: 10, y: 40, width: 100, height: 40 }, b: { x: 200, y: 40, width: 100, height: 40 } },
        groups: { x: { x: 0, y: 0, width: 120, height: 100 }, y: { x: 190, y: 0, width: 120, height: 100 } },
        edges: {},
      },
      "given",
      "RIGHT",
    );
    const theme: Theme = {
      ...defaultTheme,
      color: { ...defaultTheme.color, mechanism: "#abcdef" },
      // Every key gets the same colour whatever its hash; shortfall runs from black to white.
      palette: { ...defaultTheme.palette, categorical: Array(8).fill("#123456"), shortfall: ["#000000", "#ffffff"] },
    };
    const scene = buildScene(g, p, { theme });
    expect(scene.nodeMarks.map((m) => m.color)).toEqual(["#123456", "#123456"]);
    expect(scene.groupMarks.map((m) => m.color)).toEqual(["#123456", "#123456"]);
    // 0.5 of the way from 0 to 255 is 127.5, which rounds to 0x80; the badge's 0.25 gives 63.75, 0x40.
    expect(scene.edgeMarks.map((m) => m.color)).toEqual(["#808080", "#abcdef"]);
    expect(scene.marks.find((m) => m.kind === "badge")!.color).toBe("#404040");
    expect(scene.scales.legend.find((l) => l.kind === "sequential")).toMatchObject({ stops: ["#000000", "#ffffff"] });
  });
});
