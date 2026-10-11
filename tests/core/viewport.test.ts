import { describe, expect, it } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type Box, abstract, fitViewport, layout, overlaysFor, panelInsets } from "../../src/index";
import { CanvasRenderer, prepareScene } from "../../src/canvas/index";

/** The box `bounds` takes on screen in a view. */
const onScreen = (b: Box, v: { x: number; y: number; zoom: number }): Box => ({ x: b.x * v.zoom + v.x, y: b.y * v.zoom + v.y, width: b.width * v.zoom, height: b.height * v.zoom });
const meets = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe("the fitted view", () => {
  const bounds = { x: 0, y: 0, width: 100, height: 50 };
  const area = { width: 400, height: 300 };

  it("shows the bounds whole and centred in the area", () => {
    // 400 / 100 = 4 across, 300 / 50 = 6 down: zoom 4; the centre (50, 25) at (200, 150).
    expect(fitViewport(bounds, area, { padding: 0 })).toEqual({ x: 0, y: 50, zoom: 4 });
    // A padding of a quarter on each side: 400 / 150 = 2.67, 300 / 75 = 4.
    const padded = fitViewport(bounds, area, { padding: 0.25 });
    expect(padded.zoom).toBeCloseTo(8 / 3);
    expect(padded.x).toBeCloseTo(200 - 50 * (8 / 3));
  });

  it("keeps the insets clear and centres in what is left", () => {
    // 100 kept clear on the left: 300 by 300 left, zoom 3, centred at (100 + 150, 150).
    expect(fitViewport(bounds, area, { padding: 0, insets: { left: 100 } })).toEqual({ x: 100, y: 75, zoom: 3 });
    // 50 at the top and 30 at the bottom: 400 by 220, zoom 4, centred at (200, 50 + 110).
    expect(fitViewport(bounds, area, { padding: 0, insets: { top: 50, bottom: 30 } })).toEqual({ x: 0, y: 60, zoom: 4 });
  });

  it("clamps the zoom and ignores insets that leave no room", () => {
    expect(fitViewport(bounds, area, { padding: 0, maxZoom: 2 })).toEqual({ x: 100, y: 100, zoom: 2 });
    expect(fitViewport(bounds, area, { padding: 0, minZoom: 5 })).toEqual({ x: -50, y: 25, zoom: 5 });
    expect(fitViewport(bounds, area, { padding: 0, insets: { left: 300, right: 200 } })).toEqual(fitViewport(bounds, area, { padding: 0 }));
  });
});

describe("the insets that keep a map clear of its panels", () => {
  const area = { width: 1000, height: 500 };
  // The abstraction panel at the top left, the legend strip at the bottom right.
  const panels = [
    { x: 10, y: 10, width: 200, height: 100 },
    { x: 640, y: 450, width: 350, height: 40 },
  ];

  it("keeps each panel clear across or along the area, whichever leaves the larger zoom", () => {
    // A wide map: below the panel (top 110) and above the strip (bottom 50) leaves 1000 by 340, zoom 1; any inset
    // across the area makes it narrower (left 210 with bottom 50: 790 / 1000 = 0.79).
    expect(panelInsets(panels, area, { x: 0, y: 0, width: 1000, height: 200 }, { padding: 0 })).toEqual({ top: 110, right: 0, bottom: 50, left: 0 });
    // A tall map: beside both (left 210, right 360) leaves 430 by 500, zoom 0.5; top and bottom leave 340 / 1000.
    expect(panelInsets(panels, area, { x: 0, y: 0, width: 200, height: 1000 }, { padding: 0 })).toEqual({ top: 0, right: 360, bottom: 0, left: 210 });
    // The gap is added to each inset.
    expect(panelInsets(panels, area, { x: 0, y: 0, width: 1000, height: 200 }, { padding: 0, gap: 8 })).toEqual({ top: 118, right: 0, bottom: 58, left: 0 });
  });

  it("leaves out panels without a size", () => {
    expect(panelInsets([{ x: 10, y: 10, width: 0, height: 0 }], area, { x: 0, y: 0, width: 10, height: 10 })).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("fits the bounds where no panel covers them, for maps of many shapes", () => {
    const zoomControl = { x: 10, y: 450, width: 160, height: 40 };
    for (const [width, height] of [[1000, 200], [600, 400], [300, 300], [200, 1000], [2400, 300]]) {
      const bounds = { x: -40, y: 25, width, height };
      const all = [...panels, zoomControl];
      const view = fitViewport(bounds, area, { padding: 0.04, insets: panelInsets(all, area, bounds, { padding: 0.04, gap: 8 }) });
      const drawn = onScreen(bounds, view);
      for (const p of all) expect(meets(p, drawn), `${width} × ${height} under ${JSON.stringify(p)}`).toBe(false);
    }
  });
});

describe("the Canvas renderer's fit", () => {
  it("keeps the insets clear", async () => {
    const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
    const scene = prepareScene(graph, await layout(graph, { engine: "dagre" }), { overlays: overlaysFor(constraintItems(vendorSceneKey), { graph }) });
    const canvas = { width: 0, height: 0, style: {}, getContext: () => null } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1 });
    renderer.resize(800, 600);
    renderer.setScene(scene);
    renderer.fit(0.08);
    const plain = renderer.getViewport();
    renderer.fit(0.08, { left: 200, bottom: 100 });
    const inset = renderer.getViewport();
    // The same as the view of an area of 600 by 500 moved 200 to the right.
    expect(inset).toEqual(fitViewport(scene.bounds, { width: 800, height: 600 }, { padding: 0.08, insets: { left: 200, bottom: 100 }, minZoom: renderer.minZoom, maxZoom: renderer.maxZoom }));
    expect(inset.zoom).toBeLessThan(plain.zoom);
    const drawn = onScreen(scene.bounds, inset);
    expect(drawn.x).toBeGreaterThanOrEqual(200);
    expect(drawn.y + drawn.height).toBeLessThanOrEqual(500);
  });
});
