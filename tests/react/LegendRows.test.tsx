import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type DrawContext, drawLegend, prepareScene } from "../../src/canvas/index";
import { type FlowGraph, type LegendRow, type Locale, type Overlay, type Positions, type SceneLegend, abstract, buildScene, estimateTextWidth, layout, legendLayout, overlaysFor, toSVG } from "../../src/index";
import { ProcessMap } from "../../src/react/index";

type Fixture = { graph: FlowGraph; positions: Positions; overlays?: Overlay[]; locale?: Locale };
/** The texts a legend writes, in order, and how many map-level chips it shows. */
type Written = { texts: string[]; chips: number };

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * What a row writes, in order: the measure; a scale's title and values or entries; a key's glyph and text; a chip's
 * label and text. Given what the layout fitted, its title lines and texts instead.
 */
function rowTexts(row: LegendRow, fitted?: { lines: string[]; texts: string[] }): string[] {
  if (row.kind === "measure") return fitted?.lines ?? [row.text];
  const title = (t: string) => fitted?.lines ?? [t];
  if (row.kind === "width") return [...title(row.title), ...row.samples.map((s) => s.text)];
  if (row.kind === "ramp") return [...title(row.title), ...row.values];
  if (row.kind === "swatches") return [...title(row.title), ...(fitted?.texts ?? row.entries.map((e) => e.text))];
  if (row.kind === "key") return [row.glyph, ...(fitted?.texts ?? [row.text])];
  return fitted?.texts ?? [row.label, row.text];
}

/** The model's texts as an export writes them: wrapped and shortened to the legend's width by the estimate. */
const exported = (legend: SceneLegend) => [legend.title, ...legendLayout(legend).rows.flatMap((r) => rowTexts(r.row, r))];

function fromSVG({ graph, positions, overlays, locale }: Fixture): Written {
  const svg = toSVG({ graph, positions, overlays, locale });
  const legend = /<g class="wf-legend"[^]*?<\/g><\/g>/.exec(svg)![0];
  return { texts: [...legend.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => unescape(m[1])), chips: 0 };
}

function fromCanvas({ graph, positions, overlays, locale }: Fixture): Written {
  const scene = prepareScene(graph, positions, { overlays, locale, lodBySize: false });
  const texts: string[] = [];
  let font = "";
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, key: string) => {
      // Measures as the estimate would not: a context never shortens the legend's texts itself.
      if (key === "measureText") return (s: string) => ({ width: estimateTextWidth(s, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) }) * 10 });
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
  return { texts, chips: 0 };
}

async function fromReact({ graph, positions, overlays, locale }: Fixture): Promise<Written> {
  render(
    <div style={{ width: 1200, height: 800 }}>
      <ProcessMap graph={graph} positions={positions} overlays={overlays} locale={locale} renderer="svg" controls={false} fitView={false} contextMenu={false} pathList={false} />
    </div>,
  );
  const region = await waitFor(() => screen.getByRole("region", { name: locale === "de" ? "Legende" : "Legend" }));
  const texts: string[] = [];
  const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest(".wf-map-chips")) continue;
    const text = n.textContent?.trim();
    if (text) texts.push(text);
  }
  const chips = region.querySelectorAll(".wf-map-chips .wf-mark").length;
  cleanup();
  return { texts, chips };
}

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const vendor = abstract(vendorScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
/** The global map without the paths re-added to keep it connected. */
const unconnected = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01, keepConnected: false });

const fixtures: Record<string, Fixture> = {};
const legends: Record<string, { legend: SceneLegend; svg: Written; canvas: Written; react: Written }> = {};
beforeAll(async () => {
  const at = { global: await layout(global, { engine: "dagre" }), vendor: await layout(vendor, { engine: "dagre" }), unconnected: await layout(unconnected, { engine: "dagre" }) };
  // The committed fixtures with the constraint presets, without overlays, in German, and without re-added paths.
  Object.assign(fixtures, {
    overlays: { graph: global, positions: at.global, overlays: overlaysFor(constraintItems(), { graph: global }) },
    plain: { graph: global, positions: at.global },
    vendorGerman: { graph: vendor, positions: at.vendor, overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }), locale: "de" },
    unconnected: { graph: unconnected, positions: at.unconnected },
  } satisfies Record<string, Fixture>);
  for (const [name, f] of Object.entries(fixtures)) {
    legends[name] = { legend: buildScene(f.graph, f.positions, { overlays: f.overlays, locale: f.locale }).legend, svg: fromSVG(f), canvas: fromCanvas(f), react: await fromReact(f) };
  }
}, 60000);
afterAll(cleanup);

const keysOf = (legend: SceneLegend) => legend.rows.flatMap((r) => (r.kind === "key" ? [r.glyph] : []));

describe("the legends of SVG, Canvas and React", () => {
  it.each(["overlays", "plain", "vendorGerman", "unconnected"])("render the rows of the scene's legend, in its order, for %s", (name) => {
    const { legend, svg, canvas, react } = legends[name];
    // The exports write every row's texts, shortened to the legend's width by the scene's measure.
    expect(svg.texts).toEqual(exported(legend));
    expect(canvas.texts).toEqual(exported(legend));
    // The map's panel writes them in full and shows the map-level chips as the marks they are.
    const chips = legend.rows.filter((r) => r.kind === "chip").length;
    expect(react.texts).toEqual([legend.title, ...legend.rows.filter((r) => r.kind !== "chip").flatMap((r) => rowTexts(r))]);
    expect(react.chips).toBe(chips);
  });

  it("list one key per kind of mark drawn and none for a kind not drawn", () => {
    // The presets add badges of three glyphs (in the order of their first targets: cancel_invoice_receipt ∅,
    // clear_invoice ≥1, record_invoice_receipt ≤1), arcs (some in reverse), hatching and map-level chips; the follows
    // self-loops are on by default, the abstraction re-adds paths, and the map starts and ends with events.
    expect(keysOf(legends.overlays.legend)).toEqual(["∅", "≥1", "≤1", "⌒", "⇐", "↻", "▨", "┄", "○", "◉"]);
    expect(legends.overlays.react.chips).toBeGreaterThan(0);
    expect(keysOf(legends.plain.legend)).toEqual(["↻", "┄", "○", "◉"]);
    expect(legends.plain.react.chips).toBe(0);
    // Without re-added paths there is no key for them.
    expect(unconnected.edges.some((e) => e.tags?.includes("reconnected"))).toBe(false);
    expect(keysOf(legends.unconnected.legend)).toEqual(["↻", "○", "◉"]);
    // The measure with its unit and what the shares are of (the 251,734 cases of the log), then each scale's metric and unit.
    expect(legends.plain.react.texts.slice(0, 3)).toEqual(["Legend", "Frequency · cases · share of 251,734 cases", "Path width: cases (count) · whole graph"]);
    expect(legends.plain.react.texts.slice(-8)).toEqual(["↻", "Repeated execution", "┄", "Not directly observed (re-added)", "○", "Start of the process", "◉", "End of the process"]);
    expect(legends.unconnected.react.texts.slice(-6)).toEqual(["↻", "Repeated execution", "○", "Start of the process", "◉", "End of the process"]);
    expect(legends.vendorGerman.svg.texts[0]).toBe("Legende");
    expect(legends.vendorGerman.react.texts).toEqual(expect.arrayContaining(["Pfadbreite: Fälle (Anzahl) · ganzer Graph", "Pfadfarbe: Fälle (Anzahl)", "Aktivitätsfarbe: Phase", "Prozessbeginn", "Prozessende"]));
    // Three width samples, written as paths are.
    expect(legends.plain.legend.rows.find((r) => r.kind === "width")).toMatchObject({ samples: [{}, {}, {}] });
  });
});
