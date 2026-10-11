import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type LayoutOptions, type Positions, createPositions } from "../../src/index";
import { ProcessMap, type StableLayout, useStableLayout } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const activity = (id: string) => ({ id, kind: "activity" as const, label: id.toUpperCase() });
const follows = (source: string, target: string) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target });

/** a → b → c and a → c. */
const chain: FlowGraph = { nodes: [activity("a"), activity("b"), activity("c")], edges: [follows("a", "b"), follows("b", "c"), follows("a", "c")] };

/** An ELK whose layouts finish when the test answers them. */
function heldElk() {
  const calls: { graph: ElkNode; resolve: (result: ElkNode) => void }[] = [];
  const elk = { layout: (graph: ElkNode) => new Promise<ElkNode>((resolve) => calls.push({ graph, resolve })) } as unknown as ELK;
  /** Finish a layout: every node in one column, 100 apart from y 1000 (far from the provisional places). */
  const answer = (k = calls.length - 1) =>
    calls[k].resolve({ ...calls[k].graph, children: calls[k].graph.children!.map((child, i) => ({ ...child, x: 500, y: 1000 + 100 * i })) });
  return { elk, calls, answer };
}

/** The map's own status panel (the abstraction controls' outputs are statuses too). */
const panel = () => document.querySelector(".wf-panel[role='status']");

const never = { layout: () => new Promise<ElkNode>(() => undefined) } as unknown as ELK;

function translate(container: HTMLElement, id: string) {
  const node = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  const m = node.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/)!;
  return { x: Number(m[1]), y: Number(m[2]) };
}

function viewport(container: HTMLElement) {
  const m = container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

function reducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
}

/** Records every result of the hook. */
function recorded(graph: FlowGraph | undefined, options: LayoutOptions) {
  const results: StableLayout[] = [];
  const hook = renderHook(({ g }: { g: FlowGraph | undefined }) => {
    const r = useStableLayout(g, options);
    if (results[results.length - 1] !== r) results.push(r);
    return r;
  }, { initialProps: { g: graph } });
  return { ...hook, results };
}

describe("first scene", () => {
  it("draws nodes and edges when the map mounts, before the layout finishes", () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} layout={{ elk: never, engine: "elk" }} />
      </div>,
    );
    // No waiting: the mount itself drew the provisional arrangement.
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(3);
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(3);
    // Ranks a 0, b 1, c 2: 180 wide, 64 apart.
    expect([translate(container, "a"), translate(container, "b"), translate(container, "c")]).toEqual([{ x: 0, y: 0 }, { x: 244, y: 0 }, { x: 488, y: 0 }]);
    const map = container.querySelector(".wf-process-map")!;
    expect(map.getAttribute("data-layout-status")).toBe("pending");
    expect(map.getAttribute("data-engine")).toBe("provisional");
    // Marked visibly and for assistive technology.
    expect(panel()!.textContent).toBe("Arranging the map…");
    expect(document.getElementById(map.getAttribute("aria-describedby")!)!.textContent).toContain("Arranging the map…");
  });

  it("says so in German", () => {
    render(<ProcessMap graph={chain} layout={{ elk: never, engine: "elk" }} locale="de" />);
    expect(panel()!.textContent).toBe("Karte wird angeordnet…");
  });

  it("hands a Canvas map the scene when it mounts", async () => {
    const calls: string[] = [];
    const noop = () => {};
    const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 6 }), createPattern: () => null } as Record<string, unknown>, {
      get: (target, key: string) => target[key] ?? (key === "moveTo" || key === "fillText" ? (...args: unknown[]) => calls.push(`${key} ${args.slice(0, key === "fillText" ? 1 : 2).join(" ")}`) : noop),
      set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} renderer="canvas" edgeBudget="all" layout={{ elk: never, engine: "elk" }} controls={false} legend={false} />
      </div>,
    );
    // Listed for assistive technology at once: the activities (the list holds edges only at the keyboard position).
    expect([...container.querySelectorAll("[id^='wf-node-']")].map((e) => e.id).sort()).toEqual(["wf-node-a", "wf-node-b", "wf-node-c"]);
    expect(container.querySelector(".wf-process-map")!.getAttribute("data-layout-status")).toBe("pending");
    // The next frame draws the labels and the straight edges from a's right side (180, 32) and b's (424, 32).
    await waitFor(() => expect(calls).toEqual(expect.arrayContaining(["fillText A", "fillText B", "fillText C", "moveTo 180 32", "moveTo 424 32"])));
  });

  it("is interactive while provisional", async () => {
    const onSelect = vi.fn();
    const { container } = render(<ProcessMap graph={chain} layout={{ elk: never, engine: "elk" }} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('.react-flow__node[data-id="b"]')!);
    expect(onSelect).toHaveBeenCalledWith({ nodes: ["b"], edges: [], groups: [] });
    const map = screen.getByRole("group", { name: /Process map/ });
    await act(async () => void fireEvent.keyDown(map, { key: "Home" }));
    expect(map.getAttribute("aria-activedescendant")).toBe("wf-node-a");
  });
});

describe("arrival of the layout", () => {
  it("replaces the provisional positions once, keeping selection and focus; at once with reduced motion", async () => {
    reducedMotion(true);
    const held = heldElk();
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} layout={{ elk: held.elk, engine: "elk" }} fitView={false} />
      </div>,
    );
    await waitFor(() => expect(held.calls).toHaveLength(1));
    const map = screen.getByRole("group", { name: /Process map/ });
    fireEvent.click(container.querySelector('.react-flow__node[data-id="b"]')!);
    map.focus();
    await act(async () => void fireEvent.keyDown(map, { key: "End" }));
    expect(map.getAttribute("aria-activedescendant")).toBe("wf-node-c");
    const moves: string[] = [];
    const observer = new MutationObserver(() => moves.push(container.querySelector<HTMLElement>('.react-flow__node[data-id="c"]')!.style.transform));
    observer.observe(container.querySelector('.react-flow__node[data-id="c"]')!, { attributes: true, attributeFilter: ["style"] });
    frames.mockClear();
    await act(async () => held.answer());
    // The engine's places (sorted by id: a, b, c) at once, no frame requested for motion.
    expect(translate(container, "c")).toEqual({ x: 500, y: 1200 });
    expect(new Set(moves)).toEqual(new Set(["translate(500px,1200px)"]));
    expect(frames).not.toHaveBeenCalled();
    expect(map.getAttribute("data-layout-status")).toBe("ready");
    expect(panel()).toBeNull();
    expect(container.querySelector('.react-flow__node[data-id="b"]')!.classList.contains("selected")).toBe(true);
    expect(map.getAttribute("aria-activedescendant")).toBe("wf-node-c");
    expect(document.activeElement).toBe(map);
    observer.disconnect();
  });

  it("moves the nodes into place over a short time otherwise", async () => {
    reducedMotion(false);
    const held = heldElk();
    const { container } = render(<ProcessMap graph={chain} layout={{ elk: held.elk, engine: "elk" }} fitView={false} />);
    await waitFor(() => expect(held.calls).toHaveLength(1));
    const start = translate(container, "c");
    await act(async () => held.answer());
    // Still on the way: the status says so and c sits between the two places.
    expect(container.querySelector(".wf-process-map")!.getAttribute("data-layout-status")).toBe("pending");
    await waitFor(() => {
      const now = translate(container, "c");
      expect(now.y).toBeGreaterThan(start.y);
      expect(now.y).toBeLessThan(1200);
    });
    await waitFor(() => expect(container.querySelector(".wf-process-map")!.getAttribute("data-layout-status")).toBe("ready"));
    expect(translate(container, "c")).toEqual({ x: 500, y: 1200 });
  });

  it("says ready only once the nodes are drawn in their places", async () => {
    reducedMotion(true);
    const held = heldElk();
    const { container } = render(<ProcessMap graph={chain} layout={{ elk: held.elk, engine: "elk" }} />);
    await waitFor(() => expect(held.calls).toHaveLength(1));
    const map = container.querySelector(".wf-process-map")!;
    // Where c is drawn each time the status changes, read as an observer of the page reads it.
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(`${map.getAttribute("data-layout-status")} ${translate(container, "c").y}`));
    observer.observe(map, { attributes: true, attributeFilter: ["data-layout-status"] });
    // Answered outside act, so that React schedules its work as it does in a browser.
    held.answer();
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("ready"));
    expect(seen).toEqual(["ready 1200"]);
    observer.disconnect();
  });

  it("keeps the zoom and the node at the centre of a view that is not fitted", async () => {
    reducedMotion(true);
    const held = heldElk();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} layout={{ elk: held.elk, engine: "elk" }} fitView={false} />
      </div>,
    );
    await waitFor(() => expect(held.calls).toHaveLength(1));
    expect(viewport(container)).toEqual({ x: 0, y: 0, zoom: 1 });
    // The view's centre in its own size as React Flow measured it; the nearest of the centres a (90, 32), b (334, 32), c (578, 32).
    const { width, height } = container.querySelector(".react-flow")!.getBoundingClientRect();
    const before = { a: { x: 90, y: 32 }, b: { x: 334, y: 32 }, c: { x: 578, y: 32 } };
    const distance = (p: { x: number; y: number }) => (p.x - width / 2) ** 2 + (p.y - height / 2) ** 2;
    const anchor = (["a", "b", "c"] as const).reduce((best, id) => (distance(before[id]) < distance(before[best]) ? id : best));
    await act(async () => held.answer());
    // The layout puts a, b, c at y 1000, 1100, 1200 and x 500: the anchor's centre moves by the difference, and so does the view.
    const after = { a: { x: 590, y: 1032 }, b: { x: 590, y: 1132 }, c: { x: 590, y: 1232 } };
    expect(viewport(container)).toEqual({ x: before[anchor].x - after[anchor].x, y: before[anchor].y - after[anchor].y, zoom: 1 });
  });
});

describe("the view when the layout arrives", () => {
  async function arrived(zoomIn: boolean, answer = true) {
    reducedMotion(true);
    const held = heldElk();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} layout={{ elk: held.elk, engine: "elk" }} controls={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(held.calls).toHaveLength(1));
    // The provisional arrangement (668 × 64) is fitted: its centre (334, 32) is the view's centre.
    const { width, height } = container.querySelector(".react-flow")!.getBoundingClientRect();
    const centred = (v: { x: number; y: number; zoom: number }, c: { x: number; y: number }) => {
      expect(c.x * v.zoom + v.x).toBeCloseTo(width / 2);
      expect(c.y * v.zoom + v.y).toBeCloseTo(height / 2);
    };
    await waitFor(() => centred(viewport(container), { x: 334, y: 32 }), { timeout: 2000 });
    // The map fits twice (50 and 400 ms after the nodes render and again after they are measured): let those pass.
    await act(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    if (zoomIn) {
      const fitted = viewport(container).zoom;
      fireEvent.click(container.querySelector(".react-flow__controls-zoomin")!);
      await waitFor(() => expect(viewport(container).zoom).toBeGreaterThan(fitted));
    }
    const before = viewport(container);
    if (answer) await act(async () => held.answer());
    return { container, before, centred };
  }

  it("is fitted to the layout when nobody moved it", async () => {
    const { container, before, centred } = await arrived(false);
    // The layout spans (500, 1000) to (680, 1264): its centre (590, 1132) comes to the view's centre.
    await waitFor(() => centred(viewport(container), { x: 590, y: 1132 }), { timeout: 2000 });
    expect(viewport(container).zoom).not.toBe(before.zoom);
  });

  it("keeps its zoom and the node at its centre when the user zoomed it", async () => {
    const { container, before } = await arrived(true);
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const after = viewport(container);
    expect(after.zoom).toBe(before.zoom);
    // Zooming in keeps the centre: b (334, 32) stays the node nearest it and keeps its place on screen at (590, 1132).
    expect(590 * after.zoom + after.x).toBeCloseTo(334 * before.zoom + before.x);
    expect(1132 * after.zoom + after.y).toBeCloseTo(32 * before.zoom + before.y);
  });

  it("keeps the zoom the user chose while the layout is still on its way", async () => {
    const { container, before } = await arrived(true, false);
    // Selecting a node updates React Flow's nodes: a fit the map asked for before the zoom must not run then.
    fireEvent.click(container.querySelector('.react-flow__node[data-id="b"]')!);
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(container.querySelector('.react-flow__node[data-id="b"]')!.classList).toContain("selected");
    expect(viewport(container)).toEqual(before);
  });
});

describe("the Canvas view when the layout arrives", () => {
  /** Records the viewport of the last frame: the drawing translates by (x, y) and scales by the zoom. */
  function recordView() {
    const recorded = { view: { x: NaN, y: NaN, zoom: NaN } };
    const noop = () => {};
    const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 6 }), createPattern: () => null } as Record<string, unknown>, {
      get: (target, key: string) =>
        target[key] ??
        (key === "translate" ? (x: number, y: number) => void Object.assign(recorded.view, { x, y }) : key === "scale" ? (zoom: number) => void (recorded.view.zoom = zoom) : noop),
      set: () => true,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
    return recorded;
  }

  it("is fitted to the layout when nobody moved it", async () => {
    reducedMotion(true);
    const held = heldElk();
    const recorded = recordView();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} renderer="canvas" edgeBudget="all" layout={{ elk: held.elk, engine: "elk" }} controls={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(held.calls).toHaveLength(1));
    const { width, height } = container.querySelector("canvas")!.getBoundingClientRect();
    const centred = (c: { x: number; y: number }) => {
      const v = recorded.view;
      expect(c.x * v.zoom + v.x).toBeCloseTo(width / 2);
      expect(c.y * v.zoom + v.y).toBeCloseTo(height / 2);
    };
    await waitFor(() => centred({ x: 334, y: 32 }));
    await act(async () => held.answer());
    await waitFor(() => centred({ x: 590, y: 1132 }));
  });

  it("is fitted to the layout when the fit button was pressed after a zoom", async () => {
    reducedMotion(true);
    const held = heldElk();
    const recorded = recordView();
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} renderer="canvas" edgeBudget="all" layout={{ elk: held.elk, engine: "elk" }} controls={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(held.calls).toHaveLength(1));
    const { width, height } = container.querySelector("canvas")!.getBoundingClientRect();
    const centred = (c: { x: number; y: number }) => {
      const v = recorded.view;
      expect(c.x * v.zoom + v.x).toBeCloseTo(width / 2);
      expect(c.y * v.zoom + v.y).toBeCloseTo(height / 2);
    };
    await waitFor(() => centred({ x: 334, y: 32 }));
    const fitted = recorded.view.zoom;
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(recorded.view.zoom).toBeGreaterThan(fitted));
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    await waitFor(() => expect(recorded.view.zoom).toBe(fitted));
    await act(async () => held.answer());
    // Fitted, not kept: the layout (180 × 264) needs another zoom than the provisional arrangement (668 × 64).
    await waitFor(() => centred({ x: 590, y: 1132 }));
    expect(recorded.view.zoom).not.toBe(fitted);
  });

  it("keeps its zoom and the node at its centre when it is not fitted", async () => {
    reducedMotion(true);
    const held = heldElk();
    const recorded = recordView();
    const view = recorded.view;
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} renderer="canvas" edgeBudget="all" layout={{ elk: held.elk, engine: "elk" }} fitView={false} controls={false} legend={false} />
      </div>,
    );
    await waitFor(() => expect(held.calls).toHaveLength(1));
    await waitFor(() => expect(view).toEqual({ x: 0, y: 0, zoom: 1 }));
    const { width, height } = container.querySelector("canvas")!.getBoundingClientRect();
    const before = { a: { x: 90, y: 32 }, b: { x: 334, y: 32 }, c: { x: 578, y: 32 } };
    const distance = (p: { x: number; y: number }) => (p.x - width / 2) ** 2 + (p.y - height / 2) ** 2;
    const anchor = (["a", "b", "c"] as const).reduce((best, id) => (distance(before[id]) < distance(before[best]) ? id : best));
    const after = { a: { x: 590, y: 1032 }, b: { x: 590, y: 1132 }, c: { x: 590, y: 1232 } };
    await act(async () => held.answer());
    await waitFor(() => expect(view).toEqual({ x: before[anchor].x - after[anchor].x, y: before[anchor].y - after[anchor].y, zoom: 1 }));
  });
});

describe("useStableLayout", () => {
  it("returns a provisional arrangement until the layout arrives, then the layout once", async () => {
    const held = heldElk();
    const { result, results } = recorded(chain, { elk: held.elk, engine: "elk" });
    expect(result.current).toMatchObject({ status: "pending", provisional: true });
    expect(result.current.positions!.engine).toBe("provisional");
    expect(Object.keys(result.current.positions!.nodes).sort()).toEqual(["a", "b", "c"]);
    await waitFor(() => expect(held.calls).toHaveLength(1));
    await act(async () => held.answer());
    expect(result.current).toMatchObject({ status: "ready", provisional: false });
    expect(result.current.positions!.nodes.a).toEqual({ x: 500, y: 1000, width: 180, height: 64 });
    expect(results.map((r) => r.positions!.engine)).toEqual(["provisional", "elk"]);
  });

  it("reuses the positions of surviving nodes for a changed graph and prefers a finished layout of the same inputs", async () => {
    const held = heldElk();
    const { result, results, rerender } = recorded(chain, { elk: held.elk, engine: "elk" });
    await waitFor(() => expect(held.calls).toHaveLength(1));
    await act(async () => held.answer());
    const first = result.current.positions!;
    // c goes, d follows b.
    const changed: FlowGraph = { nodes: [activity("a"), activity("b"), activity("d")], edges: [follows("a", "b"), follows("b", "d")] };
    rerender({ g: changed });
    expect(result.current).toMatchObject({ status: "pending", provisional: true });
    const interim = result.current.positions!;
    expect(interim.nodes.a).toEqual(first.nodes.a);
    expect(interim.nodes.b).toEqual(first.nodes.b);
    // Beside b along the flow: 180 + 64 to the right.
    expect(interim.nodes.d).toEqual({ x: 500 + 180 + 64, y: 1100, width: 180, height: 64 });
    await waitFor(() => expect(held.calls).toHaveLength(2));
    await act(async () => held.answer());
    expect(result.current.status).toBe("ready");
    // Back to the first graph: its layout is known, no provisional state and no new engine run.
    const count = results.length;
    rerender({ g: chain });
    expect(result.current).toMatchObject({ status: "ready", provisional: false });
    expect(result.current.positions).toBe(first);
    await act(async () => undefined);
    expect(held.calls).toHaveLength(2);
    expect(results.slice(count).every((r) => r.positions === first && r.status === "ready")).toBe(true);
  });

  it("is idle without scenes and reports errors as before", async () => {
    const failing = { layout: () => Promise.reject(new Error("no layout")) } as unknown as ELK;
    const { result, rerender } = recorded(undefined, { elk: failing, engine: "elk" });
    expect(result.current).toEqual({ positions: undefined, status: "idle", provisional: false });
    rerender({ g: chain });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toMatchObject({ positions: undefined, provisional: false });
    expect(result.current.error?.message).toBe("no layout");
  });
});

describe("hosts that supply positions", () => {
  const at = (y: number): Positions =>
    createPositions({ nodes: { a: { x: 0, y, width: 180, height: 48 }, b: { x: 300, y, width: 180, height: 48 }, c: { x: 600, y, width: 180, height: 48 } }, groups: {}, edges: {} }, "dagre", "RIGHT");

  it("draw them at once, as given", () => {
    reducedMotion(false);
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const { container, rerender } = render(<ProcessMap graph={chain} positions={at(0)} fitView={false} />);
    expect(container.querySelector(".wf-process-map")!.getAttribute("data-layout-status")).toBe("given");
    expect(panel()).toBeNull();
    frames.mockClear();
    rerender(<ProcessMap graph={chain} positions={at(500)} fitView={false} />);
    expect(translate(container, "b")).toEqual({ x: 300, y: 500 });
    expect(frames).not.toHaveBeenCalled();
  });

  it("see the provisional state of positions from useStableLayout", async () => {
    reducedMotion(true);
    const held = heldElk();
    function Host() {
      const { positions } = useStableLayout(chain, { elk: held.elk, engine: "elk" });
      return <ProcessMap graph={chain} positions={positions} fitView={false} />;
    }
    const { container } = render(<Host />);
    expect(container.querySelector(".wf-process-map")!.getAttribute("data-layout-status")).toBe("pending");
    expect(panel()!.textContent).toBe("Arranging the map…");
    await waitFor(() => expect(held.calls).toHaveLength(1));
    await act(async () => held.answer());
    expect(container.querySelector(".wf-process-map")!.getAttribute("data-layout-status")).toBe("given");
    expect(translate(container, "a")).toEqual({ x: 500, y: 1000 });
  });

  it("move a view that is not fitted only when the layout arrives, not with later positions", async () => {
    reducedMotion(true);
    const map = (p: Positions) => <ProcessMap graph={chain} positions={p} fitView={false} />;
    const { container, rerender } = render(map(createPositions(at(0), "provisional", "RIGHT")));
    rerender(map(at(100)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    // The user pans 50 up; the host then gives positions of the same extent with a, b, c in reverse.
    const arrived = viewport(container);
    fireEvent.wheel(container.querySelector(".react-flow__pane")!, { deltaX: 0, deltaY: 100 });
    await waitFor(() => expect(viewport(container)).not.toEqual(arrived));
    const panned = viewport(container);
    const reversed = createPositions({ nodes: { a: at(100).nodes.c, b: at(100).nodes.b, c: at(100).nodes.a }, groups: {}, edges: {} }, "dagre", "RIGHT");
    rerender(map(reversed));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(viewport(container)).toEqual(panned);
  });
});
