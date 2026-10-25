/**
 * Stage-partitioned layout (WF-14): with `stages: "partition"` ELK places
 * every activity in its top-level stage's partition, in stage order, without
 * compound nodes; Start before every stage and End after; a path back to an
 * earlier stage is laid out reversed and drawn the way it runs; the stage
 * boxes are drawn around their members and do not overlap along the flow.
 */
import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Positions, abstract, layout } from "../../src/index";

const shown = abstract(globalScene, { activityDetail: 12 / 42, pathDetail: 36 / 677 } as never);
const stageOrder = (shown.groups ?? []).filter((g) => g.kind === "stage" && !g.parent).map((g) => g.id);

const extent = (positions: Positions, ids: string[]) => {
  const boxes = ids.flatMap((id) => positions.nodes[id] ?? []);
  return [Math.min(...boxes.map((b) => b.x)), Math.max(...boxes.map((b) => b.x + b.width))] as const;
};

describe("a stage-partitioned layout", () => {
  it("puts every activity in its stage's columns, the stages in order, Start before them and End after", async () => {
    const positions = await layout(shown, { engine: "elk", stages: "partition", edgeRouting: "ORTHOGONAL" });
    const members = (stage: string) => shown.nodes.filter((n) => n.kind === "activity" && n.group === stage).map((n) => n.id);
    const staged = stageOrder.filter((s) => members(s).length);
    expect(staged.length).toBeGreaterThan(1);
    for (let i = 1; i < staged.length; i++) {
      const [, before] = extent(positions, members(staged[i - 1]));
      const [after] = extent(positions, members(staged[i]));
      expect(after, `${staged[i - 1]} before ${staged[i]}`).toBeGreaterThan(before);
    }
    const events = shown.nodes.filter((n) => n.kind === "event");
    const activities = shown.nodes.filter((n) => n.kind === "activity").map((n) => n.id);
    const [first, last] = extent(positions, activities);
    for (const e of events) {
      const b = positions.nodes[e.id];
      if (e.tags?.includes("start")) expect(b.x + b.width).toBeLessThanOrEqual(first);
      if (e.tags?.includes("end")) expect(b.x).toBeGreaterThanOrEqual(last);
    }
    // No compound nodes: the stage boxes are drawn around their members, with room for the title.
    for (const s of staged) {
      const box = positions.groups[s];
      const [x0, x1] = extent(positions, members(s));
      expect(box.x).toBeLessThan(x0);
      expect(box.x + box.width).toBeGreaterThan(x1);
    }
  });

  it("draws a path back to an earlier stage from its source to its target", async () => {
    const g: FlowGraph = {
      nodes: [
        { id: "a", kind: "activity", label: "A", group: "s1" },
        { id: "b", kind: "activity", label: "B", group: "s2" },
        { id: "c", kind: "activity", label: "C", group: "s3" },
      ],
      edges: [
        { id: "ab", kind: "follows", source: "a", target: "b" },
        { id: "bc", kind: "follows", source: "b", target: "c" },
        { id: "ca", kind: "follows", source: "c", target: "a" },
      ],
      groups: [{ id: "s1", kind: "stage", label: "S1" }, { id: "s2", kind: "stage", label: "S2" }, { id: "s3", kind: "stage", label: "S3" }],
    };
    const p = await layout(g, { engine: "elk", stages: "partition" });
    expect(p.nodes.a.x).toBeLessThan(p.nodes.b.x);
    expect(p.nodes.b.x).toBeLessThan(p.nodes.c.x);
    const route = p.edges.ca.points;
    const near = (pt: { x: number; y: number }, id: string) => {
      const b = p.nodes[id];
      return pt.x >= b.x - 2 && pt.x <= b.x + b.width + 2 && pt.y >= b.y - 2 && pt.y <= b.y + b.height + 2;
    };
    expect([near(route[0], "c"), near(route.at(-1)!, "a")]).toEqual([true, true]);
  });

  it("is no wider than the compound layout of the same graph, and keeps the compound layout as the default", async () => {
    const compound = await layout(shown, { engine: "elk", edgeRouting: "ORTHOGONAL" });
    const partitioned = await layout(shown, { engine: "elk", stages: "partition", edgeRouting: "ORTHOGONAL" });
    expect(partitioned.bounds.width).toBeLessThanOrEqual(compound.bounds.width * 1.05);
    expect(await layout(shown, { engine: "elk", edgeRouting: "ORTHOGONAL", stages: "compound" })).toEqual(compound);
  });
});
