import { expect, it } from "vitest";
import { type FlowGraph, type LayoutDirection, createLayoutScope, layout } from "../../src/index";

const directions: LayoutDirection[] = ["RIGHT", "DOWN", "LEFT", "UP"];

function returningGraph(stages: boolean, multiple = false): FlowGraph {
  const starts = multiple ? ["start", "start2"] : ["start"];
  const ends = multiple ? ["end", "end2"] : ["end"];
  return {
    nodes: [
      ...starts.map((id) => ({ id, label: id, kind: "event" as const, tags: ["start"] })),
      ...ends.map((id) => ({ id, label: id, kind: "event" as const, tags: ["end"] })),
      ...["a", "b", "c", "d"].map((id) => ({ id, label: id, kind: "activity" as const, group: stages ? (id === "d" ? "second" : "first") : undefined })),
    ],
    edges: [...starts.map((id) => [id, "d"]), ["a", "b"], ["b", "c"], ["c", "d"], ["d", "b"], ...ends.map((id) => ["b", id])].map(([source, target]) => ({ id: `${source}-${target}`, source, target, kind: "follows" as const })),
    groups: stages ? [{ id: "first", label: "First", kind: "stage" }, { id: "second", label: "Second", kind: "stage" }] : [],
  };
}

it.each(directions)("keeps every start and end beyond activities and stages going %s", async (direction) => {
  const axis = direction === "RIGHT" || direction === "LEFT" ? "x" : "y";
  const size = axis === "x" ? "width" : "height";
  const forward = direction === "RIGHT" || direction === "DOWN";
  for (const stages of [false, true]) for (const multiple of [false, true]) for (const orderStages of [false, true]) for (const groups of ["compound", "ignore"] as const) {
    const graph = returningGraph(stages, multiple);
    const p = await layout(graph, { engine: "elk", direction, orderStages, groups });
    if (stages && orderStages && groups === "compound") {
      if (forward) expect(p.groups.first[axis] + p.groups.first[size]).toBeLessThan(p.groups.second[axis]);
      else expect(p.groups.first[axis]).toBeGreaterThan(p.groups.second[axis] + p.groups.second[size]);
    }
    const middle = [...graph.nodes.filter((n) => n.kind !== "event").map((n) => p.nodes[n.id]), ...Object.values(p.groups)];
    for (const tag of ["start", "end"]) {
      const events = graph.nodes.filter((n) => n.tags?.includes(tag)).map((n) => p.nodes[n.id]);
      // Every start shares one layer, as does every end.
      expect(new Set(events.map((b) => b[axis] + b[size] / 2)).size).toBe(1);
      for (const event of events) for (const box of middle) {
        if ((tag === "start") === forward) expect(event[axis] + event[size]).toBeLessThan(box[axis]);
        else expect(event[axis]).toBeGreaterThan(box[axis] + box[size]);
      }
    }
    expect(Object.keys(p.edges).sort()).toEqual(graph.edges.map((e) => e.id).sort());
  }
});

it.each(directions)("keeps disconnected events and activities in map-wide layers going %s", async (direction) => {
  const graph = returningGraph(true, true);
  graph.nodes.push({ id: "alone", label: "Alone", kind: "activity" });
  graph.edges = graph.edges.filter((e) => e.source !== "start2" && e.target !== "end2");
  const p = await layout(graph, { engine: "elk", direction });
  const axis = direction === "RIGHT" || direction === "LEFT" ? "x" : "y";
  const sign = direction === "RIGHT" || direction === "DOWN" ? 1 : -1;
  for (const start of ["start", "start2"]) for (const end of ["end", "end2"]) for (const n of graph.nodes.filter((n) => n.kind === "activity")) {
    expect(sign * p.nodes[start][axis]).toBeLessThan(sign * p.nodes[n.id][axis]);
    expect(sign * p.nodes[end][axis]).toBeGreaterThan(sign * p.nodes[n.id][axis]);
  }
  expect(p.nodes.start2[axis]).toBe(p.nodes.start[axis]);
  expect(p.nodes.end2[axis]).toBe(p.nodes.end[axis]);
});

it("leaves an event-free graph byte-identical to its previous positions", async () => {
  const graph: FlowGraph = {
    nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity", label: id })),
    edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }, { id: "bc", kind: "follows", source: "b", target: "c" }],
  };
  // 12px margin; 180x64 cards separated by 64px; routes join their side centres.
  const before = '{"nodes":{"a":{"x":12,"y":12,"width":180,"height":64},"b":{"x":256,"y":12,"width":180,"height":64},"c":{"x":500,"y":12,"width":180,"height":64}},"groups":{},"edges":{"ab":{"points":[{"x":192,"y":44},{"x":256,"y":44}]},"bc":{"points":[{"x":436,"y":44},{"x":500,"y":44}]}},"bounds":{"x":12,"y":12,"width":668,"height":64},"engine":"elk","direction":"RIGHT"}';
  expect(JSON.stringify(await layout(graph, { engine: "elk" }))).toBe(before);
});

it("places tagged events outside a stage even when the host assigned them to it", async () => {
  const graph = returningGraph(true);
  for (const n of graph.nodes.filter((n) => n.kind === "event")) n.group = "second";
  const p = await layout(graph, { engine: "elk" });
  for (const group of Object.values(p.groups)) {
    expect(p.nodes.start.x + p.nodes.start.width).toBeLessThan(group.x);
    expect(p.nodes.end.x).toBeGreaterThan(group.x + group.width);
  }
});

it("invalidates a scoped layout when events gain border tags or tagged nodes become events", async () => {
  const graph = returningGraph(true);
  const options = { engine: "elk" as const, nodeSize: { width: 36, height: 36 } };
  const expected = await layout(graph, options);
  for (const before of [
    { ...graph, nodes: graph.nodes.map((n) => ({ ...n, tags: [] })) },
    { ...graph, nodes: graph.nodes.map((n) => ({ ...n, kind: "activity" as const })) },
  ]) {
    const scope = createLayoutScope();
    try {
      const old = await scope.layout(before, options);
      expect(old.nodes.start.x).toBeGreaterThan(old.nodes.a.x);
      expect(await scope.layout(graph, options)).toEqual(expected);
    } finally {
      scope.dispose();
    }
  }
});
