import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, type Locale, type Overlay, type Positions, layout, strings } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Fourteen activities with 100, 90, 80, 70, 60, 60, 50, … 2 cases (as many events): "A5" and "A6" tie. Each is
 * entered from the start and left to the end with its cases, and a path of 1 leads from each to the next: 41 paths.
 * The activity slider stands at 1, 2, 3, 4, 6, 7, … 14 activities, the paths slider at 0 to 41 paths.
 */
const CASES = [100, 90, 80, 70, 60, 60, 50, 40, 30, 20, 15, 10, 5, 2];
const TOTAL = CASES.reduce((a, b) => a + b, 0); // 632
const ids = CASES.map((_, i) => `a${i + 1}`);
const ladder: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    ...ids.map((id, i) => ({ id, kind: "activity" as const, label: `A${i + 1}`, metrics: { cases: CASES[i], events: CASES[i] } })),
    { id: "end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    ...ids.map((id, i) => ({ id: `start->${id}`, kind: "follows" as const, source: "start", target: id, metrics: { count: CASES[i] } })),
    ...ids.map((id, i) => ({ id: `${id}->end`, kind: "follows" as const, source: id, target: "end", metrics: { count: CASES[i] } })),
    ...ids.slice(1).map((id, i) => ({ id: `${ids[i]}->${id}`, kind: "follows" as const, source: ids[i], target: id, metrics: { count: 1 } })),
  ],
};
let ladderPositions: Positions | undefined;
const positionsOf = async () => (ladderPositions ??= await layout(ladder, { engine: "dagre" }));

const slider = (name: string) => screen.getByRole("slider", { name }) as HTMLInputElement;
const drawnActivities = (container: HTMLElement) => [...container.querySelectorAll(".react-flow__node")].filter((n) => n.getAttribute("data-id")?.startsWith("a")).length;
const drawnPaths = (container: HTMLElement) => container.querySelectorAll("g.wf-edge").length;
const live = (container: HTMLElement) => container.querySelector('[data-testid="wf-live"]')!;

async function ladderMap(props: Partial<Parameters<typeof ProcessMap>[0]> = {}) {
  const positions = await positionsOf();
  const view = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={ladder} positions={positions} edgeBudget="all" legend={false} fitView={false} {...props} />
    </div>,
  );
  await waitFor(() => expect(view.container.querySelectorAll(".react-flow__node").length).toBeGreaterThan(0));
  return view;
}

const NAMES: Record<Locale, { panel: string; activities: string; paths: string; ends: string[] }> = {
  en: { panel: "Detail", activities: "Activities", paths: "Paths", ends: ["Most frequent", "All", "Fewest paths", "All paths"] },
  de: { panel: "Detailgrad", activities: "Aktivitäten", paths: "Pfade", ends: ["Häufigste", "Alle", "Wenigste Pfade", "Alle Pfade"] },
};

describe("the detail panel", () => {
  it.each(["en", "de"] as const)("has two sliders with their named ends and no keep-connected control (%s)", async (locale) => {
    await ladderMap({ locale });
    const names = NAMES[locale];
    const panel = screen.getByRole("form", { name: names.panel });
    expect(within(panel).getByRole("heading").textContent).toBe(names.panel);
    expect(within(panel).getAllByRole("slider").map((s) => s.id)).toEqual([slider(names.activities).id, slider(names.paths).id]);
    expect([...panel.querySelectorAll(".wf-controls__ends span")].map((s) => s.textContent)).toEqual(names.ends);
    expect(within(panel).queryByRole("checkbox")).toBeNull();
    expect(panel.textContent).not.toMatch(/connected|zusammenhängend/i);
    // No text of the library calls a part of the map its backbone or main flow.
    for (const text of Object.values(strings[locale])) expect(text).not.toMatch(/backbone|main flow|Rückgrat|Hauptfluss/i);
  });

  it("says what is shown beside each slider: the short form as its value, the full form as its title and description", async () => {
    await ladderMap({ defaultAbstraction: { activityDetail: 3 / 14, pathDetail: 2 / 41 } });
    // Three activities with 270 of 632 events; the two strongest paths (A1's, 100 each) by frequency, and A2's and A3's
    // from the start and to the end kept. The strongest path not shown (A4's, 70) is weaker than every path shown (80).
    const activities = slider("Activities");
    const paths = slider("Paths");
    expect(activities.getAttribute("aria-valuetext")).toBe("3 of 14 · 42.7 % of events");
    expect(paths.getAttribute("aria-valuetext")).toBe("6 of 41 · 4 kept");
    const full = (input: HTMLElement) => document.getElementById(input.getAttribute("aria-describedby")!)!.textContent;
    expect(full(activities)).toBe("3 of 14 activities shown, carrying 42.7 % of the events; the 11 rarest are not shown.");
    expect(full(paths)).toBe("6 of 41 paths: 2 by frequency, 4 kept so that every activity lies on a way from start to end. Strongest path not shown: 70.");
    expect(document.querySelector(".wf-controls__statement--paths")!.getAttribute("title")).toBe(full(paths));
    expect([activities.min, activities.max, activities.value, paths.min, paths.max, paths.value]).toEqual(["1", "14", "3", "0", "41", "2"]);
  });

  it("moves Activities one rank per arrow key, a tie whole and ten with Page Up and Down, leaves Paths in place and says its statement", async () => {
    const onAbstractionChange = vi.fn();
    const { container } = await ladderMap({ onAbstractionChange });
    const activities = slider("Activities");
    const paths = slider("Paths");
    // The map shows everything: the sliders stand at the right ends.
    expect([activities.value, paths.value]).toEqual(["14", "41"]);
    expect(activities.getAttribute("aria-valuetext")).toBe("14 of 14 · 100.0 % of events");
    let before = { activities: drawnActivities(container), paths: drawnPaths(container) };
    expect(before).toEqual({ activities: 14, paths: 41 });
    fireEvent.keyDown(activities, { key: "ArrowLeft" });
    expect(onAbstractionChange).toHaveBeenLastCalledWith({ activityDetail: 13 / 14, pathDetail: 1 });
    // A14 (2 events) goes with its three paths; the strongest of them (2) is stronger than the paths of 1 still shown.
    await waitFor(() => expect(activities.value).toBe("13"));
    expect(activities.getAttribute("aria-valuetext")).toBe("13 of 14 · 99.7 % of events");
    expect(paths.value).toBe("41");
    expect(paths.getAttribute("aria-valuetext")).toBe("38 of 41 · strongest not shown: 2");
    await waitFor(() => expect(live(container).textContent).toBe("38 of 41 paths: 38 by frequency. Strongest path not shown: 2."));
    expect(live(container).getAttribute("aria-live")).toBe("polite");
    // At each step to the left fewer activities and fewer paths are drawn; A5 and A6 leave together. With every path,
    // k activities draw 3k - 1 paths: k from the start, k to the end, k - 1 from one to the next.
    const steps: string[] = [];
    for (let i = 0; i < 9; i++) {
      const k = Number(activities.value);
      await waitFor(() => expect({ activities: drawnActivities(container), paths: drawnPaths(container) }).toEqual({ activities: k, paths: 3 * k - 1 }));
      const now = { activities: drawnActivities(container), paths: drawnPaths(container) };
      if (i) {
        expect(now.activities).toBeLessThan(before.activities);
        expect(now.paths).toBeLessThan(before.paths);
      }
      before = now;
      steps.push(activities.value);
      fireEvent.keyDown(activities, { key: "ArrowLeft" });
      await waitFor(() => expect(activities.value).not.toBe(steps.at(-1)));
      expect(paths.value).toBe("41");
    }
    expect(steps).toEqual(["13", "12", "11", "10", "9", "8", "7", "6", "4"]);
    expect(activities.value).toBe("3");
    expect(onAbstractionChange).toHaveBeenLastCalledWith({ activityDetail: 3 / 14, pathDetail: 1 });
    fireEvent.keyDown(activities, { key: "PageDown" });
    await waitFor(() => expect(activities.value).toBe("1"));
    fireEvent.keyDown(activities, { key: "PageUp" });
    await waitFor(() => expect(activities.value).toBe("11"));
    fireEvent.keyDown(activities, { key: "PageUp" });
    await waitFor(() => expect(activities.value).toBe("14"));
    // Paths: ten paths with Page Down, one with an arrow key; Activities stays.
    fireEvent.keyDown(paths, { key: "PageDown" });
    await waitFor(() => expect(paths.value).toBe("31"));
    fireEvent.keyDown(paths, { key: "ArrowDown" });
    await waitFor(() => expect(paths.value).toBe("30"));
    expect(onAbstractionChange).toHaveBeenLastCalledWith({ activityDetail: 1, pathDetail: 30 / 41 });
    expect(activities.value).toBe("14");
    // A pointer that stops inside the tie of A5 and A6 takes both.
    fireEvent.change(activities, { target: { value: "5" } });
    await waitFor(() => expect(activities.value).toBe("6"));
  });

  it("keeps the statement and the selection in the table view", async () => {
    await ladderMap({ defaultAbstraction: { activityDetail: 3 / 14, pathDetail: 2 / 41 } });
    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    await waitFor(() => expect(screen.getAllByRole("table").length).toBeGreaterThan(1));
    expect(slider("Paths").getAttribute("aria-valuetext")).toBe("6 of 41 · 4 kept");
    // The paths' table lists the six paths shown: A1's two by frequency and the four kept.
    const paths = screen.getAllByRole("table").find((table) => /path/i.test(table.querySelector("caption")?.textContent ?? ""))!;
    expect(within(paths).getAllByRole("row").length - 1).toBe(6);
  });

  it("stands where a host's thresholds put it and gives the host detail shares when a slider moves", async () => {
    const onAbstractionChange = vi.fn();
    await ladderMap({ abstraction: { minNodeShare: 0.5, minEdgeShare: 0.5, keepConnected: true }, onAbstractionChange });
    // A1 to A7 have at least half the cases of A1; the 14 paths from the start and to the end of these at least half the count of the strongest.
    expect([slider("Activities").value, slider("Paths").value]).toEqual(["7", "14"]);
    fireEvent.keyDown(slider("Activities"), { key: "ArrowRight" });
    expect(onAbstractionChange).toHaveBeenLastCalledWith({ activityDetail: 8 / 14, pathDetail: 14 / 41 });
  });

  it("has a panel of its own a host can control, with its own polite announcement", async () => {
    const { AbstractionControls } = await import("../../src/react/index");
    const onChange = vi.fn();
    const { rerender } = render(<AbstractionControls value={{}} onChange={onChange} />);
    // Without positions the sliders run over the shares.
    expect([slider("Activities").value, slider("Paths").value]).toEqual(["100", "100"]);
    fireEvent.keyDown(slider("Activities"), { key: "PageDown" });
    expect(onChange).toHaveBeenLastCalledWith({ activityDetail: 0.9, pathDetail: 1 });
    const line = (text: string) => ({ short: text, full: `${text}.` });
    const statement = (paths: string) => ({ activities: line("1 of 2"), paths: { ...line(paths), parts: [paths] }, kept: [] });
    // The statement before the move, then the one that answers it: the other slider's is said.
    rerender(<AbstractionControls value={{}} onChange={onChange} statement={statement("3 of 4")} />);
    fireEvent.keyDown(slider("Activities"), { key: "PageDown" });
    rerender(<AbstractionControls value={{ activityDetail: 0.9 }} onChange={onChange} statement={statement("2 of 4")} />);
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe("2 of 4.");
    // A change that no slider made is not announced.
    rerender(<AbstractionControls value={{ activityDetail: 0.9 }} onChange={onChange} statement={statement("1 of 4")} />);
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toBe("2 of 4.");
  });

  it("marks exactly the kept paths while their part of the statement is pointed at or focused, and their tooltips say what they keep", async () => {
    const { container } = await ladderMap({ defaultAbstraction: { activityDetail: 3 / 14, pathDetail: 2 / 41 } });
    const kept = ["a2->end", "a3->end", "start->a2", "start->a3"];
    const dimmed = () => [...container.querySelectorAll("g.wf-edge")].filter((g) => g.getAttribute("data-wf-state")?.includes("dimmed")).map((g) => g.getAttribute("data-id")).sort();
    const marked = () => [...container.querySelectorAll("g.wf-edge")].map((g) => g.getAttribute("data-id")!).filter((id) => !dimmed().includes(id)).sort();
    expect(dimmed()).toEqual([]);
    const button = screen.getByRole("button", { name: "4 kept" });
    fireEvent.pointerEnter(button);
    await waitFor(() => expect(marked()).toEqual(kept));
    expect(dimmed()).toEqual(["a1->end", "start->a1"]);
    fireEvent.pointerLeave(button);
    await waitFor(() => expect(dimmed()).toEqual([]));
    act(() => button.focus());
    await waitFor(() => expect(marked()).toEqual(kept));
    act(() => button.blur());
    await waitFor(() => expect(dimmed()).toEqual([]));
    // Drawn solid, with their counts; the tooltip says which activity a kept path keeps on a way from start to end.
    const edge = (id: string) => container.querySelector<SVGGElement>(`g.wf-edge[data-id="${id}"]`)!;
    for (const id of kept) {
      expect(edge(id).style.getPropertyValue("--wf-edge-dash"), id).toBe("");
      expect(edge(id).querySelector(".wf-edge-label")!.textContent, id).toBe(String(CASES[Number(id.match(/a(\d+)/)![1]) - 1]));
    }
    expect(edge("start->a2").querySelector("title")!.textContent).toContain("Keeps A2 on a way from start to end.");
    // An activity's tooltip adds what runs on paths not shown: A2's path of 1 from A1 and of 1 to A3.
    expect(container.querySelector("#wf-node-a2")!.getAttribute("title")).toContain("Passages on paths not shown: 1 in, 1 out.");
  });

  it("draws an indirect path dashed, with its label and without a count", async () => {
    // "late" is entered only through "rarer" and "rare": at two activities of four one path stands for them.
    const hidden: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start", tags: ["start"] },
        { id: "busy", kind: "activity", label: "Busy", metrics: { cases: 100 } },
        { id: "late", kind: "activity", label: "Late", metrics: { cases: 90 } },
        { id: "rare", kind: "activity", label: "Rare", metrics: { cases: 5 } },
        { id: "rarer", kind: "activity", label: "Rarer", metrics: { cases: 3 } },
        { id: "end", kind: "event", label: "End", tags: ["end"] },
      ],
      edges: ([["start", "busy", 100], ["busy", "end", 100], ["start", "rarer", 3], ["rarer", "rare", 3], ["rare", "late", 5], ["late", "end", 90]] as const).map(([source, target, count]) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count } })),
    };
    const positions = await layout(hidden, { engine: "dagre" });
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <ProcessMap graph={hidden} positions={positions} defaultAbstraction={{ activityDetail: 0.5, pathDetail: 0 }} edgeBudget="all" fitView={false} />
      </div>,
    );
    const indirect = () => container.querySelector<SVGGElement>('g.wf-edge[data-id="start->rarer->rare->late:indirect"]');
    await waitFor(() => expect(indirect()).not.toBeNull());
    expect(indirect()!.style.getPropertyValue("--wf-edge-dash")).toBe("6 5");
    expect(indirect()!.querySelector(".wf-edge-label")!.textContent).toBe("via 2 activities not shown");
    expect(indirect()!.querySelector("title")!.textContent).toBe("path Start → Late. Stands for a way through activities not shown: Rarer, Rare.");
    const late = container.querySelector<SVGGElement>('g.wf-edge[data-id="late->end"]')!;
    expect(late.style.getPropertyValue("--wf-edge-dash")).toBe("");
    expect(late.querySelector(".wf-edge-label")!.textContent).toBe("90");
    expect(slider("Paths").getAttribute("aria-valuetext")).toBe("3 of 6 · 3 kept");
  });
});

/** Two rare activities below every share, each with a badge; the one on "r" is protected. */
const marked: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 80 } },
    { id: "r", kind: "activity", label: "R", metrics: { cases: 2 } },
    { id: "q", kind: "activity", label: "Q", metrics: { cases: 3 } },
    { id: "end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: ([["start", "a", 100], ["a", "b", 80], ["b", "end", 80], ["a", "end", 20], ["a", "r", 2], ["r", "b", 2], ["a", "q", 3], ["q", "end", 3]] as const).map(([source, target, count]) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count } })),
};
const marks: Overlay[] = [
  { kind: "badge", target: "r", payload: { glyph: "∅", value: 0.06, label: "Never cancel" }, protected: true },
  { kind: "badge", target: "q", payload: { glyph: "≥1", value: 0.2, label: "Clear the invoice" } },
];

describe("the marks the detail setting hides", () => {
  it.each([
    ["en", "1 mark not shown", "1 mark not shown: 1 Clear the invoice.", "1 shown for a protected deviation", "Shown for a protected deviation."],
    ["de", "1 Markierung nicht gezeigt", "1 Markierung nicht gezeigt: 1 Clear the invoice.", "1 für eine geschützte Abweichung gezeigt", "Für eine geschützte Abweichung gezeigt."],
  ] as const)("are counted in a line of their own, named in its full form and listed (%s)", async (locale, short, full, protectedLine, tooltip) => {
    const positions = await layout(marked, { engine: "dagre" });
    const { container, unmount } = render(
      <div style={{ width: 1000, height: 600 }}>
        <ProcessMap graph={marked} overlays={marks} positions={positions} locale={locale} defaultAbstraction={{ activityDetail: 0, pathDetail: 0 }} edgeBudget="all" fitView={false} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector(".wf-controls__note--marks")).not.toBeNull());
    const line = container.querySelector(".wf-controls__note--marks")!;
    expect(line.querySelector("summary")!.textContent).toBe(short);
    expect(line.querySelector("summary")!.getAttribute("title")).toBe(full);
    expect([...line.querySelectorAll("li")].map((li) => li.textContent)).toEqual([expect.stringContaining("(Q)")]);
    expect(container.querySelector(".wf-controls__note--protected")!.getAttribute("title")).toBe(`${protectedLine}: R.`);
    expect(container.querySelector("#wf-node-r")!.getAttribute("title")).toContain(tooltip);
    unmount();
    // With every element shown, no mark is hidden and there is no line.
    const all = render(
      <div style={{ width: 1000, height: 600 }}>
        <ProcessMap graph={marked} overlays={marks} positions={positions} locale={locale} defaultAbstraction={{ activityDetail: 1, pathDetail: 1 }} edgeBudget="all" fitView={false} />
      </div>,
    );
    await waitFor(() => expect(all.container.querySelector(".wf-controls")).not.toBeNull());
    expect(all.container.querySelector(".wf-controls__note--marks")).toBeNull();
    expect(all.container.querySelector(".wf-controls__note--protected")).toBeNull();
  });
});
