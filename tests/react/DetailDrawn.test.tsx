import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type Box, type FlowEdge, type FlowNode, type XY, abstract, createPositions, layout } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Pairs of positions of the two sliders on the whole log: the lowest, two between, the stories' opening and every activity with few paths. */
const PAIRS: [number, number][] = [
  [0, 0],
  [0.2, 0.05],
  [0.38, 0.05],
  [0.8, 0.5],
  [1, 0.1],
];
const ACTIVITIES = new Set(globalScene.nodes.filter((n) => n.kind === "activity").map((n) => n.id));

/** How far a point lies from a box; 0 inside it. */
const away = (p: XY, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.width), Math.max(b.y - p.y, 0, p.y - b.y - b.height));

/**
 * The boxes a drawn line joins: the one its first point lies on, and the one it points into from its last point
 * (the line ends under its head, up to 30 before the box). A line that does not join two boxes is no path.
 */
function joined(points: XY[], boxes: Map<string, Box>): string[] {
  const [first, before, last] = [points[0], points[points.length - 2], points[points.length - 1]];
  const length = Math.hypot(last.x - before.x, last.y - before.y) || 1;
  const ahead = (k: number) => ({ x: last.x + ((last.x - before.x) / length) * k, y: last.y + ((last.y - before.y) / length) * k });
  const source = [...boxes].find(([, b]) => away(first, b) <= 1)?.[0];
  const target = [...boxes].find(([id, b]) => id !== source && Array.from({ length: 31 }, (_, k) => ahead(k)).some((p) => away(p, b) <= 1))?.[0];
  return source && target ? [source, target] : [];
}

/** The activities drawn that no drawn path joins to another box. */
function withoutPath(boxes: Map<string, Box>, lines: XY[][]): string[] {
  const touched = new Set(lines.flatMap((points) => joined(points, boxes)));
  return [...boxes.keys()].filter((id) => ACTIVITIES.has(id) && !touched.has(id)).sort();
}

/** A 2D context that records, for the last frame, the boxes filled as cards and the straight lines stroked. */
function recorder() {
  let boxes: Box[] = [];
  let lines: XY[][] = [];
  let path: { points: XY[]; curved: boolean } = { points: [], curved: false };
  const noop = () => {};
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", globalAlpha: 1, textAlign: "left", textBaseline: "alphabetic", lineJoin: "miter", lineCap: "butt",
    save: noop, restore: noop, translate: noop, scale: noop, setTransform: noop, closePath: noop, quadraticCurveTo: noop, fillRect: noop, strokeRect: noop, strokeText: noop, fillText: noop, setLineDash: noop, rect: noop,
    createPattern: () => null,
    measureText: (text: string) => ({ width: text.length * 6 }),
    clearRect() {
      boxes = [];
      lines = [];
    },
    beginPath() {
      path = { points: [], curved: false };
    },
    moveTo(x: number, y: number) {
      path.points.push({ x, y });
    },
    lineTo(x: number, y: number) {
      path.points.push({ x, y });
    },
    bezierCurveTo() {
      path.curved = true;
    },
    arc(x: number, y: number, r: number) {
      path.curved = true;
      path.points.push({ x: x - r, y: y - r }, { x: x + r, y: y + r });
    },
    fill() {
      // A card: a rounded box, whose corners are arcs.
      if (!path.curved || path.points.length < 8) return;
      const xs = path.points.map((p) => p.x);
      const ys = path.points.map((p) => p.y);
      boxes.push({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) });
    },
    stroke() {
      if (!path.curved && path.points.length >= 2) lines.push(path.points);
    },
  };
  return { ctx, frame: () => ({ boxes, lines }) };
}

describe("no drawn activity without a drawn path", () => {
  it.each(PAIRS)("on the React map and the Canvas map of the whole log at activities %s and paths %s", async (activityDetail, pathDetail) => {
    const shown = abstract(globalScene, { activityDetail, pathDetail });
    const positions = await layout(shown, { engine: "dagre" });
    // The React map: its cards where React Flow places them, and its paths' lines.
    const flow = render(
      <div style={{ width: 1600, height: 1000 }}>
        <ProcessMap graph={globalScene} positions={positions} defaultAbstraction={{ activityDetail, pathDetail }} edgeBudget="all" fitView={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(flow.container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
    const cards = new Map<string, Box>();
    for (const node of flow.container.querySelectorAll<HTMLElement>(".react-flow__node")) {
      const m = node.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/);
      const id = node.getAttribute("data-id")!;
      if (m && positions.nodes[id]) cards.set(id, { x: Number(m[1]), y: Number(m[2]), width: parseFloat(node.style.width) || positions.nodes[id].width, height: parseFloat(node.style.height) || positions.nodes[id].height });
    }
    const paths = [...flow.container.querySelectorAll("g.wf-edge path.react-flow__edge-path")].map((p) =>
      [...p.getAttribute("d")!.matchAll(/[ML]\s*([-\d.e]+)[ ,]([-\d.e]+)/g)].map((c) => ({ x: Number(c[1]), y: Number(c[2]) })),
    );
    const drawnActivities = [...cards.keys()].filter((id) => ACTIVITIES.has(id));
    expect(drawnActivities.length).toBe(shown.nodes.filter((n) => ACTIVITIES.has(n.id)).length);
    expect(paths.length).toBeGreaterThan(0);
    expect(withoutPath(cards, paths)).toEqual([]);
    flow.unmount();

    // The Canvas map: the cards it fills and the straight lines it strokes in its last frame.
    const record = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => record.ctx as unknown as CanvasRenderingContext2D);
    const canvas = render(
      <div style={{ width: 1600, height: 1000 }}>
        <ProcessMap graph={globalScene} positions={positions} defaultAbstraction={{ activityDetail, pathDetail }} renderer="canvas" edgeBudget="all" legend={false} />
      </div>,
    );
    await waitFor(() => expect(record.frame().lines.length).toBeGreaterThan(0));
    const { boxes, lines } = record.frame();
    // A filled box is the card of the activity whose box it is.
    const filled = new Map<string, Box>();
    for (const [id, box] of Object.entries(positions.nodes)) if (boxes.some((b) => Math.abs(b.x - box.x) < 0.5 && Math.abs(b.y - box.y) < 0.5 && Math.abs(b.width - box.width) < 0.5)) filled.set(id, box);
    expect([...filled.keys()].filter((id) => ACTIVITIES.has(id)).sort()).toEqual(drawnActivities.sort());
    // Every node's box joins the lines; a line from or into an event counts.
    const all = new Map(Object.entries(positions.nodes).map(([id, b]) => [id, filled.get(id) ?? b]));
    expect(withoutPath(new Map([...all].filter(([id]) => filled.has(id) || !ACTIVITIES.has(id))), lines)).toEqual([]);
    canvas.unmount();
  });
});

describe("the paths drawn of those selected", () => {
  it("counts a self-loop in view as drawn on the React map", async () => {
    // Three paths a → b → c → d of falling weight and a loop on b; a budget of two draws a → b, b → c and the loop.
    const nodes: FlowNode[] = ["a", "b", "c", "d"].map((id) => ({ id, kind: "activity", label: id.toUpperCase(), metrics: { cases: 10 } }));
    const edges: FlowEdge[] = [
      { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { cases: 9 } },
      { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { cases: 8 } },
      { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { cases: 7 } },
      { id: "b->b", kind: "follows", source: "b", target: "b", metrics: { cases: 3 } },
    ];
    const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, { x: 200 * i, y: 0, width: 120, height: 48 }]));
    const positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT");
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={{ nodes, edges }} positions={positions} edgeBudget={2} fitView={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll("g.wf-edge").length).toBe(2));
    // Four selected, the path c → d withheld: three drawn.
    await waitFor(() => expect(container.querySelector(".wf-controls__note--drawn")?.textContent).toBe("4 selected · 3 drawn at this zoom"));
  });
});

describe("the paths drawn of those selected, after the table view", () => {
  it("forgets what the Canvas map withheld before the table once it draws again and withholds nothing", async () => {
    // a → b → c → d of falling weight; a budget of one withholds two paths.
    const nodes: FlowNode[] = ["a", "b", "c", "d"].map((id) => ({ id, kind: "activity", label: id.toUpperCase(), metrics: { cases: 10 } }));
    const edges: FlowEdge[] = [
      { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { cases: 9 } },
      { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { cases: 8 } },
      { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { cases: 7 } },
    ];
    const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, { x: 200 * i, y: 0, width: 120, height: 48 }]));
    const positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT");
    const record = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => record.ctx as unknown as CanvasRenderingContext2D);
    const shown: unknown[] = [];
    const map = (view: "map" | "table", edgeBudget: number | "all") => (
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={{ nodes, edges }} positions={positions} renderer="canvas" view={view} edgeBudget={edgeBudget} legend={false} onEdgesShown={(s) => shown.push(s)} />
      </div>
    );
    const { container, rerender } = render(map("map", 1));
    const note = () => container.querySelector(".wf-controls__note--drawn")?.textContent;
    await waitFor(() => expect(note()).toBe("3 selected · 1 drawn at this zoom"));
    const before = record.frame().lines.length;
    // The table lists every path; the budget is raised while it is shown, and the Canvas map draws them all.
    rerender(map("table", 1));
    rerender(map("table", "all"));
    rerender(map("map", "all"));
    // Three times the lines of the one path drawn before: every path is drawn.
    await waitFor(() => expect(record.frame().lines.length).toBe(3 * before));
    expect(note()).toBeUndefined();
    // The host was told that the table view withholds nothing, and nothing of the map before it since.
    expect(shown.at(-1)).toBeUndefined();
  });
});

describe("the paths drawn of those selected, beside a constraint edge", () => {
  it.each(["svg", "canvas"] as const)("counts only paths on the %s map, not a constraint edge the budget withholds", async (renderer) => {
    // Three paths a → b → c → d of falling weight and a constraint edge from a to c, which nothing weighs: it comes last.
    const nodes: FlowNode[] = ["a", "b", "c", "d"].map((id) => ({ id, kind: "activity", label: id.toUpperCase(), metrics: { cases: 10 } }));
    const edges: FlowEdge[] = [
      { id: "a->b", kind: "follows", source: "a", target: "b", metrics: { cases: 9 } },
      { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { cases: 8 } },
      { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { cases: 7 } },
      { id: "a=>c", kind: "constraint", source: "a", target: "c" },
    ];
    const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, { x: 200 * i, y: 0, width: 120, height: 48 }]));
    const positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT");
    if (renderer === "canvas") vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => recorder().ctx as unknown as CanvasRenderingContext2D);
    const shown: unknown[] = [];
    const map = (edgeBudget: number) => (
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={{ nodes, edges }} positions={positions} renderer={renderer} edgeBudget={edgeBudget} fitView={false} legend={false} onEdgesShown={(s) => shown.push(s)} />
      </div>
    );
    const { container, rerender } = render(map(2));
    const note = () => container.querySelector(".wf-controls__note--drawn")?.textContent;
    // A budget of two withholds the constraint edge and c → d: three paths selected, two drawn.
    await waitFor(() => expect(shown.at(-1)).toEqual({ edges: ["a->b", "b->c"], total: 4 }));
    await waitFor(() => expect(note()).toBe("3 selected · 2 drawn at this zoom"));
    // A budget of three withholds only the constraint edge: every path is drawn, and the panel has no such line.
    rerender(map(3));
    await waitFor(() => expect(shown.at(-1)).toEqual({ edges: ["a->b", "b->c", "c->d"], total: 4 }));
    expect(note()).toBeUndefined();
  });
});
