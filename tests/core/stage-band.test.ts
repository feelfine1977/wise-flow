/**
 * The colour band along a card's left edge (WF-01): drawn only where the
 * card's colour says something (its stage, or another category or value of
 * the node colour), never in the neutral colour of a node without one, and
 * as wide as the theme's `size.band` (0: none), in every renderer.
 */
import { describe, expect, it } from "vitest";
import { smallP2P } from "../../fixtures/p2p_small";
import { type FlowGraph, type Positions, buildScene, createPositions, defaultNodeSize, defaultTheme, instrumentTheme, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene } from "../../src/canvas/index";

function row(graph: FlowGraph): Positions {
  let x = 0;
  const nodes = Object.fromEntries(graph.nodes.map((n) => {
    const s = defaultNodeSize(n);
    const box = { x, y: 0, ...s };
    x += s.width + 40;
    return [n.id, box];
  }));
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}

/** The small P2P without its stages. */
const groupless: FlowGraph = { ...smallP2P, groups: [], nodes: smallP2P.nodes.map(({ group: _, ...n }) => n) };
/** The small P2P with its second activity, "Change Price", outside every stage. */
const mixed: FlowGraph = { ...smallP2P, nodes: smallP2P.nodes.map((n) => (n.id === "change_price" ? (({ group: _, ...rest }) => rest)(n) : n)) };
const bands = (g: FlowGraph, theme = defaultTheme) => buildScene(g, row(g), { theme }).nodeMarks.filter((m) => m.kind === "activity").map((m) => m.band);

/** Every fillRect of a Canvas drawing as [x, width, fill]. */
function filled(draw: (ctx: DrawContext) => void): [number, number, string][] {
  const out: [number, number, string][] = [];
  const ctx = new Proxy({ fillStyle: "", measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (target, key) => (key in target ? target[key as string] : key === "fillRect" ? (x: number, _y: number, w: number) => out.push([x, w, String(target.fillStyle)]) : () => undefined),
    set: (target, key, value) => ((target[key as string] = value), true),
  }) as unknown as DrawContext;
  draw(ctx);
  return out;
}

describe("the stage band", () => {
  it("is drawn on a staged card at the theme's width and on no card of a graph without stages", () => {
    expect(new Set(bands(smallP2P))).toEqual(new Set([8]));
    expect(new Set(bands(smallP2P, instrumentTheme))).toEqual(new Set([6]));
    expect(bands(groupless)).toEqual(groupless.nodes.filter((n) => n.kind === "activity").map(() => undefined));
    expect(bands(groupless, instrumentTheme).every((b) => b === undefined)).toBe(true);
  });

  it("leaves out the band of the one card without a stage in a staged graph", () => {
    const [first, second, ...rest] = bands(mixed);
    expect([first, second]).toEqual([8, undefined]);
    expect(rest.every((b) => b === 8)).toBe(true);
  });

  it("follows a node colour by value too, but not its neutral fallback", () => {
    const valued: FlowGraph = { ...groupless, nodes: groupless.nodes.map((n) => (n.id === "create_po" ? { ...n, metrics: { ...n.metrics, delta_violationShare: 0.2 } } : n)) };
    const marks = buildScene(valued, row(valued), { style: { nodeColor: { metric: "delta_violationShare", palette: "diverging", domain: [-0.5, 0, 0.5] } } }).nodeMarks.filter((m) => m.kind === "activity");
    expect(marks.map((m) => m.band)).toEqual([8, ...marks.slice(1).map(() => undefined)]);
  });

  it("is never drawn with a band of 0", () => {
    expect(bands(smallP2P, { ...defaultTheme, size: { ...defaultTheme.size, band: 0 } }).every((b) => b === undefined)).toBe(true);
  });

  it("is absent from the SVG export and the Canvas drawing of a graph without stages, and as wide as the theme says where there are stages", () => {
    expect(toSVG({ graph: groupless, positions: row(groupless) }, { legend: false, theme: "instrument" })).not.toContain('class="wf-band"');
    const staged = toSVG({ graph: smallP2P, positions: row(smallP2P) }, { legend: false, theme: "instrument" });
    expect([...staged.matchAll(/<rect [^>]*width="(\d+)"[^>]*class="wf-band"/g)].map((m) => m[1]).every((w) => w === "6")).toBe(true);
    expect(staged).toContain('class="wf-band"');
    const view = { x: 0, y: 0, zoom: 1, width: 2000, height: 400 };
    const scene = prepareScene(groupless, row(groupless), { theme: instrumentTheme });
    const colours = new Set(scene.nodes.map((n) => n.mark.color));
    // No rectangle of a node's colour (the neutral grey) is filled at a card's left edge.
    const lefts = new Set(Object.values(row(groupless).nodes).map((b) => b.x));
    expect(filled((ctx) => drawScene(ctx, scene, view)).filter(([x, , fill]) => lefts.has(x) && colours.has(fill))).toEqual([]);
  });
});
