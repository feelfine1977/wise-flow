import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Counts the scenes built and the layouts asked for.
vi.mock("../../src/core/scene.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/scene.js")>();
  return { ...original, buildScene: vi.fn(original.buildScene) };
});
const layouts = vi.fn();
vi.mock("../../src/core/layout.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/layout.js")>();
  return {
    ...original,
    createLayoutScope: (...args: Parameters<typeof original.createLayoutScope>) => {
      const scope = original.createLayoutScope(...args);
      const run = scope.layout.bind(scope);
      scope.layout = (...given: Parameters<typeof run>) => (layouts(), run(...given));
      return scope;
    },
  };
});

const { buildScene } = await import("../../src/core/scene.js");
const { smallP2P } = await import("../../fixtures/p2p_small");
const { ProcessMap } = await import("../../src/react/index");
const { layout } = await import("../../src/index");
type Measure = import("../../src/index").Measure;

afterEach(() => {
  cleanup();
  vi.mocked(buildScene).mockClear();
  layouts.mockClear();
});

const label = (container: HTMLElement, id: string) => container.querySelector(`[data-id="${id}"] .wf-edge-label, g.wf-edge[data-id="${id}"] .wf-edge-label`)?.textContent;
const numberLine = (container: HTMLElement, id: string) => [...container.querySelectorAll(`#wf-node-${id} .wf-activity-counts > span`)].map((s) => s.textContent).join(" ");

describe("the map's measure", () => {
  it("switches path labels, number lines and the legend's measure without a layout, building the scene once", async () => {
    const map = (measure?: Measure) => <ProcessMap graph={smallP2P} measure={measure} layout={{ engine: "dagre" }} renderer="svg" edgeBudget="all" fitView={false} selfLoops={false} contextMenu={false} pathList={false} />;
    const view = render(map());
    await waitFor(() => expect(view.container.querySelector('[data-layout-status="ready"]')).not.toBeNull());
    await waitFor(() => expect(label(view.container, "create_po->goods_receipt")).toBe("800"));
    const laid = layouts.mock.calls.length;
    const built = vi.mocked(buildScene).mock.calls.length;
    expect(laid).toBeGreaterThan(0);
    const strip = () => view.container.querySelector(".wf-legend__measure")?.textContent;
    expect(strip()).toBe("Frequency · cases · share of 1,000 cases");
    expect(numberLine(view.container, "goods_receipt")).toBe("900 · 90 %");

    view.rerender(map("shortfall"));
    await waitFor(() => expect(label(view.container, "create_po->goods_receipt")).toBe("30 % · 800"));
    expect(numberLine(view.container, "goods_receipt")).toBe("35 % short · 900");
    // The strip names the measure and its unit: the sentence's first part.
    expect(strip()).toBe("Shortfall: share of cases missing an expectation.");
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built + 1);

    view.rerender(map("performance"));
    // 240 hours are 10 days; the activities have no time to the next activity from the host, so their number lines stay.
    await waitFor(() => expect(label(view.container, "create_po->goods_receipt")).toBe("10 d · 800"));
    expect(numberLine(view.container, "goods_receipt")).toBe("900 · 90 %");
    expect(strip()).toBe("Performance: median wait between activities (h, d).");
    expect(vi.mocked(buildScene).mock.calls.length).toBe(built + 2);
    expect(layouts.mock.calls.length).toBe(laid);
  });

  it("offers the three measures in the whole legend when the host listens, and switches by itself where the prop is not given", async () => {
    const changes: Measure[] = [];
    const given = await layout(smallP2P, { engine: "dagre" });
    const view = render(<ProcessMap graph={smallP2P} positions={given} onMeasureChange={(m) => changes.push(m)} renderer="svg" edgeBudget="all" fitView={false} selfLoops={false} contextMenu={false} pathList={false} />);
    await waitFor(() => expect(label(view.container, "create_po->goods_receipt")).toBe("800"));
    fireEvent.click(within(view.container).getByRole("button", { name: "Show the whole legend" }));
    const group = within(view.container).getByRole("group", { name: "Measure" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["Frequency", "true"], ["Shortfall", "false"], ["Performance", "false"]]);
    act(() => fireEvent.click(buttons[1]));
    expect(changes).toEqual(["shortfall"]);
    await waitFor(() => expect(label(view.container, "create_po->goods_receipt")).toBe("30 % · 800"));
    expect(within(group).getByRole("button", { name: "Shortfall" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("offers no switch when the host does not listen, and names the measure in German", async () => {
    const given = await layout(smallP2P, { engine: "dagre" });
    const view = render(<ProcessMap graph={smallP2P} positions={given} measure="shortfall" locale="de" renderer="svg" edgeBudget="all" fitView={false} selfLoops={false} contextMenu={false} pathList={false} />);
    await waitFor(() => expect(label(view.container, "create_po->goods_receipt")).toBe("30 % · 800"));
    fireEvent.click(within(view.container).getByRole("button", { name: "Ganze Legende zeigen" }));
    expect(within(view.container).queryByRole("group", { name: "Messgröße" })).toBeNull();
    expect(view.container.querySelector(".wf-legend__key .wf-legend__measure")?.textContent).toBe("Erwartungslücke: Anteil der Fälle, die eine Erwartung verfehlen. Farbe = Lückenanteil. Breite = Fälle.");
    expect(numberLine(view.container, "goods_receipt")).toBe("35 % verfehlt · 900");
  });
});
