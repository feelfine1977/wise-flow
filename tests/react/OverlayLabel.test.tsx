import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OverlayShape } from "../../src/core/index";
/** The map's zoom in React Flow's store, as the layer would read it. */
const map = vi.hoisted(() => ({ zoom: 1 }));
vi.mock("@xyflow/react", () => ({
  ViewportPortal: ({ children }: { children: React.ReactNode }) => children,
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => children,
  useStore: <T,>(select: (s: { transform: [number, number, number] }) => T) => select({ transform: [0, 0, map.zoom] }),
}));
import { OverlayLayer } from "../../src/react/OverlayLayer";
afterEach(cleanup);
it("keeps the explicit constraint meaning on an arc without changing its numeric evidence", () => {
  const shape: OverlayShape = { id: "lag", minZoom: 0, kind: "arc", x: 0, y: 0, width: 100, height: 100, path: "M0 0L100 100", labelX: 50, labelY: 40, overlay: { kind: "arc", target: "invoice", payload: { source: "invoice", target: "clear", glyph: "⇒", value: 0.63, displayLabel: "63% exceed target", text: "Evaluated on 173,183 items" } } };
  const { container } = render(<OverlayLayer shapes={[shape]} locale="en" hoveredId={null} />);
  expect(container.querySelector("text")?.textContent).toBe("63% exceed target");
  expect(container.querySelector("title")?.textContent).toContain("173,183");
  expect(shape.overlay.payload?.value).toBe(0.63);
});
it("draws each mark from its minZoom at the zoom it is given", () => {
  const loop = (id: string, minZoom: number): OverlayShape => ({ id, minZoom, kind: "selfLoop", x: 0, y: 0, width: 20, height: 20, path: "M0 0L20 20", overlay: { kind: "selfLoop", target: id, payload: { value: 0.5 } } });
  const shapes = [loop("near", 0.5), loop("far", 2)];
  const drawn = (zoom?: number) => {
    const { container, unmount } = render(<OverlayLayer shapes={shapes} locale="en" hoveredId={null} zoom={zoom} />);
    const ids = [...container.querySelectorAll("[data-overlay-id]")].map((g) => g.getAttribute("data-overlay-id"));
    unmount();
    return ids;
  };
  expect(drawn(1)).toEqual(["near"]);
  expect(drawn(2)).toEqual(["near", "far"]);
  expect(drawn(Infinity)).toEqual(["near", "far"]);
});
it("draws each mark from its minZoom at the map's zoom when it is given no zoom, as the marks of nodes are", () => {
  const loop = (id: string, minZoom: number): OverlayShape => ({ id, minZoom, kind: "selfLoop", x: 0, y: 0, width: 20, height: 20, path: "M0 0L20 20", overlay: { kind: "selfLoop", target: id, payload: { value: 0.5 } } });
  const shapes = [loop("near", 0.5), loop("far", 2)];
  const drawn = (zoom: number) => {
    map.zoom = zoom;
    const { container, unmount } = render(<OverlayLayer shapes={shapes} locale="en" hoveredId={null} />);
    const ids = [...container.querySelectorAll("[data-overlay-id]")].map((g) => g.getAttribute("data-overlay-id"));
    unmount();
    return ids;
  };
  // Fitted out to 0.25, at 1 and zoomed in to 2: the far loop appears from 2, the near one from 0.5.
  expect([drawn(0.25), drawn(1), drawn(2)]).toEqual([[], ["near"], ["near", "far"]]);
  map.zoom = 1;
});
