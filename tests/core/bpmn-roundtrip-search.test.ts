import { describe, expect, it } from "vitest";
import { exportBpmn, importBpmn } from "../../src/bpmn/headless";
import type { FlowEdge, FlowGraph, FlowGroup, FlowNode } from "../../src/index";
import { AWKWARD_LABELS, generatedModel } from "../support/models";
import { caseCount, caseLabel, createRandom, seeds } from "../support/random";
import { positionsOf } from "../support/scenes";

// What a model is, for the round trip: ids, kinds, labels, lanes and their nesting,
// flows with their ends, tags (default flows, loop markers, gateway kinds) and metrics.
// Tags are a set; the payload a builder adds (the path a flow replaces) is not BPMN.
const tagSet = (tags: string[] | undefined) => [...new Set(tags ?? [])].sort();
const nodeOf = (n: FlowNode) => ({ id: n.id, kind: n.kind, label: n.label, group: n.group, tags: tagSet(n.tags), metrics: n.metrics ?? {} });
const edgeOf = (e: FlowEdge) => ({ id: e.id, kind: e.kind, source: e.source, target: e.target, tags: tagSet(e.tags), metrics: e.metrics ?? {} });
const groupOf = (g: FlowGroup) => ({ id: g.id, kind: g.kind, label: g.label, parent: g.parent });

/**
 * The model without the pool the export wraps around lanes (a collaboration
 * with one participant, as Camunda Modeler writes it): the pool group goes, and
 * what pointed at it points nowhere, as before the export.
 */
function withoutAddedPool(back: FlowGraph, original: FlowGraph): FlowGraph {
  const known = new Set((original.groups ?? []).map((g) => g.id));
  const added = new Set((back.groups ?? []).filter((g) => g.kind === "pool" && !known.has(g.id)).map((g) => g.id));
  const drop = (id: string | undefined) => (id !== undefined && added.has(id) ? undefined : id);
  const groups = (back.groups ?? []).filter((g) => !added.has(g.id)).map((g) => ({ ...g, parent: drop(g.parent) }));
  return { ...back, nodes: back.nodes.map((n) => ({ ...n, group: drop(n.group) })), groups: groups.length ? groups : undefined };
}

// Lanes are a tree: BPMN writes a lane's children inside it, so the flat list comes back
// depth first. What counts is each lane, its parent and the order of its siblings.
function shape(g: FlowGraph) {
  const groups = g.groups ?? [];
  const siblings = Object.fromEntries([...new Set(groups.map((x) => x.parent ?? ""))].map((parent) => [parent, groups.filter((x) => (x.parent ?? "") === parent).map((x) => x.id)]));
  return { nodes: g.nodes.map(nodeOf), edges: g.edges.map(edgeOf), groups: groups.map(groupOf).sort((a, b) => (a.id < b.id ? -1 : 1)), siblings };
}

describe("export → import of generated models", () => {
  it("gives back the same model: ids, kinds, flows, lanes, default flows and loop markers", async () => {
    let flows = 0;
    let defaults = 0;
    let loops = 0;
    let lanes = 0;
    let renamed = 0;
    const count = caseCount(300);
    for (const seed of seeds(count)) {
      const rng = createRandom(seed);
      const { model, describe: what } = generatedModel(seed, { awkward: rng.chance(0.5), defaults: true, maxSize: 10 });
      const label = caseLabel(seed, what);
      const positions = positionsOf(model, "grid", seed, { routes: true });
      const out = await exportBpmn(model, { positions, format: rng.chance(0.5) });
      const back = await importBpmn(out.xml);
      expect(back.warnings, label).toEqual([]);
      expect(out.warnings, label).toEqual([]);
      expect(shape(withoutAddedPool(back.graph, model)), label).toEqual(shape(model));
      // The diagram keeps every box where the export put it.
      for (const n of model.nodes) expect(back.positions?.nodes[n.id], label).toEqual(out.positions.nodes[n.id]);
      flows += model.edges.length;
      defaults += model.edges.filter((e) => e.tags?.includes("default")).length;
      loops += model.nodes.filter((n) => n.tags?.includes("loop")).length;
      lanes += model.groups?.length ?? 0;
      renamed += Object.entries(out.ids.toBpmn).filter(([flowId, xmlId]) => flowId !== xmlId).length;
    }
    // The cases must hold what the round trip is about.
    expect(Math.min(defaults, loops, lanes, renamed)).toBeGreaterThan(count / 10);
    console.log(`round trip: ${count} models, ${flows} flows, ${defaults} default flows, ${loops} loop markers, ${lanes} lanes, ${renamed} ids made XML-safe`);
  });

  it("keeps labels with markup characters unchanged and writes them escaped", async () => {
    const markup = AWKWARD_LABELS.filter((l) => /[<>&"']/.test(l));
    const model: FlowGraph = {
      nodes: [
        { id: "start", kind: "event", label: "Start <here>", tags: ["start"] },
        ...markup.map((label, i): FlowNode => ({ id: `t${i}`, kind: "activity", label, group: "lane", tags: ["task"] })),
        { id: "end", kind: "event", label: 'End & "done"', tags: ["end"] },
      ],
      edges: ["start", ...markup.map((_, i) => `t${i}`), "end"].slice(1).map((target, i, all): FlowEdge => {
        const source = i === 0 ? "start" : `t${i - 1}`;
        return { id: `${source}->${target}`, kind: "flow", source, target, payload: { label: markup[i % markup.length] } };
      }),
      groups: [{ id: "lane", kind: "lane", label: "<Lane> & 'roles'" }],
    };
    const out = await exportBpmn(model, { positions: positionsOf(model, "grid", 1, { routes: true }) });
    const back = await importBpmn(out.xml);
    expect(back.graph.nodes.map((n) => n.label)).toEqual(model.nodes.map((n) => n.label));
    expect(back.graph.edges.map((e) => (e.payload as { label?: string }).label)).toEqual(model.edges.map((e) => (e.payload as { label?: string }).label));
    expect(back.graph.groups?.find((g) => g.id === "lane")?.label).toBe("<Lane> & 'roles'");
    // Escaped in the XML: every attribute value holds no markup character except in a
    // reference, and decodes (by the rules of XML, written out here) to its label.
    const values = [...out.xml.matchAll(/ name="([^"]*)"/g)].map((m) => m[1]);
    for (const value of values) expect(value).toMatch(/^(?:[^<>&"]|&(?:#\d+|#x[0-9a-fA-F]+|lt|gt|amp|quot|apos);)*$/);
    const named: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
    const decode = (v: string) => v.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (_, r: string) => (r.startsWith("#x") ? String.fromCodePoint(parseInt(r.slice(2), 16)) : r.startsWith("#") ? String.fromCodePoint(Number(r.slice(1))) : named[r]));
    for (const label of [...markup, "Start <here>", 'End & "done"', "<Lane> & 'roles'"]) expect(values.map(decode), label).toContain(label);
    expect(out.xml).not.toMatch(/<script|<b>|<\/text>/);
  });
});
