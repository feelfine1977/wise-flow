import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type LayoutOptions, clearLayoutCache, createLayoutScope, layout } from "../../src/index";

/** Places the children of the root side by side, 100 px apart, in the order given (sorted by id). */
function place(graph: ElkNode): ElkNode {
  return { ...graph, children: (graph.children ?? []).map((child, i) => ({ ...child, x: 100 * i, y: 0 })) };
}

/** An ELK instance that counts its layouts. */
function countingElk() {
  const elk = { layout: vi.fn(async (graph: ElkNode) => place(graph)) };
  return { elk: elk as unknown as ELK, calls: () => elk.layout.mock.calls.length };
}

const pair: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A" },
    { id: "b", kind: "activity", label: "B" },
  ],
  edges: [{ id: "a->b", kind: "follows", source: "a", target: "b" }],
};

describe("layout scope", () => {
  it("reuses a layout for the same graph structure and options without a caller key", async () => {
    const { elk, calls } = countingElk();
    const scope = createLayoutScope();
    const first = await scope.layout(pair, { elk, engine: "elk" });
    expect(first.nodes.b).toEqual({ x: 100, y: 0, width: 180, height: 48 });
    // A new graph object and a new size callback with the same dimensions.
    const copy = structuredClone(pair);
    expect(await scope.layout(copy, { elk, engine: "elk", nodeSize: () => ({ width: 180, height: 48 }) })).toBe(first);
    expect(calls()).toBe(1);
    expect(scope.size).toBe(1);
  });

  it("never returns the layout of a changed graph or of changed options", async () => {
    const { elk, calls } = countingElk();
    const scope = createLayoutScope();
    const width = (node: FlowGraph["nodes"][number]) => ({ width: (node.metrics?.width as number | undefined) ?? 120, height: 40 });
    const options: LayoutOptions = { elk, engine: "elk", nodeSize: width };
    expect((await scope.layout(pair, options)).nodes.a.width).toBe(120);

    // Same ids, the stable callback now resolves another width.
    const wider = { ...pair, nodes: pair.nodes.map((n) => ({ ...n, metrics: { width: 300 } })) };
    expect((await scope.layout(wider, options)).nodes.a.width).toBe(300);
    // Same ids, another node joins: a, b, c side by side.
    const three = { ...pair, nodes: [...pair.nodes, { id: "c", kind: "activity" as const, label: "C" }] };
    expect((await scope.layout(three, options)).nodes.c.x).toBe(200);
    // Same ids, the edge reversed.
    const reversed = { ...pair, edges: [{ ...pair.edges[0], source: "b", target: "a" }] };
    await scope.layout(reversed, options);
    expect(calls()).toBe(4);
    expect((elk.layout as ReturnType<typeof vi.fn>).mock.calls[3][0].edges).toEqual([{ id: "a->b", sources: ["b"], targets: ["a"] }]);
    // An option that moves nodes.
    await scope.layout(pair, { ...options, spacing: { layer: 150 } });
    expect(calls()).toBe(5);
    // Another engine instance.
    const other = countingElk();
    await scope.layout(pair, { ...options, elk: other.elk });
    expect(other.calls()).toBe(1);
  });

  it("keeps a bounded number of layouts and recomputes the least recently used one", async () => {
    const { elk, calls } = countingElk();
    const scope = createLayoutScope({ maxEntries: 2 });
    const sized = (width: number): LayoutOptions => ({ elk, engine: "elk", nodeSize: { width, height: 40 } });
    await scope.layout(pair, sized(100));
    await scope.layout(pair, sized(200));
    await scope.layout(pair, sized(100)); // used again: 200 is now the oldest
    await scope.layout(pair, sized(300));
    expect(calls()).toBe(3);
    expect(scope.size).toBe(2);
    await scope.layout(pair, sized(100));
    expect(calls()).toBe(3);
    await scope.layout(pair, sized(200));
    expect(calls()).toBe(4);
  });

  it("releases its own layouts on dispose and leaves other scopes alone", async () => {
    const { elk, calls } = countingElk();
    const mine = createLayoutScope();
    const theirs = createLayoutScope();
    await mine.layout(pair, { elk, engine: "elk" });
    const kept = await theirs.layout(pair, { elk, engine: "elk" });
    expect(calls()).toBe(2);

    mine.dispose();
    expect(mine.size).toBe(0);
    expect(await theirs.layout(pair, { elk, engine: "elk" })).toBe(kept);
    // A disposed scope can be used again; it starts empty.
    await mine.layout(pair, { elk, engine: "elk" });
    expect(calls()).toBe(3);
  });

  it("does not keep a failed layout", async () => {
    let fail = true;
    const elk = { layout: vi.fn(async (graph: ElkNode) => { if (fail) throw new Error("engine down"); return place(graph); }) };
    const scope = createLayoutScope();
    await expect(scope.layout(pair, { elk: elk as unknown as ELK, engine: "elk" })).rejects.toThrow("engine down");
    expect(scope.size).toBe(0);
    fail = false;
    expect((await scope.layout(pair, { elk: elk as unknown as ELK, engine: "elk" })).nodes.b.x).toBe(100);
  });

  it("lays out the union of scenes", async () => {
    const { elk } = countingElk();
    const scope = createLayoutScope();
    const c: FlowGraph = { nodes: [{ id: "c", kind: "activity", label: "C" }], edges: [] };
    const union = await scope.layoutUnion([pair, c], { elk, engine: "elk" });
    expect(Object.keys(union.nodes)).toEqual(["a", "b", "c"]);
    expect(union.nodes.c.x).toBe(200);
  });
});

describe("caller cache keys", () => {
  it("keep their meaning inside a scope and stay with the caller after dispose", async () => {
    const { elk, calls } = countingElk();
    const scope = createLayoutScope();
    const cached = await layout(pair, { elk, engine: "elk", cacheKey: "caller-owned" });
    // The same key returns the cached positions, whatever the graph or options.
    expect(await scope.layout({ nodes: [], edges: [] }, { cacheKey: "caller-owned", direction: "DOWN" })).toBe(cached);
    expect(scope.size).toBe(0);
    scope.dispose();
    expect(await layout({ nodes: [], edges: [] }, { cacheKey: "caller-owned" })).toBe(cached);
    expect(calls()).toBe(1);

    clearLayoutCache("caller-owned");
    expect(Object.keys((await layout({ nodes: [], edges: [] }, { cacheKey: "caller-owned" })).nodes)).toEqual([]);
    clearLayoutCache("caller-owned");
  });

  it("are forgotten together with every scope's layouts by a global clear", async () => {
    const { elk, calls } = countingElk();
    const scope = createLayoutScope();
    await scope.layout(pair, { elk, engine: "elk" });
    await layout(pair, { elk, engine: "elk", cacheKey: "cleared" });
    clearLayoutCache();
    expect(scope.size).toBe(0);
    await scope.layout(pair, { elk, engine: "elk" });
    await layout(pair, { elk, engine: "elk", cacheKey: "cleared" });
    expect(calls()).toBe(4);
    clearLayoutCache("cleared");
  });
});

describe("ELK workers", () => {
  /** Answers ELK's worker protocol in-process; records the workers and their termination. */
  class FakeWorker {
    static created: FakeWorker[] = [];
    onmessage: ((answer: { data: unknown }) => void) | null = null;
    terminated = false;
    constructor(readonly url: string) {
      FakeWorker.created.push(this);
    }
    postMessage(message: { id: number; cmd: string; graph?: ElkNode }) {
      const data = message.cmd === "layout" ? place(message.graph!) : true;
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, data } }));
    }
    terminate() {
      this.terminated = true;
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.created = [];
  });

  const viaWorker: LayoutOptions = { engine: "elk", elkWorkerUrl: "https://example.test/elk-worker.min.js" };

  it("terminates the worker of a layout outside a scope once it is done", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const positions = await layout(pair, viaWorker);
    expect(positions.nodes.b.x).toBe(100);
    expect(FakeWorker.created.map((w) => [w.url, w.terminated])).toEqual([["https://example.test/elk-worker.min.js", true]]);
  });

  it("keeps one worker while scopes use it and terminates it when the last one is disposed", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const first = createLayoutScope();
    const second = createLayoutScope();
    await first.layout(pair, viaWorker);
    await second.layout(pair, { ...viaWorker, direction: "DOWN" });
    await first.layout(pair, { ...viaWorker, spacing: { layer: 10 } });
    expect(FakeWorker.created).toHaveLength(1);

    first.dispose();
    expect(FakeWorker.created[0].terminated).toBe(false);
    second.dispose();
    await vi.waitFor(() => expect(FakeWorker.created[0].terminated).toBe(true));

    // The next layout starts a fresh worker.
    await layout(pair, viaWorker);
    expect(FakeWorker.created).toHaveLength(2);
  });

  it("keeps a worker alive for a layout in flight when its scope is disposed", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const scope = createLayoutScope();
    const pending = scope.layout(pair, viaWorker);
    scope.dispose();
    expect((await pending).nodes.b.x).toBe(100);
    await vi.waitFor(() => expect(FakeWorker.created[0].terminated).toBe(true));
  });

  it("does not terminate an ELK instance the caller supplies", async () => {
    const terminateWorker = vi.fn();
    const elk = { layout: async (graph: ElkNode) => place(graph), terminateWorker } as unknown as ELK;
    const scope = createLayoutScope();
    await scope.layout(pair, { elk, engine: "elk" });
    await layout(pair, { elk, engine: "elk" });
    scope.dispose();
    expect(terminateWorker).not.toHaveBeenCalled();
  });
});
