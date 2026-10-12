import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { createRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type EdgeBudget, type FlowGraph, type Positions, type Selection, type ShownEdges, buildScene, toSVG } from "../../src/index";
import { CanvasRenderer, type DrawContext, type DrawState, type PreparedScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { retainScene } from "../../src/canvas/scene";
import { useElementDescriptions, useFlowElements } from "../../src/react/map-elements";
import { CanvasMap, type CanvasMapHandle, ProcessMap } from "../../src/react/index";
import { type FamilyName, families } from "../support/graphs";
import { type Random, caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { positionsOf } from "../support/scenes";
import { svgEdges, svgNote } from "../support/svg";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no pointer events; the Canvas map listens to them.
const hadPointer = "PointerEvent" in window;
beforeAll(() => {
  if (hadPointer) return;
  class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: PointerEvent });
});
afterAll(() => {
  if (!hadPointer) delete (window as { PointerEvent?: unknown }).PointerEvent;
});

// ---------------------------------------------------------------------------
// Helpers: what each renderer drew, the note, and the exports.

const quietContext = () =>
  new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });

/** The Canvas maps draw into a 2D context that draws nothing. */
function quietCanvas() {
  const ctx = quietContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

/** A 2D context that records the texts each draw writes (a draw starts by clearing the canvas). */
function frameCanvas() {
  const frames: string[][] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null, clearRect: () => void frames.push([]), fillText: (s: string) => frames[frames.length - 1]?.push(s) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return frames;
}

const note = () => screen.queryByTestId("wf-edge-note")?.textContent ?? undefined;
const rfEdges = (container: HTMLElement) => [...container.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-id")!).sort();
/** The note's text by hand, with the English grouping of thousands. */
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const noteText = (shown: number, total: number, highlighted = 0) => `Showing ${group(shown)} of ${group(total)} flows${highlighted ? `, ${group(highlighted)} highlighted not shown` : ""}`;

/** The note a PNG export without its legend writes, if any. */
function pngNote(scene: Parameters<typeof toPNGCanvas>[0], edgeBudget: ShownEdges | undefined): string | undefined {
  const texts: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), fillText: (s: string) => texts.push(s) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  toPNGCanvas(scene, { scale: 1, legend: false, edgeBudget, createCanvas: (width, height) => ({ width, height, getContext: () => ctx as unknown as DrawContext }) });
  const notes = texts.filter((s) => s.startsWith("Showing"));
  expect(notes.length).toBeLessThanOrEqual(1);
  return notes[0];
}

/**
 * Every path gets a count of its own (1 … n, shuffled), as many cases as transitions, which it is labelled with and
 * ranked by, and every activity at least a thousand cases, so a drawn count label names its edge.
 */
function distinctCounts(graph: FlowGraph, rng: Random): FlowGraph {
  const counts = rng.shuffle(graph.edges.map((_, i) => i + 1));
  return {
    ...graph,
    nodes: graph.nodes.map((n) => (n.kind === "activity" ? { ...n, metrics: { ...n.metrics, cases: 1000 + rng.int(0, 9000) } } : n)),
    edges: graph.edges.map((e, i) => ({ ...e, metrics: { ...e.metrics, count: counts[i], cases: counts[i] } })),
  };
}

/** The ids of the edges whose count label a Canvas frame wrote. */
function idsOfCounts(graph: FlowGraph, frame: readonly string[] | undefined): string[] {
  const byCount = new Map(graph.edges.map((e) => [String(e.metrics!.count), e.id]));
  return [...new Set((frame ?? []).filter((s) => /^\d+$/.test(s)))].map((s) => byCount.get(s)!).sort();
}

/** Searching tests run fifty times longer in deep mode; so may their timeout. */
const TIMEOUT = 30_000 * caseCount(1);

const SMALL: readonly FamilyName[] = ["chain", "layered", "tree", "cyclic", "hub", "components", "stages", "lanes", "nested", "overlaid"];

// ---------------------------------------------------------------------------

describe("the Canvas map and the React Flow map agree on the drawn set", () => {
  it("for random graphs, budgets, selections, keyboard positions and highlighted paths", () => {
    const quiet = quietContext() as unknown as DrawContext;
    // Pattern tiles for hatched nodes are drawn on canvases of the document.
    quietCanvas();
    for (const seed of seeds(caseCount(300))) {
      const rng = createRandom(seed);
      const family = rng.pick(SMALL);
      const size = rng.int(2, 30);
      const given = families[family](size, seed);
      // Many ties half of the time.
      const graph: FlowGraph = rng.chance() ? { ...given, edges: given.edges.map((e) => ({ ...e, metrics: { ...e.metrics, count: rng.int(1, 4) } })) } : given;
      const positions = positionsOf(graph, "grid", seed);
      const scene = buildScene(graph, positions);
      const ids = scene.edgeMarks.map((m) => m.id);
      const nodeIds = graph.nodes.map((n) => n.id);
      const selection: Selection = { nodes: [], edges: rng.sample(ids, rng.int(0, Math.min(3, ids.length))), groups: [] };
      const focused = rng.pick([null, ids.length ? rng.pick(ids) : null, nodeIds.length ? rng.pick(nodeIds) : null]);
      const highlighted = rng.chance() ? new Set(rng.sample(ids, rng.int(0, Math.min(4, ids.length)))) : undefined;
      const budget = rng.weighted<EdgeBudget | "adaptive">([[rng.int(0, ids.length + 1), 6], ["all", 1], ["adaptive", 1]]);
      const label = caseLabel(seed, `${family} ${size}, budget ${budget}`);

      // The React Flow map's elements.
      const { result, unmount } = renderHook(() => {
        const descriptions = useElementDescriptions(graph, scene.overlays, "en", undefined);
        return useFlowElements({ enabled: true, scene, graph, positions: scene.positions, descriptions, selection, hovered: null, focused, bright: undefined, locale: "en", activityLabels: undefined, nodesDraggable: false, edgeBudget: budget, highlighted });
      });
      const flowIds = result.current.edges.map((e) => e.id).sort();
      const flowNote = result.current.withheld && { shown: result.current.withheld.shown, total: result.current.withheld.total, highlightedNotShown: result.current.withheld.highlightedNotShown };
      unmount();

      // The Canvas map's renderer on the retained scene, at rest.
      const prepared = retainScene(scene);
      const canvas = { width: 0, height: 0, style: {}, getContext: () => quiet } as unknown as HTMLCanvasElement;
      const renderer = new CanvasRenderer(canvas, { devicePixelRatio: 1, draw: { edgeBudget: budget }, clock: () => 0 });
      renderer.setScene(prepared);
      renderer.resize(800, 600);
      renderer.fit();
      renderer.setState({ selection, focused, highlighted });
      renderer.draw();
      const withheld = renderer.lastDraw!.withheld;
      const canvasIds = withheld ? [...withheld.drawn].map((i) => prepared.edgeMarks[i].id).sort() : [...ids].sort();
      renderer.dispose();

      expect(canvasIds, label).toEqual(flowIds);
      expect(withheld && { shown: withheld.shown, total: withheld.total, highlightedNotShown: withheld.highlightedNotShown }, label).toEqual(flowNote);
      // Both count what they drew and the paths that loop on one activity, and the highlighted edges they did not draw, and withhold only when they drew less than everything.
      const loops = graph.edges.filter((e) => e.source === e.target && positions.nodes[e.source]).length;
      const exempt = new Set([...selection.edges, ...(focused ? [focused] : [])]);
      const highlightedNotShown = ids.filter((id) => highlighted?.has(id) && !exempt.has(id) && !flowIds.includes(id)).length;
      if (flowNote) expect(flowNote, label).toEqual({ shown: flowIds.length + loops, total: ids.length + loops, highlightedNotShown });
      else expect(flowIds.length, label).toBe(ids.length);
    }
  }, TIMEOUT);

  it.each(seeds(caseCount(6)))("through <ProcessMap/> with either renderer, seed %i", async (seed) => {
    const rng = createRandom(seed);
    const family = rng.pick(["chain", "layered", "tree", "hub", "stages"] as const);
    const graph = distinctCounts(families[family](rng.int(4, 14), seed), rng);
    const positions = positionsOf(graph, "grid", seed);
    const ids = graph.edges.map((e) => e.id);
    const budget = rng.int(1, Math.max(1, ids.length - 1));
    const selection: Selection = { nodes: [], edges: rng.sample(ids, rng.int(0, 2)), groups: [] };
    const focus = rng.chance() ? rng.pick(graph.nodes).id : undefined;
    // A selection or a focus dims the other edges, whose count labels the Canvas map then leaves out.
    const dimmed = selection.edges.length > 0 || focus !== undefined;
    const label = caseLabel(seed, `${family}, budget ${budget}`);
    const reported: Record<"svg" | "canvas", (ShownEdges | undefined)[]> = { svg: [], canvas: [] };
    const map = (renderer: "svg" | "canvas") => (
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} positions={positions} renderer={renderer} edgeBudget={budget} selection={selection} focus={focus} onEdgesShown={(s) => reported[renderer].push(s)} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} lod={{ edgeLabels: 0 }} />
      </div>
    );
    const svg = render(map("svg"));
    await waitFor(() => expect(rfEdges(svg.container).length).toBeGreaterThan(0));
    await act(async () => new Promise((done) => setTimeout(done, 30)));
    const flowIds = rfEdges(svg.container);
    const flowNote = note();
    const flowReport = reported.svg.at(-1);
    svg.unmount();

    const frames = frameCanvas();
    render(map("canvas"));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    await waitFor(() => expect(note()).toBe(flowNote));
    await act(async () => new Promise((done) => setTimeout(done, 30)));
    const canvasReport = reported.canvas.at(-1);
    if (flowNote) {
      // Both withhold: the same edges are drawn and reported, and the note counts them.
      expect(flowReport && [...flowReport.edges].sort(), label).toEqual(flowIds);
      expect(canvasReport && [...canvasReport.edges].sort(), label).toEqual(flowIds);
      expect(canvasReport!.total, label).toBe(flowReport!.total);
      // A focus highlights the paths into and out of its activity: those not drawn are counted.
      const focusPaths = graph.edges.filter((e) => focus !== undefined && (e.source === focus || e.target === focus)).map((e) => e.id);
      expect(flowNote, label).toBe(noteText(flowIds.length, ids.length, focusPaths.filter((id) => !flowIds.includes(id) && !selection.edges.includes(id)).length));
    } else {
      expect(flowIds.length, label).toBe(ids.length);
      expect(flowReport, label).toBeUndefined();
      expect(canvasReport, label).toBeUndefined();
    }
    if (!dimmed) expect(idsOfCounts(graph, frames.at(-1)), label).toEqual(flowIds);
  });
});

// ---------------------------------------------------------------------------

type FrameClass = "fast" | "neutral" | "slow";
const CLASSES: readonly FrameClass[] = ["fast", "neutral", "slow"];
/** A frame time: below 8.35 ms, between, or above 16.7 ms. */
const frameMsOf = (rng: Random, kind: FrameClass) => (kind === "fast" ? rng.float(0, 8) : kind === "neutral" ? rng.float(9, 16) : rng.float(17, 80));

describe("exports at random moments of the Canvas map", () => {
  it.each(seeds(10))("contain exactly the edges the map reports as shown, with the map's note, seed %i", async (seed) => {
    const rng = createRandom(seed);
    const family = rng.pick(["hub", "layered", "cyclic"] as const);
    const graph = families[family](rng.int(850, 1000), seed);
    const positions = positionsOf(graph, "grid", seed);
    const scene: PreparedScene = prepareScene(graph, positions, { selfLoops: false });
    const all = scene.edgeMarks.map((m) => m.id);
    const figure = { graph, positions, selfLoops: false };
    // A turning case gives each drag, wheel or run of frames a class of its own, so that slow drags take the
    // adaptive budget down and fast ones take it up again within one case.
    const bias = rng.pick([...CLASSES, "mixed", "turning"] as const);
    let leaning: FrameClass | "mixed" = bias === "turning" ? rng.pick(CLASSES) : bias;
    const lean = () => (leaning = bias === "turning" ? rng.pick(CLASSES) : bias);
    quietCanvas();
    let now = 0;
    let frameMs = 25;
    const clock = () => (now += frameMs);
    const ref = createRef<CanvasMapHandle>();
    const reported: (ShownEdges | undefined)[] = [];
    let budget: EdgeBudget | "adaptive" = rng.pick(["adaptive", "adaptive", 500, 1000, "all"] as const);
    let state: DrawState = { selection: { nodes: [], edges: [], groups: [] } };
    const tree = () => (
      <div style={{ width: 1200, height: 800 }}>
        <CanvasMap ref={ref} scene={scene} state={state} fitKey="fit" edgeBudget={budget} clock={clock} onEdgesShown={(s) => reported.push(s)} />
      </div>
    );
    const view = render(tree());
    await waitFor(() => expect(ref.current?.renderer()?.lastDraw).toBeDefined());
    const renderer = ref.current!.renderer()!;
    // Every edge counts as in view, wherever the view goes.
    renderer.drawOptions = { ...renderer.drawOptions, cull: false };
    const host = screen.getByTestId("wf-canvas-map");
    const frame = () => act(() => renderer.draw());
    let dragging = false;
    let x = 600;
    for (let m = 0, moments = caseCount(30); m < moments; m++) {
      const event = rng.weighted([["drag", 4], ["release", 2], ["wheel", 2], ["budget", 2], ["select", 1], ["frames", 3], ["rest", 2]] as const);
      if (event === "drag") {
        if (!dragging) {
          lean();
          fireEvent.pointerDown(host, { clientX: x, clientY: 400, button: 0, pointerId: 1 });
          dragging = true;
        }
        for (let k = rng.int(1, 6); k > 0; k--) {
          frameMs = frameMsOf(rng, leaning === "mixed" || !rng.chance(0.85) ? rng.pick(CLASSES) : leaning);
          fireEvent.pointerMove(host, { clientX: (x += 10), clientY: 400, pointerId: 1 });
          frame();
        }
      } else if (event === "release") {
        if (dragging) fireEvent.pointerUp(host, { clientX: x, clientY: 400, button: 0, pointerId: 1 });
        dragging = false;
      } else if (event === "wheel") {
        fireEvent.wheel(host, { clientX: 600, clientY: 400, deltaY: rng.pick([10, -10]), ctrlKey: rng.chance() });
        frame();
      } else if (event === "budget") {
        budget = rng.weighted<EdgeBudget | "adaptive">([["adaptive", 4], [300, 1], [500, 1], [1000, 1], [2000, 1], ["all", 1]]);
        await act(async () => void view.rerender(tree()));
      } else if (event === "select") {
        state = { selection: { nodes: [], edges: rng.sample(all, rng.pick([0, 1, 20, 100])), groups: [] } };
        await act(async () => void view.rerender(tree()));
      } else if (event === "frames") {
        lean();
        for (let k = rng.int(1, 6); k > 0; k--) {
          frameMs = frameMsOf(rng, leaning === "mixed" ? rng.pick(CLASSES) : leaning);
          frame();
        }
      } else {
        await act(() => new Promise((done) => setTimeout(done, rng.chance(0.2) ? 220 : 25)));
      }
      // The moment: what the last frame drew, what the host was told, what the note says, and what an export draws.
      await act(async () => {});
      const withheld = renderer.lastDraw!.withheld;
      const drawn = withheld ? [...withheld.drawn].map((i) => all[i]).sort() : [...all].sort();
      const last = reported.at(-1);
      const label = caseLabel(seed, `${family} ${all.length} edges, ${bias}; moment ${m} after ${event}${dragging ? " during a drag" : ""}, budget ${budget}`);
      if (withheld) {
        // The paths that loop on an activity in view are reported and counted with the drawn lines.
        const loops = new Set(graph.edges.filter((e) => e.source === e.target).map((e) => e.id));
        expect(withheld.loops.every((id) => loops.has(id)), label).toBe(true);
        expect(last && [...last.edges].sort(), label).toEqual([...drawn, ...withheld.loops].sort());
        expect(last!.total, label).toBe(withheld.total);
        expect(withheld.shown, label).toBe(drawn.length + withheld.loops.length);
        expect(note(), label).toBe(noteText(withheld.shown, withheld.total));
      } else {
        expect(last, label).toBeUndefined();
        expect(note(), label).toBeUndefined();
      }
      const svg = toSVG(figure, { edgeBudget: last });
      expect(svgEdges(svg), label).toEqual(drawn);
      expect(svgNote(svg), label).toBe(note());
      if (m % 5 === 0) expect(pngNote(figure, last), label).toBe(note());
    }
    view.unmount();
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------

/** An ELK whose layouts finish when the test answers them: every node in one column, 100 apart. */
function heldElk() {
  const calls: { graph: ElkNode; resolve: (result: ElkNode) => void }[] = [];
  const elk = { layout: (graph: ElkNode) => new Promise<ElkNode>((resolve) => calls.push({ graph, resolve })) } as unknown as ELK;
  const answer = () => calls[0].resolve({ ...calls[0].graph, children: calls[0].graph.children!.map((child, i) => ({ ...child, x: 500, y: 100 * i })) });
  return { elk, answer };
}

function reducedMotion() {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query.includes("reduce"), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

describe("exports in the provisional state", () => {
  it.each(seeds(caseCount(12)))("contain exactly the edges the map reports before and after the layout arrives, seed %i", async (seed) => {
    const rng = createRandom(seed);
    const renderer = rng.pick(["svg", "canvas"] as const);
    const family = rng.pick(["chain", "layered", "tree", "hub", "stages"] as const);
    const graph = distinctCounts(families[family](rng.int(4, 14), seed), rng);
    const ids = graph.edges.map((e) => e.id);
    const budget = rng.int(1, Math.max(1, ids.length - 1));
    const selection: Selection = { nodes: [], edges: rng.sample(ids, rng.int(0, 2)), groups: [] };
    // Any arrangement will do for the export: it draws the edges the map reported.
    const figure: { graph: FlowGraph; positions: Positions; selfLoops: boolean } = { graph, positions: positionsOf(graph, "grid", seed), selfLoops: false };
    reducedMotion();
    const held = heldElk();
    const frames = renderer === "canvas" ? frameCanvas() : undefined;
    const reported: (ShownEdges | undefined)[] = [];
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={graph} layout={{ elk: held.elk, engine: "elk" }} renderer={renderer} edgeBudget={budget} selection={selection} onEdgesShown={(s) => reported.push(s)} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} lod={{ edgeLabels: 0 }} />
      </div>,
    );
    const map = container.querySelector(".wf-process-map")!;
    expect(map.getAttribute("data-layout-status")).toBe("pending");
    const moment = async (when: string) => {
      if (frames) await waitFor(() => expect(frames.length).toBeGreaterThan(0));
      await act(async () => new Promise((done) => setTimeout(done, 30)));
      const last = reported.at(-1);
      const label = caseLabel(seed, `${renderer} ${family}, budget ${budget}, ${when}`);
      // What the map draws: React Flow's edges, or the Canvas map's count labels while nothing is dimmed, else what it reports.
      const labelled = frames && selection.edges.length === 0 ? idsOfCounts(graph, frames.at(-1)) : undefined;
      const drawn = frames ? (labelled ?? (last ? [...last.edges].sort() : [...ids].sort())) : rfEdges(container);
      if (drawn.length < ids.length) {
        expect(last && [...last.edges].sort(), label).toEqual(drawn);
        expect(last!.total, label).toBe(ids.length);
        expect(note(), label).toBe(noteText(drawn.length, ids.length));
      } else {
        expect(last, label).toBeUndefined();
        expect(note(), label).toBeUndefined();
      }
      const svg = toSVG(figure, { edgeBudget: last });
      expect(svgEdges(svg), label).toEqual(drawn);
      expect(svgNote(svg), label).toBe(note());
      expect(pngNote(figure, last), label).toBe(note());
      return drawn;
    };
    const before = await moment("provisional");
    await act(async () => held.answer());
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"));
    const after = await moment("laid out");
    // The layout changes positions, not the edges drawn.
    expect(after, caseLabel(seed, `${renderer} ${family}`)).toEqual(before);
  });
});
