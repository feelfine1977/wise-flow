/**
 * Many maps on one page whose graphs change faster than their layouts arrive:
 * the workers alive are one per map at most (the layout of its latest graph)
 * and the one idle worker per URL that the maps' scopes keep, and none once
 * the maps are gone.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowGraph, LayoutOptions } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import { families } from "../support/graphs";
import { FakeLayoutWorker } from "../support/workers";

const workers: LayoutOptions = { elkWorkerUrl: FakeLayoutWorker.elkUrl, dagreWorkerUrl: FakeLayoutWorker.dagreUrl };
const MAPS = 12;
const CHANGES = 5;

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(0);
  });
}

function alive() {
  const live = FakeLayoutWorker.created.filter((w) => !w.terminated);
  return { running: live.filter((w) => w.pending.length > 0).length, idle: live.filter((w) => w.pending.length === 0).length };
}

const graphOf = (map: number, change: number): FlowGraph => families.layered(4 + change, map + 1);
const map = (graph: FlowGraph) => (
  <div style={{ width: 400, height: 300 }}>
    <ProcessMap graph={graph} layout={workers} controls={false} contextMenu={false} pathList={false} />
  </div>
);

beforeAll(async () => {
  await import("elkjs/lib/elk-api.js");
});

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  vi.stubGlobal("Worker", FakeLayoutWorker);
  FakeLayoutWorker.created = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("many maps whose graphs change quickly", () => {
  it("keep one running worker per map and none after they unmount", async () => {
    const maps = Array.from({ length: MAPS }, (_, i) => render(map(graphOf(i, 0))));
    await settle();
    const seen = [alive()];
    for (let change = 1; change < CHANGES; change++) {
      // Every map changes its graph, half of them twice within one task.
      maps.forEach((m, i) => {
        m.rerender(map(graphOf(i, change)));
        if (i % 2) m.rerender(map(graphOf(i, change + CHANGES)));
      });
      await settle();
      seen.push(alive());
    }
    for (const s of seen) {
      expect(s.running).toBe(MAPS);
      expect(s.idle).toBeLessThanOrEqual(1);
    }
    // Each round laid out every map's latest graph in a worker of its own; the round before was stopped.
    expect(FakeLayoutWorker.created.filter((w) => w.layouts.length > 0)).toHaveLength(MAPS * CHANGES);
    for (const m of maps) m.unmount();
    await settle();
    expect(alive()).toEqual({ running: 0, idle: 0 });
  });
});
