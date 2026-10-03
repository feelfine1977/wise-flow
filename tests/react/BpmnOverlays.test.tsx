import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Overlay } from "../../src/index";
import { BpmnView } from "../../src/react/BpmnView";
import { Chip } from "../../src/react/nodes";

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
    added: { id: string; position: { top: number; left: number }; html: HTMLElement; show?: { minZoom?: number }; scale?: unknown }[] = [];
    constructor() { Viewer.instances.push(this); }
    on() {}
    off() {}
    async importXML() { return { warnings: [] }; }
    get(name: string) {
      if (name === "selection") return { get: () => [], select() {} };
      if (name === "elementRegistry") return { get: (id: string) => tasks.find((t) => t.id === id), getAll: () => tasks };
      if (name === "overlays") return { remove: () => { this.added = []; }, add: (id: string, _type: string, o: { position: { top: number; left: number }; html: HTMLElement; show?: { minZoom?: number }; scale?: unknown }) => { this.added.push({ id, ...o }); return "1"; } };
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

  it("attaches badges given by BPMN id and by activity id to their task, one slot each", async () => {
    const { container } = render(
      <BpmnView
        xml={xml}
        mapping={{ create_purchase_order_item: "Task_CreatePO" }}
        overlays={[
          { kind: "badge", target: "Task_CreatePO", payload: { value: 0.5 } },
          { kind: "badge", target: "create_purchase_order_item", payload: { value: 0.25 } },
          { kind: "badge", target: "Task_ApproveInvoice", payload: {} },
        ]}
      />,
    );
    await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
    const viewer = mock.Viewer.instances[0];
    await waitFor(() => expect(viewer.added.length).toBe(3));
    // Slots run leftwards from the right edge of the 100 px task: 100 - 26 + 2 and 100 - 52 + 2, half a badge above.
    expect(viewer.added.map((a) => [a.id, a.position.left, a.position.top]).sort()).toEqual([
      ["Task_ApproveInvoice", 76, -11],
      ["Task_CreatePO", 50, -11],
      ["Task_CreatePO", 76, -11],
    ]);
  });

  it("maps each mark to an overlay at its box or to the SVG layer, as drawn on the map", async () => {
    const chip: Overlay = { kind: "chip", target: "Task_ApproveInvoice", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", value: 0.5, gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const { container } = render(
      <BpmnView
        xml={xml}
        overlays={[
          chip,
          { kind: "badge", target: "Task_CreatePO", payload: { glyph: "≥1", value: 0.25 } },
          { kind: "tint", target: "Task_CreatePO", payload: { value: 0.5 } },
          { kind: "arc", target: "a", payload: { source: "Task_CreatePO", target: "Task_ApproveInvoice", value: 1, reverse: true } },
        ]}
      />,
    );
    await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
    const viewer = mock.Viewer.instances[0];
    await waitFor(() => expect(viewer.added.length).toBe(3));
    const added = (className: string) => viewer.added.find((a) => a.html.className === className)!;
    // The badge's box: 24 wide for its glyph, at the first slot of the task (100 + 100 - 28 + 2, 100 - 11), shown
    // from the default badge zoom 0.22 (eleven nodes leave it unchanged).
    const badge = added("wf-badge");
    expect([badge.id, badge.position, badge.show, badge.scale]).toEqual(["Task_CreatePO", { top: -11, left: 74 }, { minZoom: 0.22 }, { min: 0.8, max: 1.2 }]);
    expect(badge.html.querySelector("svg")?.getAttribute("viewBox")).toBe("174 89 24 22");
    expect(badge.html.querySelector("rect")?.getAttribute("fill")).toBe("#fdd0a2");
    // The tint covers the task from every zoom, scales with the diagram and is multiplied onto it.
    const tint = added("wf-tint wf-mark--below");
    expect([tint.id, tint.position, tint.show, tint.scale]).toEqual(["Task_CreatePO", { top: 0, left: 0 }, undefined, true]);
    expect(tint.html.querySelector("rect")?.getAttribute("fill-opacity")).toBe("0.18");
    // The chip shows what the map's chip shows: glyph, gauge (track, fill and tick) and the label in bold.
    const drawn = added("wf-chip").html;
    expect(drawn.querySelectorAll("rect")).toHaveLength(4);
    expect(drawn.querySelector("tspan")?.getAttribute("font-weight")).toBe("700");
    const { container: map } = render(<Chip chip={chip} locale="en" />);
    expect(drawn.textContent).toBe(map.textContent);
    expect(drawn.textContent).toBe("Touches — 2.1 ⌀◔Touches: 2.1 ⌀");
    // The arc runs between the tasks in the SVG layer, dashed as a reverse arc.
    const arc = viewer.layer.querySelector(".wf-arc path");
    expect(arc?.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(arc?.getAttribute("marker-end")).toBe("url(#wf-bpmn-arrow)");
  });
});
