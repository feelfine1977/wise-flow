import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Theme, PATTERNS, abstract, buildScales, defaultStyle, defaultTheme, hashKey, palettes } from "../../src/index";

/** A graph of one activity per stage, the stages in the given order. */
function staged(ids: string[]): FlowGraph {
  return {
    nodes: ids.map((id) => ({ id: `${id}-a`, kind: "activity", label: id, group: id, metrics: { cases: 1 } })),
    edges: [],
    groups: ids.map((id) => ({ id, kind: "stage", label: id.toUpperCase() })),
  };
}

const swatch = (graph: FlowGraph, id: string, stages?: string[], theme?: Theme) => {
  const e = buildScales(graph, { ...defaultStyle, stages }, theme).categorical(id);
  return `${e.color} ${e.pattern}`;
};

describe("stage colours", () => {
  it("give five stages five colours and five patterns", () => {
    const ids = ["requisition", "order", "receipt", "invoice", "payment"];
    const s = buildScales(globalScene, defaultStyle);
    expect(new Set(ids.map((id) => s.categorical(id).color)).size).toBe(5);
    expect(new Set(ids.map((id) => s.categorical(id).pattern)).size).toBe(5);
    // Every colour keeps its pattern twin.
    for (const id of ids) expect(s.categorical(id).pattern).toBe(PATTERNS[(palettes.categorical as readonly string[]).indexOf(s.categorical(id).color)]);
  });

  it("move a stage whose hashed colour is taken to the next free colour, in stage order", () => {
    const size = palettes.categorical.length;
    // Two keys with the same hashed colour: the first takes it, the second the next one.
    const keys = Array.from({ length: 200 }, (_, i) => `stage-${i}`);
    const first = keys[0];
    const twin = keys.find((k) => k !== first && hashKey(k) % size === hashKey(first) % size)!;
    const graph = staged([first, twin]);
    const at = hashKey(first) % size;
    expect(buildScales(graph).categorical(first).color).toBe(palettes.categorical[at]);
    expect(buildScales(graph).categorical(twin).color).toBe(palettes.categorical[(at + 1) % size]);
    // In the other stage order, the other one keeps the hashed colour.
    expect(buildScales(graph, { ...defaultStyle, stages: [twin, first] }).categorical(twin).color).toBe(palettes.categorical[at]);
  });

  it("keep their colours when the graph is filtered to two stages", () => {
    const all = ["requisition", "order", "receipt", "invoice", "payment"];
    const full = Object.fromEntries(all.map((id) => [id, swatch(globalScene, id)]));
    // A graph with only the invoice and payment stages, coloured over the host's full stage list.
    const two: FlowGraph = { ...globalScene, nodes: globalScene.nodes.filter((n) => n.group === "invoice" || n.group === "payment"), groups: globalScene.groups!.filter((g) => g.id === "invoice" || g.id === "payment") };
    expect(swatch(two, "invoice", all)).toBe(full.invoice);
    expect(swatch(two, "payment", all)).toBe(full.payment);
    // Abstraction keeps the stages' order, so it keeps their colours without the list too.
    const shown = abstract(globalScene, { minNodeShare: 0.3, minEdgeShare: 0.3 });
    for (const g of shown.groups ?? []) expect(swatch(shown, g.id)).toBe(full[g.id]);
  });

  it("tell every pair of stages apart by colour or pattern when there are more stages than colours", () => {
    const ids = Array.from({ length: 2 * palettes.categorical.length + 3 }, (_, i) => `s${i}`);
    const s = buildScales(staged(ids));
    const looks = ids.map((id) => `${s.categorical(id).color} ${s.categorical(id).pattern}`);
    expect(new Set(looks).size).toBe(ids.length);
    // The first eight take the eight colours, each with its twin; the next eight the same colours with the next pattern.
    expect(new Set(ids.slice(0, 8).map((id) => s.categorical(id).color)).size).toBe(8);
    for (const id of ids.slice(8, 16)) {
      const e = s.categorical(id);
      expect(e.pattern).toBe(PATTERNS[(e.index + 1) % PATTERNS.length]);
    }
    // The print theme has seven colours and eight patterns.
    const print: Theme = { ...defaultTheme, palette: { ...defaultTheme.palette, categorical: palettes.categorical.slice(0, 7) } };
    const p = buildScales(staged(ids), defaultStyle, print);
    expect(new Set(ids.map((id) => `${p.categorical(id).color} ${p.categorical(id).pattern}`)).size).toBe(ids.length);
  });
});
