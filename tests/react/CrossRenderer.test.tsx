import { cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type DrawContext, type PreparedScene, drawScene, prepareScene } from "../../src/canvas/index";
import { liteFromGraph } from "../../src/bpmn/index";
import { type EdgeKind, type FlowGraph, type NodeKind, type Positions, abstract, estimateTextWidth, layout, toSVG } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

/**
 * What each renderer writes per element: node id or edge id → its texts in
 * order. An element missing from a map is not drawn by that renderer.
 */
type Written = { nodes: Map<string, string[]>; edges: Map<string, string[]> };

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textsOf = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unescape(m[1]));

function fromSVG(graph: FlowGraph, positions: Positions): Written {
  const svg = toSVG({ graph, positions }, { legend: false });
  const nodes = new Map([...svg.matchAll(/<g class="wf-node wf-node-\w+" data-id="([^"]+)">([^]*?)<\/g>/g)].map((m) => [unescape(m[1]), textsOf(m[2])]));
  const edges = new Map([...svg.matchAll(/<g class="wf-edge" data-id="([^"]+)">([^]*?)<\/g>/g)].map((m) => [unescape(m[1]), textsOf(m[2])]));
  return { nodes, edges };
}

/** A 2D context that keeps the written texts and measures them as the core estimate does. */
function writingContext() {
  const texts: string[] = [];
  let font = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === "measureText") return (s: string) => ({ width: estimateTextWidth(s, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) }) });
      if (key === "fillText") return (s: string) => texts.push(s);
      if (key === "font") return font;
      return () => undefined;
    },
    set: (_t, key: string, value) => {
      if (key === "font") font = value;
      return true;
    },
  }) as unknown as DrawContext;
  return { ctx, texts };
}

function fromCanvas(graph: FlowGraph, positions: Positions): Written {
  const scene = prepareScene(graph, positions, { lodBySize: false });
  // One element at a time, so that every written text belongs to it.
  const written = (only: Partial<PreparedScene>) => {
    const { ctx, texts } = writingContext();
    drawScene(ctx, { ...scene, nodes: [], edges: [], groups: [], marks: [], ...only }, { x: 0, y: 0, zoom: 1, width: 1, height: 1 }, undefined, { cull: false, createCanvas: () => null });
    return texts;
  };
  return {
    nodes: new Map(scene.nodes.map((n) => [n.node.id, written({ nodes: [n] })])),
    edges: new Map(scene.edges.map((e) => [e.edge.id, written({ edges: [e] })])),
  };
}

async function fromReact(graph: FlowGraph, positions: Positions): Promise<Written> {
  const { container } = render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} renderer="svg" controls={false} legend={false} fitView={false} selfLoops={false} contextMenu={false} pathList={false} />
    </div>,
  );
  const drawable = graph.edges.filter((e) => e.source !== e.target);
  await waitFor(() => expect(container.querySelectorAll(".wf-edge").length).toBe(drawable.length));
  const nodes = new Map<string, string[]>();
  for (const el of container.querySelectorAll<HTMLElement>(".react-flow__node .wf-node")) {
    nodes.set(el.id.replace(/^wf-node-/, ""), [...el.querySelectorAll(".wf-node__label, .wf-node__meta, .wf-activity-name > span, .wf-activity-counts > span")].map((t) => t.textContent ?? ""));
  }
  const edges = new Map<string, string[]>();
  for (const el of container.querySelectorAll<SVGGElement>("g.wf-edge")) {
    edges.set(el.getAttribute("data-id")!, [...el.querySelectorAll(".wf-edge-label")].map((t) => t.textContent ?? ""));
  }
  cleanup();
  return { nodes, edges };
}

// The committed fixtures: the BPIC map, its stage view, its BPMN-lite model, and
// the map with a note and a constraint edge on two of its activities.
const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const annotated: FlowGraph = {
  ...global,
  nodes: [...global.nodes, { id: "note", kind: "note", label: "Invoices are cleared after the goods receipt" }],
  edges: [
    ...global.edges,
    { id: "goods->clear", kind: "constraint", source: "record_goods_receipt", target: "clear_invoice", payload: { constraintId: "precedence" } },
    { id: "note->clear", kind: "constraint", source: "note", target: "clear_invoice", metrics: { count: 3 } },
  ],
};
const graphs = { annotated, stages: abstract(globalScene, { collapse: "all" }), lite: liteFromGraph(global) };

const renderers: Record<string, Record<"svg" | "canvas" | "react", Written>> = {};
const shown: Record<string, FlowGraph> = {};
beforeAll(async () => {
  for (const [name, graph] of Object.entries(graphs)) {
    const positions = await layout(graph, { engine: "dagre" });
    shown[name] = graph;
    renderers[name] = { svg: fromSVG(graph, positions), canvas: fromCanvas(graph, positions), react: await fromReact(graph, positions) };
  }
}, 60000);
afterAll(cleanup);

function agree(kind: NodeKind | EdgeKind, side: "nodes" | "edges") {
  let seen = 0;
  for (const [name, graph] of Object.entries(shown)) {
    const ids = new Set((side === "nodes" ? graph.nodes : graph.edges).filter((e) => e.kind === kind).map((e) => e.id));
    const of = (r: Written) => new Map([...r[side]].filter(([id]) => ids.has(id)).sort(([a], [b]) => (a < b ? -1 : 1)));
    const { svg, canvas, react } = renderers[name];
    expect(of(canvas), `${name}: Canvas and SVG`).toEqual(of(svg));
    expect(of(react), `${name}: React and SVG`).toEqual(of(svg));
    seen += of(svg).size;
  }
  return seen;
}

describe("SVG, Canvas and React agree on the committed fixtures", () => {
  it.each(["activity", "stage", "gateway", "event", "note"] as const)("on the texts and presence of every %s", (kind) => {
    expect(agree(kind, "nodes")).toBeGreaterThan(0);
  });

  it.each(["follows", "constraint", "flow"] as const)("on the count labels and presence of every %s edge", (kind) => {
    expect(agree(kind, "edges")).toBeGreaterThan(0);
  });

  it("writes what the map shows for each kind", () => {
    const { nodes, edges } = renderers.annotated.svg;
    // Activities: label and cases; notes: their label, cut to 136 at 6.05 per character.
    expect(nodes.get("clear_invoice")).toEqual(["Clear Invoice", expect.stringMatching(/^\d+k$/)]);
    expect(nodes.get("note")).toEqual(["Invoices are cleared …"]);
    expect(edges.get("goods->clear")).toEqual([]);
    expect(edges.get("note->clear")).toEqual(["3"]);
    // Gateways show their glyph; stages their members before the cases; flow edges their count.
    const lite = renderers.lite.svg;
    expect(new Set(shown.lite.nodes.filter((n) => n.kind === "gateway").map((n) => lite.nodes.get(n.id)?.join("")))).toEqual(new Set(["×"]));
    expect(renderers.stages.svg.nodes.get("payment")?.[1]).toMatch(/^\d+ · /);
    expect(shown.lite.edges.filter((e) => e.kind === "flow").every((e) => lite.edges.get(e.id)?.length === 1)).toBe(true);
  });
});
