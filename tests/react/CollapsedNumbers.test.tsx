import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, collapseGroups, createPositions } from "../../src/index";
import { PathList, ProcessMap, TableAlternative, describeNode } from "../../src/react/index";

afterEach(cleanup);

/** Case 1 does A then X, case 2 does B then X; A and B are in stage S. */
const twoCases: FlowGraph = {
  nodes: [
    { id: "A", kind: "activity", label: "A", group: "S", metrics: { cases: 1, share: 0.5, events: 1 } },
    { id: "B", kind: "activity", label: "B", group: "S", metrics: { cases: 1, share: 0.5, events: 1 } },
    { id: "X", kind: "activity", label: "X", metrics: { cases: 2, share: 1, events: 2 } },
  ],
  edges: [
    { id: "AX", kind: "follows", source: "A", target: "X", metrics: { count: 1, cases: 1, medianLagHours: 10 } },
    { id: "BX", kind: "follows", source: "B", target: "X", metrics: { count: 1, cases: 1, medianLagHours: 20 } },
  ],
  groups: [{ id: "S", kind: "stage", label: "S" }],
};
const collapsed = collapseGroups(twoCases, ["S"]);
const merged = collapsed.edges[0];
const positions = createPositions({ nodes: { S: { x: 0, y: 0, width: 200, height: 56 }, X: { x: 300, y: 0, width: 200, height: 56 } }, groups: {}, edges: {} }, "given", "RIGHT");

describe("a collapsed stage in the map and the table", () => {
  it("is described with at least, never as 1 cases (50 %), and a stage's own numbers plainly", () => {
    const stage = collapsed.nodes.find((n) => n.id === "S")!;
    expect(describeNode(stage, [], "en")).toContain("at least 1 cases (at least 50 %)");
    expect(describeNode(stage, [], "en")).not.toContain(", 1 cases (50 %)");
    expect(describeNode(stage, [], "de")).toContain("mindestens 1 Fälle (mindestens 50 %)");
    // Stage Invoice of the whole log: its most frequent activity has 211,379 of the 251,734 cases.
    const invoice = collapseGroups(globalScene, "all").nodes.find((n) => n.id === "invoice")!;
    expect(describeNode(invoice, [], "en")).toContain("at least 211,379 cases (at least 84 %)");
    expect(describeNode({ id: "order", kind: "stage", label: "Order", metrics: { cases: 900, share: 0.9 } }, [], "en")).toBe("Order, stage. 900 cases (90 %). No stage duration can be determined from activity statistics.");
  });

  it("is described with at least, and its merged path with a mean of medians", async () => {
    const { container } = render(
      <div style={{ width: 800, height: 400 }}>
        <ProcessMap graph={collapsed} positions={positions} renderer="svg" controls={false} fitView={false} contextMenu={false} pathList={false} />
      </div>,
    );
    const stage = await waitFor(() => {
      const found = container.querySelector("#wf-node-S");
      expect(found).not.toBeNull();
      return found!;
    });
    const label = stage.getAttribute("aria-label") ?? stage.closest("[aria-label]")?.getAttribute("aria-label") ?? "";
    expect(label).toContain("at least 1 cases (at least 50 %)");
    expect(label).not.toContain("1 cases (50 %)");
    // The card prints the bound compactly; its description says "at least".
    expect(stage.textContent).toContain("≥ 1");
    const title = container.querySelector(`g.wf-edge[data-id="${merged.id}"] title`)?.textContent ?? "";
    expect(title).toContain("lag, mean of medians 15 h");
    expect(title).not.toContain("median lag");
  });

  it("writes lower bounds and means in the table's cells", () => {
    render(<TableAlternative graph={collapsed} locale="en" />);
    // The activities' table first: its row of S.
    const row = (name: string) => [...screen.getAllByRole("rowheader", { name })[0].closest("tr")!.querySelectorAll("td")].map((td) => td.textContent);
    expect(row("S")).toEqual(expect.arrayContaining(["at least 1", "at least 50 %", "2"]));
    const edgeRow = [...screen.getAllByRole("row")].find((r) => r.querySelector("th")?.textContent === "S" && r.querySelector("td")?.textContent === "X")!;
    expect([...edgeRow.querySelectorAll("td")].map((td) => td.textContent)).toEqual(expect.arrayContaining(["2", "at least 1", "15 h (mean of medians)"]));
    cleanup();
    render(<TableAlternative graph={collapsed} locale="de" />);
    expect(row("S")).toEqual(expect.arrayContaining(["mindestens 1", "mindestens 50 %"]));
  });

  it("writes lower bounds and means in the path list's cells", () => {
    const { container } = render(<PathList graph={collapsed} focus="S" locale="en" />);
    const cells = [...container.querySelectorAll("td")].map((td) => td.textContent);
    // The merged path S → X: two transitions, at least one case, a mean of the medians 10 h and 20 h.
    expect(cells).toEqual(expect.arrayContaining(["2", "at least 1", "15 h (mean of medians)"]));
    expect(cells).not.toContain("15 h");
  });
});
