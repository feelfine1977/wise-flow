import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createBpmnView } from "../../src/react/BpmnView";
import { memoryViewers } from "./memory-viewer";

// Fitting the viewport zooms to 0.4.
const viewers = memoryViewers({ fitZoom: 0.4 });
const BpmnView = createBpmnView(viewers.connect);
const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
beforeEach(() => { viewers.instances.length = 0; });
afterEach(cleanup);

it("offers fit and zoom independently of the hosted diagram/table toggle", async () => {
  render(<BpmnView xml={xml} controls={false} navigation legend={false} />);
  const fit = screen.getByRole("button", { name: "Fit the whole model" });
  await waitFor(() => expect(fit.hasAttribute("disabled")).toBe(false));
  expect(screen.queryByRole("button", { name: "Table view" })).toBeNull();
  const viewer = viewers.instances[0];
  viewer.zooms.length = 0;
  fireEvent.click(fit);
  expect(viewer.zooms).toEqual(["fit-viewport"]);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  // 0.4 × 1.25, then back.
  expect(viewer.zooms.slice(1)).toEqual([0.5, 0.4]);
});

it("centres the readable size on the selected task, or on the first task", async () => {
  render(<BpmnView xml={xml} controls={false} navigation legend={false} />);
  const readable = screen.getByRole("button", { name: "Readable size" });
  await waitFor(() => expect(readable.hasAttribute("disabled")).toBe(false));
  const viewer = viewers.instances[0];
  // The container has no size under jsdom, so the viewbox is the task's centre.
  fireEvent.click(readable);
  // The first task of the fixture, Task_CreateRequisition at (300, 140), 100 × 80.
  expect(viewer.viewboxes.at(-1)).toEqual({ x: 350, y: 180, width: 0, height: 0 });
  act(() => viewer.select([viewer.element("Task_ApproveInvoice")]));
  fireEvent.click(readable);
  expect(viewer.viewboxes.at(-1)).toEqual({ x: 1110, y: 580, width: 0, height: 0 });
});

it("zooms to 1 for a readable size when the diagram has no task", async () => {
  const empty = memoryViewers({ registry: [] });
  const View = createBpmnView(empty.connect);
  render(<View xml={xml} controls={false} navigation legend={false} />);
  const readable = screen.getByRole("button", { name: "Readable size" });
  await waitFor(() => expect(readable.hasAttribute("disabled")).toBe(false));
  fireEvent.click(readable);
  expect(empty.instances[0].zooms.at(-1)).toBe(1);
  expect(empty.instances[0].viewboxes).toEqual([]);
});
