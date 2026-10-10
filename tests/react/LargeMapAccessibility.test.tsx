import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowEdge, type FlowGraph, type FlowGroup, type FlowNode, type Locale, type Positions, createPositions } from "../../src/index";
import { ProcessMap, TableAlternative } from "../../src/react/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A connected seeded graph: every activity after the first is joined to an
 * earlier one by a path in a random direction, `extra` further distinct paths,
 * and activity `n0` is a hub joined to `hub` activities. Stages of 50
 * activities; positions on a grid of 20 rows, `n0` at the top left.
 */
function seeded(n: number, options: { extra?: number; hub?: number; seed?: number } = {}) {
  const random = rng(options.seed ?? 11);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const groups: FlowGroup[] = Array.from({ length: Math.ceil(n / 50) }, (_, i) => ({ id: `s${i}`, kind: "stage", label: `Stage ${i}` }));
  const pairs = new Set<string>();
  const join = (a: number, b: number) => {
    if (a === b || pairs.has(`${a}>${b}`)) return;
    pairs.add(`${a}>${b}`);
    edges.push({ id: `e${edges.length}`, kind: "follows", source: `n${a}`, target: `n${b}`, metrics: { count: 1 + edges.length } });
  };
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `n${i}`, kind: "activity", label: `Activity ${i}`, group: `s${Math.floor(i / 50)}`, metrics: { cases: 10 + i } });
    if (i === 0) continue;
    const other = Math.floor(random() * i);
    if (random() < 0.5) join(other, i);
    else join(i, other);
  }
  for (const total = edges.length + (options.extra ?? 0); edges.length < total; ) join(Math.floor(random() * n), Math.floor(random() * n));
  for (let k = 1; k <= Math.min(options.hub ?? 0, n - 1); k++) join(0, k);
  const boxes = Object.fromEntries(nodes.map((node, i) => [node.id, { x: Math.floor(i / 20) * 200, y: (i % 20) * 80, width: 150, height: 50 }]));
  const positions: Positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "dagre", "RIGHT");
  return { graph: { nodes, edges, groups } satisfies FlowGraph, positions };
}

/** A 2D context that draws nothing. */
function quietCanvas() {
  const noop = () => {};
  const ctx = new Proxy({ measureText: (text: string) => ({ width: text.length * 6 }), createPattern: () => null } as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : noop),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
}

function mountMap(graph: FlowGraph, positions: Positions, props: Partial<React.ComponentProps<typeof ProcessMap>> = {}) {
  quietCanvas();
  const view = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} renderer="canvas" edgeBudget="all" controls={false} legend={false} fitView={false} {...props} />
    </div>,
  );
  const map = view.container.querySelector(".wf-process-map") as HTMLElement;
  const listed = () => Array.from(view.container.querySelectorAll('[data-testid="wf-canvas-descendants"] > *')) as HTMLElement[];
  const active = () => map.getAttribute("aria-activedescendant");
  /** The id and kind of the element the keyboard is on, which the list must hold. */
  const at = () => {
    const id = active();
    if (!id) return null;
    const target = listed().find((el) => el.id === id);
    expect(target, `${id} is listed`).toBeDefined();
    return { id: target!.getAttribute("data-id")!, kind: target!.getAttribute("data-kind")! };
  };
  const key = (k: string, mods: { altKey?: boolean } = {}) => fireEvent.keyDown(map, { key: k, ...mods });
  return { ...view, map, listed, active, at, key };
}

describe("the hidden element list of a large Canvas map", () => {
  it("holds at most the limit for 20,000 activities, at mount and after every focus move", () => {
    const { graph, positions } = seeded(20_000, { extra: 10_000, hub: 1_200 });
    const m = mountMap(graph, positions);
    // Before any key: the activity Home goes to (top left), its group and its neighbours, cut at 500.
    expect(m.listed().length).toBeLessThanOrEqual(500);
    expect(m.listed()[0].getAttribute("data-id")).toBe("n0");
    expect(m.listed().map((el) => el.getAttribute("data-id"))).toContain("s0");
    act(() => m.map.focus());
    const moves: [string, { altKey?: boolean }][] = [
      ["Home", {}], ["ArrowRight", { altKey: true }], ["ArrowRight", { altKey: true }], ["ArrowDown", {}], ["ArrowRight", {}],
      ["ArrowLeft", { altKey: true }], ["ArrowLeft", { altKey: true }], ["End", {}], ["ArrowLeft", { altKey: true }], ["Home", {}],
    ];
    for (const [k, mods] of moves) {
      m.key(k, mods);
      expect(m.listed().length).toBeLessThanOrEqual(500);
      expect(m.at()).not.toBeNull();
    }
    // The hub n0 has 1,200 neighbours: the list still stops at the limit and starts with the hub itself.
    expect(m.at()).toEqual({ id: "n0", kind: "node" });
    expect(m.listed()).toHaveLength(500);
  }, 90_000);

  it("re-centres on the element the keyboard is on: the element, its ends or group and its neighbours", () => {
    const { graph, positions } = seeded(60, { seed: 3 });
    const m = mountMap(graph, positions, { describedLimit: 10 });
    act(() => m.map.focus());
    m.key("Home");
    const ids = () => m.listed().map((el) => `${el.getAttribute("data-kind")}:${el.getAttribute("data-id")}`);
    // n0, its stage, then its predecessors and successors in the order of the paths.
    const around = (id: string) => [
      ...graph.edges.filter((e) => e.target === id).map((e) => `node:${e.source}`),
      ...graph.edges.filter((e) => e.source === id).map((e) => `node:${e.target}`),
    ];
    expect(ids()).toEqual(["node:n0", "group:s0", ...around("n0")].slice(0, 10));
    m.key("ArrowRight", { altKey: true });
    const edge = graph.edges.find((e) => e.source === "n0")!;
    expect(m.at()).toEqual({ id: edge.id, kind: "edge" });
    expect(ids().slice(0, 4)).toEqual([`edge:${edge.id}`, "node:n0", `node:${edge.target}`, "group:s0"]);
  });

  it("lets the keyboard reach every activity of a connected graph along its paths", () => {
    const limit = 12;
    const { graph, positions } = seeded(90, { extra: 30, seed: 5 });
    for (const start of ["home", "selected"] as const) {
      const m = mountMap(graph, positions, { describedLimit: limit, ...(start === "selected" ? { selection: { nodes: ["n57"], edges: [], groups: [] } } : {}) });
      act(() => m.map.focus());
      if (start === "home") m.key("Home");
      const press = (k: string) => {
        m.key(k, { altKey: true });
        expect(m.listed().length).toBeLessThanOrEqual(limit);
        return m.at()!;
      };
      /** Move from the activity `from` along `edge` to its other end with Alt and the arrow keys only. */
      const along = (from: string, edge: FlowEdge) => {
        const [out, back] = edge.source === from ? ["ArrowRight", "ArrowLeft"] : ["ArrowLeft", "ArrowRight"];
        for (let tries = 0; ; tries++) {
          expect(tries).toBeLessThan(graph.edges.length);
          if (press(out).id === edge.id) break;
          expect(press(back)).toEqual({ id: from, kind: "node" });
        }
        const to = press(out);
        expect(to).toEqual({ id: edge.source === from ? edge.target : edge.source, kind: "node" });
        return to.id;
      };
      // Depth-first: every path of the activity the keyboard is on leads on to an activity not reached
      // yet, and back along the same path.
      const first = start === "home" ? m.at()!.id : "n57";
      const reached = new Set([first]);
      const visit = (id: string) => {
        for (const edge of graph.edges) {
          if (edge.source !== id && edge.target !== id) continue;
          const other = edge.source === id ? edge.target : edge.source;
          if (reached.has(other)) continue;
          reached.add(other);
          visit(along(id, edge));
          expect(along(other, edge)).toBe(id);
        }
      };
      visit(first);
      expect(reached.size).toBe(graph.nodes.length);
      cleanup();
    }
  }, 90_000);

  it.each<[Locale, string]>([
    ["en", "Large map with 20,000 activities and 30,000 paths. The map lists the element at the keyboard position and its neighbours; the table view lists all of them."],
    ["de", "Große Karte mit 20.000 Aktivitäten und 30.000 Pfaden. Die Karte führt das Element an der Tastaturposition und seine Nachbarn auf; die Tabellenansicht führt alle auf."],
  ])("announces in %s how many activities and paths there are and that the table lists them all", (locale, text) => {
    const { graph, positions } = seeded(20_000, { extra: 10_001 });
    expect(graph.edges).toHaveLength(30_000);
    const m = mountMap(graph, positions, { locale });
    expect(m.getByTestId("wf-live").textContent).toBe(text);
  }, 90_000);

  it("keeps the whole list and stays silent at the limit", () => {
    // 450 activities and 9 stages: 459 elements, below the default limit of 500.
    const { graph, positions } = seeded(450);
    const m = mountMap(graph, positions);
    expect(m.listed()).toHaveLength(459);
    expect(m.getByTestId("wf-live").textContent).toBe("");
    cleanup();
    // 10 activities and one stage at a limit of 11: the whole list.
    const small = seeded(10);
    const at = mountMap(small.graph, small.positions, { describedLimit: 11 });
    expect(at.listed()).toHaveLength(11);
    expect(at.container.querySelector("input[type=search]")).toBeNull();
  });
});

describe("the table alternative of a large map", () => {
  it("pages and searches its rows and tells assistive technology how many there are", () => {
    const { graph } = seeded(1_000);
    render(<TableAlternative graph={graph} pageSize={100} />);
    const [nodes, edges] = screen.getAllByRole("table");
    const bodyRows = (table: HTMLElement) => within(table).getAllByRole("row").slice(1);
    // 1,000 activities: one header row and 100 rows of the first page.
    expect(nodes.getAttribute("aria-rowcount")).toBe("1001");
    expect(bodyRows(nodes)).toHaveLength(100);
    expect(bodyRows(nodes)[0].getAttribute("aria-rowindex")).toBe("2");
    expect(within(bodyRows(nodes)[0]).getByRole("rowheader").textContent).toBe("Activity 0");
    expect(edges.getAttribute("aria-rowcount")).toBe("1000");
    expect(screen.getAllByRole("status")[0].textContent).toBe("Rows 1–100 of 1,000");
    // The next page.
    fireEvent.click(screen.getAllByRole("button", { name: "Next rows" })[0]);
    expect(bodyRows(nodes)).toHaveLength(100);
    expect(bodyRows(nodes)[0].getAttribute("aria-rowindex")).toBe("102");
    expect(within(bodyRows(nodes)[0]).getByRole("rowheader").textContent).toBe("Activity 100");
    expect(screen.getAllByRole("status")[0].textContent).toBe("Rows 101–200 of 1,000");
    // Search: "Activity 99" matches Activity 99 and Activity 990–999 in the activities, starting on the first page.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the tables" }), { target: { value: "activity 99" } });
    expect(nodes.getAttribute("aria-rowcount")).toBe("12");
    expect(bodyRows(nodes).map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["Activity 99", ...Array.from({ length: 10 }, (_, i) => `Activity ${990 + i}`)]);
    expect(screen.getAllByRole("status")[0].textContent).toBe("Rows 1–11 of 11");
    expect((screen.getAllByRole("button", { name: "Next rows" })[0] as HTMLButtonElement).disabled).toBe(true);
    // Nothing matches.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no such row" } });
    expect(nodes.getAttribute("aria-rowcount")).toBe("1");
    expect(screen.getAllByRole("status")[0].textContent).toBe("Nothing to show.");
  });

  it("starts on the first page again when the search goes back to an earlier text", () => {
    const { graph } = seeded(300);
    render(<TableAlternative graph={graph} pageSize={100} tables={["nodes"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Next rows" }));
    fireEvent.click(screen.getByRole("button", { name: "Next rows" }));
    expect(screen.getByRole("status").textContent).toBe("Rows 201–300 of 300");
    // Typing and clearing the search is a new query each time: back to rows 1–100, not to the third page.
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "activity 1" } });
    expect(screen.getByRole("status").textContent).toBe("Rows 1–100 of 111");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(screen.getByRole("status").textContent).toBe("Rows 1–100 of 300");
    expect(within(within(screen.getByRole("table")).getAllByRole("row")[1]).getByRole("rowheader").textContent).toBe("Activity 0");
  });

  it("speaks German", () => {
    const { graph } = seeded(250);
    render(<TableAlternative graph={graph} pageSize={100} locale="de" />);
    expect(screen.getByRole("searchbox", { name: "Tabellen durchsuchen" })).toBeDefined();
    expect(screen.getAllByRole("status")[0].textContent).toBe("Zeilen 1–100 von 250");
    fireEvent.click(screen.getAllByRole("button", { name: "Nächste Zeilen" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Nächste Zeilen" })[0]);
    expect(screen.getAllByRole("status")[0].textContent).toBe("Zeilen 201–250 von 250");
    fireEvent.click(screen.getAllByRole("button", { name: "Vorherige Zeilen" })[0]);
    expect(screen.getAllByRole("status")[0].textContent).toBe("Zeilen 101–200 von 250");
  });

  it("is paged in the map's table view above the limit and complete below it", () => {
    const { graph, positions } = seeded(600);
    const large = render(<ProcessMap graph={graph} positions={positions} view="table" controls={false} legend={false} />);
    const [nodes] = large.getAllByRole("table");
    expect(nodes.getAttribute("aria-rowcount")).toBe("601");
    expect(within(nodes).getAllByRole("row")).toHaveLength(101);
    cleanup();
    const small = seeded(400);
    const view = render(<ProcessMap graph={small.graph} positions={small.positions} view="table" controls={false} legend={false} />);
    const [all] = view.getAllByRole("table");
    expect(all.hasAttribute("aria-rowcount")).toBe(false);
    expect(within(all).getAllByRole("row")).toHaveLength(401);
    expect(view.queryByRole("searchbox")).toBeNull();
  });
});
