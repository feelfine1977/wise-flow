import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Filter } from "../../src/index";
import { FilterChips } from "../../src/react/index";

afterEach(cleanup);

const filter: Filter = {
  and: [
    { kind: "activity", op: "contains", activity: "record_goods_receipt" },
    { kind: "time", mode: "events_inside", from: "2018-01-01", to: "2018-03-31" },
    { kind: "open", value: false },
  ],
};
const labelOf = (id: string) => (id === "record_goods_receipt" ? "Record Goods Receipt" : id);

describe("FilterChips", () => {
  it("renders one chip per clause in plain words with the preview numbers and marks clauses that change cases", () => {
    const { container } = render(<FilterChips filter={filter} preview={{ cases_in: 180000, cases_out: 71734, per_clause: [{ clause: 0, removed_marginally: 1200 }] }} labelOf={labelOf} />);
    expect(screen.getByRole("group", { name: "Filters" })).toBeTruthy();
    expect(screen.getByTestId("wf-filters-count").textContent).toBe("180,000 of 251,734 cases · 71,734 removed");
    const chips = container.querySelectorAll(".wf-filter-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain("cases with Record Goods Receipt");
    expect(chips[0].textContent).toContain("−1,200 by this filter alone");
    expect(chips[0].getAttribute("data-kind")).toBe("activity");
    expect(chips[1].getAttribute("data-changes-cases")).toBe("true");
    expect(chips[1].textContent).toContain("changes cases");
    expect(chips[2].textContent).toContain("closed cases only");
    // Read-only without a change handler: no remove buttons, no clear button.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("removes a chip with its button or the Delete key, clears all, and announces", () => {
    const onFilterChange = vi.fn();
    const onAnnounce = vi.fn();
    const { container } = render(<FilterChips filter={filter.and} labelOf={labelOf} onFilterChange={onFilterChange} onAnnounce={onAnnounce} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: closed cases only" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ and: filter.and.slice(0, 2) });
    expect(onAnnounce).toHaveBeenLastCalledWith("Filter removed: closed cases only.");
    fireEvent.keyDown(container.querySelectorAll(".wf-filter-chip")[0], { key: "Delete" });
    expect(onFilterChange).toHaveBeenLastCalledWith({ and: filter.and.slice(1) });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onFilterChange).toHaveBeenLastCalledWith({ and: [] });
    expect(onAnnounce).toHaveBeenLastCalledWith("Filters cleared.");
  });

  it("shows the empty state and German texts", () => {
    render(<FilterChips filter={[]} locale="de" onFilterChange={() => {}} />);
    expect(screen.getByText("Keine Filter.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Filter löschen/ })).toBeNull();
  });
});
