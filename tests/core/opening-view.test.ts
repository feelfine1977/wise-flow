import { describe, expect, it } from "vitest";
import { type Box, type FlowNode, fitViewport, openingView, processStart, viewTokens } from "../../src/index";

const AREA = { width: 1400, height: 900 };
/** The overview's size and the gap kept around panels, as the maps pass them. */
const OVERVIEW = { width: 200, height: 120 };
const GAP = 8;

describe("the view a map opens at", () => {
  it("is the fitted view where the whole map fits at 0.75 or more", () => {
    // 1,000 × 200 with 4 % on each side: 1400 / 1080 = 1.296.
    const bounds = { x: 0, y: 0, width: 1000, height: 200 };
    const open = openingView(bounds, AREA, { padding: 0.04, gap: GAP, start: { x: 0, y: 82, width: 36, height: 36 }, overview: OVERVIEW });
    expect(open).toEqual({ ...fitViewport(bounds, AREA, { padding: 0.04 }), fitted: true });
    expect(open.zoom).toBeCloseTo(1400 / 1080, 9);
    expect(viewTokens.openingZoom).toBe(0.75);
  });

  it("opens at 0.75 on the start, at the reading edge and centred on it, with the overview in the top right corner", () => {
    // 4,000 wide: fitted at 1400 / 4320 = 0.32. The overview takes the top right corner (1192, 8), kept clear along
    // the area (top 136: free height 764) or across it (right 216: 1184 wide); along leaves the larger area.
    const bounds = { x: 0, y: 0, width: 4000, height: 400 };
    const start = { x: 0, y: 180, width: 36, height: 36 };
    const boxes = Array.from({ length: 13 }, (_, i) => ({ x: 100 + 300 * i, y: 166, width: 180, height: 64 }));
    const open = openingView(bounds, AREA, { padding: 0.04, gap: GAP, start, boxes, overview: OVERVIEW });
    // x: the start's left edge 8 inside the free area; y: 136 + 764 / 2 − 198 × 0.75.
    expect(open).toEqual({ zoom: 0.75, x: 8, y: 369.5, fitted: false, overview: { x: 1192, y: 8, width: 200, height: 120 } });
  });

  it("keeps clear of the panels the way that leaves no activity under one", () => {
    // The zoom control at the bottom left. Kept clear along the area (bottom 68), the start sits at x 8 and the
    // activity 560 below it at y 822.5 to 870.5, under the control; kept clear across it (left 168), at x 176.
    const bounds = { x: 0, y: 0, width: 4000, height: 800 };
    const start = { x: 0, y: 0, width: 36, height: 36 };
    const zoomControl = { x: 10, y: 840, width: 150, height: 50 };
    const boxes = [{ x: 0, y: 560, width: 180, height: 64 }];
    expect(openingView(bounds, AREA, { padding: 0.04, gap: GAP, start, boxes, panels: [zoomControl] })).toEqual({ zoom: 0.75, x: 176, y: 436.5, fitted: false });
    // Without the activity there, along the area wins: it leaves the larger free area (1400 × 832).
    expect(openingView(bounds, AREA, { padding: 0.04, gap: GAP, start, panels: [zoomControl] })).toEqual({ zoom: 0.75, x: 8, y: 402.5, fitted: false });
  });

  it("puts the overview in the first corner no panel occupies and keeps clear of both", () => {
    // A status panel in the top right corner: the overview goes to the bottom right (1192, 772). The detail panel at the
    // top left: fitted the map is at 0.32 (kept clear along, 482 high); kept clear across (left 318) and the overview along
    // (bottom 136) leaves the largest free area, 1082 × 764: the start at 326, centred at 0 + 764 / 2 − 300 × 0.75.
    const bounds = { x: 0, y: 0, width: 4000, height: 600 };
    const start = { x: 0, y: 282, width: 36, height: 36 };
    const detail = { x: 10, y: 10, width: 300, height: 400 };
    const status = { x: 1150, y: 10, width: 240, height: 60 };
    const boxes = [{ x: 60, y: 0, width: 180, height: 64 }, { x: 60, y: 536, width: 180, height: 64 }];
    const open = openingView(bounds, AREA, { padding: 0.04, gap: GAP, start, boxes, panels: [detail, status], overview: OVERVIEW });
    expect(open.overview).toEqual({ x: 1192, y: 772, width: 200, height: 120 });
    // The status (kept clear along: top 78), detail across (left 318), the overview along (bottom 136): 1082 × 686.
    expect(open).toMatchObject({ zoom: 0.75, x: 326, y: 78 + 686 / 2 - 225, fitted: false });
    const covered = (b: Box) => [detail, status, open.overview!].some((p) => {
      const s = { x: b.x * open.zoom + open.x, y: b.y * open.zoom + open.y, width: b.width * open.zoom, height: b.height * open.zoom };
      return s.x < p.x + p.width && p.x < s.x + s.width && s.y < p.y + p.height && p.y < s.y + s.height;
    });
    expect(boxes.filter(covered)).toEqual([]);
  });

  it("starts at the top in a map read downwards, and at the right in one read to the left", () => {
    // Down: 4,000 high, fitted at 900 / 4320. The overview at the bottom right (the far end), kept clear along (bottom 136).
    const down = openingView({ x: 0, y: 0, width: 600, height: 4000 }, AREA, { padding: 0.04, gap: GAP, start: { x: 282, y: 0, width: 36, height: 36 }, direction: "DOWN", overview: OVERVIEW });
    expect(down).toEqual({ zoom: 0.75, x: 700 - 300 * 0.75, y: 8, fitted: false, overview: { x: 1192, y: 772, width: 200, height: 120 } });
    // Left: the start's right edge 8 inside the area's right edge; the overview at the top left, kept clear along (top 136).
    const left = openingView({ x: 0, y: 0, width: 4000, height: 400 }, AREA, { padding: 0.04, gap: GAP, start: { x: 3964, y: 182, width: 36, height: 36 }, direction: "LEFT", overview: OVERVIEW });
    expect(left).toEqual({ zoom: 0.75, x: 1400 - 8 - 4000 * 0.75, y: 136 + 764 / 2 - 200 * 0.75, fitted: false, overview: { x: 8, y: 8, width: 200, height: 120 } });
  });

  it("opens fitted without a start, and with a host's insets fits and places inside them", () => {
    const bounds = { x: 0, y: 0, width: 4000, height: 400 };
    expect(openingView(bounds, AREA, { padding: 0.04 })).toEqual({ ...fitViewport(bounds, AREA, { padding: 0.04 }), fitted: true });
    // Insets of 100 on the left: the start at 108, centred in the whole height.
    expect(openingView(bounds, AREA, { padding: 0.04, gap: GAP, insets: { left: 100 }, start: { x: 0, y: 182, width: 36, height: 36 } })).toEqual({ zoom: 0.75, x: 108, y: 450 - 150, fitted: false });
    // A smaller readable zoom opens fitted at 0.32.
    expect(openingView(bounds, AREA, { padding: 0.04, readable: 0.3, start: { x: 0, y: 182, width: 36, height: 36 } }).fitted).toBe(true);
  });
});

describe("the start of the process", () => {
  const node = (id: string, kind: FlowNode["kind"], tags?: string[]): FlowNode => ({ id, kind, label: id, tags });
  const box = (x: number, y: number): Box => ({ x, y, width: 36, height: 36 });

  it("is the first start event in the reading direction, else the first node", () => {
    const nodes = [node("a", "activity"), node("s2", "event", ["start"]), node("s1", "event", ["start"]), node("e", "event", ["end"])];
    const nodesAt = { a: box(0, 0), s1: box(50, 100), s2: box(50, 40), e: box(900, 0) };
    // Both starts at x 50: the upper one.
    expect(processStart(nodes, { nodes: nodesAt, direction: "RIGHT" })).toEqual(box(50, 40));
    // Read to the left, the start furthest right comes first; read downwards, the upper one.
    expect(processStart(nodes, { nodes: { ...nodesAt, s1: box(80, 100) }, direction: "LEFT" })).toEqual(box(80, 100));
    expect(processStart(nodes, { nodes: nodesAt, direction: "DOWN" })).toEqual(box(50, 40));
    // Without a start event, the first node; without a box, none.
    expect(processStart(nodes.filter((n) => !n.tags?.includes("start")), { nodes: nodesAt, direction: "RIGHT" })).toEqual(box(0, 0));
    expect(processStart(nodes, { nodes: {}, direction: "RIGHT" })).toBeUndefined();
  });
});
