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
});
