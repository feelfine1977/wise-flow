/**
 * The paths the React map draws at a small zoom: the whole log with every
 * activity and path selected, at its fitted zoom and in steps in and out.
 * What it draws is what the rule gives over the whole map (written out in
 * `../core/zoom-cases.ts`); the note and the detail panel say how many of how
 * many; protected paths are drawn; the numbers change only when the view is
 * at rest and not with a pan; every activity stays between the start and the
 * end; the table and the default export are unchanged, the export of what
 * the map shows is what it shows.
 */
import { useReactFlow } from "@xyflow/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type FlowScene, type Positions, type Selection, type ShownEdges, abstract, buildScene, fitViewport, layout, toSVG } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import { svgEdges, svgNote } from "../support/svg";
import { offWay, ruleAt } from "../core/zoom-cases";

const AREA = { width: 1400, height: 900 };
/** Every activity and every path of the whole log. */
const EVERYTHING = { activityDetail: 1, pathDetail: 1 };
/** The rest the map waits for before its view counts as at rest, and a little more. */
const REST = 260;

let shown: FlowGraph;
let positions: Positions;
let scene: FlowScene;
/** The zoom of the map fitted into 1,400 × 900 with 4 % around it. */
let fitted: number;
beforeAll(async () => {
  shown = abstract(globalScene, EVERYTHING);
  positions = await layout(shown);
  scene = buildScene(shown, positions, {});
  fitted = fitViewport(positions.bounds, AREA, { padding: 0.04 }).zoom;
}, 60_000);
afterEach(cleanup);

let move: (v: { x: number; y: number; zoom: number }) => void = () => {};
/** Moves the map's view from inside React Flow. */
function View() {
  const rf = useReactFlow();
  move = (v) => void rf.setViewport(v);
  return null;
}

async function mount(props: { selection?: Selection; onEdgesShown?: (s: ShownEdges | undefined) => void; view?: "map" | "table" } = {}) {
  const element = (p: typeof props) => (
    <div style={{ width: AREA.width, height: AREA.height }}>
      <ProcessMap graph={globalScene} abstraction={EVERYTHING} positions={positions} renderer="svg" edgeBudget="all" fitView={false} legend={false} contextMenu={false} pathList={false} {...p}>
        <View />
      </ProcessMap>
    </div>
  );
  const result = render(element(props));
  await waitFor(() => expect(result.container.querySelectorAll(".react-flow__edge").length).toBe(656));
  const lines = () => [...result.container.querySelectorAll(".react-flow__edge")].map((e) => e.getAttribute("data-id")!).sort();
  const note = () => screen.queryByTestId("wf-edge-note")?.textContent ?? undefined;
  const drawnLine = () => result.container.querySelector(".wf-controls__note--drawn")?.textContent ?? undefined;
  const to = (v: { x: number; y: number; zoom: number }) => act(() => move(v));
  const rest = () => act(() => new Promise((done) => setTimeout(done, REST)));
  return { ...result, lines, note, drawnLine, to, rest, rerender: (p: typeof props) => result.rerender(element(p)) };
}

describe("the paths the React map draws at a small zoom", () => {
  it("are those the rule gives over the whole map at the fitted zoom, with the note and the panel's line, and all at zoom 1", async () => {
    const map = await mount();
    await map.to({ x: 0, y: 0, zoom: fitted });
    await map.rest();
    expect(map.lines()).toEqual(ruleAt(scene, fitted));
    // 84 lines of 656 and the 21 loops, which are never withheld; the panel counts the 677 paths selected.
    expect(map.note()).toBe("Showing 105 of 677 flows");
    expect(map.drawnLine()).toBe("677 selected · 105 drawn at this zoom");
    await map.to({ x: 0, y: 0, zoom: 1 });
    await map.rest();
    expect(map.lines()).toHaveLength(656);
    expect(map.note()).toBeUndefined();
    expect(map.drawnLine()).toBeUndefined();
  });

  it("always draws a selected path, and one on a highlighted route", async () => {
    const withheld = scene.edgeMarks.map((m) => m.id).find((id) => !ruleAt(scene, fitted).includes(id))!;
    const map = await mount({ selection: { nodes: [], edges: [withheld], groups: [] } });
    await map.to({ x: 0, y: 0, zoom: fitted });
    await map.rest();
    expect(map.lines()).toEqual([...ruleAt(scene, fitted), withheld].sort());
    expect(map.note()).toBe("Showing 106 of 677 flows");
    // A pair of activities selected highlights the route between them: its paths are drawn.
    const path = scene.edgeMarks.find((m) => m.id === withheld)!.edge;
    map.rerender({ selection: { nodes: [path.source, path.target], edges: [], groups: [] } });
    await map.rest();
    expect(map.lines()).toContain(withheld);
  });

  it("change only at rest, never fewer zooming in nor more zooming out, not with a pan, and keep every activity between the start and the end", async () => {
    const map = await mount();
    await map.to({ x: 0, y: 0, zoom: fitted });
    await map.rest();
    let previous = fitted;
    // Six steps of 1.5 in, from the fitted zoom past 0.75, where every path is drawn, and back out.
    const zooms = Array.from({ length: 6 }, (_, i) => fitted * 1.5 ** (i + 1));
    expect(zooms.at(-1)).toBeGreaterThan(0.75);
    for (const zoom of [...zooms, ...zooms.slice(0, -1).reverse(), fitted]) {
      const was = map.lines();
      await map.to({ x: 0, y: 0, zoom });
      // Not yet at rest: what is drawn stays.
      expect(map.lines(), `moving to ${zoom}`).toEqual(was);
      await map.rest();
      const now = map.lines();
      expect(now, `at rest at ${zoom}`).toEqual(ruleAt(scene, zoom));
      if (zoom > previous) expect(was.filter((id) => !now.includes(id)), `in to ${zoom}`).toEqual([]);
      else expect(now.filter((id) => !was.includes(id)), `out to ${zoom}`).toEqual([]);
      previous = zoom;
      expect(offWay(shown, shown.edges.filter((e) => now.includes(e.id))), `zoom ${zoom}`).toEqual([]);
      // A pan draws the same paths.
      const note = map.note();
      await map.to({ x: -1200, y: -400, zoom });
      await map.rest();
      expect(map.lines(), `panned at ${zoom}`).toEqual(now);
      expect(map.note()).toBe(note);
    }
  }, 60_000);

  it("leave the table view and the default export whole; the export of what the map shows is what it draws, with its note", async () => {
    const reported: (ShownEdges | undefined)[] = [];
    const map = await mount({ onEdgesShown: (s) => reported.push(s) });
    await map.to({ x: 0, y: 0, zoom: fitted });
    await map.rest();
    const last = reported.at(-1)!;
    const figure = toSVG({ graph: shown, positions }, { edgeBudget: last });
    expect(svgEdges(figure)).toEqual(map.lines());
    expect(svgNote(figure)).toBe(map.note());
    expect(svgEdges(toSVG({ graph: shown, positions }))).toHaveLength(656);
    // The table lists every path at any zoom.
    map.rerender({ view: "table", onEdgesShown: (s) => reported.push(s) });
    await waitFor(() => expect(screen.getAllByRole("table").length).toBeGreaterThan(0));
    const rows = (name: RegExp) => screen.getAllByRole("table").find((t) => name.test(t.getAttribute("aria-label") ?? t.querySelector("caption")?.textContent ?? ""));
    expect(rows(/path/i)?.querySelectorAll("tbody tr").length).toBe(677);
    expect(reported.at(-1)).toBeUndefined();
  });
});
