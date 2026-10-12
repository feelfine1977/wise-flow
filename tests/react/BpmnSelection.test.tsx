import { act, cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BpmnSelection, createBpmnView } from "../../src/react/BpmnView";
import { type MemoryViewer, memoryViewers } from "./memory-viewer";

// The viewer clears its selection when it imports and when it is destroyed; imports finish when the test says so.
const viewers = memoryViewers({ deferImports: true });
const BpmnView = createBpmnView(viewers.connect);

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");
const selected: BpmnSelection = { tasks: ["Task_CreatePO"], flows: [], lanes: [] };
const empty: BpmnSelection = { tasks: [], flows: [], lanes: [] };
beforeEach(() => { viewers.instances.length = 0; });
afterEach(cleanup);

async function viewerAt(index = 0) {
  await waitFor(() => expect(viewers.instances[index]?.pending.length).toBeGreaterThan(0));
  return viewers.instances[index];
}
async function finish(viewer: MemoryViewer, container: HTMLElement) {
  await act(async () => { viewer.pending.shift()!(); });
  await waitFor(() => expect(container.querySelector(".wf-bpmn")?.getAttribute("data-bpmn-status")).toBe("ready"));
  await waitFor(() => expect(viewer.selected().map((element) => element.id)).toEqual(selected.tasks));
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
    await waitFor(() => expect(viewer.pending).toHaveLength(1));
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
    expect(second.options.mode).toBe("model");
    expect(onSelect).not.toHaveBeenCalled();
    await finish(second, container);
    act(() => first.emit("selection", []));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("still reports a user deselection, reselection and another deselection after import", async () => {
    const onSelect = vi.fn();
    const { container } = render(<BpmnView xml={xml} selection={selected} onSelect={onSelect} />);
    const viewer = await viewerAt();
    await finish(viewer, container);
    onSelect.mockClear();
    act(() => viewer.select([]));
    act(() => viewer.select([viewer.element("Task_CreatePO")]));
    act(() => viewer.select([]));
    expect(onSelect.mock.calls).toEqual([[empty], [selected], [empty]]);
  });
});
