import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type LayoutOptions, LayoutUnavailableError } from "../../src/index";
import { ProcessMap, type StableLayout, useStableLayout } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const activity = (id: string) => ({ id, kind: "activity" as const, label: id.toUpperCase() });
const follows = (source: string, target: string) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target });

/** a → b → c and a → c. */
const chain: FlowGraph = { nodes: [activity("a"), activity("b"), activity("c")], edges: [follows("a", "b"), follows("b", "c"), follows("a", "c")] };
/** a → b → d. */
const changed: FlowGraph = { nodes: [activity("a"), activity("b"), activity("d")], edges: [follows("a", "b"), follows("b", "d")] };

const failing = { layout: () => Promise.reject(new Error("engine down")) } as unknown as ELK;
/** The fallback may lay out 2 nodes plus edges on the calling thread; the chain has 6. */
const unavailable: LayoutOptions = { elk: failing, fallbackLimit: 2 };

const panel = () => document.querySelector(".wf-panel[role='status']");

function translate(container: HTMLElement, id: string) {
  const node = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
  const m = node.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/)!;
  return { x: Number(m[1]), y: Number(m[2]) };
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

describe("a refined layout that is unavailable", () => {
  it("leaves the provisional scene on the map and says so", async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={chain} layout={unavailable} />
      </div>,
    );
    const map = container.querySelector(".wf-process-map")!;
    await waitFor(() => expect(map.getAttribute("data-layout-status")).toBe("error"));
    // Ranks a 0, b 1, c 2: 180 wide, 64 apart, as the provisional arrangement placed them.
    expect([translate(container, "a"), translate(container, "b"), translate(container, "c")]).toEqual([{ x: 0, y: 0 }, { x: 244, y: 0 }, { x: 488, y: 0 }]);
    expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(3);
    expect(map.getAttribute("data-engine")).toBe("provisional");
    expect(panel()!.textContent).toBe("The refined layout is unavailable; the map shows a provisional arrangement.");
    expect(document.querySelector("[role='alert']")).toBeNull();
    const description = document.getElementById(map.getAttribute("aria-describedby")!)!.textContent!;
    expect(description).toContain("The refined layout is unavailable");
    expect(description).not.toContain("Arranging");
  });

  it("says so in German", async () => {
    render(<ProcessMap graph={chain} layout={unavailable} locale="de" />);
    await waitFor(() => expect(panel()!.textContent).toBe("Das verfeinerte Layout ist nicht verfügbar; die Karte zeigt eine vorläufige Anordnung."));
  });

  it("keeps the provisional positions in useStableLayout, with the error", async () => {
    const { result, results } = recorded(chain, unavailable);
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBeInstanceOf(LayoutUnavailableError);
    expect(result.current.provisional).toBe(true);
    expect(result.current.positions).toBe(results[0].positions);
  });
});

describe("useStableLayout", () => {
  /** Answers `register` at once and never a layout; records termination. */
  class SlowWorker {
    static created: SlowWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    terminated = false;
    layouts = 0;
    constructor() {
      SlowWorker.created.push(this);
    }
    postMessage(message: { id: number; cmd: string }) {
      if (message.cmd === "register") queueMicrotask(() => this.onmessage?.({ data: { id: message.id, data: true } }));
      if (message.cmd === "layout") this.layouts++;
    }
    terminate() {
      this.terminated = true;
    }
  }

  it("terminates the worker of a layout it no longer shows and of the last one when it unmounts", async () => {
    vi.stubGlobal("Worker", SlowWorker);
    const { rerender, unmount } = recorded(chain, { engine: "elk", elkWorkerUrl: "https://example.test/elk-worker.min.js" });
    await waitFor(() => expect(SlowWorker.created[0]?.layouts).toBe(1));
    rerender({ g: changed });
    await waitFor(() => expect(SlowWorker.created[0].terminated).toBe(true));
    await waitFor(() => expect(SlowWorker.created[1]?.layouts).toBe(1));
    expect(SlowWorker.created[1].terminated).toBe(false);
    unmount();
    await waitFor(() => expect(SlowWorker.created[1].terminated).toBe(true));
  });

  it("never shows the result of an earlier request", async () => {
    const calls: { graph: ElkNode; resolve: (result: ElkNode) => void }[] = [];
    const elk = { layout: (graph: ElkNode) => new Promise<ElkNode>((resolve) => calls.push({ graph, resolve })) } as unknown as ELK;
    const answer = (k: number) => calls[k].resolve({ ...calls[k].graph, children: calls[k].graph.children!.map((child, i) => ({ ...child, x: 500, y: 1000 + 100 * i })) });
    const { result, results, rerender } = recorded(chain, { elk, engine: "elk" });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ g: changed });
    await waitFor(() => expect(calls).toHaveLength(2));
    // The first layout finishes after the second was asked for: it is not shown.
    await act(async () => answer(0));
    expect(result.current).toMatchObject({ status: "pending", provisional: true });
    await act(async () => answer(1));
    expect(result.current).toMatchObject({ status: "ready", provisional: false });
    expect(Object.keys(result.current.positions!.nodes).sort()).toEqual(["a", "b", "d"]);
    expect(results.filter((r) => r.positions?.engine === "elk").every((r) => !r.positions!.nodes.c)).toBe(true);
  });
});
