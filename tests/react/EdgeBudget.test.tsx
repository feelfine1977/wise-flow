import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, type Locale, type ShownEdges, createPositions } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A hub `h` with a path to each of `counts.length` activities, `h->t1` … in order, with those counts. */
function hub(counts: number[]) {
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "Hub" }, ...counts.map((_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `T${k + 1}` }))];
  const edges: FlowEdge[] = counts.map((count, k) => ({ id: `h->t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count } }));
  const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, i === 0 ? { x: 0, y: 0, width: 100, height: 40 } : { x: 300 + 160 * ((i - 1) % 50), y: 80 * Math.floor((i - 1) / 50), width: 100, height: 40 }]));
  return { graph: { nodes, edges } satisfies FlowGraph, positions: createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT") };
}

// Hand-ordered: h->t5 (70), h->t7 (60), h->t2 (50), h->t8 (40), h->t3 and h->t4 (30 each, by id), h->t6 (20), h->t1 (10).
const small = hub([10, 50, 30, 30, 70, 20, 60, 40]);

type Props = Partial<React.ComponentProps<typeof ProcessMap>>;
function mount(props: Props, given = small) {
  return render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={given.graph} positions={given.positions} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} {...props} />
    </div>,
  );
}

/** A 2D context that records the texts written. */
function textCanvas() {
  const texts: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null, fillText: (s: string) => texts.push(s) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return texts;
}

/** A 2D context that records the texts written by each draw (a draw starts by clearing the canvas). */
function frameCanvas() {
  const frames: string[][] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null, clearRect: () => void frames.push([]), fillText: (s: string) => frames[frames.length - 1]?.push(s) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  return frames;
}
/** The count labels of a draw, sorted. */
const counts = (frame: string[] | undefined) => [...new Set((frame ?? []).filter((s) => /^\d+$/.test(s)))].sort();

const rfEdges = (container: HTMLElement) => [...container.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-id")).sort();
const note = () => screen.queryByTestId("wf-edge-note");
const live = () => screen.getByTestId("wf-live").textContent;

describe("edge budget on the React Flow map", () => {
  it("draws the n heaviest edges, shows a note with both numbers and announces it", async () => {
    const { container } = mount({ renderer: "svg", edgeBudget: 3 });
    await waitFor(() => expect(rfEdges(container)).toEqual(["h->t2", "h->t5", "h->t7"]));
    expect(note()!.textContent).toBe("Showing 3 of 8 flows");
    expect(note()!.getAttribute("role")).toBe("note");
    await waitFor(() => expect(live()).toBe("Showing 3 of 8 flows"));
  });

  it("draws every edge and no note with the default, all, or a budget of the edges", async () => {
    for (const edgeBudget of [undefined, "all" as const, 8]) {
      const { container, unmount } = mount({ renderer: "svg", edgeBudget });
      await waitFor(() => expect(rfEdges(container)).toHaveLength(8));
      expect(note()).toBeNull();
      unmount();
    }
  });

  it("keeps a selected edge with a budget of 0, and writes the note in German", async () => {
    const { container } = mount({ renderer: "svg", edgeBudget: 0, selection: { nodes: [], edges: ["h->t1"], groups: [] }, locale: "de" });
    await waitFor(() => expect(rfEdges(container)).toEqual(["h->t1"]));
    expect(note()!.textContent).toBe("1 von 8 Flüssen gezeigt");
  });

  it("keeps the edges of a focus of paths with a budget of 0", async () => {
    const { container } = mount({ renderer: "svg", edgeBudget: 0, focus: "t3" });
    await waitFor(() => expect(rfEdges(container)).toEqual(["h->t3"]));
  });

  it("lists every edge in the table view", () => {
    mount({ renderer: "svg", edgeBudget: 3, view: "table" });
    const table = screen.getByText("Paths of the process map with their metrics").closest("table")!;
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 8);
    expect(note()).toBeNull();
  });
});

describe("edge budget on the Canvas map", () => {
  it("draws the n heaviest edges with their labels, shows the note and announces it", async () => {
    const texts = textCanvas();
    mount({ renderer: "canvas", edgeBudget: 3, lod: { edgeLabels: 0 } });
    await waitFor(() => expect(note()?.textContent).toBe("Showing 3 of 8 flows"));
    // The count labels written are those of the drawn edges.
    expect([...new Set(texts.filter((s) => /^\d+$/.test(s)))].sort()).toEqual(["50", "60", "70"]);
    await waitFor(() => expect(live()).toBe("Showing 3 of 8 flows"));
  });

  it("keeps the edges of a focus of paths with a budget of 0", async () => {
    const texts = textCanvas();
    mount({ renderer: "canvas", edgeBudget: 0, focus: "t4", lod: { edgeLabels: 0 } });
    await waitFor(() => expect(note()?.textContent).toBe("Showing 1 of 8 flows"));
    expect([...new Set(texts.filter((s) => /^\d+$/.test(s)))]).toEqual(["30"]);
  });

  it("counts the edges in view with separators in both languages", async () => {
    textCanvas();
    // 2,500 edges, fitted into the view: all of them are in view.
    const large = hub(Array.from({ length: 2500 }, (_, k) => 1 + (k % 97)));
    for (const [locale, text] of [["en", "Showing 2,000 of 2,500 flows"], ["de", "2.000 von 2.500 Flüssen gezeigt"]] as [Locale, string][]) {
      const { unmount } = mount({ renderer: "canvas", edgeBudget: 2000, fitView: true, locale }, large);
      await waitFor(() => expect(note()?.textContent).toBe(text));
      unmount();
    }
  });

  it("removes the note when the budget no longer withholds edges", async () => {
    textCanvas();
    const view = mount({ renderer: "canvas", edgeBudget: 3 });
    await waitFor(() => expect(note()).not.toBeNull());
    await act(async () => {
      view.rerender(
        <div style={{ width: 1200, height: 800 }}>
          <ProcessMap graph={small.graph} positions={small.positions} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} renderer="canvas" edgeBudget="all" />
        </div>,
      );
    });
    await waitFor(() => expect(note()).toBeNull());
  });
});

function reducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

/** An ELK whose layouts finish when the test answers them: every node in one column, 100 apart. */
function heldElk() {
  const calls: { graph: ElkNode; resolve: (result: ElkNode) => void }[] = [];
  const elk = { layout: (graph: ElkNode) => new Promise<ElkNode>((resolve) => calls.push({ graph, resolve })) } as unknown as ELK;
  const answer = () => calls[0].resolve({ ...calls[0].graph, children: calls[0].graph.children!.map((child, i) => ({ ...child, x: 500, y: 100 * i })) });
  return { elk, calls, answer };
}

const active = (map: HTMLElement) => map.getAttribute("aria-activedescendant");

describe("edge budget and the keyboard", () => {
  // Alt with an arrow key moves from the hub along its paths in the graph's order: h->t1 first, the lightest
  // edge (10), which a budget of 3 withholds until the keyboard is on it.
  it("draws the edge the keyboard moved onto in the React Flow map, and keeps the note's numbers", async () => {
    const { container } = mount({ renderer: "svg", edgeBudget: 3 });
    await waitFor(() => expect(rfEdges(container)).toEqual(["h->t2", "h->t5", "h->t7"]));
    const map = screen.getByRole("group", { name: /Process map/ });
    await act(async () => void fireEvent.keyDown(map, { key: "Home" }));
    expect(active(map)).toBe("wf-node-h");
    await act(async () => void fireEvent.keyDown(map, { key: "ArrowRight", altKey: true }));
    expect(active(map)).toBe("wf-edge-h->t1");
    // The focused edge is drawn in place of the weakest unprotected one, h->t2.
    await waitFor(() => expect(rfEdges(container)).toEqual(["h->t1", "h->t5", "h->t7"]));
    expect(document.getElementById("wf-edge-h->t1")).not.toBeNull();
    expect(note()!.textContent).toBe("Showing 3 of 8 flows");
  });

  it("lists and draws the edge the keyboard moved onto in the Canvas map", async () => {
    const frames = frameCanvas();
    const { container } = mount({ renderer: "canvas", edgeBudget: 3, lod: { edgeLabels: 0 } });
    await waitFor(() => expect(note()?.textContent).toBe("Showing 3 of 8 flows"));
    await waitFor(() => expect(counts(frames.at(-1))).toEqual(["50", "60", "70"]));
    const map = screen.getByRole("group", { name: /Process map/ });
    await act(async () => void fireEvent.keyDown(map, { key: "Home" }));
    await act(async () => void fireEvent.keyDown(map, { key: "ArrowRight", altKey: true }));
    expect(active(map)).toBe("wf-edge-h->t1");
    expect(container.querySelector("[id='wf-edge-h->t1']")).not.toBeNull();
    // The next draw writes the focused edge's label in place of the weakest unprotected edge's.
    await waitFor(() => expect(counts(frames.at(-1))).toEqual(["10", "60", "70"]));
    expect(note()?.textContent).toBe("Showing 3 of 8 flows");
  });

  it("draws a withheld edge only while the keyboard is on it, also beyond a budget that leaves no room", async () => {
    // A budget of 0 draws no edge; the edge the keyboard is on is drawn beyond it, so the count grows by one.
    const { container } = mount({ renderer: "svg", edgeBudget: 0 });
    await waitFor(() => expect(note()?.textContent).toBe("Showing 0 of 8 flows"));
    const map = screen.getByRole("group", { name: /Process map/ });
    await act(async () => void fireEvent.keyDown(map, { key: "Home" }));
    await act(async () => void fireEvent.keyDown(map, { key: "ArrowRight", altKey: true }));
    expect(active(map)).toBe("wf-edge-h->t1");
    expect(rfEdges(container)).toEqual(["h->t1"]);
    expect(note()?.textContent).toBe("Showing 1 of 8 flows");
    expect(live()).toBe("Focused: path Hub → T1. 10 transitions.");
    // On to its end, the edge is withheld again.
    await act(async () => void fireEvent.keyDown(map, { key: "ArrowRight", altKey: true }));
    expect(active(map)).toBe("wf-node-t1");
    expect(rfEdges(container)).toEqual([]);
    expect(note()?.textContent).toBe("Showing 0 of 8 flows");
  });
});

describe("edge budget across the first scene", () => {
  // Without positions the map draws a provisional arrangement first; the budget chooses the same three
  // edges there and once the layout has replaced it, so the note and the report to the host hold.
  const shown = { edges: ["h->t2", "h->t5", "h->t7"], total: 8 };

  it("keeps the note and reports the drawn edges once on the React Flow map", async () => {
    reducedMotion(true);
    const held = heldElk();
    const reported: (ShownEdges | undefined)[] = [];
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={small.graph} layout={{ elk: held.elk, engine: "elk" }} renderer="svg" edgeBudget={3} onEdgesShown={(s) => reported.push(s)} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    const map = container.querySelector(".wf-process-map")!;
    expect(map.getAttribute("data-layout-status")).toBe("pending");
    expect(rfEdges(container)).toEqual(shown.edges);
    expect(note()!.textContent).toBe("Showing 3 of 8 flows");
    await waitFor(() => expect(reported).toEqual([shown]));
    await act(async () => held.answer());
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"));
    expect(rfEdges(container)).toEqual(shown.edges);
    expect(note()!.textContent).toBe("Showing 3 of 8 flows");
    expect(reported).toEqual([shown]);
  });

  it("keeps the note and reports the drawn edges once on the Canvas map", async () => {
    reducedMotion(true);
    textCanvas();
    const held = heldElk();
    const reported: (ShownEdges | undefined)[] = [];
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={small.graph} layout={{ elk: held.elk, engine: "elk" }} renderer="canvas" edgeBudget={3} onEdgesShown={(s) => reported.push(s)} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
      </div>,
    );
    const map = container.querySelector(".wf-process-map")!;
    await waitFor(() => expect(note()?.textContent).toBe("Showing 3 of 8 flows"));
    await waitFor(() => expect(reported).toEqual([shown]));
    await act(async () => held.answer());
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"));
    // The frame drawn on the layout reports nothing new.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(note()?.textContent).toBe("Showing 3 of 8 flows");
    expect(reported).toEqual([shown]);
  });
});
