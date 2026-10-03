import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Overlay, type Positions, FIGURE_WIDTHS, abstract, layout, overlaysFor, toSVG } from "../../src/index";
import * as kinds from "./overlay-kinds";

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

describe("toSVG overlay marks", () => {
  const svg = toSVG({ graph: kinds.graph, positions: kinds.positions, overlays: kinds.overlays, selfLoops: false }, { legend: false });
  const marks = svg.match(/<g class="wf-overlay[^]*?<\/g>/g) ?? [];
  const halo = 'fill="#1f1f1f" paint-order="stroke" stroke="#ffffff" stroke-width="3"';
  const arrow = 'marker-end="url(#wf-overlay-arrow)"';

  it("maps every mark to SVG primitives", () => {
    expect(svg).toContain('<marker id="wf-overlay-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="12" markerHeight="12" orient="auto-start-reverse" markerUnits="userSpaceOnUse">');
    expect(marks).toEqual([
      '<g class="wf-overlay wf-tint"><title>Balance — 50 % above</title><rect x="190" y="-10" width="320" height="60" rx="10" fill="#fd8d3c" fill-opacity="0.18" stroke="none"/></g>',
      '<g class="wf-overlay wf-hatch"><title>Scope — Out of scope</title><rect x="0" y="0" width="100" height="40" rx="6" fill="url(#wf-pattern-outofscope)" fill-opacity="0.55" stroke="none"/></g>',
      `<g class="wf-overlay wf-arc"><title></title><path d="M50 0 C50 -88 450 -88 450 0" fill="none" stroke="#fdd0a2" stroke-width="6" stroke-opacity="0.9" ${arrow}/><text x="250" y="-74" font-size="11" text-anchor="middle" ${halo}>⏱ 25 %</text></g>`,
      `<g class="wf-overlay wf-arc"><title></title><path d="M450 40 C450 142 50 142 50 40" fill="none" stroke="#7f2704" stroke-width="2" stroke-opacity="0.9" stroke-dasharray="6 4" ${arrow}/><text x="250" y="130.5" font-size="11" text-anchor="middle" ${halo}>⇐ 100 %</text></g>`,
      `<g class="wf-overlay wf-selfloop"><title></title><path d="M482 0 C482 -28 528 12 500 12" fill="none" stroke="#d94801" stroke-width="2.5" ${arrow}/><text x="506" y="-6" font-size="10" ${halo}>↻ 75 %</text></g>`,
      // Text whose middle is given sits on a baseline 0.3 × its size lower: 0.5 + 3.
      `<g class="wf-overlay wf-badge"><title></title><rect x="76" y="-11" width="22" height="22" rx="11" fill="#7f2704" stroke="#ffffff" stroke-width="1.5"/><text x="87" y="3.5" font-size="10" font-weight="700" text-anchor="middle" fill="#ffffff">●</text><text x="102" y="3.5" font-size="10" ${halo}>100 %</text></g>`,
      `<g class="wf-overlay wf-badge"><title></title><rect x="274" y="-11" width="24" height="22" rx="11" fill="#fdd0a2" stroke="#ffffff" stroke-width="1.5"/><text x="286" y="3.5" font-size="10" font-weight="700" text-anchor="middle" fill="#000000">≥1</text><text x="302" y="3.5" font-size="10" ${halo}>25 %</text></g>`,
      // The map-level chip is listed with the legend only.
      '<g class="wf-overlay wf-chip"><title>Late</title><rect x="442" y="-4" width="60" height="24" rx="12" fill="#ffffff" stroke="#8c8c8c" stroke-width="2"/><text x="450" y="11.5" font-size="10" fill="#1f1f1f">◔ Late</text></g>',
    ]);
  });

  it("shows the share of a badge without a glyph once", () => {
    expect(svg.match(/>100 %</g)).toHaveLength(1);
  });

  it("hatches at opacity 0.55, as the map does", () => {
    expect(marks.filter((m) => m.includes("wf-hatch")).map((m) => /fill-opacity="([^"]+)"/.exec(m)?.[1])).toEqual(["0.55"]);
  });
});
