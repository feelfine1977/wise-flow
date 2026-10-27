import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceTimeline, type Trace, type TraceEvent } from "../../src/react/index";

afterEach(cleanup);

const traces: Trace[] = [
  {
    caseId: "case-a",
    events: [
      { activity: "Submit", timestamp: "2026-01-01T10:00:00+02:00" },
      { activity: "Approve", timestamp: "2026-01-02T12:00:00Z", violates: ["deadline"] },
    ],
  },
  {
    caseId: "case-b",
    events: [
      { activity: "Open", timestamp: "2026-01-02T00:00:00Z" },
      { activity: "Review", timestamp: "2026-01-03T00:00:00Z" },
    ],
  },
];

function eventAt(container: HTMLElement, index: number) {
  const event = container.querySelectorAll<SVGCircleElement>(".wf-event")[index];
  expect(event).toBeDefined();
  return event;
}

describe("TraceTimeline", () => {
  it("falls back for invalid explicit colours and gives valid colours precedence over a custom key", () => {
    const data: Trace[] = [{ caseId: "c", events: [
      { activity: "First", timestamp: 0 }, { activity: "Second", timestamp: 3600000, violates: ["rule"] },
      { activity: "Third", timestamp: 7200000 },
    ] }];
    const props = { traces: data, colorKey: () => "known", stages: ["known"] };
    const { container, rerender } = render(<TraceTimeline {...props} />);
    const fills = () => [...container.querySelectorAll(".wf-event")].map((dot) => dot.getAttribute("fill"));
    const baseline = fills();
    rerender(<TraceTimeline {...props} eventColor={(event) => event.activity === "First" ? "" : event.activity === "Second" ? "#f0f0f0" : "var(--unsafe)"} />);
    expect(fills()).toEqual([baseline[0], "#f0f0f0", baseline[2]]);
    expect(container.querySelectorAll(".wf-event--explicit")).toHaveLength(1);
    expect(container.querySelector(".wf-event--violates")?.parentElement?.textContent).toContain("!");
    expect(container.querySelector(".wf-event--violates")?.parentElement?.querySelector("text")?.getAttribute("fill")).toBe("#000000");
    rerender(<TraceTimeline traces={data} eventColor={() => undefined} />);
    const defaultFills = fills();
    rerender(<TraceTimeline traces={data} />);
    expect(fills()).toEqual(defaultFills);
  });

  it.each(["window", "minute"] as const)("a %s cluster marks mixed colours and later violations, and selects its first event", (clusterBy) => {
    const data: Trace[] = [{ caseId: "c", events: [
      { activity: "First", timestamp: "2026-01-01T00:00:00Z" },
      { activity: "Second", timestamp: "2026-01-01T00:00:20Z", violates: ["deadline"] },
    ] }];
    const onSelect = vi.fn();
    const { container } = render(<TraceTimeline traces={data} orientation="vertical" clusterBy={clusterBy} clusterMs={60000} eventColor={(e) => e.activity === "First" ? "#112233" : "#aabbcc"} onSelect={onSelect} />);
    expect(container.querySelectorAll(".wf-event-dot")).toHaveLength(1);
    expect(container.querySelector(".wf-event-dot")?.getAttribute("fill")).toBe("var(--wf-line-strong)");
    expect(container.textContent).toContain("2 events · First · mixed colours");
    expect(container.querySelector(".wf-event--ring")?.getAttribute("aria-label")).toContain("deadline");
    fireEvent.mouseEnter(container.querySelector(".wf-event--ring")!);
    expect(screen.getByRole("status").textContent).toContain("deadline");
    fireEvent.click(container.querySelector(".wf-event--ring")!);
    expect(onSelect).toHaveBeenCalledWith("c", 0);
  });

  it("an all-undefined colour callback leaves a mixed-stage cluster unchanged", () => {
    const data: Trace[] = [{ caseId: "c", events: [
      { activity: "First", canonicalId: "a", timestamp: "2026-01-01T00:00:00Z" },
      { activity: "Second", canonicalId: "b", timestamp: "2026-01-01T00:00:20Z" },
    ] }];
    const props = { traces: data, orientation: "vertical" as const, clusterBy: "minute" as const, stages: ["a", "b"] };
    const { container, rerender } = render(<TraceTimeline {...props} />);
    const initial = container.querySelector(".wf-event-dot")?.getAttribute("fill");
    rerender(<TraceTimeline {...props} eventColor={() => undefined} />);
    expect(container.querySelector(".wf-event-dot")?.getAttribute("fill")).toBe(initial);
    expect(container.textContent).not.toContain("mixed colours");
  });

  it("updates a vertical tooltip when a cluster changes and keeps it on equivalent parent renders", () => {
    const data: Trace[] = [{ caseId: "c", events: [
      { activity: "First", timestamp: "2026-01-01T00:00:00Z" },
      { activity: "Second", timestamp: "2026-01-01T00:00:20Z" },
    ] }];
    const mixed = (e: TraceEvent) => e.activity === "First" ? "#112233" : "#aabbcc";
    const same = () => "#112233";
    const props = { traces: data, orientation: "vertical" as const, clusterBy: "minute" as const };
    const { container, rerender } = render(<TraceTimeline {...props} eventColor={mixed} />);
    fireEvent.mouseEnter(container.querySelector(".wf-event--ring")!);
    expect(screen.getByRole("status").textContent).toContain("mixed colours");
    rerender(<TraceTimeline {...props} eventColor={same} />);
    expect(screen.getByRole("status").textContent).not.toContain("mixed colours");
    rerender(<TraceTimeline {...props} eventColor={() => "#112233"} />);
    expect(screen.getByRole("status").textContent).toContain("First");
    rerender(<TraceTimeline {...props} eventColor={same} clusterBy="window" />);
    expect(screen.getByRole("status").textContent).not.toContain("2 events");
    fireEvent.mouseEnter(container.querySelectorAll(".wf-event--ring")[1]);
    expect(screen.getByRole("status").textContent).toContain("Second");
    rerender(<TraceTimeline {...props} eventColor={same} />);
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<TraceTimeline {...props} eventColor={same} clusterBy="window" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it.each(["horizontal", "vertical"] as const)("uses explicit event colours in the %s timeline while leaving unknown events at their default", (orientation) => {
    const colors = ["#112233", "#223344", "#334455", "#445566", "#556677", "#667788", "#778899", "#8899aa"];
    const events = colors.map((_, i) => ({ activity: "Same activity", canonicalId: `stage-${i}`, timestamp: Date.UTC(2026, 0, 1, i) }));
    const cases = [{ caseId: "c1", events: [...events, { activity: "Unmapped", timestamp: Date.UTC(2026, 0, 2) }] }];
    const { container, rerender } = render(<TraceTimeline traces={cases} orientation={orientation} stages={events.map((e) => e.canonicalId)} />);
    const selector = orientation === "vertical" ? ".wf-event-dot" : ".wf-event";
    const before = [...container.querySelectorAll(selector)].map((e) => e.getAttribute("fill"));
    rerender(<TraceTimeline traces={cases} orientation={orientation} stages={events.map((e) => e.canonicalId)} eventColor={(event) => colors[events.findIndex((e) => e.canonicalId === event.canonicalId)]} />);
    const after = [...container.querySelectorAll(selector)].map((e) => e.getAttribute("fill"));
    expect(after.slice(0, colors.length)).toEqual(colors);
    expect(after.at(-1)).toBe(before.at(-1));
    expect(container.querySelectorAll(orientation === "vertical" ? ".wf-event-dot--explicit" : ".wf-event--explicit")).toHaveLength(colors.length);
  });
  it("renders an empty cohort and shows event times in UTC on hover", () => {
    const { container, rerender } = render(<TraceTimeline traces={[]} />);
    expect(screen.getByRole("img").textContent).toContain("0");
    expect(container.querySelectorAll(".wf-event")).toHaveLength(0);

    rerender(<TraceTimeline traces={traces} />);
    fireEvent.mouseEnter(eventAt(container, 0));
    expect(screen.getByRole("status").textContent).toBe("Submit\n2026-01-01 08:00");
    fireEvent.mouseEnter(eventAt(container, 1));
    expect(screen.getByRole("status").textContent).toContain("deadline");
    fireEvent.mouseLeave(eventAt(container, 1));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each<{ change: string; next: Trace[] }>([
    { change: "the entire cohort is removed", next: [] },
    { change: "the hovered case is removed", next: [traces[1]] },
    { change: "the event list is shortened", next: [{ ...traces[0], events: [traces[0].events[0]] }, traces[1]] },
    { change: "the event at the same index is replaced", next: [{ ...traces[0], events: [traces[0].events[0], { activity: "Reject", timestamp: "2026-01-04" }] }] },
    { change: "events are reordered", next: [{ ...traces[0], events: [...traces[0].events].reverse() }] },
  ])("clears hover when $change", ({ next }) => {
    const { container, rerender } = render(<TraceTimeline traces={traces} />);
    fireEvent.mouseEnter(eventAt(container, 1));
    expect(screen.getByRole("status").textContent).toContain("Approve");

    rerender(<TraceTimeline traces={next} />);
    expect(screen.queryByRole("status")).toBeNull();
    // A subsequent cohort must not resurrect the old hover.
    rerender(<TraceTimeline traces={traces} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retains a valid hovered event when another case is removed and uses its current row", () => {
    const { container, rerender } = render(<TraceTimeline traces={traces} />);
    fireEvent.mouseEnter(eventAt(container, 3));
    const before = parseFloat(screen.getByRole("status").style.top);

    rerender(<TraceTimeline traces={[traces[1]]} />);
    expect(screen.getByRole("status").textContent).toContain("Review");
    expect(parseFloat(screen.getByRole("status").style.top)).toBeLessThan(before);
  });

  it("selects the replacement event using the current case and index", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(<TraceTimeline traces={traces} onSelect={onSelect} />);
    fireEvent.mouseEnter(eventAt(container, 1));
    const replacement: Trace[] = [{ ...traces[0], events: [traces[0].events[0], { activity: "Reject", timestamp: "2026-01-04" }] }];

    rerender(<TraceTimeline traces={replacement} onSelect={onSelect} />);
    expect(screen.queryByRole("status")).toBeNull();
    const event = screen.getByRole("button", { name: /case-a: Reject/ });
    fireEvent.mouseEnter(event);
    expect(screen.getByRole("status").textContent).toBe("Reject\n2026-01-04 00:00");
    fireEvent.click(event);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("case-a", 1);
  });

  it.each<{ label: string; timestamp: TraceEvent["timestamp"] }>([
    { label: "malformed string", timestamp: "not-a-date" },
    { label: "invalid Date", timestamp: new Date(NaN) },
    { label: "NaN", timestamp: NaN },
    { label: "infinite number", timestamp: Infinity },
    { label: "out-of-range number", timestamp: 1e20 },
  ])("keeps a $label in the table without inventing a plotted timestamp", ({ timestamp }) => {
    const invalid: Trace[] = [{ caseId: "case-invalid", events: [{ activity: "Undated", timestamp }] }];
    const { container, rerender } = render(<TraceTimeline traces={invalid} />);
    expect(container.querySelectorAll(".wf-event")).toHaveLength(0);
    expect(screen.getByText(/1 events have no usable timestamp/)).toBeTruthy();
    expect(container.querySelectorAll(".wf-axis text")).toHaveLength(0);

    rerender(<TraceTimeline traces={invalid} table />);
    expect(within(screen.getByRole("table")).getByRole("cell", { name: "–" })).toBeTruthy();
  });

  it("aligns valid events when an anchor timestamp is invalid", () => {
    const mixed: Trace[] = [{ caseId: "case-mixed", events: [{ activity: "Start", timestamp: "invalid" }, ...traces[0].events] }];
    const { container } = render(<TraceTimeline traces={mixed} anchor="Start" />);
    expect(container.querySelectorAll(".wf-event")).toHaveLength(2);
    const start = Number(eventAt(container, 0).getAttribute("cx"));
    const end = Number(eventAt(container, 1).getAttribute("cx"));
    expect(Number.isFinite(start)).toBe(true);
    expect(end).toBeGreaterThan(start);
  });

  it.each([false, true])("selects the same event by pointer, Enter and Space (table=%s)", (table) => {
    const onSelect = vi.fn();
    render(<TraceTimeline traces={traces} onSelect={onSelect} table={table} />);
    const event = table ? screen.getByText("Review").closest("tr")! : screen.getByRole("button", { name: /case-b: Review/ });
    expect(event.getAttribute("tabindex")).toBe("0");

    fireEvent.click(event);
    fireEvent.focus(event);
    expect(fireEvent.keyDown(event, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(event, { key: " " })).toBe(false);
    fireEvent.keyDown(event, { key: "ArrowRight" });
    expect(onSelect.mock.calls).toEqual([["case-b", 1], ["case-b", 1], ["case-b", 1]]);
    if (!table) {
      expect(screen.getByRole("status").textContent).toContain("Review");
      fireEvent.blur(event);
      expect(screen.queryByRole("status")).toBeNull();
    }
  });

  it.each([false, true])("does not add tab stops without a selection action (table=%s)", (table) => {
    const { container } = render(<TraceTimeline traces={traces} table={table} />);
    expect(container.querySelector('[tabindex="0"]')).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
