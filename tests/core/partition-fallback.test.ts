/**
 * Workbench #39, route safety of `stages: "partition"`. On the BPI 2019 log
 * ELK threw a NullPointerException for some detail settings, and the layout
 * fell back to Dagre without saying so: diagonal routes through cards and
 * stages out of order. For others ELK laid the partitions out but routed paths
 * behind cards. The contract: a partitioned layout comes from ELK; where ELK's
 * partitions fail or break the routes, the stages are laid out as compound
 * nodes instead, and `positions.stages` says which. No route crosses a card
 * that is not its own, and no route has a diagonal leg.
 */
import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type Box, type FlowGraph, type Positions, abstract, layout, routeFaults } from "../../src/index";

const OPTIONS = { edgeRouting: "ORTHOGONAL", direction: "RIGHT", stages: "partition", orderStages: true } as const;

/** Whether a leg crosses the inside of a box (shrunk by 2), sampled densely. */
const crosses = (a: { x: number; y: number }, c: { x: number; y: number }, b: Box) => {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = a.x + (c.x - a.x) * t, y = a.y + (c.y - a.y) * t;
    if (x > b.x + 2 && x < b.x + b.width - 2 && y > b.y + 2 && y < b.y + b.height - 2) return true;
  }
  return false;
};
const drawnFaults = (graph: FlowGraph, positions: Positions) => {
  const out: string[] = [];
  for (const e of graph.edges) {
    const r = positions.edges[e.id];
    if (!r || e.source === e.target) continue;
    const legs = r.points.slice(1).map((p, i) => [r.points[i], p] as const);
    if (legs.some(([a, c]) => Math.abs(a.x - c.x) > 0.5 && Math.abs(a.y - c.y) > 0.5)) out.push(`${e.id} diagonal`);
    for (const [id, b] of Object.entries(positions.nodes)) if (id !== e.source && id !== e.target && legs.some(([a, c]) => crosses(a, c, b))) out.push(`${e.id} behind ${id}`);
  }
  return out;
};

describe("stage partitions on the BPI log (#39)", () => {
  // Detail settings, as `abstract` takes them: the first two made ELK throw, the third routed paths behind cards.
  for (const [activityDetail, pathDetail] of [[0.45, 0], [0.6, 0], [0.45, 0.12], [0.3, 0], [0.8, 0.12], [1, 0]] as const) {
    it(`activities ${activityDetail}, paths ${pathDetail}: ELK, said how the stages were laid out, no route behind a card or diagonal`, async () => {
      const shown = abstract(globalScene, { activityDetail, pathDetail, collapse: false });
      const positions = await layout(shown, OPTIONS);
      expect(positions.engine).toBe("elk");
      expect(["partition", "compound"]).toContain(positions.stages);
      expect(drawnFaults(shown, positions)).toEqual([]);
      expect(routeFaults(shown, positions)).toEqual([]);
    }, 60_000);
  }

  it("keeps partitions where ELK lays them out cleanly", async () => {
    const shown = abstract(globalScene, { activityDetail: 0.3, pathDetail: 0, collapse: false });
    expect((await layout(shown, OPTIONS)).stages).toBe("partition");
  }, 60_000);

  it("says nothing about stages without them, and `compound` when they are asked for as compounds", async () => {
    const shown = abstract(globalScene, { activityDetail: 0.3, pathDetail: 0, collapse: false });
    expect((await layout({ ...shown, groups: [], nodes: shown.nodes.map(({ group: _g, ...n }) => n) }, OPTIONS)).stages).toBeUndefined();
    expect((await layout(shown, { ...OPTIONS, stages: "compound" })).stages).toBe("compound");
  }, 60_000);
});
