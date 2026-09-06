import { describe, expect, it } from "vitest";
import { vendorScene } from "../../fixtures/bpic2019";
import { type Box, type FlowGraph, type Positions, abstract, laneAssignment, laneBands, laneGroups, layout, positionsBounds } from "../../src/index";

function given(nodes: Record<string, Box>, groups: Record<string, Box> = {}, edges: Positions["edges"] = {}): Positions {
  const partial = { nodes, groups, edges };
  return { ...partial, bounds: positionsBounds(partial), engine: "given", direction: "RIGHT" };
}

const inside = (inner: Box, outer: Box, axis: "x" | "y") => {
  const size = axis === "x" ? "width" : "height";
  return inner[axis] >= outer[axis] - 1e-6 && inner[axis] + inner[size] <= outer[axis] + outer[size] + 1e-6;
};

describe("stage lanes", () => {
  const g: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: "A", group: "s1" },
      { id: "b", kind: "activity", label: "B", group: "s1" },
      { id: "c", kind: "activity", label: "C", group: "s2" },
      { id: "d", kind: "activity", label: "D", group: "s3" },
      { id: "x", kind: "activity", label: "X" },
    ],
    edges: [
      { id: "a->c", kind: "follows", source: "a", target: "c" },
      { id: "c->d", kind: "follows", source: "c", target: "d" },
    ],
    groups: [
      { id: "s3", kind: "stage", label: "Stage 3" },
      { id: "s1", kind: "stage", label: "Stage 1" },
      { id: "s2", kind: "stage", label: "Stage 2" },
      { id: "role", kind: "lane", label: "Role" },
    ],
  };
  const positions = given(
    {
      a: { x: 0, y: 0, width: 180, height: 48 },
      b: { x: 0, y: 100, width: 180, height: 48 },
      c: { x: 300, y: 40, width: 180, height: 48 },
      d: { x: 600, y: 40, width: 180, height: 48 },
      x: { x: 900, y: 40, width: 180, height: 48 },
    },
    { s1: { x: -10, y: -10, width: 200, height: 170 }, s2: { x: 290, y: 30, width: 200, height: 68 }, s3: { x: 590, y: 30, width: 200, height: 68 } },
    { "a->c": { points: [{ x: 180, y: 24 }, { x: 300, y: 64 }] }, "c->d": { points: [{ x: 480, y: 64 }, { x: 600, y: 64 }] } },
  );

  it("cuts consecutive bands along the flow half-way between neighbouring stages and leaves the nodes alone", () => {
    const r = laneBands(g, positions, { lanes: "stages" });
    expect(r.mode).toBe("stages");
    expect(r.positions.nodes).toBe(positions.nodes);
    expect(r.positions.edges).toBe(positions.edges);
    expect(r.bands.map((b) => b.id)).toEqual(["s1", "s2", "s3"]);
    expect(r.bands.map((b) => b.index)).toEqual([0, 1, 2]);
    expect(r.bands.every((b) => b.axis === "main")).toBe(true);
    const [s1, s2, s3] = r.bands.map((b) => b.box);
    expect(s1.x + s1.width).toBeCloseTo(s2.x);
    expect(s2.x + s2.width).toBeCloseTo(s3.x);
    expect(s2.x).toBeCloseTo((180 + 300) / 2);
    expect(s3.x).toBeCloseTo((480 + 600) / 2);
    expect(s1.x).toBeLessThan(0);
    expect(s3.x + s3.width).toBeGreaterThan(1080);
    expect(new Set(r.bands.map((b) => b.box.y)).size).toBe(1);
    expect(new Set(r.bands.map((b) => b.box.height)).size).toBe(1);
    expect(s1.y).toBeLessThan(0);
    expect(s1.y + s1.height).toBeGreaterThan(148);
    for (const n of g.nodes) {
      const band = r.bands.find((b) => b.id === n.group);
      if (band) expect(inside(positions.nodes[n.id], band.box, "x")).toBe(true);
    }
    for (const b of r.bands) expect(r.positions.groups[b.id]).toEqual(b.box);
    expect(r.positions.bounds.x).toBeLessThanOrEqual(s1.x);
  });

  it("lists the groups of a mode and returns positions unchanged for none", () => {
    expect(laneGroups(g, "stages").map((x) => x.id)).toEqual(["s3", "s1", "s2"]);
    expect(laneGroups(g, "roles").map((x) => x.id)).toEqual(["role"]);
    expect(laneGroups(g, "none")).toEqual([]);
    const r = laneBands(g, positions, { lanes: "none" });
    expect(r.positions).toBe(positions);
    expect(r.bands).toEqual([]);
  });

  it("orders the bands of an ELK layout of the fixture along the flow and keeps every member inside its band", async () => {
    const graph = abstract(vendorScene, { minEdgeShare: 0.02 });
    const p = await layout(graph, { engine: "elk" });
    const r = laneBands(graph, p, { lanes: "stages" });
    const withMembers = (graph.groups ?? []).filter((gr) => gr.kind === "stage" && graph.nodes.some((n) => n.group === gr.id && p.nodes[n.id]));
    expect(r.bands).toHaveLength(withMembers.length);
    expect(r.bands.length).toBeGreaterThan(1);
    for (let i = 1; i < r.bands.length; i++) expect(r.bands[i].box.x).toBeCloseTo(r.bands[i - 1].box.x + r.bands[i - 1].box.width);
    for (const n of graph.nodes) {
      const band = r.bands.find((b) => b.id === n.group);
      if (band && p.nodes[n.id]) {
        const centre = p.nodes[n.id].x + p.nodes[n.id].width / 2;
        expect(centre).toBeGreaterThanOrEqual(band.box.x);
        expect(centre).toBeLessThanOrEqual(band.box.x + band.box.width);
      }
    }
    expect(r.positions.nodes).toEqual(p.nodes);
  });
});

describe("role lanes", () => {
  const g: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: "A", group: "L1" },
      { id: "b", kind: "activity", label: "B", group: "L1" },
      { id: "c", kind: "activity", label: "C", tags: ["role:Warehouse"] },
      { id: "d", kind: "activity", label: "D" },
    ],
    edges: [
      { id: "a->b", kind: "follows", source: "a", target: "b" },
      { id: "a->c", kind: "follows", source: "a", target: "c" },
      { id: "c->d", kind: "follows", source: "c", target: "d" },
    ],
    groups: [
      { id: "L1", kind: "lane", label: "Requester" },
      { id: "L2", kind: "lane", label: "Warehouse" },
    ],
  };
  const positions = given(
    {
      a: { x: 0, y: 0, width: 180, height: 48 },
      b: { x: 300, y: 100, width: 180, height: 48 },
      c: { x: 300, y: 50, width: 180, height: 48 },
      d: { x: 600, y: 150, width: 180, height: 48 },
    },
    {},
    {
      "a->b": { points: [{ x: 180, y: 24 }, { x: 300, y: 124 }] },
      "a->c": { points: [{ x: 180, y: 24 }, { x: 300, y: 74 }] },
      "c->d": { points: [{ x: 480, y: 74 }, { x: 600, y: 174 }] },
    },
  );

  it("assigns lanes by group, by tag and along the paths", () => {
    const lanes = laneGroups(g, "roles");
    const assignment = laneAssignment(g, lanes);
    expect(assignment.get("a")).toBe("L1");
    expect(assignment.get("b")).toBe("L1");
    expect(assignment.get("c")).toBe("L2");
    expect(assignment.get("d")).toBe("L2");
  });

  it("stacks the lanes across the flow, moves every node into its lane and keeps the routes inside a lane", () => {
    const r = laneBands(g, positions, { lanes: "roles" });
    expect(r.mode).toBe("roles");
    expect(r.bands.map((b) => b.id)).toEqual(["L1", "L2"]);
    expect(r.bands.every((b) => b.axis === "cross")).toBe(true);
    const [l1, l2] = r.bands.map((b) => b.box);
    expect(l1.y + l1.height).toBeLessThanOrEqual(l2.y);
    expect(l1.x).toBe(l2.x);
    expect(l1.width).toBe(l2.width);
    for (const id of ["a", "b"]) expect(inside(r.positions.nodes[id], l1, "y")).toBe(true);
    for (const id of ["c", "d"]) expect(inside(r.positions.nodes[id], l2, "y")).toBe(true);
    for (const id of ["a", "b", "c", "d"]) expect(r.positions.nodes[id].x).toBe(positions.nodes[id].x);
    // The route inside a lane moved with its nodes; the route across lanes is dropped.
    const shift = r.positions.nodes.a.y - positions.nodes.a.y;
    expect(r.positions.edges["a->b"].points.map((p) => p.y)).toEqual([24 + shift, 124 + shift]);
    expect(r.positions.edges["c->d"]).toBeDefined();
    expect(r.positions.edges["a->c"]).toBeUndefined();
    expect(r.positions.groups.L1).toEqual(l1);
    expect(r.positions.bounds.height).toBeGreaterThanOrEqual(l2.y + l2.height - l1.y);
  });

  it("returns the positions as they are when the graph has no lane groups", () => {
    const noLanes: FlowGraph = { ...g, groups: [] };
    const r = laneBands(noLanes, positions, { lanes: "roles" });
    expect(r.positions).toBe(positions);
    expect(r.bands).toEqual([]);
  });
});
