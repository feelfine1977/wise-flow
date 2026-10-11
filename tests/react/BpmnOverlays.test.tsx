import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Overlay } from "../../src/index";
import { createBpmnView } from "../../src/react/BpmnView";
import { Chip } from "../../src/react/nodes";
import { memoryViewers } from "./memory-viewer";

// The viewer's registry is the fixture's diagram interchange: Task_CreatePO at (440, 140) and
// Task_ApproveInvoice at (1060, 540), both 100 × 80; arcs and self-loops land in its SVG layer.
const viewers = memoryViewers();
const BpmnView = createBpmnView(viewers.connect);

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");

beforeEach(() => { viewers.instances.length = 0; });
afterEach(cleanup);

async function loops(overlays: Overlay[]) {
  const { container } = render(<BpmnView xml={xml} overlays={overlays} />);
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  const layer = viewers.instances[0].layer();
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
      "BPMN diagram with 7 tasks, 3 gateways and 13 sequence flows in 3 lanes. 1 visual annotations.",
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
    const viewer = viewers.instances[0];
    await waitFor(() => expect(viewer.overlays.length).toBe(3));
    // Pills run leftwards from the right edge of the 100 px task, 18 tall and 2 above it: "● · 50 %" and "● · 25 %"
    // (8 characters of 6.05 and 6 on either side, 60.4 wide) at 100 − 60.4 and 39.6 − 4 − 60.4; a dot alone 18.05 wide at 100 − 18.05.
    expect(viewer.overlays.map((a) => [a.element, Math.round(a.overlay.position.left * 100) / 100, a.overlay.position.top]).sort()).toEqual([
      ["Task_ApproveInvoice", 81.95, -20],
      ["Task_CreatePO", -24.8, -20],
      ["Task_CreatePO", 39.6, -20],
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
    const viewer = viewers.instances[0];
    await waitFor(() => expect(viewer.overlays.length).toBe(3));
    const added = (className: string) => {
      const { element, overlay } = viewer.overlays.find((a) => a.overlay.html.className === className)!;
      return { id: element, ...overlay };
    };
    // The badge's pill: "≥1 · 25 %", 66.45 wide, ending at the right edge of the task at (440, 140) and 2 above it
    // (440 + 100 − 66.45, 140 − 20), shown from the default badge zoom 0.22 (eleven nodes leave it unchanged).
    const badge = added("wf-badge");
    expect([badge.id, badge.position, badge.show, badge.scale]).toEqual(["Task_CreatePO", { top: -20, left: expect.closeTo(33.55, 5) }, { minZoom: 0.22 }, { min: 0.8, max: 1.2 }]);
    expect(badge.html.querySelector("svg")?.getAttribute("viewBox")).toBe("473.55 120 66.45 18");
    expect(badge.html.querySelector("rect")?.getAttribute("stroke")).toBe("#b84a00");
    // The tint covers the task from every zoom, scales with the diagram and is multiplied onto it.
    const tint = added("wf-tint wf-mark--below");
    expect([tint.id, tint.position, tint.show, tint.scale]).toEqual(["Task_CreatePO", { top: 0, left: 0 }, undefined, true]);
    expect(tint.html.querySelector("rect")?.getAttribute("fill-opacity")).toBe("0.18");
    // The chip shows what the map's chip shows: glyph, gauge (track, fill and tick) and the label in semibold.
    const drawn = added("wf-chip").html;
    expect(drawn.querySelectorAll("rect")).toHaveLength(4);
    expect(drawn.querySelector("tspan")?.getAttribute("font-weight")).toBe("600");
    const { container: map } = render(<Chip chip={chip} locale="en" />);
    expect(drawn.textContent).toBe(map.textContent);
    expect(drawn.textContent).toBe("Touches — 2.1 ⌀◔Touches: 2.1 ⌀");
    // The arc runs between the tasks in the SVG layer, solid as every arc, its label "⇐ 100 %" on its pill.
    const arc = viewer.layer().querySelector(".wf-arc path");
    expect(arc?.getAttribute("stroke-dasharray")).toBeNull();
    expect(arc?.getAttribute("marker-end")).toBe("url(#wf-bpmn-arrow)");
    expect(viewer.layer().querySelector(".wf-arc .wf-pill")).not.toBeNull();
    expect(viewer.layer().querySelector(".wf-arc text")?.textContent).toBe("⇐ 100 %");
  });

  it("keeps the diagram's marks out of the styling contract, which reaches only the React map and its panels", async () => {
    const { container } = render(
      <BpmnView
        xml={xml}
        legend={false}
        overlays={[
          { kind: "badge", target: "Task_CreatePO", payload: { glyph: "≥1", value: 0.25 } },
          { kind: "selfLoop", target: "Task_ApproveInvoice", payload: { value: 0.25 } },
        ]}
      />,
    );
    await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
    const viewer = viewers.instances[0];
    await waitFor(() => expect(viewer.layer().querySelector(".wf-selfloop")).not.toBeNull());
    await waitFor(() => expect(viewer.overlays.length).toBe(1));
    const drawn = [viewer.layer(), viewer.overlays[0].overlay.html];
    expect(drawn.flatMap((root) => Array.from(root.querySelectorAll("[data-wf-part], [data-wf-kind], [data-wf-state]")))).toEqual([]);
  });
});
