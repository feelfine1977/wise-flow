/**
 * Finding: ids that name a member of `Object.prototype` (`__proto__`,
 * `constructor`, `toString`, …) are not opaque everywhere. Positions and many
 * tables of the library are plain objects keyed by id: `__proto__` cannot be
 * stored as a key of its own, and a lookup of `constructor` finds the
 * prototype's member where nothing was stored. Dagre no longer writes such ids
 * into `Object.prototype` (see the layout tests); whether the library should
 * support them in every record, and how, is an open decision. This test pins
 * what happens today, so that a change shows.
 */
import { describe, expect, it } from "vitest";
import { createIdMap, createIdResolver, exportBpmn, importBpmn, registerId } from "../../src/bpmn/headless";
import { type FlowGraph, buildScene, filterPositions, toSVG, validateGraph } from "../../src/index";
import { positionsOf } from "../support/scenes";

const graphOf = (id: string): FlowGraph => ({
  nodes: [
    { id, kind: "activity", label: "Odd", metrics: { cases: 3 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 2 } },
  ],
  edges: [{ id: `${id}->b`, kind: "follows", source: id, target: "b", metrics: { count: 2 } }],
});

describe("finding: ids named like members of Object.prototype", () => {
  it("pass validation and reach the scene", () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      const g = graphOf(id);
      expect(validateGraph(g), id).toEqual([]);
      expect(buildScene(g, positionsOf(g, "grid", 1)).nodeMarks.map((m) => m.id), id).toEqual([id, "b"]);
    }
  });

  it("__proto__ is stored on a record's prototype: positions do not hold it as their own, filtering drops it, the SVG export fails", () => {
    const g = graphOf("__proto__");
    const p = positionsOf(g, "grid", 1);
    expect(Object.prototype.hasOwnProperty.call(p.nodes, "__proto__")).toBe(false);
    expect(Object.keys(filterPositions(p, g).nodes)).toEqual(["b"]);
    expect(() => toSVG({ graph: g, positions: p })).toThrow(TypeError);
  });

  it("an activity mapped under such an id fails the id resolver, and the BPMN round trip loses the node", async () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      const ids = createIdMap();
      registerId(ids, "Task_1", "x");
      expect(() => createIdResolver({ ids, mapping: { [id]: "Task_1" } }).names("Task_1"), id).toThrow(TypeError);
      const back = await importBpmn((await exportBpmn(graphOf(id))).xml);
      expect(back.graph.nodes.map((n) => n.id), id).toEqual(["b"]);
    }
  });
});
