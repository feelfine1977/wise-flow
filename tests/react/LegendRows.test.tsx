import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type DrawContext, drawLegend, prepareScene } from "../../src/canvas/index";
import { type FlowGraph, type Locale, type Overlay, type Positions, abstract, createPositions, estimateTextWidth, layout, overlaysFor, toSVG } from "../../src/index";
import { Chip, ProcessMap } from "../../src/react/index";

/** The rows a legend writes, in order, and the texts of its map-level chips. */
type Rows = { rows: string[]; chips: number; chipTexts?: string[] };
type Fixture = { graph: FlowGraph; positions: Positions; overlays?: Overlay[]; locale?: Locale };

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function fromSVG({ graph, positions, overlays, locale }: Fixture, chips: number): Rows {
  const svg = toSVG({ graph, positions, overlays, locale });
  const legend = /<g class="wf-legend"[^]*?<\/g><\/g>/.exec(svg)![0];
  const texts = [...legend.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unescape(m[1]));
  // A chip is written as its label and its text, after the rows.
  return { rows: texts.slice(0, texts.length - 2 * chips), chips, chipTexts: texts.slice(texts.length - 2 * chips) };
}

function fromCanvas({ graph, positions, overlays, locale }: Fixture): Rows & { listed: number } {
  const scene = prepareScene(graph, positions, { overlays, locale, lodBySize: false });
  const texts: string[] = [];
  let font = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      if (key === "measureText") return (s: string) => ({ width: estimateTextWidth(s, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10), weight: /^600 /.test(font) ? 600 : undefined }) });
      if (key === "fillText") return (s: string) => texts.push(s);
      if (key === "createLinearGradient" || key === "createPattern") return undefined;
      return () => undefined;
    },
    set: (_t, key: string, value) => {
      if (key === "font") font = value;
      return true;
    },
  }) as unknown as DrawContext;
  drawLegend(ctx, scene, 0, 0, 188);
  const chips = scene.legend.chips.length;
  return { rows: texts.slice(0, texts.length - 2 * chips), chips, chipTexts: texts.slice(texts.length - 2 * chips), listed: chips };
}

async function fromReact({ graph, positions, overlays, locale }: Fixture): Promise<Rows> {
  render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} overlays={overlays} locale={locale} renderer="svg" controls={false} fitView={false} contextMenu={false} pathList={false} />
    </div>,
  );
  const region = await waitFor(() => screen.getByRole("region", { name: locale === "de" ? "Legende" : "Legend" }));
  const rows: string[] = [];
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(".wf-map-chips")) continue;
    const text = n.textContent?.trim();
    if (text) rows.push(text);
  }
  const chips = region.querySelectorAll(".wf-map-chips .wf-mark").length;
  cleanup();
  return { rows, chips };
}

/** Same row, or the same row shortened with an ellipsis to fit the export's legend. */
function sameRow(full: string, written: string): boolean {
  return written === full || (written.endsWith("…") && full.startsWith(written.slice(0, -1)));
}

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const vendor = abstract(vendorScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });

const legends: Record<string, { svg: Rows; canvas: Rows & { listed: number }; react: Rows }> = {};
beforeAll(async () => {
  const at = { global: await layout(global, { engine: "dagre" }), vendor: await layout(vendor, { engine: "dagre" }) };
  // The committed fixtures with the constraint presets, without overlays, and in German.
  const fixtures: Record<string, Fixture> = {
    overlays: { graph: global, positions: at.global, overlays: overlaysFor(constraintItems(), { graph: global }) },
    plain: { graph: global, positions: at.global },
    vendorGerman: { graph: vendor, positions: at.vendor, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }), locale: "de" },
  };
  for (const [name, f] of Object.entries(fixtures)) {
    const canvas = fromCanvas(f);
    legends[name] = { canvas, svg: fromSVG(f, canvas.listed), react: await fromReact(f) };
  }
}, 60000);
afterAll(cleanup);

describe("the legends of SVG, Canvas and React", () => {
  it.each(["overlays", "plain", "vendorGerman"])("list the same rows for %s", (name) => {
    const { svg, canvas, react } = legends[name];
    expect(svg.rows).toEqual(canvas.rows);
    expect(svg.rows).toHaveLength(react.rows.length);
    react.rows.forEach((row, i) => expect(sameRow(row, svg.rows[i]), `${row} / ${svg.rows[i]}`).toBe(true));
    expect(svg.chipTexts).toEqual(canvas.chipTexts);
    expect(react.chips).toBe(canvas.chips);
  });

  it("list the overlay kinds present and the re-added paths", () => {
    const keys = (rows: string[]) => rows.filter((r) => ["●", "⌒", "⌒┄", "↻", "▨", "┄"].includes(r));
    // The presets add badges, arcs (some in reverse), hatching and map-level chips;
    // the follows self-loops are on by default.
    expect(keys(legends.overlays.react.rows)).toEqual(["●", "⌒", "⌒┄", "↻", "▨", "┄"]);
    expect(legends.overlays.react.chips).toBeGreaterThan(0);
    expect(keys(legends.plain.svg.rows)).toEqual(["↻", "┄"]);
    expect(legends.plain.react.chips).toBe(0);
    const plain = legends.plain.react.rows;
    expect(plain.slice(0, 2)).toEqual(["Legend", "Path width"]);
    expect(plain.slice(-4)).toEqual(["↻", "Repeated execution", "┄", "Re-added path"]);
    expect(legends.vendorGerman.svg.rows[0]).toBe("Legende");
  });
});

describe("map-level chips", () => {
  it("say what they show to assistive technology, in the legend and as a chip of their own", () => {
    // The chip's label and reading, as the text of the chip reads them; the glyph is decoration.
    const chip: Overlay = { kind: "chip", target: "__map", payload: { label: "Balance", text: "12 % over", glyph: "⚖" } };
    const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A" }], edges: [] };
    const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 100, height: 40 } }, groups: {}, edges: {} }, "given", "RIGHT");
    const { container } = render(<ProcessMap graph={graph} positions={positions} overlays={[chip]} controls={false} fitView={false} />);
    expect(within(container.querySelector<HTMLElement>(".wf-map-chips")!).getByRole("img", { name: "Balance: 12 % over" })).toBeTruthy();
    cleanup();
    render(<Chip chip={chip} locale="en" />);
    expect(screen.getByRole("img", { name: "Balance: 12 % over" })).toBeTruthy();
  });
});
