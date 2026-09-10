import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BpmnView, type BpmnSelection } from "../../src/react/BpmnView";

// Model the selection service's diagram.clear/root.set events during import and
// teardown, with import completion controlled separately from those events.
const mock = vi.hoisted(() => {
  const task = { id: "receive", businessObject: {
    id: "receive", get: () => undefined,
    $instanceOf: (type: string) => type === "bpmn:Activity",
  } };
  type Element = typeof task;
  class Viewer {
    static instances: Viewer[] = [];
    handlers = new Map<string, ((event: Record<string, unknown>) => void)[]>();
    selected: Element[] = [];
    imports: (() => void)[] = [];
    destroyed = false;
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    constructor() { Viewer.instances.push(this); }
    on(name: string, fn: (event: Record<string, unknown>) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]);
    }
    off(name: string, fn: (event: Record<string, unknown>) => void) {
      this.handlers.set(name, (this.handlers.get(name) ?? []).filter((handler) => handler !== fn));
    }
    select(elements: Element[] | Element | null) {
      this.selected = elements === null ? [] : Array.isArray(elements) ? elements : [elements];
      for (const handler of this.handlers.get("selection.changed") ?? []) handler({ newSelection: this.selected });
    }
    importXML() {
      this.select(null);
      return new Promise<{ warnings: string[] }>((resolve) => this.imports.push(() => resolve({ warnings: [] })));
    }
    get(name: string) {
      if (name === "selection") return { get: () => this.selected, select: (elements: Element[] | Element | null) => this.select(elements) };
      if (name === "elementRegistry") return { get: (id: string) => id === task.id ? task : undefined, getAll: () => [task] };
      if (name === "overlays") return { remove() {} };
      if (name === "canvas") return { getLayer: () => this.layer, zoom: () => 1, resized() {}, removeMarker() {} };
      throw new Error(`Unexpected service ${name}`);
    }
    destroy() { this.destroyed = true; this.select(null); }
  }
  return { Viewer, task };
});
vi.mock("bpmn-js/lib/NavigatedViewer.js", () => ({ default: mock.Viewer }));
vi.mock("bpmn-js/lib/Modeler.js", () => ({ default: mock.Viewer }));

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
const selected: BpmnSelection = { tasks: ["receive"], flows: [], lanes: [] };
const empty: BpmnSelection = { tasks: [], flows: [], lanes: [] };
beforeEach(() => { mock.Viewer.instances = []; });
afterEach(cleanup);

async function viewerAt(index = 0) {
  await waitFor(() => expect(mock.Viewer.instances[index]?.imports.length).toBeGreaterThan(0));
  return mock.Viewer.instances[index];
}
async function finish(viewer: InstanceType<typeof mock.Viewer>, container: HTMLElement) {
  await act(async () => { viewer.imports.shift()!(); });
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  await waitFor(() => expect(viewer.selected.map((element) => element.id)).toEqual(selected.tasks));
}

describe("BPMN selection lifecycle", () => {
  it("does not report the initial import's selection reset", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} selection={selected} onSelect={onSelect} />);
    const viewer = await viewerAt();
    expect(onSelect).not.toHaveBeenCalled();
    await finish(viewer, container);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not clear the host selection when the model unmounts", async () => {
    const onSelect = vi.fn();
    const { container, unmount } = render(<BpmnView xml={xml} selection={selected} onSelect={onSelect} />);
    const viewer = await viewerAt();
    await finish(viewer, container);
    onSelect.mockClear();
    unmount();
    expect(viewer.destroyed).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reapplies controlled selection after XML replacement without reporting the import reset", async () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<BpmnView xml={xml} selection={selected} onSelect={onSelect} />);
    const viewer = await viewerAt();
    await finish(viewer, container);
    onSelect.mockClear();
    rerender(<BpmnView xml={`${xml}\n`} selection={selected} onSelect={onSelect} />);
    await waitFor(() => expect(viewer.imports).toHaveLength(1));
    expect(onSelect).not.toHaveBeenCalled();
    await finish(viewer, container);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("restores selection on viewer replacement and ignores events from the destroyed viewer", async () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<BpmnView xml={xml} selection={selected} onSelect={onSelect} />);
    const first = await viewerAt();
    await finish(first, container);
    onSelect.mockClear();
    rerender(<BpmnView xml={xml} mode="model" selection={selected} onSelect={onSelect} />);
    const second = await viewerAt(1);
    expect(first.destroyed).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    await finish(second, container);
    act(() => first.select(null));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still reports a user deselection, reselection and another deselection after import", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} selection={selected} onSelect={onSelect} />);
    const viewer = await viewerAt();
    await finish(viewer, container);
    onSelect.mockClear();
    act(() => viewer.select(null));
    act(() => viewer.select(mock.task));
    act(() => viewer.select(null));
    expect(onSelect.mock.calls).toEqual([[empty], [selected], [empty]]);
  });
});
