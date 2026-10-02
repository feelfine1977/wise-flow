import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Overlay, type Positions, FIGURE_WIDTHS, abstract, layout, overlaysFor, toSVG } from "../../src/index";

const scene = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });

describe("toSVG", () => {
  it("is deterministic for the same input and independent of element order", async () => {
    const positions = await layout(scene, { engine: "dagre" });
    const overlays = overlaysFor(constraintItems(), { graph: scene });
    const a = toSVG({ graph: scene, positions, overlays, title: "P2P" });
    const b = toSVG({ graph: scene, positions, overlays, title: "P2P" });
    expect(b).toBe(a);
    const shuffled = { ...scene, nodes: [...scene.nodes].reverse(), edges: [...scene.edges].reverse() };
    const c = toSVG({ graph: shuffled, positions, overlays: [...overlays].reverse(), title: "P2P" });
    expect(c).toBe(a);
  });

  it("contains nodes, edges, overlays, a legend and escaped text", async () => {
    const positions = await layout(scene, { engine: "dagre" });
    const overlays = overlaysFor(constraintItems(), { graph: scene });
    const svg = toSVG({ graph: scene, positions, overlays, title: "P2P <map> & co" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('class="wf-node wf-node-activity"');
    expect(svg).toContain('class="wf-edge"');
    expect(svg).toContain('class="wf-legend"');
    expect(svg).toContain("Legend");
    expect(svg).toContain("wf-badge");
    expect(svg).toContain("wf-arc");
    expect(svg).toContain("wf-hatch");
    expect(svg).toContain("wf-tint");
    expect(svg).toContain("wf-selfloop");
    expect(svg).toContain("P2P &lt;map&gt; &amp; co");
    expect(svg).toContain("251,734 cases");
    expect(svg.match(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g)).toBeNull();
    const opens = (svg.match(/<g\b/g) ?? []).length;
    const closes = (svg.match(/<\/g>/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("scales to figure presets and honours level of detail", async () => {
    const positions = await layout(scene, { engine: "dagre" });
    const single = toSVG({ graph: scene, positions }, { preset: "single-column" });
    expect(single).toContain(`width="${FIGURE_WIDTHS["single-column"]}"`);
    const custom = toSVG({ graph: scene, positions }, { width: 500, legend: false });
    expect(custom).toContain('width="500"');
    expect(custom).not.toContain("wf-legend");
    const overlays = overlaysFor(constraintItems(), { graph: scene });
    const zoomedOut = toSVG({ graph: scene, positions, overlays }, { lodZoom: 0.1 });
    expect(zoomedOut).not.toContain("wf-badge");
    expect(zoomedOut).not.toContain("wf-arc");
    const de = toSVG({ graph: scene, positions, overlays, locale: "de", title: "Karte" });
    expect(de).toContain("Legende");
    expect(de).toContain("251.734 Fälle");
  });
});

describe("toSVG overlays", () => {
  const graph: FlowGraph = {
    nodes: [
      { id: "a", kind: "activity", label: "A", metrics: { cases: 4 } },
      { id: "b", kind: "activity", label: "B" },
    ],
    edges: [
      { id: "ab", kind: "follows", source: "a", target: "b", metrics: { count: 5 } },
      { id: "aa", kind: "follows", source: "a", target: "a", metrics: { count: 3, cases: 1 } },
    ],
  };
  const positions: Positions = {
    nodes: { a: { x: 0, y: 0, width: 200, height: 40 }, b: { x: 300, y: 0, width: 100, height: 40 } },
    groups: {},
    edges: {},
    bounds: { x: 0, y: 0, width: 400, height: 40 },
    engine: "dagre",
    direction: "RIGHT",
  };

  it("draws follows self-loops by default and hides them on request", () => {
    const svg = toSVG({ graph, positions }, { legend: false });
    // One case of four repeats a: 25 %.
    expect(svg).toContain('class="wf-overlay wf-selfloop" data-edge-id="aa"');
    expect(svg).toContain(">↻ 25 %</text>");
    expect(toSVG({ graph, positions, selfLoops: false }, { legend: false })).not.toContain("wf-selfloop");
  });

  it("is not affected by overlays on unknown targets", () => {
    // Ten badges on one node: an extra overlay ahead of them used to shift their ids to two digits and reorder them.
    const badges: Overlay[] = Array.from({ length: 10 }, (_, i) => ({ kind: "badge", target: "a", payload: { constraintId: `c${i}`, glyph: String(i) } }));
    const known = toSVG({ graph, positions, overlays: badges, selfLoops: false }, { legend: false });
    const ghost: Overlay = { kind: "tint", target: "ghost", payload: { value: 0.5 } };
    expect(toSVG({ graph, positions, overlays: [ghost, ...badges], selfLoops: false }, { legend: false })).toBe(known);
    const edgeTarget: Overlay = { kind: "hatch", target: "ab" };
    expect(toSVG({ graph, positions, overlays: [edgeTarget, ...badges], selfLoops: false }, { legend: false })).toBe(known);
  });
});
