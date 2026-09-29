import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VariantMatrix } from "../../src/react/index";

afterEach(cleanup);
const rows = [{ id: "repeat", activities: ["Create", "Receive", "Receive", null], count: 3 }, { id: "short", activities: ["Create", "Clear"], count: 1 }];
it("retains repeated and missing activities, exact counts, and the whole selected population denominator", () => {
  const {container} = render(<VariantMatrix rows={rows} totalCases={10} zeroEventCases={2} maxSteps={2} />);
  expect(screen.getByText(/6 outside the displayed paths/).textContent).toContain("2 without events");
  expect(screen.getByText(/Only the first 2 positions/)).toBeTruthy();
  expect(screen.getByText("Create → Receive → Receive → Missing activity")).toBeTruthy();
  expect(container.textContent).toContain("30.0%");
  expect(container.querySelectorAll('svg [data-variant-id]')).toHaveLength(2);
});
it("uses one keyboard tab stop and inspects the exact requested path without selecting a cohort", () => {
  const inspect = vi.fn(); const {container} = render(<VariantMatrix rows={rows} totalCases={4} onInspect={inspect} selectedId="repeat" />);
  const paths = container.querySelectorAll<SVGGElement>('[data-variant-id]');
  expect(paths[0].getAttribute('tabindex')).toBe('0'); expect(paths[1].getAttribute('tabindex')).toBe('-1');
  expect(paths[0].getAttribute('aria-pressed')).toBe('true');
  paths[0].focus(); fireEvent.keyDown(paths[0], {key:'End'}); expect(document.activeElement).toBe(paths[1]);
  fireEvent.keyDown(paths[1], {key:' '}); expect(inspect).toHaveBeenCalledExactlyOnceWith('short');
  fireEvent.keyDown(paths[1], {key:' ', repeat:true}); expect(inspect).toHaveBeenCalledTimes(1);
});
it("rejects inconsistent support and remains finite for an invalid display limit", () => {
  const ui = render(<VariantMatrix rows={rows} totalCases={3} />);
  expect(screen.getByRole('status').textContent).toContain('do not reconcile');
  ui.rerender(<VariantMatrix rows={rows} totalCases={4} zeroEventCases={1} />);
  expect(screen.getByRole('status')).toBeTruthy();
  ui.rerender(<VariantMatrix rows={rows} totalCases={4} maxSteps={NaN} />);
  expect(ui.container.innerHTML).not.toMatch(/NaN|Infinity/);
  ui.rerender(<VariantMatrix rows={[]} totalCases={0} />);
  expect(ui.container.innerHTML).not.toMatch(/NaN|Infinity/);
});
