import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { importBpmn } from "../../src/bpmn/headless";
import type { ElementRef, FlowGraph, Positions } from "../../src/index";
import { createBpmnView } from "../../src/react/BpmnView";
import { ProcessMap } from "../../src/react/index";
import { memoryViewers } from "./memory-viewer";

/**
 * The same action on the four surfaces (the React Flow map, the Canvas map,
 * the table alternative, the BPMN diagram) is announced with the same
 * sentence, because each takes its selection through the map controller.
 */
const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
const viewers = memoryViewers();
const BpmnView = createBpmnView(viewers.connect);

let graph: FlowGraph;
let positions: Positions;
beforeAll(async () => {
  const imported = await importBpmn(xml);
  graph = imported.graph;
  positions = imported.positions!;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// jsdom has no pointer events; the Canvas map listens to them.
const hadPointer = "PointerEvent" in window;
beforeAll(() => {
  if (hadPointer) return;
  class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, writable: true, value: PointerEvent });
});
afterAll(() => {
  if (!hadPointer) delete (window as { PointerEvent?: unknown }).PointerEvent;
});

const REQ: ElementRef = { kind: "node", id: "Task_CreateRequisition" };
const PO: ElementRef = { kind: "node", id: "Task_CreatePO" };
const FLOW: ElementRef = { kind: "edge", id: "Flow_Req_PO" };

/**
 * Click, Shift-click, Shift-click again, a click on the path between them, the
 * same click again; with the selection each leaves (what bpmn-js reports).
 */
const ACTIONS: { element: ElementRef; multi: boolean; leaves: string[] }[] = [
  { element: REQ, multi: false, leaves: [REQ.id] },
  { element: PO, multi: true, leaves: [REQ.id, PO.id] },
  { element: PO, multi: true, leaves: [REQ.id] },
  { element: FLOW, multi: false, leaves: [FLOW.id] },
  { element: FLOW, multi: false, leaves: [] },
];
// Hand-written from the fixture's names and the strings table.
const SENTENCES = [
  "Selected: Create Purchase Requisition Item.",
  "Selected: Create Purchase Requisition Item and Create Purchase Order Item.",
  "Selected: Create Purchase Requisition Item.",
  "Selected: path Create Purchase Requisition Item → Create Purchase Order Item.",
  "Selection cleared.",
];

interface Surface {
  live(): string | null | undefined;
  act(action: (typeof ACTIONS)[number]): void;
}

const mapLive = () => screen.getByTestId("wf-live").textContent;

async function reactFlowMap(): Promise<Surface> {
  const { container } = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} renderer="svg" fitView={false} />
    </div>,
  );
  await waitFor(() => expect(container.querySelector(`[data-id="${FLOW.id}"]`)).toBeTruthy());
  return {
    live: mapLive,
    act({ element, multi }) {
      const target = element.kind === "edge" ? container.querySelector(`.react-flow__edge[data-id="${element.id}"]`) : container.querySelector(`.react-flow__node[data-id="${element.id}"]`);
      fireEvent.click(target!, { shiftKey: multi });
    },
  };
}

async function canvasMap(): Promise<Surface> {
  // Hit-testing needs no drawing.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const { container } = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} renderer="canvas" edgeBudget="all" fitView={false} />
    </div>,
  );
  await waitFor(() => expect(container.querySelector(".wf-canvas-map")).toBeTruthy());
  const host = container.querySelector(".wf-canvas-map")!;
  // Without fitting, the viewport is the identity: a screen point is a point of the layout.
  const pointOf = (element: ElementRef) => {
    if (element.kind === "edge") {
      const [a, b] = positions.edges[element.id].points;
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    const box = positions.nodes[element.id];
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  return {
    live: mapLive,
    act({ element, multi }) {
      const { x, y } = pointOf(element);
      fireEvent.pointerDown(host, { clientX: x, clientY: y, button: 0, pointerId: 1 });
      fireEvent.pointerUp(host, { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: multi });
    },
  };
}

/** The row of an element: an activity by its name in the first table, a path by its two ends in the second. */
function row(tables: HTMLElement, element: ElementRef) {
  const [activities, paths] = within(tables).getAllByRole("table");
  const label = (id: string) => graph.nodes.find((n) => n.id === id)!.label!;
  if (element.kind === "node") return within(activities).getByRole("rowheader", { name: label(element.id) }).closest("tr")!;
  const e = graph.edges.find((x) => x.id === element.id)!;
  return within(paths).getAllByRole("row").find((r) => r.querySelector("th")?.textContent === label(e.source) && r.querySelector("td")?.textContent === label(e.target))!;
}

async function tableAlternative(): Promise<Surface> {
  const { container } = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} view="table" fitView={false} />
    </div>,
  );
  const table = await waitFor(() => container.querySelector<HTMLElement>(".wf-table")!);
  return { live: mapLive, act: ({ element, multi }) => void fireEvent.click(row(table, element), { shiftKey: multi }) };
}

async function bpmnView(view: "diagram" | "table"): Promise<Surface> {
  viewers.instances.length = 0;
  const { container } = render(<BpmnView xml={xml} view={view} />);
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  const viewer = viewers.instances[0];
  const live = () => container.querySelector("[aria-live=polite]")?.textContent;
  if (view === "table") {
    const table = await waitFor(() => container.querySelector<HTMLElement>(".wf-table")!);
    return { live, act: ({ element, multi }) => void fireEvent.click(row(table, element), { shiftKey: multi }) };
  }
  return { live, act: ({ leaves }) => act(() => viewer.select(leaves.map(viewer.element))) };
}

describe("the same sentence on every surface", () => {
  for (const [name, mount] of [
    ["React Flow map", reactFlowMap],
    ["Canvas map", canvasMap],
    ["table alternative of the map", tableAlternative],
    ["BPMN diagram", () => bpmnView("diagram")],
    ["table alternative of the BPMN view", () => bpmnView("table")],
  ] as const) {
    it(`announces selections on the ${name}`, async () => {
      const surface = await mount();
      const said = ACTIONS.map((action) => {
        surface.act(action);
        return surface.live();
      });
      expect(said).toEqual(SENTENCES);
    });
  }
});
