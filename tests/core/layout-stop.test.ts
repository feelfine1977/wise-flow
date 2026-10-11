import type { ELK, ElkNode } from "elkjs/lib/elk-api.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as dagre from "@dagrejs/dagre";
import { abstract, createLayoutScope, type FlowGraph, layout, LayoutUnavailableError, type LayoutOptions } from "../../src/index";
import { type DagreInput, dagreJob, knownLayout } from "../../src/core/layout";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";

// The Dagre the calling thread runs, watched; a fake worker runs the module's own copy.
vi.mock("@dagrejs/dagre", async (actual) => {
  const real = await actual<typeof import("@dagrejs/dagre")>();
  return { ...real, layout: vi.fn(real.layout) };
});
const real = await vi.importActual<typeof import("@dagrejs/dagre")>("@dagrejs/dagre");
const onCallingThread = vi.mocked(dagre.layout);

/** Places the children of the root side by side, 100 px apart, in the order given (sorted by id). */
function place(graph: ElkNode): ElkNode {
  return { ...graph, children: (graph.children ?? []).map((child, i) => ({ ...child, x: 100 * i, y: 0 })) };
}

/**
 * A worker at `url` speaks ELK's protocol: `register` is answered at once, a
 * layout when the test calls `answer` (or never). While a layout runs the fake
 * engine records a step every millisecond until it is terminated. A worker at
 * `dagreUrl` answers each Dagre input with the module's Dagre job, unless
 * `holdDagre` is set.
 */
class FakeWorker {
  static created: FakeWorker[] = [];
  static holdDagre = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminated = false;
  steps = 0;
  dagreRuns = 0;
  layouts: { id: number; graph: ElkNode }[] = [];
  dagreInputs: DagreInput[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(readonly url: string) {
    FakeWorker.created.push(this);
  }
  private send(data: unknown) {
    queueMicrotask(() => this.onmessage?.({ data }));
  }
  postMessage(message: { id: number; cmd: string; graph?: ElkNode } & DagreInput) {
    if (this.url === dagreUrl) {
      this.dagreRuns++;
      this.dagreInputs.push(message);
      this.timer ??= setInterval(() => this.steps++, 1);
      if (!FakeWorker.holdDagre) this.send({ output: dagreJob(real, message) });
      return;
    }
    if (message.cmd === "register") this.send({ id: message.id, data: true });
    if (message.cmd === "layout") {
      this.layouts.push({ id: message.id, graph: message.graph! });
      this.timer ??= setInterval(() => this.steps++, 1);
    }
  }
  /** Answers the last layout, also after termination (a real worker could not). */
  answer(k = this.layouts.length - 1) {
    clearInterval(this.timer);
    this.timer = undefined;
    this.send({ id: this.layouts[k].id, data: place(this.layouts[k].graph) });
  }
  /** Answers a held Dagre input, the last one unless told otherwise. */
  answerDagre(k = this.dagreInputs.length - 1) {
    this.send({ output: dagreJob(real, this.dagreInputs[k]) });
  }
  /** Answers the last layout with an engine error. */
  fail(k = this.layouts.length - 1) {
    this.send({ id: this.layouts[k].id, error: { message: "engine down" } });
  }
  terminate() {
    this.terminated = true;
    clearInterval(this.timer);
  }
}

const activity = (id: string) => ({ id, kind: "activity" as const, label: id.toUpperCase() });
const follows = (source: string, target: string) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target });
const pair: FlowGraph = { nodes: [activity("a"), activity("b")], edges: [follows("a", "b")] };
const trio: FlowGraph = { nodes: [activity("a"), activity("b"), activity("c")], edges: [follows("a", "b"), follows("b", "c")] };

const url = "https://example.test/elk-worker.min.js";
const dagreUrl = "https://example.test/dagre-worker.min.js";
const viaWorker: LayoutOptions = { engine: "elk", elkWorkerUrl: url };
const failing = { layout: () => Promise.reject(new Error("engine down")) } as unknown as ELK;

/** The worker that received a layout, once it has. */
async function running(k = 0) {
  await vi.waitFor(() => expect(FakeWorker.created[k]?.layouts.length).toBeGreaterThan(0));
  return FakeWorker.created[k];
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
  FakeWorker.created = [];
  FakeWorker.holdDagre = false;
  onCallingThread.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stopping a layout", () => {
  it("terminates the worker when the caller aborts, ignores its late answer and starts a new worker next", async () => {
    const scope = createLayoutScope();
    const stop = new AbortController();
    const pending = scope.layout(pair, { ...viaWorker, signal: stop.signal });
    const first = await running();
    stop.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(first.terminated).toBe(true));

    // Its answer arrives anyway: nothing is kept.
    first.answer();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(knownLayout(scope, pair, viaWorker)).toBeUndefined();
    expect(scope.size).toBe(0);

    const next = scope.layout(pair, viaWorker);
    const second = await running(1);
    expect(second).not.toBe(first);
    second.answer();
    expect((await next).nodes.b.x).toBe(100);
    scope.dispose();
  });

  it("terminates the worker of a layout outside a scope when the caller aborts", async () => {
    const stop = new AbortController();
    const pending = layout(pair, { ...viaWorker, signal: stop.signal });
    const worker = await running();
    stop.abort(new Error("gone"));
    await expect(pending).rejects.toThrow("gone");
    await vi.waitFor(() => expect(worker.terminated).toBe(true));
    // Aborted before it starts: no worker at all.
    const before = new AbortController();
    before.abort();
    await expect(layout(trio, { ...viaWorker, signal: before.signal })).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(FakeWorker.created).toHaveLength(1);
  });

  it("terminates the worker on timeout; no layout work continues", async () => {
    const pending = layout(pair, { ...viaWorker, timeoutMs: 30 }).catch((error: Error) => error);
    const worker = await running();
    expect(await pending).toEqual(new Error("layout timed out after 30 ms"));
    expect(worker.terminated).toBe(true);
    const steps = worker.steps;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(worker.steps).toBe(steps);
    // A timeout does not try ELK again without stage partitions.
    expect(FakeWorker.created).toHaveLength(1);
    expect(worker.layouts).toHaveLength(1);
  });

  it("ignores the late answer of a worker a timeout terminated in a scope and starts a new worker next", async () => {
    const scope = createLayoutScope();
    const quick = { ...viaWorker, timeoutMs: 30 };
    const pending = scope.layout(pair, quick).catch((error: Error) => error);
    const first = await running();
    expect(await pending).toEqual(new Error("layout timed out after 30 ms"));
    expect(first.terminated).toBe(true);

    first.answer();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(knownLayout(scope, pair, quick)).toBeUndefined();
    expect(scope.size).toBe(0);

    const next = scope.layout(pair, viaWorker);
    const second = await running(1);
    expect(second).not.toBe(first);
    second.answer();
    expect((await next).nodes.b.x).toBe(100);
    scope.dispose();
  });

  it("terminates the worker of a request a newer one in the same scope replaces", async () => {
    const scope = createLayoutScope();
    const older = scope.layout(pair, viaWorker);
    const first = await running();
    const newer = scope.layout(trio, viaWorker);
    await expect(older).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(first.terminated).toBe(true));
    const second = await running(1);
    first.answer();
    second.answer();
    expect(Object.keys((await newer).nodes)).toEqual(["a", "b", "c"]);
    expect(knownLayout(scope, pair, viaWorker)).toBeUndefined();
    scope.dispose();
  });

  it("keeps running while another caller still waits for the same layout", async () => {
    const scope = createLayoutScope();
    const stop = new AbortController();
    const mine = scope.layout(pair, { ...viaWorker, signal: stop.signal });
    const theirs = scope.layout(pair, viaWorker);
    const worker = await running();
    stop.abort();
    await expect(mine).rejects.toMatchObject({ name: "AbortError" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(worker.terminated).toBe(false);
    worker.answer();
    expect((await theirs).nodes.b.x).toBe(100);
    scope.dispose();
  });

  it("keeps a layout that is asked for again in the same turn, as a remounted component does", async () => {
    const scope = createLayoutScope();
    const stop = new AbortController();
    const first = scope.layout(pair, { ...viaWorker, signal: stop.signal });
    stop.abort();
    const again = scope.layout(pair, viaWorker);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const worker = await running();
    worker.answer();
    expect((await again).nodes.b.x).toBe(100);
    expect(FakeWorker.created).toHaveLength(1);
    scope.dispose();
  });

  it("keeps a layout whose answer is being read as its last waiter leaves, instead of laying it out again", async () => {
    // The answer's reading and the leaving are a few microtasks apart; every distance must give one answer.
    const options: LayoutOptions = { engine: "dagre", dagreWorkerUrl: dagreUrl };
    for (let distance = 0; distance <= 8; distance++) {
      FakeWorker.created = [];
      FakeWorker.holdDagre = true;
      const scope = createLayoutScope();
      try {
        const stop = new AbortController();
        const first = scope.layout(pair, { ...options, signal: stop.signal }).then(() => "answered", () => "aborted");
        await vi.waitFor(() => expect(FakeWorker.created[0]?.dagreRuns).toBe(1));
        FakeWorker.created[0].answerDagre();
        for (let i = 0; i < distance; i++) await Promise.resolve();
        stop.abort();
        await new Promise((resolve) => setTimeout(resolve, 5));
        // What the scope knows and what it does for the next request must agree, and the worker is not asked twice.
        const outcome = await first;
        const known = knownLayout(scope, pair, options);
        FakeWorker.holdDagre = false;
        const again = await scope.layout(pair, options);
        const runs = FakeWorker.created.reduce((n, w) => n + w.dagreRuns, 0);
        const where = `the caller left ${distance} microtasks after the answer and was ${outcome}`;
        // The answer reaches the module a microtask after it is sent: leaving before that stops the layout, which is
        // not kept; a caller that received the layout leaves it finished, and a finished layout is kept.
        if (distance === 0) expect(known, where).toBeUndefined();
        if (outcome === "answered") expect(known, where).toBeDefined();
        if (known) {
          expect(again, where).toBe(known);
          expect(runs, where).toBe(1);
        } else expect(runs, where).toBe(2);
      } finally {
        // Disposed even when an assertion fails, so that the scope's idle worker does not reach the next test.
        scope.dispose();
      }
    }
  });

  it("does not stop a finished layout when a newer request replaces it", async () => {
    const scope = createLayoutScope();
    const first = scope.layout(pair, viaWorker);
    (await running()).answer();
    const done = await first;
    const second = scope.layout(trio, viaWorker);
    // The scope kept the worker; it runs the second layout too.
    const worker = await running();
    await vi.waitFor(() => expect(worker.layouts).toHaveLength(2));
    worker.answer();
    await second;
    await expect(scope.layout(pair, viaWorker)).resolves.toBe(done);
    expect(knownLayout(scope, pair, viaWorker)).toBe(done);
    scope.dispose();
  });

  it("answers a request for a finished layout even when a newer request follows in the same turn", async () => {
    const scope = createLayoutScope();
    const first = scope.layout(pair, viaWorker);
    (await running()).answer();
    const done = await first;
    // The pair's layout is known: asked for again and replaced at once, it has nothing left to stop.
    const again = scope.layout(pair, viaWorker);
    const next = scope.layout(trio, viaWorker);
    await expect(again).resolves.toBe(done);
    const worker = await running();
    await vi.waitFor(() => expect(worker.layouts).toHaveLength(2));
    worker.answer();
    expect((await next).nodes.c.x).toBe(200);
    scope.dispose();
  });

  it("waits as long as a timer can for a timeout beyond a timer's reach, as for Infinity", async () => {
    // Timers fire at once for a delay above 2³¹ − 1 ms; such a timeout must not end the layout before the engine answers.
    for (const timeoutMs of [Infinity, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      let answer: (() => void) | undefined;
      const elk = { layout: (graph: ElkNode) => new Promise<ElkNode>((resolve) => (answer = () => resolve({ ...graph, children: graph.children?.map((c) => ({ ...c, x: 0, y: 0 })) }))) } as unknown as ELK;
      let settled = "";
      const pending = layout(pair, { elk, engine: "elk", timeoutMs }).then(() => (settled = "resolved"), (e: Error) => (settled = e.message));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled, String(timeoutMs)).toBe("");
      answer!();
      await pending;
      expect(settled, String(timeoutMs)).toBe("resolved");
    }
  });

  it("rejects at once for an ELK instance the caller supplies, which cannot be interrupted", async () => {
    const terminateWorker = vi.fn();
    const elk = { layout: () => new Promise<ElkNode>(() => undefined), terminateWorker } as unknown as ELK;
    const stop = new AbortController();
    const pending = layout(pair, { elk, engine: "elk", signal: stop.signal });
    stop.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(layout(pair, { elk, engine: "elk", timeoutMs: 5 })).rejects.toThrow("timed out");
    expect(terminateWorker).not.toHaveBeenCalled();
  });
});

describe("the Dagre fallback", () => {
  const chain = (n: number): FlowGraph => ({
    nodes: Array.from({ length: n }, (_, i) => activity(`n${i}`)),
    edges: Array.from({ length: n - 1 }, (_, i) => follows(`n${i}`, `n${i + 1}`)),
  });

  it("runs on the calling thread up to 500 nodes plus edges", async () => {
    // 250 nodes and 249 edges, then 251 nodes and 250 edges.
    expect((await layout(chain(250), { elk: failing })).engine).toBe("dagre");
    expect(onCallingThread).toHaveBeenCalledTimes(1);
    const unavailable = layout(chain(251), { elk: failing });
    await expect(unavailable).rejects.toBeInstanceOf(LayoutUnavailableError);
    await expect(unavailable).rejects.toThrow("251 nodes and 250 edges exceed the limit of 500");
    expect(onCallingThread).toHaveBeenCalledTimes(1);
  });

  it("is not run on the calling thread above the given limit, also after ELK ran in a worker", async () => {
    await expect(layout(pair, { elk: failing, fallbackLimit: 2 })).rejects.toBeInstanceOf(LayoutUnavailableError);
    const pending = layout(pair, { elkWorkerUrl: url, fallbackLimit: 2, timeoutMs: 30 }).catch((error: Error) => error);
    await running();
    expect(await pending).toBeInstanceOf(LayoutUnavailableError);
    expect(onCallingThread).not.toHaveBeenCalled();
    // A Dagre layout asked for by name runs whatever its size.
    expect((await layout(pair, { engine: "dagre", fallbackLimit: 0 })).engine).toBe("dagre");
  });

  it("runs in the Dagre worker after ELK failed or timed out, whatever the limit", async () => {
    const workers = { elkWorkerUrl: url, dagreWorkerUrl: dagreUrl, fallbackLimit: 0 };
    const failed = layout(pair, workers);
    (await running()).fail();
    expect((await failed).engine).toBe("dagre");

    const timedOut = layout(pair, { ...workers, timeoutMs: 30 });
    const slow = await running(2);
    expect((await timedOut).engine).toBe("dagre");
    expect(slow.terminated).toBe(true);
    expect(FakeWorker.created.map((w) => [w.url === dagreUrl ? "dagre" : "elk", w.dagreRuns, w.terminated])).toEqual([
      ["elk", 0, true], ["dagre", 1, true], ["elk", 0, true], ["dagre", 1, true],
    ]);
    expect(onCallingThread).not.toHaveBeenCalled();
  });

  it("runs in the Dagre worker after an ELK instance the caller supplies failed", async () => {
    expect((await layout(pair, { elk: failing, dagreWorkerUrl: dagreUrl, fallbackLimit: 0 })).engine).toBe("dagre");
    expect(FakeWorker.created.map((w) => [w.url, w.dagreRuns, w.terminated])).toEqual([[dagreUrl, 1, true]]);
    expect(onCallingThread).not.toHaveBeenCalled();
  });

  it("stops the Dagre worker on abort and on timeout", async () => {
    FakeWorker.holdDagre = true;
    const stop = new AbortController();
    const aborted = layout(pair, { engine: "dagre", dagreWorkerUrl: dagreUrl, signal: stop.signal });
    await vi.waitFor(() => expect(FakeWorker.created[0]?.dagreRuns).toBe(1));
    stop.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(FakeWorker.created[0].terminated).toBe(true));

    const timedOut = layout(pair, { engine: "dagre", dagreWorkerUrl: dagreUrl, timeoutMs: 30 }).catch((error: Error) => error);
    await vi.waitFor(() => expect(FakeWorker.created[1]?.dagreRuns).toBe(1));
    expect(await timedOut).toEqual(new Error("layout timed out after 30 ms"));
    const worker = FakeWorker.created[1];
    expect(worker.terminated).toBe(true);
    const steps = worker.steps;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(worker.steps).toBe(steps);
  });

  it("keeps the Dagre worker of a scope for its next layout", async () => {
    const scope = createLayoutScope();
    await scope.layout(pair, { engine: "dagre", dagreWorkerUrl: dagreUrl });
    await scope.layout(trio, { engine: "dagre", dagreWorkerUrl: dagreUrl });
    expect(FakeWorker.created.map((w) => [w.dagreRuns, w.terminated])).toEqual([[2, false]]);
    scope.dispose();
    expect(FakeWorker.created[0].terminated).toBe(true);
  });

  it("gives the same positions in a worker as on the calling thread", async () => {
    for (const graph of [abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 }), vendorScene, { ...vendorScene, groups: [] }]) {
      const here = await layout(graph, { engine: "dagre" });
      expect(here.engine).toBe("dagre");
      expect(await layout(graph, { engine: "dagre", dagreWorkerUrl: dagreUrl })).toEqual(here);
      for (const direction of ["DOWN", "LEFT", "UP"] as const) {
        expect(await layout(graph, { engine: "dagre", dagreWorkerUrl: dagreUrl, direction, spacing: { node: 10, layer: 30 } })).toEqual(
          await layout(graph, { engine: "dagre", direction, spacing: { node: 10, layer: 30 } }),
        );
      }
    }
    expect(FakeWorker.created.reduce((sum, w) => sum + w.dagreRuns, 0)).toBe(12);
  });

  it("reports an error of Dagre in the worker", async () => {
    vi.spyOn(FakeWorker.prototype, "postMessage").mockImplementation(function (this: FakeWorker) {
      queueMicrotask(() => this.onmessage?.({ data: { error: "no such node" } }));
    });
    await expect(layout(pair, { engine: "dagre", dagreWorkerUrl: dagreUrl })).rejects.toThrow("no such node");
  });
});
