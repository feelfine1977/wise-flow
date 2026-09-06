import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuAction } from "../../src/index";
import { ContextMenu } from "../../src/react/index";

afterEach(cleanup);

const actions: MenuAction[] = [
  { id: "filter-to", label: "Filter to cases with this activity", group: "filter", accelerator: "f" },
  { id: "exclude", label: "Exclude cases with this activity", group: "filter", accelerator: "x", disabled: true },
  { id: "paths", label: "Paths in and out", group: "explore", accelerator: "i" },
  { id: "pin", label: "Pin for comparison", group: "compare", accelerator: "p" },
];

describe("ContextMenu", () => {
  it("is a grouped menu with the first enabled entry focused", () => {
    const returnTo = document.createElement("button");
    document.body.appendChild(returnTo);
    render(<ContextMenu x={10} y={20} title="Actions for A" subtitle="activity (Stage 1)" note="Worst expectation: 23 % missing" actions={actions} onAction={() => {}} onClose={() => {}} returnFocusTo={returnTo} />);
    const menu = screen.getByRole("menu", { name: "Actions for A" });
    expect(menu).toBeTruthy();
    expect(screen.getByText("activity (Stage 1)")).toBeTruthy();
    expect(screen.getByText("Worst expectation: 23 % missing")).toBeTruthy();
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Filter", "Explore", "Compare"]);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(4);
    expect(items[1].getAttribute("aria-disabled")).toBe("true");
    expect(items[2].getAttribute("aria-keyshortcuts")).toBe("i");
    expect(document.activeElement).toBe(items[0]);
    returnTo.remove();
  });

  it("moves with the arrow keys over enabled entries, activates with Enter and accelerators, closes with Escape", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const returnTo = document.createElement("button");
    document.body.appendChild(returnTo);
    render(<ContextMenu x={0} y={0} title="Actions for A" actions={actions} onAction={onAction} onClose={onClose} returnFocusTo={returnTo} />);
    const menu = screen.getByRole("menu");
    const action = () => document.activeElement?.getAttribute("data-action");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(action()).toBe("paths");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(action()).toBe("pin");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(action()).toBe("filter-to");
    fireEvent.keyDown(menu, { key: "End" });
    expect(action()).toBe("pin");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(action()).toBe("paths");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(action()).toBe("filter-to");
    fireEvent.keyDown(menu, { key: "Enter" });
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ id: "filter-to" }));
    expect(document.activeElement).toBe(returnTo);
    fireEvent.keyDown(menu, { key: "p" });
    expect(onAction).toHaveBeenLastCalledWith(expect.objectContaining({ id: "pin" }));
    fireEvent.keyDown(menu, { key: "x" });
    expect(onAction).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(returnTo);
    returnTo.remove();
  });

  it("activates on click, ignores disabled entries and closes on a click outside", () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <ContextMenu x={0} y={0} title="Actions for A" actions={actions} onAction={onAction} onClose={onClose} locale="de" />
      </div>,
    );
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Filtern", "Erkunden", "Vergleichen"]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Exclude/ }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: /Pin/ }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: "pin" }));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
