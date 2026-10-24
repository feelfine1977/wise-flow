import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/scene.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/core/scene.js")>();
  return { ...original, buildScene: vi.fn(original.buildScene) };
});

const { buildScene } = await import("../../src/core/scene.js");
const { constraintItems, vendorScene, vendorSceneKey } = await import("../../fixtures/bpic2019");
const { abstract, layout, overlaysFor, toSVG } = await import("../../src/index");
const { Badges, ProcessMap } = await import("../../src/react/index");
type FlowGraph = import("../../src/index").FlowGraph;
type FlowScene = import("../../src/index").FlowScene;
type Positions = import("../../src/index").Positions;

afterEach(() => {
  cleanup();
  vi.mocked(buildScene).mockClear();
});

const plain = { controls: false, legend: false, fitView: false } as const;
const lastScene = () => vi.mocked(buildScene).mock.results.at(-1)!.value as FlowScene;
// Every mark from zoom 0, so that what is drawn does not depend on the zoom jsdom ends up with.
const everything = { badges: 0, chips: 0, hatch: 0, arcs: 0, selfLoops: 0 };

const shown = abstract(vendorScene, { minEdgeShare: 0.02 });
const vendor: FlowGraph = { ...shown, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: shown }) };

async function vendorMap() {
  const positions = await layout(vendor, { engine: "dagre" });
  const { container } = render(<div style={{ width: 1200, height: 800 }}><ProcessMap graph={vendor} positions={positions} lod={everything} {...plain} /></div>);
  await waitFor(() => expect(container.querySelector(".react-flow__node [data-overlay-id]")).not.toBeNull());
  return { container, positions, scene: lastScene() };
}

const num = (s: string | null | undefined) => Number(s ?? NaN);
const translate = (s: string | null | undefined) => (s?.match(/translate\(\s*(-?[\d.]+)(?:px)?[ ,]\s*(-?[\d.]+)(?:px)?\s*\)/)?.slice(1).map(Number) ?? [NaN, NaN]) as [number, number];

describe("overlay marks in the React Flow map", () => {
  it("draws the badges and chips of an element where the scene places them", async () => {
    const { container, scene } = await vendorMap();
    const carried = scene.marks.filter((m) => m.inMap && m.path === undefined && m.layer === "above");
    expect(carried.map((m) => m.kind)).toEqual(expect.arrayContaining(["badge", "chip"]));
    const boxes = [...container.querySelectorAll<SVGGElement>(".react-flow__node .wf-marks [data-overlay-id]")].map((g) => {
      // The node sits at its absolute flow position; its marks are shifted back by its origin.
      const [nx, ny] = translate(g.closest<HTMLElement>(".react-flow__node")!.style.transform);
      // A card's badges lie in its row (`wf-pill-row`) inside the shifted group.
      const [ox, oy] = translate(g.closest("svg.wf-marks > g")!.getAttribute("transform"));
      const rect = g.querySelector("rect")!;
      return { id: g.dataset.overlayId, x: nx + ox + num(rect.getAttribute("x")), y: ny + oy + num(rect.getAttribute("y")), width: num(rect.getAttribute("width")), height: num(rect.getAttribute("height")) };
    });
    const round = (b: { x: number; y: number; width: number; height: number }) => ({ x: Math.round(b.x * 100) / 100, y: Math.round(b.y * 100) / 100, width: Math.round(b.width * 100) / 100, height: Math.round(b.height * 100) / 100 });
    expect(boxes.map(({ id, ...b }) => ({ id, ...round(b) }))).toEqual(
      expect.arrayContaining(carried.map((m) => ({ id: m.id, ...round(scene.geometry.shapes.find((s) => s.id === m.id)!) }))),
    );
    expect(boxes).toHaveLength(carried.length);
  });

  it("draws every mark as the SVG export does", async () => {
    const { container, positions } = await vendorMap();
    const map = lastScene();
    const svg = toSVG({ graph: vendor, positions }, { legend: false, theme: "default" });
    const exported = lastScene();
    const drawnIds = exported.marks.filter((m) => m.inMap).map((m) => m.id);
    const exportedGroups = svg.match(/<g class="wf-overlay[^]*?<\/g>/g) ?? [];
    expect(exportedGroups).toHaveLength(drawnIds.length);
    expect(map.marks.map((m) => m.id)).toEqual(exported.marks.map((m) => m.id));
    const parse = (markup: string) => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "image/svg+xml").documentElement.firstElementChild!;
    const byId = new Map(drawnIds.map((id, i) => [id, tree(parse(exportedGroups[i]))]));
    const domGroups = [...container.querySelectorAll<SVGGElement>(".wf-overlay[data-overlay-id]")];
    // Tints are drawn as the background of the element they cover (below).
    expect(domGroups.map((g) => g.dataset.overlayId).sort()).toEqual(map.marks.filter((m) => m.inMap && m.layer !== "below").map((m) => m.id).sort());
    for (const g of domGroups) expect(tree(g), g.dataset.overlayId).toEqual(byId.get(g.dataset.overlayId!));
  });

  it("draws the arcs after the edges and before the nodes and their badges, the self-loops after the nodes", async () => {
    const { container, scene } = await vendorMap();
    await waitFor(() => expect(container.querySelector(".react-flow__edge")).not.toBeNull());
    const arcs = scene.marks.filter((m) => m.kind === "arc").map((m) => m.id);
    expect(arcs.length).toBeGreaterThan(0);
    // React Flow stacks its viewport's children by z-index, then in document order: the edges
    // (z-index 0 here), its edge label layer, the nodes (from 0), the viewport portal.
    const layer = container.querySelector<HTMLElement>(".react-flow__edgelabel-renderer")!;
    const drawn = [...layer.querySelectorAll<SVGGElement>(".wf-overlay[data-overlay-id]")];
    expect(drawn.map((g) => g.dataset.overlayId)).toEqual(arcs);
    expect(drawn[0].closest("svg")!.style.zIndex).toBe("0");
    const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const edges = [...container.querySelectorAll<SVGElement>(".react-flow__edges > svg")];
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(follows(edge, layer)).toBe(true);
      expect(Number(edge.style.zIndex || 0)).toBeLessThanOrEqual(0);
    }
    const nodes = [...container.querySelectorAll<HTMLElement>(".react-flow__node:not(.react-flow__node-wfGroup)")];
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(follows(layer, node)).toBe(true);
      expect(Number(node.style.zIndex || 0)).toBeGreaterThanOrEqual(0);
    }
    // Badges are drawn by the node that carries them; self-loops in the portal above the nodes.
    expect(container.querySelector(".react-flow__node [data-overlay-id^='badge:']")).not.toBeNull();
    const loop = container.querySelector<SVGGElement>(".react-flow__viewport-portal [data-overlay-id^='selfLoop:']")!;
    expect(loop.closest("svg")!.style.zIndex).toBe("1001");
  });

  it("tints a node with the colour of the overlay's value", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }, { id: "b", kind: "activity", label: "B" }],
      edges: [{ id: "ab", kind: "follows", source: "a", target: "b" }],
      overlays: [{ kind: "tint", target: "a", payload: { value: 0.5 } }],
    };
    const positions: Positions = {
      engine: "dagre", direction: "RIGHT", bounds: { x: 0, y: 0, width: 400, height: 40 }, groups: {},
      nodes: { a: { x: 0, y: 0, width: 120, height: 40 }, b: { x: 280, y: 0, width: 120, height: 40 } }, edges: {},
    };
    const { container } = render(<div style={{ width: 800, height: 400 }}><ProcessMap graph={graph} positions={positions} {...plain} /></div>);
    await waitFor(() => expect(container.querySelector("#wf-node-a")).not.toBeNull());
    const a = container.querySelector<HTMLElement>("#wf-node-a")!;
    // Whatever its value, the accent #b84a00 (184, 74, 0), at the tint opacity 0.18.
    expect(a.classList.contains("wf-node--tinted")).toBe(true);
    expect(a.style.getPropertyValue("--wf-tint")).toBe("linear-gradient(rgba(184, 74, 0, 0.18), rgba(184, 74, 0, 0.18))");
    expect(container.querySelector<HTMLElement>("#wf-node-b")!.classList.contains("wf-node--tinted")).toBe(false);
  });

  it("shows an element's marks from their zoom on", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }],
      edges: [],
      overlays: [{ kind: "badge", target: "a", payload: { glyph: "≥1", value: 0.25 } }],
    };
    const positions: Positions = { engine: "dagre", direction: "RIGHT", bounds: { x: 0, y: 0, width: 120, height: 40 }, groups: {}, nodes: { a: { x: 0, y: 0, width: 120, height: 40 } }, edges: {} };
    const badge = async (lod: number) => {
      const { container, unmount } = render(<div style={{ width: 800, height: 400 }}><ProcessMap graph={graph} positions={positions} lod={{ badges: lod }} {...plain} /></div>);
      await waitFor(() => expect(container.querySelector("#wf-node-a")).not.toBeNull());
      const found = container.querySelector("#wf-node-a .wf-badge");
      unmount();
      return found;
    };
    // The map starts at zoom 1.
    expect(await badge(0.9)).not.toBeNull();
    expect(await badge(1.1)).toBeNull();
  });
});

describe("Badges", () => {
  it("draws badges leftwards from the top-right corner of the element they are placed in, wholly above it", () => {
    const { container } = render(<Badges badges={[{ kind: "badge", target: "x", payload: { value: 1 } }, { kind: "badge", target: "x", payload: { glyph: "≥1", value: 0.25 } }]} locale="en" />);
    // Pills of the core, 18 tall and 2 above the corner: "● · 100 %" and "≥1 · 25 %", each 9 characters of 6.05 and 6 on
    // either side (66.45), the second 4 left of the first.
    expect([...container.querySelectorAll(".wf-badges .wf-badge rect")].map((r) => ["x", "y", "width"].map((a) => r.getAttribute(a)))).toEqual([
      ["-66.45", "-20", "66.45"],
      ["-136.9", "-20", "66.45"],
    ]);
  });
});

const TOKENS: Record<string, string> = { ink: "#1f1f1f", paper: "#ffffff", line: "#cfd4dc", "out-of-scope": "#b0b0b0" };
const IDS: Record<string, string> = { "url(#wf-arc-arrow)": "url(#wf-overlay-arrow)", "url(#wf-mark-arrow)": "url(#wf-overlay-arrow)", "url(#wf-mark-outofscope)": "url(#wf-pattern-outofscope)" };
const DOM_ONLY = new Set(["data-overlay-id", "data-constraint", "pointer-events", "data-wf-part", "data-wf-kind", "data-wf-state"]);

/**
 * An element as tag, attributes and children, with the DOM's paints and ids
 * read as the SVG export writes them: the classes of token paints
 * (`wf-fill-ink`) as the fixed colours, and the export's marker and pattern ids.
 */
function tree(e: Element): unknown {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(e.attributes)) if (!DOM_ONLY.has(a.name)) attrs[a.name] = IDS[a.value] ?? a.value;
  const classes = (attrs.class ?? "").split(" ").filter((c) => {
    const paint = c.match(/^wf-(fill|stroke)-(.+)$/);
    if (paint) attrs[paint[1]] = TOKENS[paint[2]] ?? paint[2];
    return c && !paint;
  });
  if (classes.length) attrs.class = classes.join(" ");
  else delete attrs.class;
  // An arc's pill and label are grouped in the DOM, so that the stylesheet scales them together; the export writes them in the mark.
  const children = Array.from(e.childNodes).flatMap((c) => ((c as Element).classList?.contains("wf-arc-pill") ? Array.from(c.childNodes) : [c]));
  return { tag: e.tagName, attrs, children: children.map((c) => (c.nodeType === 3 ? c.textContent : tree(c as Element))) };
}

describe("paints of the theme on marks", () => {
  it("have a rule in the stylesheet for every class the marks of every overlay kind carry, plain and hovered", async () => {
    const { readFileSync } = await import("node:fs");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { overlayGeometry, overlayMarks } = await import("../../src/index");
    const { MARK_IDS, mapMark, markDefs, svgReact } = await import("../../src/react/marks");
    const kinds = await import("../core/overlay-kinds");
    // The fixture's overlays and a chip with a gauge, whose track is painted with the line colour.
    const gauge: (typeof kinds.overlays)[number] = { kind: "chip", target: "b", payload: { glyph: "◔", text: "2.1", value: 0.5, gauge: { value: 2.1, threshold: 2, width: 1 } } };
    const marks = overlayMarks(overlayGeometry([...kinds.overlays, gauge], kinds.positions).shapes);
    const markup = renderToStaticMarkup(<svg>{[...marks.flatMap((m) => [false, true].map((hovered) => svgReact(mapMark(m, MARK_IDS, hovered), `${m.id}-${hovered}`))), svgReact(markDefs(MARK_IDS), "defs")]}</svg>);
    const classes = new Set([...markup.matchAll(/\bwf-(?:fill|stroke)-[a-z-]+/g)].map(([c]) => c));
    // Ink, paper, the gauge's track, the hatching's lines, and a hovered mark's value in the focus colour.
    for (const c of ["wf-fill-ink", "wf-fill-paper", "wf-stroke-paper", "wf-fill-line", "wf-stroke-out-of-scope", "wf-fill-focus", "wf-stroke-focus"]) expect(classes).toContain(c);
    const css = readFileSync("src/react/style.css", "utf8");
    for (const c of classes) {
      const [, property, token] = c.match(/^wf-(fill|stroke)-(.+)$/)!;
      expect(css, c).toContain(`\n.${c} { ${property}: var(--wf-${token}); }\n`);
    }
  });
});
