import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalScene, vendorScene } from "../../fixtures/bpic2019";
import { type FlowEdge, type FlowGraph, type FlowNode, type Positions, type ShownEdges, createPositions, layout, toSVG } from "../../src/index";
import { ProcessMap } from "../../src/react/index";
import raw from "../fixtures/o2c-observed.json";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The numbers written in a text, separators taken out. */
const numbers = (text: string | null | undefined) => [...(text ?? "").matchAll(/\d[\d,.]*/g)].map((m) => Number(m[0].replace(/[,.]/g, "")));

/**
 * A hub `h` with a path to each of eight activities (counts 10, 50, 30, 30, 70, 20, 60, 40 in the order
 * h->t1 … h->t8) and two paths that loop on one activity: h->h and t1->t1. By hand, a budget of 3 draws the
 * three heaviest lines, h->t5 (70), h->t7 (60) and h->t2 (50), and both loops, which are never withheld:
 * 5 paths of 10.
 */
function loops() {
  const counts = [10, 50, 30, 30, 70, 20, 60, 40];
  const nodes: FlowNode[] = [{ id: "h", kind: "activity", label: "Hub" }, ...counts.map((_, k): FlowNode => ({ id: `t${k + 1}`, kind: "activity", label: `T${k + 1}` }))];
  const edges: FlowEdge[] = [
    ...counts.map((count, k): FlowEdge => ({ id: `h->t${k + 1}`, kind: "follows", source: "h", target: `t${k + 1}`, metrics: { count } })),
    { id: "h->h", kind: "follows", source: "h", target: "h", metrics: { count: 5 } },
    { id: "t1->t1", kind: "follows", source: "t1", target: "t1", metrics: { count: 3 } },
  ];
  const boxes = Object.fromEntries(nodes.map((n, i) => [n.id, i === 0 ? { x: 0, y: 0, width: 100, height: 40 } : { x: 300, y: 80 * (i - 1), width: 100, height: 40 }]));
  return { graph: { nodes, edges } satisfies FlowGraph, positions: createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT") };
}

// The fixture holds a backend's `group: null`, which the map does not take; no group is undefined.
const observed: FlowGraph = { ...(raw as unknown as FlowGraph), nodes: (raw as unknown as FlowGraph).nodes.map((n) => ({ ...n, group: n.group ?? undefined })) };

/** A 2D context that draws nothing. */
function quietCanvas() {
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => {}),
    set: (target, key, value) => ((target[key] = value), true),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

const note = () => screen.queryByTestId("wf-edge-note")?.textContent;

function mount(graph: FlowGraph, positions: Positions, renderer: "svg" | "canvas", props: Partial<React.ComponentProps<typeof ProcessMap>> = {}) {
  quietCanvas();
  return render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} renderer={renderer} edgeBudget={3} describedLimit={1} controls={false} legend={false} contextMenu={false} pathList={false} {...props} />
    </div>,
  );
}

describe("one count of paths everywhere", () => {
  it("counts the paths that loop on one activity in both numbers of the note, and reports them as drawn", async () => {
    const { graph, positions } = loops();
    for (const renderer of ["svg", "canvas"] as const) {
      const reports: (ShownEdges | undefined)[] = [];
      const { unmount } = mount(graph, positions, renderer, { onEdgesShown: (shown) => reports.push(shown) });
      await waitFor(() => expect(note(), renderer).toBe("Showing 5 of 10 flows"));
      await waitFor(() => expect(reports.at(-1), renderer).toEqual({ edges: ["h->t2", "h->t5", "h->t7", "h->h", "t1->t1"], total: 10 }));
      // An export of that report draws the same paths and writes the same note.
      const svg = toSVG({ graph, positions }, { edgeBudget: reports.at(-1) });
      expect(svg, renderer).toContain(">Showing 5 of 10 flows<");
      unmount();
    }
  });

  const fixtures: [string, () => Promise<{ graph: FlowGraph; positions: Positions }>][] = [
    ["a hub with loops on one activity", async () => loops()],
    ["the BPIC global scene", async () => ({ graph: globalScene, positions: await layout(globalScene, { engine: "dagre" }) })],
    ["the BPIC vendor scene", async () => ({ graph: vendorScene, positions: await layout(vendorScene, { engine: "dagre" }) })],
    ["the observed order-to-cash graph", async () => ({ graph: observed, positions: await layout(observed, { engine: "dagre" }) })],
  ];
  for (const [name, load] of fixtures) {
    it(`gives the note, the description, the bounded list and the table one total of paths for ${name}`, async () => {
      const { graph, positions } = await load();
      const loopsIn = graph.edges.filter((e) => e.source === e.target).length;
      expect(loopsIn, "a fixture with paths that loop on one activity").toBeGreaterThan(0);
      const total = graph.edges.length;
      for (const renderer of ["svg", "canvas"] as const) {
        const { container, unmount } = mount(graph, positions, renderer);
        await waitFor(() => expect(note(), renderer).toBeTruthy());
        const [shown, of] = numbers(note());
        expect(of, `${renderer}: the note's total`).toBe(total);
        expect(shown, `${renderer}: the note's shown paths`).toBeLessThanOrEqual(of);
        expect(shown, `${renderer}: three lines and every loop`).toBe(3 + loopsIn);
        // "Process map with {nodes} nodes and {edges} connections in {groups} groups."
        expect(numbers(container.querySelector(".wf-process-map")!.getAttribute("aria-label"))[1], `${renderer}: the description`).toBe(total);
        const described = container.querySelector(".wf-process-map > p.wf-sr-only")!.textContent!;
        if (renderer === "canvas") {
          // The canvas sentence and the bounded list's sentence: "… {nodes} activities and {edges} paths."
          const totals = [...described.matchAll(/activities and (\d[\d,]*) paths/g)].map((m) => numbers(m[1])[0]);
          expect(totals, described).toEqual([total, total]);
        }
        unmount();
        // The table view: one row per path, header excluded.
        const table = mount(graph, positions, renderer, { view: "table" });
        const edges = table.container.querySelectorAll("table")[1];
        expect(Number(edges.getAttribute("aria-rowcount")) - 1, `${renderer}: the table`).toBe(total);
        table.unmount();
      }
    }, 60_000);
  }
});
