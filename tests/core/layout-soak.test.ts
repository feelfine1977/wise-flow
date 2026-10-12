/**
 * A soak of the layout module: thousands of cycles of a scope that lays out
 * two graphs in fake workers and is disposed, with the retained heap measured
 * before and after. It runs only where the runtime exposes garbage collection
 * (`NODE_OPTIONS=--expose-gc`); elsewhere it is skipped and says so.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type LayoutOptions, createLayoutScope } from "../../src/index";
import { families } from "../support/graphs";
import { FakeLayoutWorker } from "../support/workers";

const CYCLES = 5000;
const WARM_UP = 500;
/** Bytes the heap may still hold after the measured cycles: the noise of a collected heap plus a little under 200 bytes per cycle. */
const TOLERANCE = 1_000_000;

const gc = (globalThis as { gc?: () => void }).gc;

function heapUsed(): number {
  for (let i = 0; i < 4; i++) gc!();
  return process.memoryUsage().heapUsed;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0);
}

function answerAll(reply: number): void {
  for (const w of FakeLayoutWorker.created) for (const k of w.pending) w.answer(k, reply);
}

beforeAll(async () => {
  await import("elkjs/lib/elk-api.js");
});

beforeEach(() => {
  vi.stubGlobal("Worker", FakeLayoutWorker);
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeLayoutWorker.created = [];
});

describe("soak: layout scopes", () => {
  it(`retain no memory over ${CYCLES} cycles of two layouts and a dispose`, async (ctx) => {
    if (typeof gc !== "function") ctx.skip("garbage collection is not exposed; run with NODE_OPTIONS=--expose-gc");
    const graphs: FlowGraph[] = [families.layered(8, 1), families.stages(10, 1)];
    const elk: LayoutOptions = { elkWorkerUrl: FakeLayoutWorker.elkUrl, dagreWorkerUrl: FakeLayoutWorker.dagreUrl };
    const dagre: LayoutOptions = { ...elk, engine: "dagre" };
    const cycle = async (i: number) => {
      FakeLayoutWorker.created = [];
      const scope = createLayoutScope();
      const stop = new AbortController();
      // One layout finishes, one is abandoned while it runs, one runs in the Dagre worker.
      const first = scope.layout(graphs[i % 2], elk);
      await settle();
      answerAll(1);
      await settle();
      expect((await first).engine).toBe("elk");
      const abandoned = scope.layout(graphs[(i + 1) % 2], { ...elk, signal: stop.signal }).catch((error: Error) => error.name);
      await settle();
      stop.abort();
      expect(await abandoned).toBe("AbortError");
      const third = scope.layout(graphs[(i + 1) % 2], dagre);
      await settle();
      answerAll(2);
      await settle();
      expect((await third).engine).toBe("dagre");
      scope.dispose();
      await settle();
      expect(FakeLayoutWorker.created.filter((w) => !w.terminated)).toEqual([]);
    };
    for (let i = 0; i < WARM_UP; i++) await cycle(i);
    const before = heapUsed();
    const samples: string[] = [];
    for (let i = WARM_UP; i < CYCLES; i++) {
      await cycle(i);
      if ((i + 1) % 1000 === 0) samples.push(`${i + 1}: ${((heapUsed() - before) / 1024).toFixed(0)} KB`);
    }
    const after = heapUsed();
    console.log(`scope soak: heap after ${WARM_UP} warm-up cycles ${(before / 1024).toFixed(0)} KB, after ${CYCLES} cycles ${(after / 1024).toFixed(0)} KB (${((after - before) / 1024).toFixed(0)} KB retained); ${samples.join(", ")}`);
    expect(after - before, `retained ${after - before} bytes over ${CYCLES - WARM_UP} measured cycles`).toBeLessThan(TOLERANCE);
  }, 600000);
});
