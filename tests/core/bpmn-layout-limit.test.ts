import type { ELK } from "elkjs/lib/elk-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FlowGraph, LayoutUnavailableError } from "../../src/index";
import { exportBpmn, layoutBpmn } from "../../src/bpmn/headless";

afterEach(() => vi.unstubAllGlobals());

/** A start event, `n` tasks and an end event in a row: n + 2 nodes and n + 1 flows. */
function row(n: number): FlowGraph {
  const ids = ["start", ...Array.from({ length: n }, (_, k) => `t${k}`), "end"];
  return {
    nodes: ids.map((id, k) => (k === 0 || k === ids.length - 1 ? { id, kind: "event", label: id, tags: [id] } : { id, kind: "activity", label: `Task ${id}`, tags: ["task"] })),
    edges: ids.slice(1).map((id, k) => ({ id: `f${k}`, kind: "flow", source: ids[k], target: id })),
  };
}

// 300 tasks: 302 nodes and 301 flows, above the fallback limit of 500 nodes plus edges.
const large = row(300);
const failing = { layout: () => Promise.reject(new Error("engine down")) } as unknown as ELK;

describe("the BPMN layout's Dagre fallback where no Worker exists", () => {
  it("lays out a model above the fallback limit, as there is no page to freeze", async () => {
    expect(typeof Worker).toBe("undefined");
    const positions = await layoutBpmn(large, { elk: failing });
    expect(positions.engine).toBe("dagre");
    expect(Object.keys(positions.nodes)).toHaveLength(302);
    const { xml } = await exportBpmn(large, { layout: { elk: failing } });
    expect(xml.match(/<bpmn:task /g)).toHaveLength(300);
  });

  it("keeps a limit the caller gives", async () => {
    await expect(layoutBpmn(large, { elk: failing, fallbackLimit: 500 })).rejects.toBeInstanceOf(LayoutUnavailableError);
  });

  it("keeps the limit where a Worker exists, as in a browser", async () => {
    vi.stubGlobal("Worker", class {});
    await expect(layoutBpmn(large, { elk: failing })).rejects.toBeInstanceOf(LayoutUnavailableError);
    await expect(exportBpmn(large, { layout: { elk: failing } })).rejects.toBeInstanceOf(LayoutUnavailableError);
    // Below the limit the fallback runs on the calling thread there too.
    expect((await layoutBpmn(row(100), { elk: failing })).engine).toBe("dagre");
  });
});
