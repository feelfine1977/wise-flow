import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowGraph } from "../../src/index";
import { PathList } from "../../src/react/index";

afterEach(cleanup);

const g: FlowGraph = {
  nodes: [
    { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 80 } },
    { id: "c", kind: "activity", label: "C", metrics: { cases: 60 } },
    { id: "d", kind: "activity", label: "D", metrics: { cases: 40 } },
  ],
  edges: [
    { id: "a->c", kind: "follows", source: "a", target: "c", metrics: { count: 30, cases: 30, medianLagHours: 48, p90LagHours: 240, violationShare: 0.5 } },
    { id: "b->c", kind: "follows", source: "b", target: "c", metrics: { count: 60, cases: 60 } },
    { id: "c->d", kind: "follows", source: "c", target: "d", metrics: { count: 40, cases: 40, medianLagHours: 5 } },
    { id: "d->b", kind: "follows", source: "d", target: "b", metrics: { count: 4, cases: 4 } },
  ],
};

describe("PathList", () => {
  it("lists incoming and outgoing paths with numbers and totals, sorts by column and selects rows", () => {
    const onSelect = vi.fn();
    const onHover = vi.fn();
    const onClose = vi.fn();
    render(<PathList graph={g} focus="c" onSelect={onSelect} onHover={onHover} onClose={onClose} />);
    const section = screen.getByRole("region", { name: "Paths of C" });
    expect(section.getAttribute("data-source")).toBe("graph");
    expect(screen.getByText("numbers computed from the map at the current abstraction")).toBeTruthy();
    const [incoming, outgoing] = screen.getAllByRole("table");
    expect(within(incoming).getByText(/Incoming paths/).textContent).toContain("2 paths");
    const rows = within(incoming).getAllByRole("row");
    // header, two paths, total
    expect(rows).toHaveLength(4);
    expect(rows[1].textContent).toContain("B");
    expect(rows[1].textContent).toContain("60");
    expect(rows[1].textContent).toContain("100 %");
    expect(rows[2].textContent).toContain("2.0 d");
    expect(rows[2].textContent).toContain("50 %");
    expect(rows[3].textContent).toContain("Total");
    expect(rows[3].textContent).toContain("90");
    expect(within(outgoing).getAllByRole("row")[2].textContent).toContain("40");
    fireEvent.click(within(incoming).getByRole("button", { name: "From" }));
    expect(within(incoming).getAllByRole("row")[1].textContent).toContain("A");
    expect(within(incoming).getAllByRole("columnheader")[0].getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(within(incoming).getByRole("button", { name: "From" }));
    expect(within(incoming).getAllByRole("row")[1].textContent).toContain("B");
    const row = within(incoming).getAllByRole("row")[1];
    fireEvent.mouseEnter(row);
    expect(onHover).toHaveBeenCalledWith("b->c");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith({ nodes: [], edges: ["b->c"], groups: [] });
    fireEvent.click(screen.getByRole("button", { name: "Close the path list" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("reads the paths block of the response and marks the selected row", () => {
    render(<PathList graph={g} focus="c" paths={{ focus: "c", incoming: [{ from: "a", count: 35, cases: 33, median_lag: 50, violation_share: 0.4 }], outgoing: [] }} selection={{ nodes: [], edges: ["a->c"], groups: [] }} locale="de" />);
    const section = screen.getByRole("region", { name: "Pfade von C" });
    expect(section.getAttribute("data-source")).toBe("payload");
    expect(screen.getByText("Zahlen aus der Analyse (vollständiger Directly-follows-Graph)")).toBeTruthy();
    const [incoming, outgoing] = screen.getAllByRole("table");
    const row = within(incoming).getAllByRole("row")[1];
    expect(row.classList.contains("wf-row--selected")).toBe(true);
    expect(row.textContent).toContain("35");
    expect(row.textContent).toContain("55 %");
    expect(within(outgoing).getAllByRole("row")).toHaveLength(2);
  });

  it("shows the path between two activities and the reverse path", () => {
    render(<PathList graph={g} focus={["b", "d"]} />);
    const section = screen.getByRole("region", { name: "Path from B to D" });
    expect(section.getAttribute("data-found")).toBe("true");
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    expect(within(tables[0]).getByText(/Path B → D/)).toBeTruthy();
    expect(within(tables[0]).getAllByRole("row").map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("B → C"), expect.stringContaining("C → D")]));
    expect(within(tables[1]).getByText(/Reverse path D → B/)).toBeTruthy();
    expect(within(tables[1]).getAllByRole("row")[1].textContent).toContain("D → B");
    cleanup();
    render(<PathList graph={g} focus={["d", "a"]} />);
    expect(screen.getByRole("region", { name: "Path from D to A" }).getAttribute("data-found")).toBe("false");
    expect(screen.getByText("No path from D to A in this map.")).toBeTruthy();
  });
});
