import { describe, expect, it } from "vitest";
import { constraintItems, globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, type Overlay, type Positions, FIGURE_WIDTHS, abstract, layout, overlaysFor, toSVG } from "../../src/index";
import * as elements from "./element-kinds";
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
  const accentHalo = 'fill="#b84a00" paint-order="stroke" stroke="#ffffff" stroke-width="2"';
  const arrow = 'marker-end="url(#wf-overlay-arrow)"';

  it("maps every mark to SVG primitives", () => {
    // The overlay arrowhead in user units: 12 long and wide, its tip 1.2 beyond the path's end.
    expect(svg).toContain('<marker id="wf-overlay-arrow" viewBox="-10.8 -6 12 12" refX="0" refY="0" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1.2 0L-10.8 6L-10.8 -6Z" fill="context-stroke"/></marker>');
    // In paint order: the tint below the edges, the arcs between the edges and the nodes, the rest above the nodes.
    expect(marks).toEqual([
      '<g class="wf-overlay wf-tint"><title>Balance — 50 % above</title><rect x="190" y="-10" width="320" height="60" rx="8" fill="#b84a00" fill-opacity="0.18" stroke="none"/></g>',
      // Arcs one width in the accent, solid; their labels in the accent on a pill of paper outlined in it, over the path.
      // Text whose middle is given sits on a baseline 0.3 × its size lower: −65.5 + 3.3.
      `<g class="wf-overlay wf-arc"><title></title><path d="M50 0 C50 -88 450 -88 450 0" fill="none" stroke="#b84a00" stroke-width="1" stroke-opacity="0.9" ${arrow}/>` +
        `<rect class="wf-pill" x="216.78" y="-75" width="66.45" height="18" rx="9" fill="#ffffff" stroke="#b84a00" stroke-width="1"/><text x="250" y="-62.2" font-size="11" text-anchor="middle" fill="#b84a00">late 25 %</text></g>`,
      `<g class="wf-overlay wf-arc"><title></title><path d="M450 40 C450 142 50 142 50 40" fill="none" stroke="#b84a00" stroke-width="1" stroke-opacity="0.9" ${arrow}/>` +
        `<rect class="wf-pill" x="222.82" y="107.5" width="54.35" height="18" rx="9" fill="#ffffff" stroke="#b84a00" stroke-width="1"/><text x="250" y="120.3" font-size="11" text-anchor="middle" fill="#b84a00">⇐ 100 %</text></g>`,
      '<g class="wf-overlay wf-hatch"><title>Scope — Out of scope</title><rect x="0" y="0" width="100" height="40" rx="4" fill="url(#wf-pattern-outofscope)" fill-opacity="0.55" stroke="none"/></g>',
      `<g class="wf-overlay wf-selfloop"><title></title><path d="M482 0 C482 -28 528 12 500 12" fill="none" stroke="#b84a00" stroke-width="2" ${arrow}/><text x="506" y="-6" font-size="11" ${accentHalo}>↻ 75 %</text></g>`,
      // Badges are pills of paper above the box with the glyph and the share in the accent: −10.5 + 3.3.
      `<g class="wf-overlay wf-badge"><title></title><rect x="33.55" y="-20" width="66.45" height="18" rx="9" fill="#ffffff" stroke="#b84a00" stroke-width="1"/><text x="66.78" y="-7.2" font-size="11" font-weight="600" text-anchor="middle" fill="#b84a00">● · 100 %</text></g>`,
      `<g class="wf-overlay wf-badge"><title></title><rect x="233.55" y="-20" width="66.45" height="18" rx="9" fill="#ffffff" stroke="#b84a00" stroke-width="1"/><text x="266.78" y="-7.2" font-size="11" font-weight="600" text-anchor="middle" fill="#b84a00">≥1 · 25 %</text></g>`,
      // The map-level chip is listed with the legend only.
      '<g class="wf-overlay wf-chip"><title>Late</title><rect x="442" y="-4" width="60" height="24" rx="12" fill="#ffffff" stroke="#b84a00" stroke-width="1"/><text x="450" y="11.8" font-size="11" fill="#1f1f1f">◔</text><text x="462.4" y="11.8" font-size="11" fill="#1f1f1f">Late</text></g>',
    ]);
  });

  it("draws a chip's gauge and its label in bold", () => {
    const chip: Overlay = { kind: "chip", target: "s2", payload: { glyph: "◔", label: "Touches", text: "2.1 ⌀", value: 0.5, gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const drawn = toSVG({ graph: kinds.graph, positions: kinds.positions, overlays: [chip], selfLoops: false }, { legend: false }).match(/<g class="wf-overlay[^]*?<\/g>/g);
    // The chip ends at 502 and is 159.1 wide: padding 16, glyph 12.4, gauge 46 and 14 characters of 6.05 by the estimate.
    // Track 40 × 6 at (363.3, 5) in the line colour, 0.7 of it filled, the tick 2 px wide at 2 / 3 (389.97 − 1).
    expect(drawn).toEqual([
      '<g class="wf-overlay wf-chip"><title>Touches — 2.1 ⌀</title><rect x="342.9" y="-4" width="159.1" height="24" rx="12" fill="#ffffff" stroke="#b84a00" stroke-width="1"/>' +
        '<rect x="363.3" y="5" width="40" height="6" rx="3" fill="#cfd4dc"/><rect x="363.3" y="5" width="28" height="6" fill="#b84a00"/><rect x="388.97" y="4" width="2" height="8" fill="#1f1f1f"/>' +
        '<text x="350.9" y="11.8" font-size="11" fill="#1f1f1f">◔</text><text x="409.3" y="11.8" font-size="11" fill="#1f1f1f"><tspan font-weight="600">Touches: </tspan>2.1 ⌀</text></g>',
    ]);
  });

  it("writes the arcs after the edges and before the nodes and their badges", () => {
    const first = (cls: string) => svg.indexOf(`<g class="${cls}`);
    const last = (cls: string) => svg.lastIndexOf(`<g class="${cls}`);
    // Both edges, then both arcs, then the three nodes, then the badges a and b carry.
    expect(svg.match(/<g class="wf-(edge|overlay wf-arc|node|overlay wf-badge)\b/g)).toEqual([
      '<g class="wf-edge', '<g class="wf-edge', '<g class="wf-overlay wf-arc', '<g class="wf-overlay wf-arc',
      '<g class="wf-node', '<g class="wf-node', '<g class="wf-node', '<g class="wf-overlay wf-badge', '<g class="wf-overlay wf-badge',
    ]);
    expect(last("wf-edge")).toBeLessThan(first("wf-overlay wf-arc"));
    expect(last("wf-overlay wf-arc")).toBeLessThan(first("wf-node"));
    expect(last("wf-node")).toBeLessThan(first("wf-overlay wf-badge"));
  });

  it("shows the share of a badge without a glyph once", () => {
    expect(marks.filter((m) => m.includes("wf-badge")).join("").match(/100 %/g)).toHaveLength(1);
  });

  it("hatches at opacity 0.55, as the map does", () => {
    expect(marks.filter((m) => m.includes("wf-hatch")).map((m) => /fill-opacity="([^"]+)"/.exec(m)?.[1])).toEqual(["0.55"]);
  });
});

describe("toSVG node and edge marks", () => {
  const draw = (lodZoom?: number) => toSVG({ graph: elements.graph, positions: elements.positions, style: elements.style }, { legend: false, lodZoom });
  const groups = (svg: string, kind: "node" | "edge") => svg.match(new RegExp(`<g class="wf-${kind}[^]*?</g>`, "g")) ?? [];
  const halo = 'fill="#1f1f1f" paint-order="stroke" stroke="#ffffff" stroke-width="2"';

  it("draws every node kind from its mark", () => {
    const card = (x: number, y: number, w: number, h: number, dash = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#ffffff" stroke="#8c94a1" stroke-width="1"${dash}/><rect x="${x}" y="${y}" width="8" height="${h}" class="wf-band" rx="4" fill="#8c8c8c"/>`;
    const number = (x: number, y: number, count: string, share: number) => `<text x="${x}" y="${y}" font-size="11" font-weight="600" fill="#1f1f1f">${count}</text><text x="${share}" y="${y}" font-size="11" fill="#5b6270">· –</text>`;
    expect(groups(draw(), "node")).toEqual([
      // The card: its name, then the cases and their share (none without the log's cases), the block in the middle above the foot.
      `<g class="wf-node wf-node-activity" data-id="a">${card(100, 0, 180, 40)}<text x="116" y="16.05" font-size="13" font-weight="500" fill="#1f1f1f">Check invoice</text>${number(116, 30.35, "1,234", 150.25)}</g>`,
      // The event's label sits below its circle.
      '<g class="wf-node wf-node-event" data-id="end"><circle cx="858" cy="20" r="18" fill="#ffffff" stroke="#1f1f1f" stroke-width="2"/><text x="858" y="53" font-size="11" text-anchor="middle" fill="#1f1f1f">End</text></g>',
      // The gateway shows its glyph, not its label; text whose middle is given sits on a baseline 0.3 × its size lower: 21 + 4.5.
      '<g class="wf-node wf-node-gateway" data-id="g"><path d="M342 -2L364 20L342 42L320 20Z" fill="#ffffff" stroke="#1f1f1f" stroke-width="1"/><text x="342" y="25.5" font-size="15" font-weight="600" text-anchor="middle" fill="#1f1f1f">+</text></g>',
      // The note is drawn as a note: surface colour, solid border, no band.
      '<g class="wf-node wf-node-note" data-id="n"><rect x="640" y="0" width="160" height="60" rx="4" fill="#f6f7f9" stroke="#8c8c8c" stroke-width="1"/><text x="656" y="33.3" font-size="11" fill="#1f1f1f">Ask the vendor twice</text></g>',
      `<g class="wf-node wf-node-activity" data-id="r">${card(400, 100, 180, 40, ' stroke-dasharray="4 3"')}<text x="416" y="116.05" font-size="13" font-weight="500" fill="#1f1f1f">Re-added</text>${number(416, 130.35, "–", 426.05)}</g>`,
      // The stage is the same card with a semibold name.
      `<g class="wf-node wf-node-stage" data-id="s">${card(400, 0, 200, 56)}<text x="416" y="24.05" font-size="13" font-weight="600" fill="#1f1f1f">Payment</text>${number(416, 38.35, "1,500", 450.25)}</g>`,
      '<g class="wf-node wf-node-event" data-id="start"><circle cx="18" cy="20" r="18" fill="#ffffff" stroke="#1f1f1f" stroke-width="1"/><text x="18" y="53" font-size="11" text-anchor="middle" fill="#1f1f1f">Start</text></g>',
    ]);
  });

  it("draws a card's frequency cue under its band and texts", () => {
    const counted = { ...elements.graph, meta: { cases: 2468 } };
    const [a] = groups(toSVG({ graph: counted, positions: elements.positions, style: elements.style }, { legend: false }), "node");
    // 1,234 of 2,468 cases: half of the inner width 180 − 8 − 1, from the band's end; the stripe inside the outline, the foot its lowest 3.
    expect(a).toContain('<rect x="100" y="0" width="180" height="40" rx="4" fill="#ffffff" stroke="#8c94a1" stroke-width="1"/><rect x="108" y="1" width="85.5" height="38" class="wf-cue" fill="#e6e8ec"/><rect x="108" y="36" width="85.5" height="3" class="wf-cue-foot" fill="#5f6672"/><rect x="100" y="0" width="8" height="40" class="wf-band" rx="4" fill="#8c8c8c"/>');
    expect(a).toContain('fill="#5b6270">· 50 %</text>');
  });

  it("draws every edge kind from its mark", () => {
    // Each line ends 2.25 before its route, inside its head of 12, whose tip lies on the route's end.
    const path = (d: string, color: string, dash = "") => `<path d="${d}" fill="none" stroke="${color}" stroke-width="1" stroke-linejoin="round"${dash} marker-end="url(#wf-arrow)"/>`;
    expect(groups(draw(), "edge")).toEqual([
      // A flow edge carries its count, as on the map; without a route it runs straight between the boxes.
      `<g class="wf-edge" data-id="a-&gt;g">${path("M280 20L317.75 20", "#8c8c8c")}<text x="300" y="16" font-size="11" text-anchor="middle" ${halo}>12</text></g>`,
      // A constraint edge in the accent, solid: only the re-added path is dashed.
      `<g class="wf-edge" data-id="g-&gt;s">${path("M364 20L382 20L382 28L397.75 28", "#b84a00")}</g>`,
      `<g class="wf-edge" data-id="s-&gt;r">${path("M500 56L500 97.75", "#8c8c8c", ' stroke-dasharray="6 5"')}<text x="500" y="74" font-size="11" text-anchor="middle" ${halo}>3</text></g>`,
      `<g class="wf-edge" data-id="start-&gt;a">${path("M36 20L97.75 20", "#8c8c8c")}<text x="68" y="16" font-size="11" text-anchor="middle" ${halo}>1,234</text></g>`,
    ]);
  });

  it("leaves out texts below their level of detail but keeps glyphs and notes", () => {
    const far = draw(0.1);
    const texts = [...far.matchAll(/<g class="wf-(?:node|edge)[^]*?<\/g>/g)].flatMap((g) => [...g[0].matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((t) => t[1]));
    expect(texts).toEqual(["+", "Ask the vendor twice"]);
    const mid = draw(0.3);
    expect(mid).toContain(">Check invoice<");
    // Edge counts appear from 0.6.
    expect(groups(mid, "edge").filter((g) => g.includes("<text"))).toEqual([]);
  });

  it("writes a name on up to two lines, the second shortened by the core rule, and keeps the full name in a title", () => {
    const label = "Change Approval for Purchase Order Item of a Framework Contract";
    const long = { ...elements.graph, nodes: elements.graph.nodes.map((n) => (n.id === "a" ? { ...n, label } : n)) };
    const svg = toSVG({ graph: long, positions: elements.positions, style: elements.style }, { legend: false });
    // 154 by the estimate at 13 px holds 21 characters: the rest keeps 20 and the ellipsis, without the space before it.
    expect(svg).toContain(">Change Approval for</text>");
    expect(svg).toContain(">Purchase Order Item…</text>");
    expect(svg).toContain(`<title>${label}</title>`);
  });
});
