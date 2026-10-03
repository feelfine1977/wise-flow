import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Overlay } from "../../src/index";
import { connectBpmnJs } from "../../src/bpmn/bpmn-js";
import type { ConnectViewer, ViewerEvents } from "../../src/bpmn/viewer";
import { type BpmnViewHandle, createBpmnView } from "../../src/react/BpmnView";
import { memoryViewers } from "./memory-viewer";

const viewers = memoryViewers();
const BpmnView = createBpmnView(viewers.connect);

const fixture = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
// `Task_ClearInvoice` carries the FlowGraph id `clear invoice`.
const xml = fixture
  .replace("<bpmn:definitions ", '<bpmn:definitions xmlns:wise="http://wise-workbench.org/schema/flow" ')
  .replace('<bpmn:serviceTask id="Task_ClearInvoice"', '<bpmn:serviceTask id="Task_ClearInvoice" wise:flowId="clear invoice"');

beforeEach(() => { viewers.instances.length = 0; });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  globalThis.ResizeObserver = setupObserver;
});

// The setup's observer, replaced in a test by one the test drives.
const setupObserver = globalThis.ResizeObserver;
function observeWith(observer: unknown) {
  globalThis.ResizeObserver = observer as typeof ResizeObserver;
}

async function ready(container: HTMLElement, index = 0) {
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  return viewers.instances[index];
}

describe("BpmnView through the viewer seam", () => {
  it("reports a diagram selection as tasks, flows and lanes in FlowGraph ids, once per change", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} onSelect={onSelect} />);
    const viewer = await ready(container);
    const pick = ["Lane_Purchasing", "Task_ClearInvoice", "Gateway_Received", "Flow_Req_PO", "Participant_p2p", "StartEvent_Need", "Task_CreatePO"];
    act(() => viewer.select(pick.map(viewer.element)));
    // Gateways and events are not reported; tasks by FlowGraph id, in the order of the selection.
    const expected = { tasks: ["clear invoice", "Task_CreatePO"], flows: ["Flow_Req_PO"], lanes: ["Lane_Purchasing", "Participant_p2p"] };
    expect(onSelect.mock.calls).toEqual([[expected]]);
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("Selected: 2 tasks, 1 flows, 2 lanes.");
    act(() => viewer.select(pick.map(viewer.element)));
    expect(onSelect).toHaveBeenCalledTimes(1);
    act(() => viewer.select([viewer.element("Gateway_Received")]));
    expect(onSelect).toHaveBeenLastCalledWith({ tasks: [], flows: [], lanes: [] });
    expect(container.querySelector("[aria-live=polite]")?.textContent).toBe("");
  });

  it("reports hovered tasks, flows and lanes in FlowGraph ids and null when the pointer leaves", async () => {
    const onHover = vi.fn();
    const { container } = render(<BpmnView xml={xml} onHover={onHover} />);
    const viewer = await ready(container);
    for (const id of ["Task_ClearInvoice", "Gateway_Received", "Flow_Req_PO", "Lane_Warehouse"]) act(() => viewer.emit("hover", viewer.element(id)));
    act(() => viewer.emit("hover", undefined));
    act(() => viewer.emit("out", undefined));
    expect(onHover.mock.calls).toEqual([["clear invoice"], ["Flow_Req_PO"], ["Lane_Warehouse"], [null]]);
  });

  it("tells the viewer about a resize and refits until the user navigates", async () => {
    let observed: { target: Element; callback: () => void } | undefined;
    observeWith(class {
      constructor(private callback: () => void) {}
      observe(target: Element) { observed = { target, callback: this.callback }; }
      disconnect() { observed = undefined; }
    });
    const { container, unmount } = render(<BpmnView xml={xml} />);
    const viewer = await ready(container);
    const canvas = observed!.target as HTMLElement;
    expect(canvas.className).toBe("wf-bpmn__canvas");
    viewer.zooms.length = 0;
    // A container without a size (hidden) is left alone.
    observed!.callback();
    expect([viewer.resizes, viewer.zooms]).toEqual([0, []]);
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    observed!.callback();
    expect([viewer.resizes, viewer.zooms]).toEqual([1, ["fit-viewport"]]);
    // After the user zooms with the wheel, a resize keeps the viewport.
    fireEvent.wheel(canvas);
    observed!.callback();
    expect([viewer.resizes, viewer.zooms]).toEqual([2, ["fit-viewport"]]);
    unmount();
    expect(observed).toBeUndefined();
  });

  it("does not refit on a resize when fitting is off", async () => {
    let callback: (() => void) | undefined;
    observeWith(class {
      constructor(fn: () => void) { callback = fn; }
      observe(target: HTMLElement) { Object.defineProperties(target, { clientWidth: { value: 800 }, clientHeight: { value: 600 } }); }
      disconnect() {}
    });
    const { container } = render(<BpmnView xml={xml} fitView={false} />);
    const viewer = await ready(container);
    callback!();
    expect([viewer.resizes, viewer.zooms]).toEqual([1, []]);
  });

  it("saves the modeler's changes once commands pause for 250 ms and does not re-import the saved XML", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<BpmnView xml={xml} mode="model" onChange={onChange} />);
    const viewer = await ready(container);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => viewer.edit(`${xml}<!-- 1 -->`));
    act(() => { vi.advanceTimersByTime(200); });
    act(() => viewer.edit(`${xml}<!-- 2 -->`));
    await act(async () => { vi.advanceTimersByTime(249); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onChange.mock.calls).toEqual([[`${xml}<!-- 2 -->`]]);
    vi.useRealTimers();
    // The host passes the saved XML back; the modeler keeps its diagram.
    rerender(<BpmnView xml={`${xml}<!-- 2 -->`} mode="model" onChange={onChange} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(viewer.imported).toEqual([xml]);
  });

  it("does not save in the viewer", async () => {
    const onChange = vi.fn();
    const { container } = render(<BpmnView xml={xml} onChange={onChange} />);
    const viewer = await ready(container);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => viewer.edit(`${xml}<!-- 1 -->`));
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("offers the viewer, its saved XML and SVG and fitting through the handle", async () => {
    const ref = createRef<BpmnViewHandle>();
    const { container } = render(<BpmnView ref={ref} xml={xml} fitView={false} />);
    const viewer = await ready(container);
    expect(ref.current!.viewer()).toBe(viewer.instance);
    expect(await ref.current!.saveXML()).toBe(xml);
    expect(await ref.current!.saveSVG()).toBe("<svg/>");
    act(() => ref.current!.fit());
    expect(viewer.zooms).toEqual(["fit-viewport"]);
  });

  it("replaces the overlays and markers of a dataset without re-importing, and re-reads moved elements", async () => {
    const badge: Overlay = { kind: "badge", target: "Task_CreatePO", payload: { glyph: "≥1", value: 0.25 } };
    const { container, rerender } = render(<BpmnView xml={xml} overlays={[badge]} />);
    const viewer = await ready(container);
    await waitFor(() => expect(viewer.overlays).toHaveLength(1));
    expect(viewer.markers.get("Task_CreatePO")).toEqual(new Set(["wf-bpmn--badge"]));
    // First slot of the task at (440, 140): 440 + 100 - 28 + 2, 140 - 11.
    expect(viewer.overlays[0].overlay.html.querySelector("svg")?.getAttribute("viewBox")).toBe("514 129 24 22");
    // The modeler moves the task in place; the registry is read again on the next frame.
    Object.assign(viewer.element("Task_CreatePO"), { x: 400, y: 100 });
    act(() => viewer.emit("changed", undefined));
    await waitFor(() => expect(viewer.overlays[0].overlay.html.querySelector("svg")?.getAttribute("viewBox")).toBe("474 89 24 22"));
    rerender(<BpmnView xml={xml} overlays={[]} />);
    await waitFor(() => expect(viewer.overlays).toEqual([]));
    expect(viewer.markers.get("Task_CreatePO")).toEqual(new Set());
    expect(viewer.imported).toHaveLength(1);
  });

  it("projects the overlays onto the modeler only once it has imported the diagram", async () => {
    const deferred = memoryViewers({ deferImports: true });
    const Deferred = createBpmnView(deferred.connect);
    const overlays: Overlay[] = [{ kind: "badge", target: "Task_CreatePO", payload: { glyph: "≥1", value: 0.25 } }];
    const { container, rerender } = render(<Deferred xml={xml} overlays={overlays} />);
    await waitFor(() => expect(deferred.instances[0]?.pending).toHaveLength(1));
    act(() => deferred.instances[0].pending[0]());
    await waitFor(() => expect(deferred.instances[0].overlays).toHaveLength(1));
    rerender(<Deferred xml={xml} overlays={overlays} mode="model" />);
    // The modeler's registry is empty until its import finishes; the viewer's elements are not its own.
    await waitFor(() => expect(deferred.instances[1]?.pending).toHaveLength(1));
    const modeler = deferred.instances[1];
    expect([modeler.overlays, modeler.markers.size]).toEqual([[], 0]);
    act(() => modeler.pending[0]());
    await waitFor(() => expect(modeler.overlays.map((o) => o.element)).toEqual(["Task_CreatePO"]));
    expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-mode")).toBe("model");
  });

  it("shows paths from their zoom and selects an arc's ends on a click", async () => {
    const onSelect = vi.fn();
    const arc: Overlay = { kind: "arc", target: "lag", payload: { source: "Task_CreatePO", target: "Task_ClearInvoice", value: 1 } };
    const { container } = render(<BpmnView xml={xml} overlays={[arc]} lod={{ arcs: 0.5 }} onSelect={onSelect} />);
    const viewer = await ready(container);
    const path = await waitFor(() => {
      const found = viewer.layer().querySelector<SVGGElement>(".wf-arc");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(path.getAttribute("data-min-zoom")).toBe("0.5");
    expect(path.style.visibility).toBe("visible");
    act(() => { viewer.zoom(0.4); });
    expect(path.style.visibility).toBe("hidden");
    act(() => { viewer.zoom(0.5); });
    expect(path.style.visibility).toBe("visible");
    fireEvent.click(path);
    expect(onSelect).toHaveBeenLastCalledWith({ tasks: ["Task_CreatePO", "clear invoice"], flows: [], lanes: [] });
  });

  it("destroys a viewer that arrives after unmounting and reports a viewer that cannot be created", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const Late = createBpmnView(async (options) => {
      const viewer = await viewers.connect(options);
      await gate;
      return viewer;
    });
    const { unmount } = render(<Late xml={xml} />);
    await waitFor(() => expect(viewers.instances).toHaveLength(1));
    unmount();
    release();
    await waitFor(() => expect(viewers.instances[0].destroyed).toBe(true));

    const onError = vi.fn();
    const failing: ConnectViewer = async () => { throw new Error("no viewer"); };
    const Failing = createBpmnView(failing);
    const { container } = render(<Failing xml={xml} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(new Error("no viewer")));
    expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("error");
    expect(container.querySelector("[role=alert]")?.textContent).toBe("The diagram could not be loaded.");
  });
});

describe("the bpmn-js adapter", () => {
  // jsdom has no SVG geometry, so bpmn-js can neither import nor draw a selection here; its event bus runs.
  it("passes bpmn-js events on as the seam's events until unsubscribed", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const viewer = await connectBpmnJs({ container, mode: "view" });
    const instance = viewer.instance as { get(name: string): { fire(event: string, data?: object): void } };
    const seen: [string, unknown][] = [];
    const names: (keyof ViewerEvents)[] = ["selection", "hover", "out", "changed", "command", "viewbox"];
    const offs = names.map((name) => viewer.on(name, (value) => seen.push([name, value])));
    const task = { id: "Task_1" };
    const bus = instance.get("eventBus");
    bus.fire("element.hover", { element: task });
    bus.fire("element.out", { element: task });
    bus.fire("elements.changed", { elements: [] });
    bus.fire("commandStack.changed", {});
    bus.fire("canvas.viewbox.changed", { viewbox: { scale: 1 } });
    bus.fire("selection.changed", { oldSelection: [], newSelection: [task] });
    expect(seen.map(([name]) => name)).toEqual(["hover", "out", "changed", "command", "viewbox", "selection"]);
    expect(seen[0][1]).toBe(task);
    expect(seen[5][1]).toEqual([task]);
    expect(viewer.selected()).toEqual([]);
    for (const off of offs) off();
    bus.fire("element.hover", { element: task });
    expect(seen).toHaveLength(6);
    viewer.destroy();
    container.remove();
  });
});
