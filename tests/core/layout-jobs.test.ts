/**
 * How many layouts run at once. A scope's bound counts the finished layouts it
 * keeps, not the layouts running: a scope runs the layout of its latest
 * request, a newer request stops waiting for the one before, and disposing a
 * scope stops waiting for its latest one, so that its worker ends without the
 * caller aborting its own request.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type LayoutOptions, type LayoutScope, type Positions, createLayoutScope } from "../../src/index";
import { families } from "../support/graphs";
import { FakeLayoutWorker } from "../support/workers";

const workers: LayoutOptions = { elkWorkerUrl: FakeLayoutWorker.elkUrl, dagreWorkerUrl: FakeLayoutWorker.dagreUrl };

/** Lets the workers' messages and the module's microtasks run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
}

/** Workers not terminated: running a layout nobody answered yet, or idle. */
function alive() {
  const live = FakeLayoutWorker.created.filter((w) => !w.terminated);
  return { running: live.filter((w) => w.pending.length > 0).length, idle: live.filter((w) => w.pending.length === 0).length };
}

/** A request whose outcome can be read without awaiting it. */
function track(promise: Promise<Positions>) {
  const out: { state: "pending" | "resolved" | "rejected"; error?: unknown } = { state: "pending" };
  promise.then(
    () => (out.state = "resolved"),
    (error: unknown) => Object.assign(out, { state: "rejected", error }),
  );
  return out;
}

const graphOf = (map: number, change: number): FlowGraph => families.chain(3 + change, map + 1);

beforeAll(async () => {
  // Loaded once here, so that the layout module's import of it resolves in microtasks under fake timers.
  await import("elkjs/lib/elk-api.js");
});

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  vi.stubGlobal("Worker", FakeLayoutWorker);
  FakeLayoutWorker.created = [];
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("layouts running at once", () => {
  it("runs one layout per scope however fast its requests change, whatever its bound", async () => {
    const scopes: LayoutScope[] = Array.from({ length: 12 }, (_, i) => createLayoutScope({ maxEntries: i % 2 ? 1 : 8 }));
    const requests = scopes.map((scope, map) => Array.from({ length: 5 }, (_, change) => track(scope.layout(graphOf(map, change), workers))));
    await settle();
    // Twelve scopes, five requests each in one task: the last of each is laid out, the other four were replaced.
    // A replaced layout's worker may stay as the one idle worker of its URL.
    expect(alive().running).toBe(12);
    expect(alive().idle).toBeLessThanOrEqual(1);
    for (const list of requests) {
      expect(list.slice(0, 4).map((r) => [r.state, (r.error as Error | undefined)?.name])).toEqual(Array(4).fill(["rejected", "AbortError"]));
      expect(list[4].state).toBe("pending");
    }
    for (const scope of scopes) scope.dispose();
  });

  it("stops waiting for a scope's latest request when the scope is disposed, so its worker ends", async () => {
    const scopes = Array.from({ length: 12 }, () => createLayoutScope());
    const requests = scopes.map((scope, map) => track(scope.layout(graphOf(map, 0), workers)));
    await settle();
    expect(alive()).toEqual({ running: 12, idle: 0 });
    // Nobody aborts a request: disposing the scopes alone ends the wait and the workers.
    for (const scope of scopes) scope.dispose();
    await settle();
    expect(requests.map((r) => [r.state, (r.error as Error | undefined)?.name])).toEqual(Array(12).fill(["rejected", "AbortError"]));
    expect(alive()).toEqual({ running: 0, idle: 0 });
  });

  it("lets another caller of a shared layout keep it when one scope is disposed, and stays usable", async () => {
    const [mine, theirs] = [createLayoutScope(), createLayoutScope()];
    const shared: LayoutOptions = { ...workers, cacheKey: "shared map" };
    const graph = graphOf(0, 0);
    const first = track(mine.layout(graph, shared));
    const second = track(theirs.layout(graph, shared));
    await settle();
    expect(alive()).toEqual({ running: 1, idle: 0 });
    mine.dispose();
    await settle();
    expect([first.state, second.state, alive().running]).toEqual(["rejected", "pending", 1]);
    const [worker] = FakeLayoutWorker.created;
    worker.answer(worker.pending[0], 1);
    await settle();
    expect(second.state).toBe("resolved");
    // The disposed scope starts empty and lays out a later request.
    const later = track(mine.layout(graphOf(0, 1), workers));
    await settle();
    const w = FakeLayoutWorker.created.find((x) => !x.terminated && x.pending.length)!;
    w.answer(w.pending[0], 2);
    await settle();
    expect(later.state).toBe("resolved");
    mine.dispose();
    theirs.dispose();
  });
});
