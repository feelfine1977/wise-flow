import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TraceTimeline, eventClusters } from "../../src/react/TraceTimeline.js";

const at = (iso: string) => Date.parse(iso);
// One case: created, seven SRM events in the same minute, then two more events days later.
const trace = {
  caseId: "4507",
  events: [
    { activity: "Create PO", timestamp: at("2018-03-01T08:00:00Z") },
    ...Array.from({ length: 7 }, (_, i) => ({ activity: "SRM: Created", timestamp: at(`2018-03-01T14:12:${String(i * 5).padStart(2, "0")}Z`) })),
    { activity: "Record Goods Receipt", timestamp: at("2018-03-10T09:00:00Z") },
    { activity: "Clear Invoice", timestamp: at("2018-04-20T09:00:00Z") },
  ],
};

describe("eventClusters", () => {
  it("groups the events that follow within the window of the first of them, in their order", () => {
    expect(eventClusters([0, 10, 70, 80, 200], 60)).toEqual([[0, 1], [2, 3], [4]]);
    expect(eventClusters([0, 10], undefined)).toEqual([[0], [1]]);
    expect(eventClusters([0, Number.NaN, 5], 60)).toEqual([[0], [1], [2]]);
  });
});

describe("TraceTimeline, vertical", () => {
  it("draws one ring for the events of the same minute, labelled with their count and the first activity", () => {
    const { container } = render(<TraceTimeline traces={[trace]} orientation="vertical" clusterMs={60000} />);
    expect(container.querySelectorAll(".wf-event--ring")).toHaveLength(4);
    const cluster = container.querySelector('[data-wf-part="timeline-cluster"]')!;
    expect(cluster.textContent).toContain("7 events · SRM: Created");
    expect(container.querySelectorAll('[data-wf-part="timeline-cluster"]')).toHaveLength(1);
  });

  it("moves a ring down where it would touch the one before it, keeping their order", () => {
    const { container } = render(<TraceTimeline traces={[trace]} orientation="vertical" clusterMs={60000} />);
    const ys = [...container.querySelectorAll(".wf-event--ring")].map((c) => Number(c.getAttribute("cy")));
    ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBeGreaterThanOrEqual(20));
  });

  it("ticks in days from the first event over a long case, in hours over a short one", () => {
    const long = render(<TraceTimeline traces={[trace]} orientation="vertical" />);
    expect(long.container.querySelector(".wf-axis text")!.textContent).toBe("0 days");
    long.unmount();
    const short = render(<TraceTimeline traces={[{ caseId: "s", events: trace.events.slice(0, 8) }]} orientation="vertical" />);
    expect(short.container.querySelector(".wf-axis text")!.textContent).toBe("0 hours");
  });

  it("draws Start and End rings at the ends of the case's line", () => {
    const { container } = render(<TraceTimeline traces={[trace]} orientation="vertical" terminals locale="de" />);
    expect(container.querySelector(".wf-terminal--start")!.textContent).toContain("Beginn");
    expect(container.querySelector(".wf-terminal--end")!.textContent).toContain("■");
  });

  it("prints the times in the zone given and names it", () => {
    render(<TraceTimeline traces={[trace]} orientation="vertical" timeZone="Europe/Berlin" table />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("2018-03-01 09:00")).toBeTruthy();
    expect(table.querySelector("caption")!.textContent).toContain("Times in Europe/Berlin.");
    // Elapsed and wait before, in days.
    expect(within(table).getByText("Elapsed (days)")).toBeTruthy();
  });

  it("keeps UTC for a zone the runtime does not know", () => {
    render(<TraceTimeline traces={[trace]} timeZone="Nowhere/Else" table />);
    expect(screen.getByText("2018-03-01 08:00")).toBeTruthy();
  });

  it("colours the stages in their order and an event of no stage in the strong line colour", () => {
    const stageOf = (e: { activity: string }) => (e.activity.startsWith("SRM") ? "srm" : e.activity === "Create PO" ? "po" : "other");
    const { container } = render(<TraceTimeline traces={[trace]} orientation="vertical" clusterMs={60000} colorKey={stageOf} stages={["po", "srm"]} />);
    const dots = [...container.querySelectorAll(".wf-event-dot")].map((d) => d.getAttribute("fill"));
    expect(new Set(dots.slice(0, 2)).size).toBe(2);
    expect(dots[2]).toBe(dots[3]);
  });
});
