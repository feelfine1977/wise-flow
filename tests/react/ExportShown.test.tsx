import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowNode, type ShownEdges, createPositions, toSVG } from "../../src/index";
import { type DrawContext, toPNGCanvas } from "../../src/canvas/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A hub `h` with a path `h-t1` … to each activity, with these counts. */
function hub(counts: number[]) {
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "Hub" }, ...counts.map((_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `T${k + 1}` }))];
  const edges: FlowEdge[] = counts.map((count, k) => ({ id: `h-t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count } }));
  const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, i === 0 ? { x: 0, y: 0, width: 100, height: 40 } : { x: 300, y: 80 * (i - 1), width: 100, height: 40 }]));
  return { graph: { nodes, edges } satisfies FlowGraph, positions: createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT") };
}

// Hand-ordered by count: h-t5 (70), h-t7 (60), h-t2 (50), h-t8 (40), h-t3 and h-t4 (30), h-t6 (20), h-t1 (10).
const small = hub([10, 50, 30, 30, 70, 20, 60, 40]);
// A budget of 3 with h-t1 selected: h-t1, then the two heaviest, h-t5 and h-t7.
const selected = { nodes: [], edges: ["h-t1"], groups: [] };

type Props = Partial<React.ComponentProps<typeof ProcessMap>>;
function mount(props: Props) {
  const reported: (ShownEdges | undefined)[] = [];
  const view = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={small.graph} positions={small.positions} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} onEdgesShown={(shown) => reported.push(shown)} {...props} />
    </div>,
  );
  return { ...view, reported };
}

/** A 2D context for the Canvas map that draws nothing. */
function quietCanvas() {
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

/** The texts a PNG export without its legend writes. */
function pngTexts(edgeBudget: ShownEdges | undefined) {
  const texts: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), fillText: (s: string) => texts.push(s) } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  toPNGCanvas(small, { scale: 1, legend: false, edgeBudget, createCanvas: (width, height) => ({ width, height, getContext: () => ctx as unknown as DrawContext }) });
  return texts;
}

const svgEdges = (svg: string) => [...svg.matchAll(/<g class="wf-edge" data-id="([^"]*)"/g)].map((m) => m[1]).sort();
const svgNote = (svg: string) => /<text [^>]*class="wf-edge-note"[^>]*>([^<]*)<\/text>/.exec(svg)?.[1];
const note = () => screen.queryByTestId("wf-edge-note")?.textContent;

describe("exporting what the map shows", () => {
  for (const renderer of ["svg", "canvas"] as const) {
    it(`exports the edges the ${renderer} map draws, with its note, in SVG and PNG`, async () => {
      if (renderer === "canvas") quietCanvas();
      const { reported } = mount({ renderer, edgeBudget: 3, selection: selected });
      await waitFor(() => expect(note()).toBe("Showing 3 of 8 flows"));
      const shown = reported.at(-1)!;
      expect([...shown.edges].sort()).toEqual(["h-t1", "h-t5", "h-t7"]);
      expect(shown.total).toBe(8);

      const svg = toSVG(small, { edgeBudget: shown });
      expect(svgEdges(svg)).toEqual(["h-t1", "h-t5", "h-t7"]);
      expect(svgNote(svg)).toBe("Showing 3 of 8 flows");
      const texts = pngTexts(shown);
      expect(texts.filter((s) => /^\d+$/.test(s)).sort()).toEqual(["10", "60", "70"]);
      expect(texts).toContain("Showing 3 of 8 flows");
    });
  }

  it("reports a change of the edges drawn once, and nothing while every edge is drawn", async () => {
    const view = mount({ renderer: "svg", edgeBudget: "all" });
    await waitFor(() => expect(view.container.querySelectorAll(".react-flow__edge")).toHaveLength(8));
    expect(view.reported).toEqual([]);
    const props = { graph: small.graph, positions: small.positions, controls: false, legend: false, fitView: false, selfLoops: false, contextMenu: false, pathList: false, renderer: "svg" as const, onEdgesShown: (s: ShownEdges | undefined) => view.reported.push(s) };
    await act(async () => view.rerender(<div style={{ width: 1200, height: 800 }}><ProcessMap {...props} edgeBudget={2} /></div>));
    await waitFor(() => expect(note()).toBe("Showing 2 of 8 flows"));
    expect(view.reported.map((s) => s && [...s.edges].sort())).toEqual([["h-t5", "h-t7"]]);
    await act(async () => view.rerender(<div style={{ width: 1200, height: 800 }}><ProcessMap {...props} edgeBudget="all" /></div>));
    await waitFor(() => expect(note()).toBeUndefined());
    expect(view.reported).toHaveLength(2);
    expect(view.reported[1]).toBeUndefined();
    // Exported without a value, the figure has every edge again.
    expect(svgEdges(toSVG(small, { edgeBudget: view.reported[1] }))).toHaveLength(8);
  });

  it("reports what the new renderer draws after a switch of renderer", async () => {
    quietCanvas();
    const reported: (ShownEdges | undefined)[] = [];
    const map = (renderer: "svg" | "canvas", edgeBudget: number) => (
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={small.graph} positions={small.positions} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} renderer={renderer} edgeBudget={edgeBudget} onEdgesShown={(shown) => reported.push(shown)} />
      </div>
    );
    const last = () => reported.at(-1) && [...reported.at(-1)!.edges].sort();
    const view = render(map("svg", 2));
    await waitFor(() => expect(last()).toEqual(["h-t5", "h-t7"]));
    // The Canvas map draws every edge: the host is told so, not left with the two.
    await act(async () => view.rerender(map("canvas", 20)));
    await waitFor(() => expect(reported).toHaveLength(2));
    expect(reported[1]).toBeUndefined();
    await act(async () => view.rerender(map("canvas", 3)));
    await waitFor(() => expect(last()).toEqual(["h-t2", "h-t5", "h-t7"]));
    // Back on React Flow, the same two edges as at first are reported again.
    await act(async () => view.rerender(map("svg", 2)));
    await waitFor(() => expect(last()).toEqual(["h-t5", "h-t7"]));
    // And when it then draws every edge, the host hears that too.
    await act(async () => view.rerender(map("canvas", 2)));
    await waitFor(() => expect(last()).toEqual(["h-t5", "h-t7"]));
    await act(async () => view.rerender(map("svg", 20)));
    await waitFor(() => expect(reported.at(-1)).toBeUndefined());
    expect(note()).toBeUndefined();
  });

  for (const renderer of ["svg", "canvas"] as const) {
    it(`tells a host that starts listening while the ${renderer} map withholds edges what it draws`, async () => {
      if (renderer === "canvas") quietCanvas();
      const reported: (ShownEdges | undefined)[] = [];
      const map = (listen: boolean) => (
        <div style={{ width: 1200, height: 800 }}>
          <ProcessMap graph={small.graph} positions={small.positions} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} renderer={renderer} edgeBudget={3} onEdgesShown={listen ? (shown) => reported.push(shown) : undefined} />
        </div>
      );
      const view = render(map(false));
      await waitFor(() => expect(note()).toBe("Showing 3 of 8 flows"));
      // An export dialog that opens later listens from then on, and learns what the map withholds.
      await act(async () => view.rerender(map(true)));
      await waitFor(() => expect(reported).toHaveLength(1));
      expect([...reported[0]!.edges].sort()).toEqual(["h-t2", "h-t5", "h-t7"]);
      expect(reported[0]!.total).toBe(8);
      expect(svgNote(toSVG(small, { edgeBudget: reported[0] }))).toBe("Showing 3 of 8 flows");
    });
  }

  it("reports what the Canvas map draws when it is shown again after the table view", async () => {
    quietCanvas();
    const reported: (ShownEdges | undefined)[] = [];
    const map = (view: "map" | "table", edgeBudget: number | "all") => (
      <div style={{ width: 1200, height: 800 }}>
        <ProcessMap graph={small.graph} positions={small.positions} controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} renderer="canvas" view={view} edgeBudget={edgeBudget} onEdgesShown={(shown) => reported.push(shown)} />
      </div>
    );
    const last = () => reported.at(-1) && [...reported.at(-1)!.edges].sort();
    const view = render(map("map", 3));
    await waitFor(() => expect(last()).toEqual(["h-t2", "h-t5", "h-t7"]));
    // Back from the table view with the same budget, the map draws and reports the same three edges.
    await act(async () => view.rerender(map("table", 3)));
    await act(async () => view.rerender(map("map", 3)));
    await waitFor(() => expect(note()).toBe("Showing 3 of 8 flows"));
    await waitFor(() => expect(last()).toEqual(["h-t2", "h-t5", "h-t7"]));
    // The budget changed while the table was shown: back on the map every edge is drawn, and the host
    // hears so instead of keeping the three, which an export would otherwise draw with a note.
    await act(async () => view.rerender(map("table", 3)));
    await act(async () => view.rerender(map("table", "all")));
    await act(async () => view.rerender(map("map", "all")));
    await waitFor(() => expect(reported.at(-1)).toBeUndefined());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(reported.at(-1)).toBeUndefined();
    expect(note()).toBeUndefined();
    expect(svgEdges(toSVG(small, { edgeBudget: reported.at(-1) }))).toHaveLength(8);
  });
});
