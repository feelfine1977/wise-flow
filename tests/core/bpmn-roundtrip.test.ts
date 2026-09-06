import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { p2pStages, withSceneMetrics } from "../../fixtures/p2p_stages";
import { POOL_ID, exportBpmn, importBpmn, layoutBpmn, liteFromGraph, liteFromStages, validateBpmn } from "../../src/bpmn/index";
import { abstract } from "../../src/index";

const lite = liteFromStages(withSceneMetrics(p2pStages, globalScene));

describe("layoutBpmn", () => {
  it("stacks lanes as full-width bands inside one pool and keeps shapes apart", async () => {
    const p = await layoutBpmn(lite, { engine: "dagre" });
    const lanes = lite.groups!.map((g) => p.groups[g.id]);
    expect(lanes.every(Boolean)).toBe(true);
    for (let i = 0; i + 1 < lanes.length; i++) {
      expect(lanes[i + 1].y).toBeCloseTo(lanes[i].y + lanes[i].height, 6);
      expect(lanes[i + 1].x).toBe(lanes[i].x);
      expect(lanes[i + 1].width).toBe(lanes[i].width);
    }
    const pool = p.groups[POOL_ID];
    expect(pool.height).toBeCloseTo(lanes.reduce((h, l) => h + l.height, 0), 6);
    for (const n of lite.nodes) {
      const box = p.nodes[n.id];
      const lane = p.groups[n.group!];
      expect(box.y).toBeGreaterThanOrEqual(lane.y);
      expect(box.y + box.height).toBeLessThanOrEqual(lane.y + lane.height);
      expect(box.x).toBeGreaterThanOrEqual(pool.x);
      expect(box.x + box.width).toBeLessThanOrEqual(pool.x + pool.width);
    }
    const boxes = Object.values(p.nodes);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
    for (const e of lite.edges) expect(p.edges[e.id].points.length).toBeGreaterThanOrEqual(2);
  });
});

describe("export → import round trip", () => {
  it("preserves tasks, flows, lanes and ids and opens with DI for every element", async () => {
    const out = await exportBpmn(lite, { layout: { engine: "dagre" }, name: "P2P" });
    expect(out.xml).toContain("<bpmn:definitions");
    expect(out.xml).toContain("<bpmndi:BPMNDiagram");
    expect(out.xml).toContain('xmlns:wise="http://wise-workbench.org/schema/flow"');
    expect(out.warnings).toEqual([]);
    const check = await validateBpmn(out.xml);
    expect(check.warnings).toEqual([]);
    expect(check.missingDi).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.counts.tasks).toBe(lite.nodes.filter((n) => n.kind === "activity").length);
    expect(check.counts.gateways).toBe(lite.nodes.filter((n) => n.kind === "gateway").length);
    expect(check.counts.events).toBe(2);
    expect(check.counts.flows).toBe(lite.edges.length);
    expect(check.counts.lanes).toBe(lite.groups!.length);
    expect(check.counts.shapes).toBe(lite.nodes.length + lite.groups!.length + 1);
    expect(check.counts.edges).toBe(lite.edges.length);

    const back = await importBpmn(out.xml);
    expect(back.warnings).toEqual([]);
    const sortIds = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
    expect(sortIds(back.graph.nodes)).toEqual(sortIds(lite.nodes));
    expect(sortIds(back.graph.edges)).toEqual(sortIds(lite.edges));
    expect(sortIds(back.graph.groups!.filter((g) => g.kind !== "pool"))).toEqual(sortIds(lite.groups!));
    for (const n of lite.nodes) {
      const m = back.graph.nodes.find((x) => x.id === n.id)!;
      expect(m.kind).toBe(n.kind);
      expect(m.label).toBe(n.label);
      expect(m.group).toBe(n.group);
      for (const tag of n.tags ?? []) expect(m.tags).toContain(tag);
      if (n.metrics) expect(m.metrics).toEqual(n.metrics);
    }
    for (const e of lite.edges) {
      const f = back.graph.edges.find((x) => x.id === e.id)!;
      expect([f.source, f.target]).toEqual([e.source, e.target]);
      expect(f.kind).toBe("flow");
    }
    // Positions of the DI are the ones we exported.
    expect(back.positions?.engine).toBe("di");
    for (const n of lite.nodes) expect(back.positions!.nodes[n.id]).toEqual(out.positions.nodes[n.id]);
    // The mapping table lists every task and maps by id against the fixture's activities.
    expect(back.mapping.length).toBe(lite.nodes.filter((n) => n.kind === "activity").length);
    const mapped = await importBpmn(out.xml, { activities: globalScene.nodes.filter((n) => n.kind === "activity").map((n) => ({ id: n.id, label: n.label })) });
    expect(mapped.mapping.every((row) => row.matchedBy === "id" && row.activityId === row.nodeId)).toBe(true);
    // Exporting the re-imported graph on its DI positions reproduces the same XML.
    const again = await exportBpmn(back.graph, { positions: back.positions, name: "P2P" });
    expect(again.xml).toBe(out.xml);
  });

  it("makes ids XML-safe and keeps the original in wise:flowId", async () => {
    const out = await exportBpmn(lite, { layout: { engine: "dagre" } });
    expect(out.ids.toBpmn["__start->gw_skip_requisition"]).toMatch(/^Flow_/);
    expect(out.xml).toContain('wise:flowId="__start-&#62;gw_skip_requisition"');
    for (const id of Object.values(out.ids.toBpmn)) expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]*$/);
    const back = await importBpmn(out.xml, { keepIds: false });
    expect(back.graph.nodes.find((n) => n.id === out.ids.toBpmn["clear_invoice"])).toBeTruthy();
  });

  it("round-trips a BPMN-lite graph derived from the log with gateways and metrics", async () => {
    const graphLite = liteFromGraph(abstract(globalScene, { minNodeShare: 0.05, minEdgeShare: 0.1 }));
    const out = await exportBpmn(graphLite, { layout: { engine: "dagre" } });
    const check = await validateBpmn(out.xml);
    expect(check.ok).toBe(true);
    const back = await importBpmn(out.xml);
    expect(back.graph.nodes.map((n) => n.id).sort()).toEqual(graphLite.nodes.map((n) => n.id).sort());
    expect(back.graph.edges.map((e) => e.id).sort()).toEqual(graphLite.edges.map((e) => e.id).sort());
    const flow = graphLite.edges.find((e) => e.metrics?.count !== undefined)!;
    expect(back.graph.edges.find((e) => e.id === flow.id)?.metrics?.count).toBe(flow.metrics!.count);
    expect(back.graph.nodes.filter((n) => n.kind === "gateway").every((n) => n.tags?.includes("xor"))).toBe(true);
  });
});
