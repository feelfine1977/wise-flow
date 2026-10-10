import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const viewer = vi.hoisted(() => {
  let scale = 0.4;
  return { zoom: vi.fn((value?: number | string) => { if (typeof value === "number") scale = value; return scale; }), viewbox: vi.fn() };
});
vi.mock("bpmn-js/lib/NavigatedViewer.js", () => ({ default: class {
  importXML = async () => ({ warnings: [] });
  get(name: string) {
    if (name === "canvas") return { ...viewer, resized: vi.fn(), getLayer: () => document.createElementNS("http://www.w3.org/2000/svg", "g") };
    if (name === "elementRegistry") return { getAll: () => [] };
    if (name === "selection") return { get: () => [], select: vi.fn() };
    if (name === "overlays") return { remove: vi.fn() };
  }
  on() {} off() {} destroy() {}
} }));
import { BpmnView } from "../../src/react/BpmnView";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("offers fit and zoom independently of the hosted diagram/table toggle", async () => {
  const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
  render(<BpmnView xml={xml} controls={false} navigation legend={false} />);
  const fit = screen.getByRole("button", { name: "Fit the whole model" });
  await waitFor(() => expect(fit.hasAttribute("disabled")).toBe(false));
  expect(screen.queryByRole("button", { name: "Table view" })).toBeNull();
  viewer.zoom.mockClear();
  fireEvent.click(fit);
  expect(viewer.zoom).toHaveBeenLastCalledWith("fit-viewport");
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(viewer.zoom).toHaveBeenLastCalledWith(0.5);
  fireEvent.click(screen.getByRole("button", { name: "Readable size" }));
  expect(viewer.zoom).toHaveBeenLastCalledWith(1);
});
