import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type Locale, layout, toSVG } from "../../src/index";
import { type BpmnViewHandle, createBpmnView } from "../../src/react/BpmnView";
import { Legend, ProcessMap } from "../../src/react/index";
import { memoryViewers } from "./memory-viewer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");

/**
 * Four activities and four paths. Activity strength is cases over the most (1, 0.5, 0.2, 0.05), path strength the count
 * over the most (1, 0.5, 0.1, 0.05): at 10 % for activities and 20 % for paths D, a → c and c → d go.
 */
const graph: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 50 } },
    { id: "c", kind: "activity", label: "C", metrics: { cases: 20 } },
    { id: "d", kind: "activity", label: "D", metrics: { cases: 5 } },
  ],
  edges: [
    { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 100, cases: 100 } },
    { id: "bc", kind: "follows", source: "b", target: "c", metrics: { count: 50, cases: 50 } },
    { id: "ac", kind: "follows", source: "a", target: "c", metrics: { count: 10, cases: 10 } },
    { id: "cd", kind: "follows", source: "c", target: "d", metrics: { count: 5, cases: 5 } },
  ],
};

const NAMES: Record<Locale, { group: string; buttons: string[]; expand: string; collapse: string; expanded: string; collapsed: string }> = {
  en: { group: "Zoom", buttons: ["Zoom in", "Zoom out", "Fit the map"], expand: "Show the whole legend", collapse: "Show the legend as one line", expanded: "The whole legend is shown.", collapsed: "The legend is shown as one line." },
  de: { group: "Zoom", buttons: ["Vergrößern", "Verkleinern", "Karte einpassen"], expand: "Ganze Legende zeigen", collapse: "Legende als eine Zeile zeigen", expanded: "Die ganze Legende wird gezeigt.", collapsed: "Die Legende wird als eine Zeile gezeigt." },
};

async function map(renderer: "svg" | "canvas", locale: Locale = "en", abstraction = { minNodeShare: 0, minEdgeShare: 0 }) {
  const positions = await layout(graph, { engine: "dagre" });
  const view = render(
    <div style={{ width: 1000, height: 600 }}>
      <ProcessMap graph={graph} positions={positions} renderer={renderer} edgeBudget="all" locale={locale} defaultAbstraction={abstraction} />
    </div>,
  );
  await waitFor(() => expect(view.container.querySelector('[data-layout-status="given"]')).not.toBeNull());
  return view;
}

/** The accessible names of the buttons in an element, in order. */
const buttonNames = (element: HTMLElement) => within(element).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);

describe("one zoom control", () => {
  it.each(["svg", "canvas"] as const)("is the zoom control of the %s map, and React Flow's controls are not drawn", async (renderer) => {
    const { container } = await map(renderer);
    const controls = container.querySelectorAll<HTMLElement>('[data-wf-part="controls"]');
    expect(controls).toHaveLength(1);
    const group = screen.getByRole("group", { name: "Zoom" });
    expect(group).toBe(controls[0]);
    expect(group.classList.contains("wf-zoom")).toBe(true);
    expect(buttonNames(group)).toEqual(NAMES.en.buttons);
    // Icon buttons: the name is on the button, the icon is hidden.
    for (const button of within(group).getAllByRole("button")) {
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(container.querySelector('[class*="react-flow__controls"]')).toBeNull();
    // The current zoom, as a percentage, follows the buttons.
    const level = group.querySelector('[data-wf-part="zoom-level"]')!;
    const before = level.textContent;
    expect(before).toMatch(/^\d+ %$/);
    fireEvent.click(within(group).getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(level.textContent).not.toBe(before));
    expect(parseInt(level.textContent!)).toBeGreaterThan(parseInt(before!));
  });

  it("is the zoom control of the BPMN view, with its readable size", async () => {
    const viewers = memoryViewers({ fitZoom: 0.4 });
    const BpmnView = createBpmnView(viewers.connect);
    const { container } = render(<BpmnView xml={xml} />);
    const group = await waitFor(() => screen.getByRole("group", { name: "Model zoom controls" }));
    expect(group.classList.contains("wf-zoom")).toBe(true);
    expect(container.querySelectorAll('[data-wf-part="controls"]')).toHaveLength(1);
    expect(buttonNames(group)).toEqual(["Zoom in", "Zoom out", "Fit the whole model", "Readable size"]);
    // Fitted to 0.4.
    await waitFor(() => expect(group.querySelector('[data-wf-part="zoom-level"]')?.textContent).toBe("40 %"));
    fireEvent.click(within(group).getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(group.querySelector('[data-wf-part="zoom-level"]')?.textContent).toBe("50 %"));
  });

  it("fits the BPMN diagram inside the insets it is given", async () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    const viewers = memoryViewers();
    const BpmnView = createBpmnView(viewers.connect);
    const ref = createRef<BpmnViewHandle>();
    render(<BpmnView ref={ref} xml={xml} fitView={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Readable size" }).hasAttribute("disabled")).toBe(false));
    const viewer = viewers.instances[0];
    act(() => ref.current!.fit({ left: 300, bottom: 100 }));
    const box = viewer.viewboxes.at(-1)!;
    // The view box has the container's shape, and every shape lies right of 300 and above 500 on screen.
    expect(box.width / box.height).toBeCloseTo(1000 / 600);
    const scale = 1000 / box.width;
    for (const e of viewer.elements().filter((e) => !e.waypoints && e.x !== undefined && e.width)) {
      expect((e.x! - box.x) * scale).toBeGreaterThanOrEqual(300 - 1e-9);
      expect((e.y! + e.height! - box.y) * scale).toBeLessThanOrEqual(500 + 1e-9);
    }
    width.mockRestore();
    height.mockRestore();
  });
});

describe("the legend strip", () => {
  it.each(["en", "de"] as const)("names the measure and its unit, expands to the whole key and collapses again, and says so (%s)", async (locale) => {
    const names = NAMES[locale];
    const { container } = await map("svg", locale);
    const legend = container.querySelector<HTMLElement>('[data-wf-part="legend"]')!;
    // The default style draws paths by their cases: the measure is frequency, the unit cases.
    expect(legend.querySelector(".wf-legend__measure")?.textContent).toBe(locale === "de" ? "Häufigkeit · Fälle" : "Frequency · cases");
    expect(legend.querySelector("dl")).toBeNull();
    const toggle = within(legend).getByRole("button", { name: names.expand });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // A key on the toggle is the toggle's: the map does not take it.
    const enter = fireEvent.keyDown(toggle, { key: "Enter" });
    expect(enter).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(toggle);
    const collapse = within(legend).getByRole("button", { name: names.collapse });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(collapse.getAttribute("aria-controls")!)?.querySelector("dl")).not.toBeNull();
    expect(screen.getByTestId("wf-live").textContent).toBe(names.expanded);
    fireEvent.click(collapse);
    expect(legend.querySelector("dl")).toBeNull();
    expect(screen.getByTestId("wf-live").textContent).toBe(names.collapsed);
    // Every control of the map has a name in the locale.
    expect(buttonNames(screen.getByRole("group", { name: names.group }))).toEqual(names.buttons);
    for (const control of container.querySelectorAll<HTMLElement>(".wf-panel button, .wf-panel input")) {
      const label = control.getAttribute("aria-label") ?? (control.id ? container.querySelector(`label[for="${control.id}"]`)?.textContent : undefined) ?? control.closest("label")?.textContent ?? control.textContent;
      expect(label?.trim(), control.outerHTML).toBeTruthy();
    }
  });

  it("leaves the exports their whole key", async () => {
    const positions = await layout(graph, { engine: "dagre" });
    const { container } = await map("svg");
    const legend = container.querySelector<HTMLElement>('[data-wf-part="legend"]')!;
    // On screen the strip holds the measure only; the export writes the scales' titles and samples as well.
    expect(legend.textContent).not.toContain("Path width");
    const svg = toSVG({ graph, positions });
    // (The tests of the legend rows check that the exports write every row; here the strip and the export of one map.)
    for (const text of ["Frequency", "Path width"]) expect(svg).toContain(text);
  });

  it("opens in full when asked, and announces in its own live region without a map", () => {
    render(<Legend legend={{ title: "Legend", rows: [{ kind: "measure", text: "Frequency · cases" }, { kind: "key", key: "start", glyph: "○", text: "Start of the process" }], items: [], keys: [], chips: [] }} defaultExpanded />);
    const region = screen.getByRole("region", { name: "Legend" });
    expect(within(region).getByText("Start of the process")).toBeTruthy();
    fireEvent.click(within(region).getByRole("button", { name: "Show the legend as one line" }));
    expect(within(region).queryByText("Start of the process")).toBeNull();
    expect(region.querySelector("[aria-live]")?.textContent).toBe("The legend is shown as one line.");
  });
});

describe("the sliders' readouts", () => {
  it.each(["svg", "canvas"] as const)("say how many activities and paths the %s map shows, of how many", async (renderer) => {
    const { container } = await map(renderer, "en", { minNodeShare: 0.1, minEdgeShare: 0.2 });
    const outputs = [...container.querySelectorAll("output")].map((o) => o.textContent);
    expect(outputs).toEqual(["3 of 4", "2 of 4"]);
    const [nodes, edges] = container.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect(nodes.getAttribute("aria-valuetext")).toBe("10 %: 3 of 4 activities shown");
    expect(edges.getAttribute("aria-valuetext")).toBe("20 %: 2 of 4 paths shown");
    // The numbers of the graph the map draws.
    if (renderer === "svg") {
      expect([...container.querySelectorAll(".react-flow__node")].map((n) => n.getAttribute("data-id")).sort()).toEqual(["a", "b", "c"]);
      expect(container.querySelectorAll(".react-flow__edge")).toHaveLength(2);
    } else {
      expect(container.querySelector(".wf-process-map")?.getAttribute("aria-label")).toBe("Process map with 3 nodes and 2 connections in 0 groups.");
    }
    // Moving a slider changes what the map shows and the readout with it: at 0 % every activity and path.
    fireEvent.change(nodes, { target: { value: "0" } });
    fireEvent.change(edges, { target: { value: "0" } });
    await waitFor(() => expect([...container.querySelectorAll("output")].map((o) => o.textContent)).toEqual(["4 of 4", "4 of 4"]));
  });

  it("are in German too", async () => {
    const { container } = await map("svg", "de", { minNodeShare: 0.1, minEdgeShare: 0.2 });
    expect([...container.querySelectorAll("output")].map((o) => o.textContent)).toEqual(["3 von 4", "2 von 4"]);
    expect(container.querySelector('input[type="range"]')?.getAttribute("aria-valuetext")).toBe("10 %: 3 von 4 Aktivitäten gezeigt");
  });
});

describe("the map's own fit", () => {
  /** The flow box of each activity card: its position as React Flow places it and its size in the layout. */
  const cards = (container: HTMLElement, positions: Awaited<ReturnType<typeof layout>>) =>
    [...container.querySelectorAll<HTMLElement>(".react-flow__node")].flatMap((n) => {
      const box = positions.nodes[n.getAttribute("data-id")!];
      const m = n.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\)/);
      return box && m ? [{ x: Number(m[1]), y: Number(m[2]), width: box.width, height: box.height }] : [];
    });
  const viewport = (container: HTMLElement) => {
    const m = container.querySelector<HTMLElement>(".react-flow__viewport")!.style.transform.match(/translate\(([-\d.e]+)px,\s*([-\d.e]+)px\) scale\(([-\d.e]+)\)/)!;
    return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
  };

  it.each([true, false])("keeps every activity clear of a panel over the map (panel measured: %s)", async (measured) => {
    // jsdom lays nothing out, and React Flow measures its pane as 100 by 100 there: the map's area is given that box, the zoom
    // control's panel 30 wide down its whole left side, the other panels none.
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const rect = (width: number, height: number) => ({ left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains("wf-process-map__main")) return rect(100, 100);
      if (!this.classList.contains("react-flow__panel")) return original.call(this);
      return measured && this.querySelector('[data-wf-part="controls"]') ? rect(30, 100) : rect(0, 0);
    });
    const positions = await layout(graph, { engine: "dagre" });
    const { container } = render(
      <div style={{ width: 100, height: 100 }}>
        <ProcessMap graph={graph} positions={positions} edgeBudget="all" />
      </div>,
    );
    await waitFor(() => expect(container.querySelector('[data-layout-status="given"]')).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Fit the map" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    const v = viewport(container);
    const lefts = cards(container, positions).map((c) => c.x * v.zoom + v.x);
    expect(lefts).toHaveLength(4);
    // The panel ends at 30 and the map keeps a gap of 8 from it; without the panel the cards start further left.
    if (measured) expect(Math.min(...lefts)).toBeGreaterThanOrEqual(38 - 1e-6);
    else expect(Math.min(...lefts)).toBeLessThan(38);
  });
});
