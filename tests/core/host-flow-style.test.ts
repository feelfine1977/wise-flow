import { describe, expect, it } from "vitest";
import { type FlowGraph, type FlowSceneOptions, buildScene, checkTheme, createPositions, dashTokens, defaultTheme, toSVG } from "../../src/index";
import { type DrawContext, drawScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";

const graph: FlowGraph = {
  nodes: [
    { id: "s", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "A", metrics: { cases: 100 } },
    { id: "b", kind: "activity", label: "B", metrics: { cases: 100 } },
    { id: "e", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: [
    // Even accidentally supplied measure values never colour a host-added flow.
    { id: "start", kind: "follows", source: "s", target: "a", tags: ["added-by-map"], metrics: { cases: 100, medianLagHours: 999999, violationShare: 1 } },
    { id: "end", kind: "follows", source: "b", target: "e", tags: ["added-by-map"], metrics: { cases: 25 } },
    { id: "zero", kind: "follows", source: "a", target: "b", metrics: { cases: 80, medianLagHours: 0 } },
    { id: "day", kind: "follows", source: "a", target: "e", metrics: { cases: 60, medianLagHours: 24 } },
    { id: "week", kind: "follows", source: "b", target: "a", metrics: { cases: 40, medianLagHours: 168 } },
    { id: "long", kind: "follows", source: "s", target: "b", tags: ["reconnected"], metrics: { cases: 20, medianLagHours: 169 } },
    { id: "missing", kind: "follows", source: "a", target: "s", metrics: { cases: 10 } },
  ],
  meta: { cases: 100 },
};
const positions = createPositions({
  nodes: Object.fromEntries(graph.nodes.map((n, i) => [n.id, { x: i * 220, y: 0, width: 100, height: 40 }])),
  groups: {}, edges: {},
}, "given", "RIGHT");
const width = { metric: "cases", scale: "linear" as const, max: 100, range: [1, 10] as [number, number] };
const lag = { metric: "medianLagHours", palette: "performance" as const, bins: [24, 168] };
const style = { addedFlowLabel: true as const, frequencyColorLegend: true as const, edgeWidth: width, edgeColor: lag };
const scene = (options: FlowSceneOptions = {}) => buildScene(graph, positions, { selfLoops: false, ...options });

describe("opted-in host-added flows", () => {
  it.each(["frequency", "shortfall", "performance"] as const)("keeps added Start/End flows neutral and dotted, at their count width, in %s", (measure) => {
    const s = scene({ measure, style: { addedFlowLabel: true, edgeWidth: width } });
    const start = s.edgeMarks.find((m) => m.id === "start")!;
    const end = s.edgeMarks.find((m) => m.id === "end")!;
    expect([start.color, end.color]).toEqual(["#8c8c8c", "#8c8c8c"]);
    expect([start.width, end.width]).toEqual([10, 2.5]);
    expect([start.dash, end.dash]).toEqual([[0, 30], [0, 7.5]]);
    expect([start.texts[0]?.text, end.texts[0]?.text]).toEqual(["100", "25"]);
    expect([start.addedFlow, end.addedFlow]).toEqual([true, true]);
    expect([start.notEvaluated, end.notEvaluated]).toEqual([undefined, undefined]);
    const reconnected = s.edgeMarks.find((m) => m.id === "long")!;
    expect(reconnected.dash).toEqual([6, 5]);
    expect(reconnected.addedFlow).toBeUndefined();
    expect(dashTokens.addedFlow).not.toEqual(dashTokens.reconnectedPath);
    expect(checkTheme(defaultTheme)).toEqual([]);
  });

  it("requires both the explicit host option and the edge tag; event endpoints alone are unchanged", () => {
    const plain = scene({ measure: "frequency" });
    expect(plain.edgeMarks.find((m) => m.id === "start")?.addedFlow).toBeUndefined();
    expect(plain.edgeMarks.find((m) => m.id === "start")?.dash).toBeUndefined();
    expect(plain.legend.keys.some((k) => k.kind === "addedFlow")).toBe(false);
    const unmarked = { ...graph, edges: graph.edges.map((e) => ({ ...e, tags: e.tags?.filter((t) => t !== "added-by-map") })) };
    const opted = buildScene(unmarked, positions, { measure: "frequency", style: { addedFlowLabel: true } });
    expect(opted.edgeMarks).toEqual(buildScene(unmarked, positions, { measure: "frequency" }).edgeMarks);
    expect(opted.legend).toEqual(buildScene(unmarked, positions, { measure: "frequency" }).legend);
    expect(plain.legend.rows[0]).toEqual({ kind: "measure", text: "Frequency: cases. Width and shade = cases per path. Bar = share of all cases." });
  });

  it("excludes only opted-in added flows from colour calibration, leaving widths and unopted behavior intact", () => {
    const noAccidentalValue = { ...graph, edges: graph.edges.map((e) => e.id === "start" ? { ...e, metrics: { cases: 100 } } : e) };
    const options = { measure: "performance" as const, style: { addedFlowLabel: true as const } };
    const withValue = scene(options);
    const withoutValue = buildScene(noAccidentalValue, positions, options);
    // `long` starts at the start event: a terminal path (WF-02), outside the colour's domain like an added flow.
    expect(withValue.scales.domains.edgeColor).toEqual([0, 168]);
    expect(withValue.scales.domains).toEqual(withoutValue.scales.domains);
    expect(withValue.edgeMarks).toEqual(withoutValue.edgeMarks.map((m) => m.id === "start" ? { ...m, edge: graph.edges[0] } : m));
    const unopted = scene({ measure: "performance" });
    expect(unopted.scales.domains.edgeColor).toEqual([0, 999999]);
    expect(unopted.edgeMarks.map((m) => m.width)).toEqual(withValue.edgeMarks.map((m) => m.width));
  });

  it.each([
    ["en", true, "Added by the map: start and end of the recorded history"],
    ["de", true, "Von der Karte ergänzt: Anfang und Ende der aufgezeichneten Historie"],
    ["en", "History boundary supplied by the host", "History boundary supplied by the host"],
    ["de", "Historiengrenze des Hosts", "Historiengrenze des Hosts"],
  ] as const)("uses default or host words in %s: %s", (locale, addedFlowLabel, text) => {
    const s = scene({ locale, style: { addedFlowLabel } });
    expect(s.legend.rows.filter((r) => r.kind === "key" && r.key === "addedFlow")).toEqual([{ kind: "key", key: "addedFlow", glyph: "···", text }]);
    expect(toSVG({ graph, positions, style: { addedFlowLabel }, locale }, { theme: "default" }).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).toContain(text);
  });
});

describe("frequency with optional lag colour", () => {
  it("preserves the original frequency sentence unless the alternate-colour legend is explicitly requested", () => {
    const old = "Frequency: cases. Width and shade = cases per path. Bar = share of all cases.";
    expect(scene({ measure: "frequency", style: { edgeColor: lag } }).legend.rows[0]).toEqual({ kind: "measure", text: old });
    expect(scene({ measure: "frequency", style: { frequencyColorLegend: true } }).legend.rows[0]).toEqual({ kind: "measure", text: old });
  });
  it("keeps missing lag neutral with count and width; zero and tied 24/168 h bounds use their lower class", () => {
    const s = scene({ measure: "frequency", style });
    const paths = Object.fromEntries(s.edgeMarks.map((m) => [m.id, m]));
    expect([paths.missing.color, paths.missing.width, paths.missing.texts[0]?.text, paths.missing.notEvaluated]).toEqual(["#8c8c8c", 1, "10", undefined]);
    // `day` ends at the end event and `long` starts at the start event: terminal paths in the terminal paint, whatever the colour (WF-02).
    expect([paths.zero.color, paths.day.color, paths.week.color, paths.long.color]).toEqual(["#8c8c8c", "#c9ced6", "#2171b5", "#c9ced6"]);
    expect([paths.day.terminal, paths.long.terminal, paths.start.terminal, paths.end.terminal]).toEqual(["end", "start", undefined, undefined]);
    expect(s.legend.keys.some((k) => k.kind === "notEvaluated")).toBe(false);
    expect(s.legend.rows.find((r) => r.kind === "swatches" && r.title.startsWith("Path colour"))).toEqual({
      kind: "swatches", title: "Path colour: median lag (min, h, d)", entries: [
        { text: "up to 24 h", color: "#8c8c8c", pattern: "solid" },
        { text: "24 h to 7.0 d", color: "#2171b5", pattern: "solid" },
        { text: "over 7.0 d", color: "#08306b", pattern: "solid" },
      ],
    });
    const performance = scene({ measure: "performance" });
    expect(performance.edgeMarks.find((m) => m.id === "missing")?.notEvaluated).toBe(true);
    expect(performance.scales.spec.edgeColor?.required).toBe(true);
    expect(performance.legend.keys.some((k) => k.kind === "notEvaluated")).toBe(true);
  });

  it.each([
    ["en", "Frequency: width = cases per path. Colour = median lag classes. Bar = share of all cases."],
    ["de", "Häufigkeit: Breite = Fälle je Pfad. Farbe = Klassen für Median-Wartezeit. Balken = Anteil aller Fälle."],
  ] as const)("names the actual width, colour and classes in %s", (locale, text) => {
    expect(scene({ measure: "frequency", locale, style }).legend.rows[0]).toEqual({ kind: "measure", text });
    const ramp = scene({ measure: "frequency", locale, style: { frequencyColorLegend: true, edgeColor: { metric: "medianLagHours", palette: "performance" } } });
    expect(ramp.legend.rows[0]).toEqual({ kind: "measure", text: text.replace(locale === "en" ? " classes" : "Klassen für ", "") });
  });

  it.each([
    ["en", "Frequency: width = share per path. Colour = median lag classes. Bar = share of all cases."],
    ["de", "Häufigkeit: Breite = Anteil je Pfad. Farbe = Klassen für Median-Wartezeit. Balken = Anteil aller Fälle."],
  ] as const)("names a share width independently of the case count labels in %s", (locale, text) => {
    const withShares = { ...graph, edges: graph.edges.map((e) => ({ ...e, metrics: { ...e.metrics, share: 0.25 } })) };
    const s = buildScene(withShares, positions, { measure: "frequency", locale, style: { frequencyColorLegend: true, edgeWidth: { metric: "share", scale: "linear", domain: [0, 1], range: [1, 6] }, edgeColor: lag } });
    expect(s.scales.pathMetric).toBe("cases");
    expect(s.edgeMarks.find((m) => m.id === "zero")?.texts[0]?.text).toBe("80");
    expect(s.edgeMarks.find((m) => m.id === "zero")?.width).toBe(2.25);
    expect(s.legend.items.find((i) => i.kind === "width")?.metric).toBe("share");
    expect(s.legend.rows[0]).toEqual({ kind: "measure", text });
  });
});

/** Record actual Canvas strokes and text, including the drawing used by PNG. */
function context() {
  const strokes: { color: string; width: number; dash: number[]; cap: string }[] = [];
  const texts: string[] = [];
  let dash: number[] = [];
  const target = { globalAlpha: 1, lineWidth: 1, lineCap: "butt", strokeStyle: "", fillStyle: "", measureText: (text: string) => ({ width: text.length * 6 }),
    setLineDash: (d: number[]) => { dash = [...d]; },
    stroke() { strokes.push({ color: String(this.strokeStyle), width: this.lineWidth, dash, cap: this.lineCap }); },
    fillText: (text: string) => { texts.push(text); },
  };
  const ctx = new Proxy(target, { get: (t, key) => key in t ? Reflect.get(t, key) : () => undefined }) as unknown as DrawContext;
  return { ctx, strokes, texts };
}

it("draws the same neutral round dots and recorded classes in Canvas, SVG and PNG", () => {
  const options = { measure: "frequency" as const, style, selfLoops: false };
  const { ctx, strokes } = context();
  drawScene(ctx, prepareScene(graph, positions, options), { x: 0, y: 0, zoom: 1, width: 1000, height: 500 }, undefined, { cull: false });
  expect(strokes).toContainEqual({ color: "#8c8c8c", width: 10, dash: [0, 30], cap: "round" });
  expect(strokes).toContainEqual({ color: "#8c8c8c", width: 2.5, dash: [0, 7.5], cap: "round" });
  // The re-added path from the start event: a terminal path, dashed as re-added.
  expect(strokes).toContainEqual({ color: "#c9ced6", width: 2, dash: [6, 5], cap: "butt" });
  const svg = toSVG({ graph, positions, ...options }, { theme: "default" });
  expect(svg).toMatch(/data-id="start"><path [^>]*stroke="#8c8c8c" stroke-width="10"[^>]*stroke-linecap="round" stroke-dasharray="0 30"/);
  expect(svg).toMatch(/data-id="long"><path [^>]*stroke="#c9ced6" stroke-width="2"[^>]*stroke-dasharray="6 5"/);
  const png = context();
  toPNGCanvas({ graph, positions, ...options }, { theme: "default", createCanvas: (width, height) => ({ width, height, getContext: () => png.ctx }) });
  expect(png.strokes).toContainEqual({ color: "#8c8c8c", width: 10, dash: [0, 30], cap: "round" });
  expect(png.texts.join(" ")).toContain("Added by the map:");
});
