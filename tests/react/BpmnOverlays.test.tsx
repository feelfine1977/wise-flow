import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Overlay } from "../../src/index";
import { BpmnView } from "../../src/react/BpmnView";

// A viewer whose registry holds two tasks of the fixture; arcs and self-loops land in `layer`.
const mock = vi.hoisted(() => {
  const task = (id: string, x: number) => ({ id, x, y: 100, width: 100, height: 80, businessObject: {
    id, get: () => undefined,
    $instanceOf: (type: string) => type === "bpmn:Activity",
  } });
  const tasks = [task("Task_CreatePO", 100), task("Task_ApproveInvoice", 300)];
  class Viewer {
    static instances: Viewer[] = [];
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    constructor() { Viewer.instances.push(this); }
    on() {}
    off() {}
    async importXML() { return { warnings: [] }; }
    get(name: string) {
      if (name === "selection") return { get: () => [], select() {} };
      if (name === "elementRegistry") return { get: (id: string) => tasks.find((t) => t.id === id), getAll: () => tasks };
      if (name === "overlays") return { remove() {}, add: () => "1" };
      if (name === "canvas") return { getLayer: () => this.layer, zoom: () => 1, resized() {}, removeMarker() {}, addMarker() {} };
      throw new Error(`Unexpected service ${name}`);
    }
    destroy() {}
  }
  return { Viewer };
});
vi.mock("bpmn-js/lib/NavigatedViewer.js", () => ({ default: mock.Viewer }));
vi.mock("bpmn-js/lib/Modeler.js", () => ({ default: mock.Viewer }));

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");

beforeEach(() => { mock.Viewer.instances = []; });
afterEach(cleanup);

async function loops(overlays: Overlay[]) {
  const { container } = render(<BpmnView xml={xml} overlays={overlays} />);
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  const layer = mock.Viewer.instances[0].layer;
  await waitFor(() => expect(layer.querySelectorAll(".wf-selfloop").length).toBeGreaterThan(0));
  return { container, groups: Array.from(layer.querySelectorAll(".wf-selfloop")) };
}

describe("BpmnView overlays from the scene", () => {
  it("draws no text for a self-loop without a label or a value", async () => {
    const { groups } = await loops([
      { kind: "selfLoop", target: "Task_CreatePO", payload: { label: "repeat" } },
      { kind: "selfLoop", target: "Task_ApproveInvoice", payload: { value: 0.25 } },
    ]);
    // Canonical order: Task_ApproveInvoice before Task_CreatePO.
    expect(groups.map((g) => g.querySelector("text")?.textContent ?? null)).toEqual(["↻ 25 %", null]);
  });

  it("keeps observed repeats at every zoom and others from the self-loop zoom", async () => {
    const { groups } = await loops([
      { kind: "selfLoop", target: "Task_CreatePO", payload: { observed: true, displayLabel: "↻ 3 transitions" } },
      { kind: "selfLoop", target: "Task_ApproveInvoice", payload: { value: 0.25 } },
    ]);
    // Eleven nodes in the fixture leave the self-loop zoom at its default 0.25.
    expect(groups.map((g) => g.getAttribute("data-min-zoom"))).toEqual(["0.25", "0"]);
  });

  it("counts only the overlays whose targets name an element of the diagram", async () => {
    const { container } = await loops([
      { kind: "selfLoop", target: "Task_CreatePO", payload: { value: 0.5 } },
      { kind: "badge", target: "no_such_task", payload: { value: 0.5 } },
    ]);
    expect(container.querySelector(".wf-bpmn")?.getAttribute("aria-label")).toBe(
      "BPMN diagram with 7 tasks, 2 gateways and 12 sequence flows in 3 lanes. 1 visual annotations.",
    );
  });
});
