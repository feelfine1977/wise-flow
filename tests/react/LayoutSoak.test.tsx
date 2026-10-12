/**
 * A soak of the hook's lifecycle: thousands of mount, change and unmount
 * cycles with fake workers, with the retained heap measured before and after.
 * It runs only where the runtime exposes garbage collection
 * (`NODE_OPTIONS=--expose-gc`), since the measurement needs a collection it
 * can call; elsewhere it is skipped and says so.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowGraph, LayoutOptions } from "../../src/index";
import { useStableLayout } from "../../src/react/index";
import { families } from "../support/graphs";
import { FakeLayoutWorker } from "../support/workers";

/** Cycles measured; the first `WARM_UP` of them fill caches and compiled code and are not counted. */
const CYCLES = 5000;
const WARM_UP = 500;
/**
 * Bytes the heap may still hold after the measured cycles: the noise of a
 * collected heap plus a little under 200 bytes per cycle, well under what one
 * leaked layout, scope or worker per cycle would retain.
 */
const TOLERANCE = 1_500_000;

const gc = (globalThis as { gc?: () => void }).gc;

function heapUsed(): number {
  for (let i = 0; i < 4; i++) gc!();
  return process.memoryUsage().heapUsed;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0);
  });
}

/** Answers every layout the workers hold. */
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
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeLayoutWorker.created = [];
});

describe("soak: the hook's lifecycle", () => {
  it(`retains no memory over ${CYCLES} mount, change and unmount cycles`, async (ctx) => {
    if (typeof gc !== "function") ctx.skip("garbage collection is not exposed; run with NODE_OPTIONS=--expose-gc");
    const graphs: FlowGraph[] = [families.layered(8, 1), families.stages(10, 1)];
    const options: LayoutOptions = { elkWorkerUrl: FakeLayoutWorker.elkUrl, dagreWorkerUrl: FakeLayoutWorker.dagreUrl };
    const cycle = async (i: number) => {
      FakeLayoutWorker.created = [];
      const hook = renderHook(({ graph }: { graph: FlowGraph }) => useStableLayout(graph, options), { initialProps: { graph: graphs[i % 2] } });
      await settle();
      answerAll(1);
      await settle();
      expect(hook.result.current.status).toBe("ready");
      hook.rerender({ graph: graphs[(i + 1) % 2] });
      await settle();
      answerAll(2);
      await settle();
      expect(hook.result.current.status).toBe("ready");
      hook.unmount();
      cleanup();
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
    console.log(`hook soak: heap after ${WARM_UP} warm-up cycles ${(before / 1024).toFixed(0)} KB, after ${CYCLES} cycles ${(after / 1024).toFixed(0)} KB (${((after - before) / 1024).toFixed(0)} KB retained); ${samples.join(", ")}`);
    expect(after - before, `retained ${after - before} bytes over ${CYCLES - WARM_UP} measured cycles`).toBeLessThan(TOLERANCE);
  }, 600000);
});
