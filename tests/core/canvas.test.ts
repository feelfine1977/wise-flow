import { describe, expect, it } from "vitest";
import { constraintItems, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type Positions, abstract, layout, overlaysFor } from "../../src/index";
import { CanvasRenderer, type DrawContext, defaultTokens, drawLegend, drawScene, prepareScene, toPNGCanvas, toPNGDataUrl, tracePath } from "../../src/canvas/index";

/** A 2D context that records the calls the drawing routines make. */
function recordingContext() {
  const calls: Record<string, number> = {};
  const texts: string[] = [];
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const ctx = {
    fillStyle: "" as string,
    strokeStyle: "" as string,
    lineWidth: 1,
    font: "",
    textAlign: "left" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    globalAlpha: 1,
    lineJoin: "miter" as CanvasLineJoin,
    lineCap: "butt" as CanvasLineCap,
    save: () => count("save"),
    restore: () => count("restore"),
    translate: () => count("translate"),
    scale: () => count("scale"),
    beginPath: () => count("beginPath"),
    closePath: () => count("closePath"),
    moveTo: () => count("moveTo"),
    lineTo: () => count("lineTo"),
    bezierCurveTo: () => count("bezierCurveTo"),
    arc: () => count("arc"),
    rect: () => count("rect"),
    fill: () => count("fill"),
    stroke: () => count("stroke"),
    fillRect: () => count("fillRect"),
    clearRect: () => count("clearRect"),
    fillText: (text: string) => {
      count("fillText");
      texts.push(text);
    },
    strokeText: () => count("strokeText"),
    measureText: (text: string) => ({ width: text.length * 6 }),
    setLineDash: () => count("setLineDash"),
  } satisfies DrawContext;
  return { ctx, calls, texts };
}

const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
const overlays = overlaysFor(constraintItems(vendorSceneKey), { graph });
let positions: Positions | undefined;
async function pos() {
  positions ??= await layout(graph, { engine: "dagre" });
  return positions;
}

describe("prepareScene", () => {
  it("resolves every element with its geometry, colours and overlay shapes and answers hits", async () => {
    const p = await pos();
    const scene = prepareScene(graph, p, { overlays, lanes: "stages" });
    expect(scene.nodes).toHaveLength(graph.nodes.filter((n) => p.nodes[n.id]).length);
    expect(scene.edges).toHaveLength(graph.edges.filter((e) => e.source !== e.target && p.nodes[e.source] && p.nodes[e.target]).length);
    expect(scene.groups.length).toBeGreaterThan(0);
    expect(scene.bands.length).toBeGreaterThan(0);
    expect(scene.size).toBe(scene.nodes.length + scene.edges.length);
    const clear = scene.nodeById.get("clear_invoice")!;
    expect(clear.badges.length).toBeGreaterThan(0);
    expect(clear.color).toMatch(/^#/);
    expect(scene.shapes.some((s) => s.kind === "arc")).toBe(true);
    expect(scene.shapes.some((s) => s.kind === "selfLoop")).toBe(true);
    expect(scene.bounds.width).toBeGreaterThanOrEqual(p.bounds.width);
    const b = clear.box;
    const hit = scene.hit.at(b.x + b.width / 2, b.y + b.height / 2);
    expect(hit.find((h) => h.kind === "node")?.id).toBe("clear_invoice");
    const badge = clear.badges[0];
    const onBadge = scene.hit.at(badge.x + badge.width / 2, badge.y + badge.height / 2);
    expect(onBadge[0]).toMatchObject({ kind: "overlay", shapeId: badge.id });
    expect(scene.shapeById.get(badge.id)?.overlay.target).toBe("clear_invoice");
    expect(prepareScene(graph, p, { selfLoops: false }).shapes.some((s) => s.kind === "selfLoop")).toBe(false);
  });
});

describe("drawScene", () => {
  it("draws every element for a view over the whole scene and hides details when zoomed out", async () => {
    const p = await pos();
    const scene = prepareScene(graph, p, { overlays });
    const { ctx, calls, texts } = recordingContext();
    const view = { x: -scene.bounds.x + 10, y: -scene.bounds.y + 10, zoom: 1, width: scene.bounds.width + 20, height: scene.bounds.height + 20 };
    const stats = drawScene(ctx, scene, view, undefined, { tokens: defaultTokens });
    expect(stats).toMatchObject({ nodes: scene.nodes.length, edges: scene.edges.length, culled: false });
    expect(stats.shapes).toBeGreaterThan(0);
    expect(calls.clearRect).toBe(1);
    expect(texts).toContain("Clear Invoice");
    const zoomedOut = recordingContext();
    drawScene(zoomedOut.ctx, scene, { ...view, zoom: 0.05 }, undefined, { tokens: defaultTokens });
    expect(zoomedOut.texts).not.toContain("Clear Invoice");
    expect(zoomedOut.calls.fillText ?? 0).toBeLessThan(calls.fillText);
  });

  it("culls elements outside the viewport through the R-tree and dims outside a focus", async () => {
    const p = await pos();
    const scene = prepareScene(graph, p, { overlays });
    const clear = scene.nodeById.get("clear_invoice")!.box;
    const { ctx } = recordingContext();
    const stats = drawScene(ctx, scene, { x: -clear.x + 5, y: -clear.y + 5, zoom: 1, width: clear.width + 10, height: clear.height + 10 }, undefined, { cull: true });
    expect(stats.culled).toBe(true);
    expect(stats.nodes).toBeGreaterThanOrEqual(1);
    expect(stats.nodes).toBeLessThan(scene.nodes.length);
    const bright = { nodes: new Set(["clear_invoice"]), edges: new Set<string>() };
    const dimmed = recordingContext();
    const alpha: number[] = [];
    const proxy = new Proxy(dimmed.ctx, {
      set(target, key, value) {
        if (key === "globalAlpha") alpha.push(value as number);
        return Reflect.set(target, key, value);
      },
    });
    drawScene(proxy, scene, { x: 0, y: 0, zoom: 1, width: 5000, height: 5000 }, { selection: { nodes: ["clear_invoice"], edges: [], groups: [] }, bright }, { cull: false });
    expect(alpha.some((a) => a === 0.35)).toBe(true);
    expect(alpha.some((a) => a === 0.25)).toBe(true);
  });

  it("traces SVG path data and draws the legend", async () => {
    const { ctx, calls } = recordingContext();
    const end = tracePath(ctx, "M0 0L10 0C10 5 20 5 20 0Z");
    expect(calls).toMatchObject({ beginPath: 1, moveTo: 1, lineTo: 1, bezierCurveTo: 1, closePath: 1 });
    expect(end.last).toEqual([20, 0]);
    expect(end.beforeLast).toEqual([20, 5]);
    const p = await pos();
    const scene = prepareScene(graph, p, { overlays });
    const legend = recordingContext();
    const height = drawLegend(legend.ctx, scene, 0, 0, 200);
    expect(height).toBeGreaterThan(40);
    expect(legend.texts[0]).toBe("Legend");
  });
});

describe("toPNG", () => {
  it("renders the scene into a canvas at the figure preset's width and density with the title and legend", async () => {
    const p = await pos();
    const created: { width: number; height: number }[] = [];
    const { ctx, texts } = recordingContext();
    const createCanvas = (width: number, height: number) => {
      created.push({ width, height });
      return { width, height, getContext: () => ctx, toDataURL: () => "data:image/png;base64,AAAA" };
    };
    const out = toPNGCanvas({ graph, positions: p, overlays, title: "Vendor 0128", subtitle: "BPIC 2019", lanes: "stages" }, { preset: "single-column", scale: 2, createCanvas });
    expect(out.cssWidth).toBe(1000);
    expect(out.scale).toBe(2);
    expect(out.width).toBe(2000);
    expect(out.height).toBe(Math.round(out.cssHeight * 2));
    expect(created[0]).toEqual({ width: 2000, height: out.height });
    expect(texts).toContain("Vendor 0128");
    expect(texts).toContain("Legend");
    expect(texts.some((s) => s.includes("BPIC 2019"))).toBe(true);
    const url = toPNGDataUrl({ graph, positions: p, overlays }, { width: 500, scale: 1, legend: false, createCanvas });
    expect(url.startsWith("data:image/png")).toBe(true);
    expect(created[created.length - 1].width).toBe(500);
  });
});

describe("CanvasRenderer", () => {
  function fakeCanvas() {
    const { ctx, calls } = recordingContext();
    const canvas = { width: 0, height: 0, style: {} as Record<string, string>, getContext: () => ctx };
    return { canvas: canvas as unknown as HTMLCanvasElement, calls, raw: canvas };
  }

  it("fits the scene, converts between screen and flow coordinates and answers hits", async () => {
    const p = await pos();
    const scene = prepareScene(graph, p, { overlays });
    const { canvas, calls, raw } = fakeCanvas();
    const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 2 });
    const viewports: number[] = [];
    renderer.onViewportChange = (v) => viewports.push(v.zoom);
    renderer.resize(800, 600);
    expect(raw.width).toBe(1600);
    expect(raw.style.width).toBe("800px");
    renderer.setScene(scene);
    renderer.fit();
    const v = renderer.getViewport();
    expect(v.zoom).toBeGreaterThan(0);
    expect(v.zoom * scene.bounds.width).toBeLessThanOrEqual(800);
    expect(v.zoom * scene.bounds.height).toBeLessThanOrEqual(600);
    const centre = renderer.toScreen(scene.bounds.x + scene.bounds.width / 2, scene.bounds.y + scene.bounds.height / 2);
    expect(centre.x).toBeCloseTo(400);
    expect(centre.y).toBeCloseTo(300);
    const flow = renderer.toFlow(123, 45);
    const back = renderer.toScreen(flow.x, flow.y);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(45);
    const clear = scene.nodeById.get("clear_invoice")!.box;
    const s = renderer.toScreen(clear.x + clear.width / 2, clear.y + clear.height / 2);
    expect(renderer.hitAt(s.x, s.y)?.id).toBe("clear_invoice");
    expect(renderer.screenBox("clear_invoice")).toMatchObject({ width: clear.width * v.zoom });
    renderer.zoomBy(2, { x: 400, y: 300 });
    expect(renderer.getViewport().zoom).toBeCloseTo(v.zoom * 2);
    const after = renderer.toScreen(scene.bounds.x + scene.bounds.width / 2, scene.bounds.y + scene.bounds.height / 2);
    expect(after.x).toBeCloseTo(400);
    renderer.panBy(10, -5);
    renderer.centerOn({ x: clear.x, y: clear.y });
    expect(renderer.toScreen(clear.x, clear.y)).toEqual({ x: 400, y: 300 });
    expect(viewports.length).toBeGreaterThanOrEqual(4);
    renderer.setState({ hovered: "clear_invoice" });
    renderer.draw();
    expect(renderer.lastDraw?.nodes).toBe(scene.nodes.length);
    expect(calls.clearRect).toBeGreaterThan(0);
    renderer.setViewport({ x: 0, y: 0, zoom: 100 });
    expect(renderer.getViewport().zoom).toBe(renderer.maxZoom);
    renderer.dispose();
  });
});
