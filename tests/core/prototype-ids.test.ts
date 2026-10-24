/**
 * Ids that name a member of `Object.prototype` (`__proto__`, `constructor`,
 * `toString`, …) are reserved. Positions and many tables of the library are
 * plain objects keyed by id: `__proto__` cannot be stored as a key of its own,
 * and a lookup of `constructor` finds the prototype's member where nothing was
 * stored. Validation reports such an id as an error, and the exports refuse a
 * graph with one with the library's `InvalidGraphError` instead of failing
 * somewhere inside with a `TypeError`.
 */
import { describe, expect, it } from "vitest";
import { createIdMap, createIdResolver, exportBpmn, registerId } from "../../src/bpmn/headless";
import { type DrawContext, toPNG, toPNGCanvas, toPNGDataUrl } from "../../src/canvas/index";
import { type FlowGraph, InvalidGraphError, toSVG, validateGraph } from "../../src/index";
import { positionsOf } from "../support/scenes";

const RESERVED = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];

/** A graph of two activities and a path, with `id` as the first activity's, the path's or the stage's id. */
const graphOf = (id: string, where: "node" | "edge" | "group"): FlowGraph => ({
  nodes: [
    { id: where === "node" ? id : "a", kind: "activity", label: "Odd", metrics: { cases: 3 }, ...(where === "group" ? { group: id } : {}) },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 2 } },
  ],
  edges: [{ id: where === "edge" ? id : "a->b", kind: "follows", source: where === "node" ? id : "a", target: "b", metrics: { count: 2 } }],
  ...(where === "group" ? { groups: [{ id, kind: "stage" as const, label: "Stage" }] } : {}),
});

/** A canvas whose context does nothing and can say what it drew as a PNG. */
const canvas = (width: number, height: number) => {
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (own, key) => (key in own ? own[key] : key === "measureText" ? (s: string) => ({ width: s.length * 6 }) : () => ({ addColorStop() {} })),
    set: (own, key, value) => ((own[key] = value), true),
  }) as unknown as DrawContext;
  return { width, height, getContext: () => ctx, toDataURL: () => "data:image/png;base64,", convertToBlob: async () => new Blob() };
};

describe("ids named like members of Object.prototype", () => {
  it("are an error of validation, for nodes, edges and groups, and ids that only resemble them are not", () => {
    for (const where of ["node", "edge", "group"] as const) {
      for (const id of RESERVED) expect(validateGraph(graphOf(id, where)), `${where} ${id}`).toEqual([{ level: "error", message: "reserved id", id }]);
      for (const id of ["proto", "Constructor", "tostring", "__proto"]) expect(validateGraph(graphOf(id, where)), `${where} ${id}`).toEqual([]);
    }
  });

  it("make the SVG, PNG and BPMN exports fail with the library's error, which names them", async () => {
    for (const where of ["node", "edge", "group"] as const) {
      for (const id of RESERVED) {
        const graph = graphOf(id, where);
        const scene = { graph, positions: positionsOf(graph, "grid", 1) };
        const expected = { name: "InvalidGraphError", message: `reserved id: ${id}`, issues: [{ level: "error", message: "reserved id", id }] };
        const failure = (f: () => unknown) => {
          try {
            f();
          } catch (error) {
            return error;
          }
          return undefined;
        };
        for (const [name, error] of [
          ["toSVG", failure(() => toSVG(scene))],
          ["toPNGCanvas", failure(() => toPNGCanvas(scene, { createCanvas: canvas }))],
          ["toPNGDataUrl", failure(() => toPNGDataUrl(scene, { createCanvas: canvas }))],
          ["toPNG", await toPNG(scene, { createCanvas: canvas }).then(() => undefined, (e: unknown) => e)],
          ["exportBpmn", await exportBpmn(graph).then(() => undefined, (e: unknown) => e)],
        ] as const) {
          expect(error, `${name}, ${where} ${id}`).toBeInstanceOf(InvalidGraphError);
          expect(error, `${name}, ${where} ${id}`).toMatchObject(expected);
        }
      }
    }
    // The same graph with an ordinary id exports.
    const graph = graphOf("a", "node");
    expect(toSVG({ graph, positions: positionsOf(graph, "grid", 1) })).toContain("<svg");
    expect((await exportBpmn(graph)).xml).toContain("bpmn:task");
  });

  it("cannot be held as their own by a record: positions drop __proto__, and a mapping under such an id fails the id resolver", () => {
    const g = graphOf("__proto__", "node");
    expect(Object.prototype.hasOwnProperty.call(positionsOf(g, "grid", 1).nodes, "__proto__")).toBe(false);
    for (const id of ["__proto__", "constructor", "toString"]) {
      const ids = createIdMap();
      registerId(ids, "Task_1", "x");
      expect(() => createIdResolver({ ids, mapping: { [id]: "Task_1" } }).names("Task_1"), id).toThrow(TypeError);
    }
  });
});
