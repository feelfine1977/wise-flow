import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/overlays.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/overlays.js")>();
  return { ...original, canonicalOverlays: vi.fn(original.canonicalOverlays) };
});

vi.mock("../../src/core/overlay-geometry.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/overlay-geometry.js")>();
  return { ...original, placeOverlays: vi.fn(original.placeOverlays) };
});

const { canonicalOverlays } = await import("../../src/core/overlays.js");
const { placeOverlays } = await import("../../src/core/overlay-geometry.js");
const { buildScene, toSVG } = await import("../../src/index");

const graph = {
  nodes: [
    { id: "a", kind: "activity" as const, label: "A" },
    { id: "b", kind: "activity" as const, label: "B" },
  ],
  edges: [{ id: "aa", kind: "follows" as const, source: "a", target: "a", metrics: { count: 2 } }],
  overlays: [
    { kind: "badge" as const, target: "b", payload: { constraintId: "x" } },
    { kind: "arc" as const, target: "a->b", payload: { source: "a", target: "b" } },
  ],
};
const positions = {
  nodes: { a: { x: 0, y: 0, width: 100, height: 40 }, b: { x: 200, y: 0, width: 100, height: 40 } },
  groups: {},
  edges: {},
  bounds: { x: 0, y: 0, width: 300, height: 40 },
  engine: "dagre" as const,
  direction: "RIGHT" as const,
};

describe("canonical overlay order", () => {
  it("is computed once per scene, also when toSVG reads it", () => {
    const sort = vi.mocked(canonicalOverlays);
    sort.mockClear();
    const scene = buildScene(graph, positions);
    expect(sort).toHaveBeenCalledTimes(1);
    // The geometry places the sorted list itself rather than sorting a copy again.
    expect(vi.mocked(placeOverlays).mock.lastCall?.[0]).toBe(scene.overlays);
    expect(scene.geometry.shapes.map((s) => s.overlay)).toEqual(scene.overlays);
    sort.mockClear();
    toSVG({ graph, positions });
    expect(sort).toHaveBeenCalledTimes(1);
  });
});
