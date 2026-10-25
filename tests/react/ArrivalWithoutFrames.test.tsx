/**
 * The map's layout status stuck at "pending" ("Arranging the map…") after the
 * map was complete, on a Windows runner and once under load (Workbench host
 * report): the layout that replaces a provisional arrangement moves there in
 * 300 ms of animation frames, and a browser that gives no frames (a window in
 * the background or occluded, a busy machine) left the arrival "moving" for
 * good. The arrival ends by the clock too.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPositions } from "../../src/index";
import { useArrival } from "../../src/react/hooks";

const at = (x: number) => createPositions({ nodes: { a: { x, y: 0, width: 100, height: 40 } }, groups: {}, edges: {} }, "elk", "RIGHT");
const provisional = { ...at(0), engine: "provisional" as const };

let raf: typeof requestAnimationFrame;
beforeEach(() => {
  vi.useFakeTimers();
  raf = globalThis.requestAnimationFrame;
  // A browser that gives no animation frame.
  globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame;
});
afterEach(() => {
  globalThis.requestAnimationFrame = raf;
  vi.useRealTimers();
});

describe("a layout replacing a provisional arrangement, without animation frames", () => {
  it("arrives by the clock", () => {
    const { result, rerender } = renderHook(({ p, prov }) => useArrival(p, prov, false), { initialProps: { p: provisional as ReturnType<typeof at>, prov: true } });
    rerender({ p: at(200), prov: false });
    expect(result.current.moving).toBe(true);
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.moving).toBe(false);
    expect(result.current.positions?.nodes.a.x).toBe(200);
  });

  it("stays arrived when a late first frame comes after the clock finished it", () => {
    // Frames held, then given out late with their own timestamp: the first one used to set the start and progress 0.
    const held: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => (held.push(cb), held.length)) as typeof requestAnimationFrame;
    const { result, rerender } = renderHook(({ p, prov }) => useArrival(p, prov, false), { initialProps: { p: provisional as ReturnType<typeof at>, prov: true } });
    rerender({ p: at(200), prov: false });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.moving).toBe(false);
    act(() => held.splice(0).forEach((cb) => cb(5000)));
    expect(result.current.moving).toBe(false);
    expect(result.current.positions?.nodes.a.x).toBe(200);
    act(() => held.splice(0).forEach((cb) => cb(5016)));
    expect(result.current.moving).toBe(false);
  });

  it("still animates where frames come in time, and moves at once with reduced motion", () => {
    let now = 0;
    const held: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => (held.push(cb), held.length)) as typeof requestAnimationFrame;
    const frame = (ms: number) => act(() => { now += ms; held.splice(0).forEach((cb) => cb(now)); });
    const { result, rerender } = renderHook(({ p, prov, still }) => useArrival(p, prov, still), { initialProps: { p: provisional as ReturnType<typeof at>, prov: true, still: false } });
    rerender({ p: at(200), prov: false, still: false });
    frame(0);
    frame(150);
    expect(result.current.moving).toBe(true);
    const mid = result.current.positions!.nodes.a.x;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(200);
    frame(200);
    expect(result.current.moving).toBe(false);
    expect(result.current.positions?.nodes.a.x).toBe(200);
    // Reduced motion: no animation at all.
    const still = renderHook(({ p, prov }) => useArrival(p, prov, true), { initialProps: { p: provisional as ReturnType<typeof at>, prov: true } });
    still.rerender({ p: at(300), prov: false });
    expect(still.result.current.moving).toBe(false);
    expect(still.result.current.positions?.nodes.a.x).toBe(300);
  });
});
