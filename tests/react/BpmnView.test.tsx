import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { p2pStages } from "../../fixtures/p2p_stages";
import { liteFromStages } from "../../src/bpmn/index";
import { BpmnView, ViewSwitcher } from "../../src/react/index";
import { abstract, layout, resolveViews } from "../../src/index";

afterEach(cleanup);

const xml = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures/p2p_small.bpmn"), "utf8");

// jsdom has no SVG geometry, so bpmn-js cannot render here; the headless
// import, the table alternative, the ARIA description and the controls are
// what these tests cover. Rendering is checked in Storybook and Playwright.
describe("BpmnView", () => {
  it("imports the XML headlessly, describes the diagram and lists it as tables", async () => {
    // onImport waits for the viewer, which cannot show the diagram here; the seam's tests cover it.
    const onError = vi.fn();
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <BpmnView xml={xml} view="table" onError={onError} mapping={{ create_purchase_order_item: "Task_CreatePO" }} />
      </div>,
    );
    await waitFor(() => expect(screen.getAllByRole("table").length).toBe(3));
    const group = container.querySelector(".wf-bpmn") as HTMLElement;
    expect(group.getAttribute("aria-label")).toBe("BPMN diagram with 7 tasks, 3 gateways and 13 sequence flows in 3 lanes.");
    // The mapped task appears under its activity id in the table.
    expect(container.textContent).toContain("Create Purchase Order Item");
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows.some((r) => r.textContent?.includes("Purchasing"))).toBe(true);
    expect(screen.getByRole("button", { name: "Diagram view" })).toBeTruthy();
  });

  it("exports a BPMN-lite graph on the fly and offers the table toggle", async () => {
    const lite = liteFromStages(p2pStages);
    const onViewChange = vi.fn();
    render(
      <div style={{ width: 1200, height: 800 }}>
        <BpmnView graph={lite} layout={{ engine: "dagre" }} view="diagram" onViewChange={onViewChange} onError={() => {}} />
      </div>,
    );
    const toggle = await screen.findByRole("button", { name: "Table view" });
    fireEvent.click(toggle);
    expect(onViewChange).toHaveBeenCalledWith("table");
  });
});

/** The legends of the grid open as strips; their toggles expand them to the whole key. */
function expandLegends(container: HTMLElement) {
  for (const legend of container.querySelectorAll<HTMLElement>(".wf-views__legend")) fireEvent.click(within(legend).getByRole("button", { name: "Show the whole legend" }));
}

describe("ViewSwitcher", () => {
  it("renders tabs for every view and the same positions in the grid", async () => {
    const base = abstract(globalScene, { minNodeShare: 0.05, minEdgeShare: 0.1 });
    const positions = await layout(base, { engine: "dagre" });
    const set = resolveViews(
      base,
      [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta", style: { edgeWidth: { metric: "count" }, edgeColor: { metric: "medianLagHours", palette: "sequentialBlue" } } },
      ],
      positions,
    );
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ViewSwitcher views={set} />
      </div>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Alpha", "Beta"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All views" }));
    await waitFor(() => expect(container.querySelectorAll(".wf-views__cell").length).toBe(2));
    const nodeBoxes = (cell: Element) =>
      Array.from(cell.querySelectorAll<HTMLElement>(".react-flow__node")).map((n) => `${n.getAttribute("data-id")}:${n.style.transform}`).sort();
    const cells = container.querySelectorAll(".wf-views__cell");
    await waitFor(() => expect(nodeBoxes(cells[0]).length).toBeGreaterThan(0));
    expect(nodeBoxes(cells[0])).toEqual(nodeBoxes(cells[1]));
  });

  it("gives each distinct style of the grid the legend of what its views' maps draw", async () => {
    const base = abstract(globalScene, { minNodeShare: 0.05, minEdgeShare: 0.1 });
    const positions = await layout(base, { engine: "dagre" });
    const set = resolveViews(base, [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta", style: { edgeWidth: { metric: "count" } } }], positions);
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ViewSwitcher views={set} mode="grid" />
      </div>,
    );
    // Without overlays the maps draw the follows self-loops, the re-added paths and the start and end events, and nothing
    // else the legend explains.
    const loops = base.edges.some((e) => e.kind === "follows" && e.source === e.target);
    const readded = base.edges.some((e) => e.tags?.includes("reconnected"));
    expect(loops || readded).toBe(true);
    expect(base.nodes.filter((n) => n.kind === "event").map((n) => n.tags)).toEqual([["start"], ["end"]]);
    const keys = [...(loops ? ["↻"] : []), ...(readded ? ["┄"] : []), "─", "▶", "■"];
    await waitFor(() => expect(container.querySelectorAll(".wf-views__legend").length).toBe(2));
    expandLegends(container);
    for (const legend of container.querySelectorAll(".wf-views__legend")) {
      expect([...legend.querySelectorAll(".wf-legend__glyph")].map((g) => g.textContent)).toEqual(keys);
    }
    // The default style colours the paths by their shortfall; the second style only sets their width.
    expect([...container.querySelectorAll(".wf-views__legend")].map((l) => l.querySelectorAll(".wf-legend__gradient").length)).toEqual([1, 0]);
  });

  it("keys in a style's one legend what any of its views' maps draws", async () => {
    const base = abstract(globalScene, { minNodeShare: 0.05, minEdgeShare: 0.1 });
    const positions = await layout(base, { engine: "dagre" });
    const target = base.nodes.find((n) => n.kind === "activity")!.id;
    // Same style; only the second view draws a badge.
    const set = resolveViews(base, [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta", overlays: [{ kind: "badge", target, payload: { glyph: "●", value: 0.2 } }] }], positions);
    const { container } = render(
      <div style={{ width: 1200, height: 800 }}>
        <ViewSwitcher views={set} mode="grid" />
      </div>,
    );
    await waitFor(() => expect(container.querySelectorAll(".wf-views__legend").length).toBe(1));
    expandLegends(container);
    const glyphs = [...container.querySelectorAll(".wf-views__legend .wf-legend__glyph")].map((g) => g.textContent);
    expect(glyphs.filter((g) => g === "●")).toEqual(["●"]);
  });
});
