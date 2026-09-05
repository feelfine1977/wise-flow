import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { FIGURE_WIDTHS, abstract, layout, overlaysFor, toSVG } from "../../src/index";

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
