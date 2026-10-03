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
      const [ox, oy] = translate(g.parentElement!.getAttribute("transform"));
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
    const svg = toSVG({ graph: vendor, positions }, { legend: false });
    const exported = lastScene();
    const drawnIds = exported.marks.filter((m) => m.inMap).map((m) => m.id);
    const exportedGroups = svg.match(/<g class="wf-overlay[^]*?<\/g>/g) ?? [];
    expect(exportedGroups).toHaveLength(drawnIds.length);
    expect(map.marks.map((m) => m.id)).toEqual(exported.marks.map((m) => m.id));
    const parse = (markup: string) => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, "image/svg+xml").documentElement.firstElementChild!;
    const byId = new Map(drawnIds.map((id, i) => [id, tree(parse(exportedGroups[i]))]));
    const domGroups = [...container.querySelectorAll<SVGGElement>(".wf-overlay[data-overlay-id]")];
    // Tints are drawn as the background of the element they cover (below).
    expect(domGroups.map((g) => g.dataset.overlayId).sort()).toEqual(map.marks.filter((m) => m.inMap && m.layer === "above").map((m) => m.id).sort());
    for (const g of domGroups) expect(tree(g), g.dataset.overlayId).toEqual(byId.get(g.dataset.overlayId!));
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
    // Value 0.5 is #fd8d3c on the sequential palette, at the tint opacity 0.18.
    expect(a.classList.contains("wf-node--tinted")).toBe(true);
    expect(a.style.getPropertyValue("--wf-tint")).toBe("linear-gradient(rgba(253, 141, 60, 0.18), rgba(253, 141, 60, 0.18))");
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
  it("draws badges leftwards from the top-right corner of the element they are placed in", () => {
    const { container } = render(<Badges badges={[{ kind: "badge", target: "x", payload: { value: 1 } }, { kind: "badge", target: "x", payload: { glyph: "≥1", value: 0.25 } }]} locale="en" />);
    // Slots of the core: −(22 + 4) + 2 for the first and −2 × (24 + 4) + 2 for the 24 px wide second, half above the corner.
    expect([...container.querySelectorAll(".wf-badges .wf-badge rect")].map((r) => ["x", "y", "width"].map((a) => r.getAttribute(a)))).toEqual([
      ["-24", "-11", "22"],
      ["-54", "-11", "24"],
    ]);
  });
});

const TOKENS: Record<string, string> = { "var(--wf-ink)": "#1f1f1f", "var(--wf-paper)": "#ffffff", "var(--wf-line)": "#cfd4dc", "var(--wf-out-of-scope)": "#b0b0b0" };
const IDS: Record<string, string> = { "url(#wf-arc-arrow)": "url(#wf-overlay-arrow)", "url(#wf-mark-arrow)": "url(#wf-overlay-arrow)", "url(#wf-mark-outofscope)": "url(#wf-pattern-outofscope)" };
const DOM_ONLY = new Set(["data-overlay-id", "data-constraint", "pointer-events", "style"]);

/**
 * An element as tag, attributes and children, with the DOM's paints and ids
 * read as the SVG export writes them: token variables (in the style) as the
 * fixed colours, and the export's marker and pattern ids.
 */
function tree(e: Element): unknown {
  const attrs: Record<string, string> = {};
  for (const a of Array.from(e.attributes)) if (!DOM_ONLY.has(a.name)) attrs[a.name] = IDS[a.value] ?? a.value;
  const style = (e as SVGElement).style;
  for (const name of ["fill", "stroke"]) {
    const value = style?.getPropertyValue(name);
    if (value) attrs[name] = TOKENS[value] ?? value;
  }
  return { tag: e.tagName, attrs, children: Array.from(e.childNodes).map((c) => (c.nodeType === 3 ? c.textContent : tree(c as Element))) };
}
