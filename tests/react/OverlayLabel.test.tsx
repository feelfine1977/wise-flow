import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OverlayShape } from "../../src/core/index";
vi.mock("@xyflow/react", () => ({ ViewportPortal: ({ children }: { children: React.ReactNode }) => children }));
import { OverlayLayer } from "../../src/react/OverlayLayer";
afterEach(cleanup);
it("keeps the explicit constraint meaning on an arc without changing its numeric evidence", () => {
  const shape: OverlayShape = { id: "lag", minZoom: 0, kind: "arc", x: 0, y: 0, width: 100, height: 100, path: "M0 0L100 100", labelX: 50, labelY: 40, overlay: { kind: "arc", target: "invoice", payload: { source: "invoice", target: "clear", glyph: "⇒", value: 0.63, displayLabel: "63% exceed target", text: "Evaluated on 173,183 items" } } };
  const { container } = render(<OverlayLayer shapes={[shape]} locale="en" hoveredId={null} showArcs showSelfLoops />);
  expect(container.querySelector("text")?.textContent).toBe("63% exceed target");
  expect(container.querySelector("title")?.textContent).toContain("173,183");
  expect(shape.overlay.payload?.value).toBe(0.63);
});
