import { describe, expect, it } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type Box, type FlowEdge, type Positions, abstract, elementPoint, fitViewport, inViewText, layout, overlaysFor, panelInsets, partInView } from "../../src/index";
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
  it("keeps a host's many panels clear in time", () => {
    // Forty panels along the top and the bottom: 2 ** 40 ways to keep each clear are too many to try one by one.
    const many = Array.from({ length: 40 }, (_, i) => ({ x: 25 * (i % 20) + 2, y: i < 20 ? 0 : 480, width: 20, height: 20 }));
    const bounds = { x: 0, y: 0, width: 1000, height: 200 };
    const started = performance.now();
    const insets = panelInsets(many, area, bounds, { padding: 0, gap: 0 });
    expect(performance.now() - started).toBeLessThan(1000);
    // Along the area: below the top row (20) and above the bottom row (500 - 480 = 20) leaves 1000 by 460, zoom 1.
    expect(insets).toEqual({ top: 20, right: 0, bottom: 20, left: 0 });
    const drawn = onScreen(bounds, fitViewport(bounds, area, { padding: 0, insets }));
    for (const p of many) expect(meets(p, drawn)).toBe(false);
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

describe("the part of a map in view", () => {
  const card = (kind: "activity" | "stage" | "event", x: number, y: number) => ({ kind, box: { x, y, width: 100, height: 40 } });
  const path = (id: string, points: { x: number; y: number }[], kind: "follows" | "constraint" = "follows") => ({ edge: { id, kind, source: "a", target: "b" } as FlowEdge, points });
  // A (0..100), B (300..400) and C (600..700) in a row, an event below A; the paths A → B and B → C, and a constraint along them.
  const scene = {
    nodeMarks: [card("activity", 0, 0), card("stage", 300, 0), card("activity", 600, 0), card("event", 0, 200)],
    edgeMarks: [path("ab", [{ x: 100, y: 20 }, { x: 300, y: 20 }]), path("bc", [{ x: 400, y: 20 }, { x: 600, y: 20 }]), path("k", [{ x: 0, y: 40 }, { x: 600, y: 40 }], "constraint")],
  };
  const area = { width: 400, height: 300 };

  it("counts the cards whose box and the paths whose line reach into the view: not events, not constraints", () => {
    // From the origin at zoom 1 the view ends at 400: A and B (from 300) are in it, with A → B; C and B → C lie beyond.
    expect(partInView(scene, { x: 0, y: 0, zoom: 1 }, area)).toEqual({ nodes: 2, ofNodes: 3, edges: 1, ofEdges: 2, whole: false });
    // Zoomed out to 0.5 the view reaches 800: everything.
    expect(partInView(scene, { x: 0, y: 0, zoom: 0.5 }, area)).toEqual({ nodes: 3, ofNodes: 3, edges: 2, ofEdges: 2, whole: true });
    // Moved 350 to the right: B and C, and B → C; A → B ends at 300, before the view.
    expect(partInView(scene, { x: -350, y: 0, zoom: 1 }, area)).toMatchObject({ nodes: 2, edges: 1, whole: false });
    // 150 kept clear on the right leaves the view at 250: B is out, and A → B still crosses the edge of the view.
    expect(partInView(scene, { x: 0, y: 0, zoom: 1 }, area, { right: 150 })).toMatchObject({ nodes: 1, edges: 1 });
    // A view without a zoom shows nothing.
    expect(partInView(scene, { x: 0, y: 0, zoom: 0 }, area)).toEqual({ nodes: 0, ofNodes: 3, edges: 0, ofEdges: 2, whole: false });
    expect(partInView({ nodeMarks: [], edgeMarks: [] }, { x: 0, y: 0, zoom: 1 }, area).whole).toBe(true);
  });

  it("is said in words, in English and in German", () => {
    const part = { nodes: 17, ofNodes: 42, edges: 23, ofEdges: 1200, whole: false };
    expect(inViewText(part)).toBe("17 of 42 activities and 23 of 1,200 paths in view");
    expect(inViewText(part, "de")).toBe("17 von 42 Aktivitäten und 23 von 1.200 Pfaden im Blick");
  });
});

describe("the point an element is brought into view at", () => {
  const positions: Pick<Positions, "nodes" | "groups" | "edges"> = {
    nodes: { a: { x: 0, y: 0, width: 100, height: 40 }, b: { x: 300, y: 100, width: 100, height: 40 } },
    groups: { g: { x: -10, y: -10, width: 500, height: 200 } },
    edges: { ab: { points: [{ x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 120 }, { x: 300, y: 120 }] } },
  };
  const edges: FlowEdge[] = [{ id: "ab", kind: "follows", source: "a", target: "b" }, { id: "ba", kind: "follows", source: "b", target: "a" }];

  it("is the centre of a node's or a group's box, the middle of an edge's route or the midpoint between its ends", () => {
    expect(elementPoint({ kind: "node", id: "a" }, positions)).toEqual({ x: 50, y: 20 });
    expect(elementPoint({ kind: "group", id: "g" }, positions)).toEqual({ x: 240, y: 90 });
    // Four points: halfway between the second and the third.
    expect(elementPoint({ kind: "edge", id: "ab" }, positions, edges)).toEqual({ x: 200, y: 70 });
    // Three points: the middle one.
    expect(elementPoint({ kind: "edge", id: "ab" }, { ...positions, edges: { ab: { points: [{ x: 100, y: 20 }, { x: 150, y: 60 }, { x: 300, y: 120 }] } } }, edges)).toEqual({ x: 150, y: 60 });
    // Without a route, between the centres of B (350, 120) and A (50, 20).
    expect(elementPoint({ kind: "edge", id: "ba" }, positions, edges)).toEqual({ x: 200, y: 70 });
    expect(elementPoint({ kind: "node", id: "x" }, positions)).toBeUndefined();
    expect(elementPoint({ kind: "edge", id: "x" }, positions, edges)).toBeUndefined();
  });
});
