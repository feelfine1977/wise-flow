import { describe, expect, it } from "vitest";
import { type FlowGraph, type FlowScene, type FlowSceneOptions, type Theme, buildScene, checkTheme, createPositions, defaultTheme, measureStyle, printTheme, toSVG } from "../../src/index";
import { prepareScene } from "../../src/canvas/index";

/**
 * A log of 1,000 cases: activities with their cases, their share short and,
 * for the first, the time to the next activity a host measured; paths with
 * their cases, their share short and their median lag, two of them without.
 */
const graph: FlowGraph = {
  nodes: [
    { id: "s", kind: "event", label: "Start", tags: ["start"] },
    { id: "a", kind: "activity", label: "Create order", metrics: { cases: 1000, violationShare: 0.35, medianNextHours: 112.8 } },
    { id: "b", kind: "activity", label: "Approve", metrics: { cases: 900, violationShare: 0.1 } },
    { id: "c", kind: "activity", label: "Ship", metrics: { cases: 500, violationShare: 0.3 } },
    { id: "d", kind: "activity", label: "Bill", metrics: { cases: 400 } },
  ],
  edges: [
    { id: "s-a", kind: "follows", source: "s", target: "a", metrics: { cases: 1000 } },
    { id: "a-b", kind: "follows", source: "a", target: "b", metrics: { cases: 820, violationShare: 0.35, medianLagHours: 288 } },
    { id: "a-c", kind: "follows", source: "a", target: "c", metrics: { cases: 100, violationShare: 0.1, medianLagHours: 2 } },
    { id: "b-c", kind: "follows", source: "b", target: "c", metrics: { cases: 400, violationShare: 0.3, medianLagHours: 30 } },
    { id: "b-d", kind: "follows", source: "b", target: "d", metrics: { cases: 500, violationShare: 0.31, medianLagHours: 144 } },
    { id: "c-d", kind: "follows", source: "c", target: "d", metrics: { cases: 400, violationShare: 0.05 } },
  ],
  meta: { cases: 1000 },
};
const boxes = Object.fromEntries(["s", "a", "b", "c", "d"].map((id, i) => [id, { x: i * 260, y: (i % 2) * 120, width: id === "s" ? 36 : 180, height: id === "s" ? 36 : 64 }]));
const positions = createPositions({ nodes: boxes, groups: {}, edges: {} }, "given", "RIGHT");
const scene = (options: FlowSceneOptions = {}) => buildScene(graph, positions, options);

const pathLabels = (s: FlowScene) => Object.fromEntries(s.edgeMarks.map((m) => [m.id, m.texts[0]?.text]));
const pathColors = (s: FlowScene) => Object.fromEntries(s.edgeMarks.map((m) => [m.id, m.color]));
const numberLines = (s: FlowScene) => Object.fromEntries(s.nodeMarks.filter((m) => m.kind === "activity").map((m) => [m.id, m.texts.filter((t) => t.role === "countLine" || t.role === "share").map((t) => t.text).join(" ")]));
const measureRow = (s: FlowScene) => s.legend.rows.find((r) => r.kind === "measure");

describe("the three measures of one map", () => {
  it("frequency draws what the default style draws, and only its legend names the measure in the spec's sentence", () => {
    const plain = scene();
    const named = scene({ measure: "frequency" });
    expect(named.nodeMarks).toEqual(plain.nodeMarks);
    expect(named.edgeMarks).toEqual(plain.edgeMarks);
    expect(named.legend.rows.slice(1)).toEqual(plain.legend.rows.slice(1));
    expect(measureRow(plain)).toEqual({ kind: "measure", text: "Frequency · cases · share of 1,000 cases" });
    expect(measureRow(named)).toEqual({ kind: "measure", text: "Frequency: cases. Width and shade = cases per path. Bar = share of all cases." });
    expect(numberLines(named)).toEqual({ a: "1,000 · 100 %", b: "900 · 90 %", c: "500 · 50 %", d: "400 · 40 %" });
  });

  it("switching the measure changes path colours, labels, number lines and legend, never a box, a route or a width", () => {
    const [frequency, shortfall, performance] = (["frequency", "shortfall", "performance"] as const).map((measure) => scene({ measure }));
    for (const s of [shortfall, performance]) {
      expect(s.edgeMarks.map((m) => [m.id, m.width, m.points])).toEqual(frequency.edgeMarks.map((m) => [m.id, m.width, m.points]));
      expect(s.nodeMarks.map((m) => [m.id, m.box])).toEqual(frequency.nodeMarks.map((m) => [m.id, m.box]));
      expect(s.positions).toEqual(frequency.positions);
    }
    expect(pathLabels(frequency)).toEqual({ "s-a": "1,000", "a-b": "820", "a-c": "100", "b-c": "400", "b-d": "500", "c-d": "400" });
    // The share short leads ("35 % · 820"), then the median lag ("12 d · 820"); a path without one reads "–" first.
    expect(pathLabels(shortfall)).toEqual({ "s-a": "– · 1,000", "a-b": "35 % · 820", "a-c": "10 % · 100", "b-c": "30 % · 400", "b-d": "31 % · 500", "c-d": "5 % · 400" });
    expect(pathLabels(performance)).toEqual({ "s-a": "– · 1,000", "a-b": "12 d · 820", "a-c": "2.0 h · 100", "b-c": "30 h · 400", "b-d": "6.0 d · 500", "c-d": "– · 400" });
    // "35 % short · 900" in the shortfall, "4.7 d to next · 93 %" where the host gave the time to the next activity.
    expect(numberLines(shortfall)).toEqual({ a: "35 % short · 1,000", b: "10 % short · 900", c: "30 % short · 500", d: "– · 400" });
    expect(numberLines(performance)).toEqual({ a: "4.7 d to next · 100 %", b: "900 · 90 %", c: "500 · 50 %", d: "400 · 40 %" });
    expect(measureRow(shortfall)?.text).toBe("Shortfall: share of cases missing an expectation. Colour = share short. Width = cases.");
    expect(measureRow(performance)?.text).toBe("Performance: median wait between activities (h, d). Colour = median lag. Width = cases.");
  });

  it("states the measures' sentences in German, with German numbers", () => {
    const de = (measure: "frequency" | "shortfall" | "performance") => scene({ measure, locale: "de" });
    expect(measureRow(de("frequency"))?.text).toBe("Häufigkeit: Fälle. Breite und Tönung = Fälle je Pfad. Balken = Anteil aller Fälle.");
    expect(measureRow(de("shortfall"))?.text).toBe("Erwartungslücke: Anteil der Fälle, die eine Erwartung verfehlen. Farbe = Lückenanteil. Breite = Fälle.");
    expect(measureRow(de("performance"))?.text).toBe("Durchlaufzeit: mediane Wartezeit zwischen Aktivitäten (h, d). Farbe = Median-Wartezeit. Breite = Fälle.");
    expect(numberLines(de("shortfall")).a).toBe("35 % verfehlt · 1.000");
    expect(numberLines(de("performance")).a).toBe("4,7 d bis zur nächsten · 100 %");
    expect(pathLabels(de("performance"))["a-c"]).toBe("2,0 h · 100");
  });
});

describe("the shortfall measure", () => {
  it("colours paths in three classes by their share short, a value on a bound in the class below it, a path without one not evaluated", () => {
    // Up to 10 % the neutral colour, then the shortfall palette's stops that stand out more from the paper than it (3.36 : 1):
    // #d94801 (4.31 : 1) and #7f2704 (9.57 : 1) in the light scheme; #fd8d3c (7.65) to #fff5eb (16.5) above 5.28 in the dark.
    expect(pathColors(scene({ measure: "shortfall" }))).toEqual({ "s-a": "#cfd4dc", "a-b": "#7f2704", "a-c": "#8c8c8c", "b-c": "#d94801", "b-d": "#7f2704", "c-d": "#8c8c8c" });
    expect(pathColors(scene({ measure: "shortfall", scheme: "dark" }))).toEqual({ "s-a": "#3a3f49", "a-b": "#fff5eb", "a-c": "#8c8c8c", "b-c": "#fd8d3c", "b-d": "#fff5eb", "c-d": "#8c8c8c" });
    const s = scene({ measure: "shortfall" });
    expect(s.edgeMarks.find((m) => m.id === "s-a")?.notEvaluated).toBe(true);
    expect(s.legend.rows.filter((r) => r.kind === "key").map((r) => r.kind === "key" && r.text)).toContain("not evaluated");
    expect(s.legend.rows.find((r) => r.kind === "swatches")).toEqual({
      kind: "swatches",
      title: "Path colour: expectation shortfall (% of cases)",
      entries: [
        { text: "up to 10 %", color: "#8c8c8c", pattern: "solid" },
        { text: "10 % to 30 %", color: "#d94801", pattern: "solid" },
        { text: "over 30 %", color: "#7f2704", pattern: "solid" },
      ],
    });
  });

  it("keeps a deviation's arc apart from a path in the accent's hue by its form", () => {
    const arc = { kind: "arc" as const, target: "a-b", payload: { constraintType: "lag", source: "a", target: "b", value: 0.35, evaluated: 820 } };
    const s = scene({ measure: "shortfall", overlays: [arc] });
    const mark = s.marks.find((m) => m.kind === "arc")!;
    const path = s.edgeMarks.find((m) => m.id === "a-b")!;
    // The arc: a curve in the accent, one width, an arrowhead and its result in a pill; the path: a line as wide as its cases, its label without one.
    expect([/C/u.test(mark.path!), mark.stroke!.width, !!mark.arrow, !!mark.pill, mark.color, mark.texts[0].text]).toEqual([true, 1, true, true, "#b84a00", "late 35 % of 820"]);
    expect([path.points.length, path.width > 1, path.texts[0].halo]).toEqual([2, true, true]);
    expect(path.width).toBeGreaterThan(mark.stroke!.width * 4);
  });

  it("follows thresholds the host gives, in the classes and in the legend's words", () => {
    const s = scene({ measure: "shortfall", style: { edgeColor: { bins: [0.05, 0.2] } } });
    expect(pathColors(s)).toEqual({ "s-a": "#cfd4dc", "a-b": "#7f2704", "a-c": "#d94801", "b-c": "#7f2704", "b-d": "#7f2704", "c-d": "#8c8c8c" });
    const row = s.legend.rows.find((r) => r.kind === "swatches");
    expect(row?.kind === "swatches" && row.entries.map((e) => e.text)).toEqual(["up to 5 %", "5 % to 20 %", "over 20 %"]);
    const de = scene({ measure: "shortfall", locale: "de", style: { edgeColor: { bins: [0.05, 0.2] } } }).legend.rows.find((r) => r.kind === "swatches");
    expect(de?.kind === "swatches" && de.entries.map((e) => e.text)).toEqual(["bis 5 %", "5 % bis 20 %", "über 20 %"]);
    // Four classes with three bounds: the neutral colour, then the two stops and the colour half-way between them.
    const four = scene({ measure: "shortfall", style: { edgeColor: { bins: [0.05, 0.2, 0.32] } } });
    expect(pathColors(four)).toEqual({ "s-a": "#cfd4dc", "a-b": "#7f2704", "a-c": "#d94801", "b-c": "#ac3803", "b-d": "#ac3803", "c-d": "#8c8c8c" });
  });

  it("draws the share short of an activity's cases in the accent of its frequency cue, which stays as long as its share of all cases", () => {
    // Inside the outline (the cards have no stage, so no band): 180 − 2 × 1 = 178 for all cases.
    const cue = (s: FlowScene, id: string) => s.nodeMarks.find((m) => m.id === id)!.cue!;
    const s = scene({ measure: "shortfall" });
    expect([cue(s, "a").stripe!.box.width, cue(s, "a").foot!.box.width]).toEqual([178, 178]);
    // 35 % of all cases short: 62.3 long (35 % of 178), from the cue's start; the stripe in the accent #b84a00 at the tint's 0.18 over the paper, the foot in the accent.
    const a = cue(s, "a");
    expect([a.accent!.share, a.accent!.stripe!.paint, a.accent!.foot!.paint]).toEqual([0.35, "#f2ded1", "#b84a00"]);
    expect([a.accent!.stripe!.box.width, a.accent!.foot!.box.width]).toEqual([expect.closeTo(62.3), expect.closeTo(62.3)]);
    expect([a.accent!.stripe!.box.x, a.accent!.stripe!.box.y, a.accent!.stripe!.box.height, a.accent!.foot!.box.y]).toEqual([a.stripe!.box.x, a.stripe!.box.y, a.stripe!.box.height, a.foot!.box.y]);
    // 30 % of the half of all cases: 15 % of 178.
    expect(cue(s, "c").accent!.share).toBeCloseTo(0.15);
    expect(cue(s, "c").accent!.foot!.box.width).toBeCloseTo(26.7);
    expect(cue(s, "d").accent).toBeUndefined();
    expect(s.legend.rows.find((r) => r.kind === "key" && r.key === "shortPart")).toMatchObject({ text: "Bar in the accent: share of all cases that fall short" });
    // Print has no tints: only the foot shows the cases short.
    expect(buildScene(graph, positions, { measure: "shortfall", theme: printTheme }).nodeMarks.find((m) => m.id === "a")!.cue!.accent!.stripe).toBeUndefined();
  });
});

describe("the performance measure", () => {
  it("colours paths by their median lag from 0 to the 95th percentile of the shown paths, from a stop at 3 : 1 on", () => {
    // Twenty paths of 1 to 20 hours: the 95th percentile by nearest rank is the 19th, 19 h; 20 h is drawn as 19 h.
    const chain: FlowGraph = {
      nodes: Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, kind: "activity" as const, label: `n${i}` })),
      edges: Array.from({ length: 20 }, (_, i) => ({ id: `e${i + 1}`, kind: "follows" as const, source: `n${i}`, target: `n${i + 1}`, metrics: { count: 10, medianLagHours: i + 1 } })),
    };
    const place = createPositions({ nodes: Object.fromEntries(chain.nodes.map((n, i) => [n.id, { x: i * 200, y: 0, width: 100, height: 40 }])), groups: {}, edges: {} }, "given", "RIGHT");
    const s = buildScene(chain, place, { measure: "performance" });
    // The performance palette's stops at 3 : 1 or more on white: #2171b5 (5.13) and #08306b (12.76).
    const color = (id: string) => s.edgeMarks.find((m) => m.id === id)!.color;
    expect([color("e19"), color("e20")]).toEqual(["#08306b", "#08306b"]);
    expect(s.scales.domains.edgeColor).toEqual([0, 19]);
    // The first path at 9.5 h leaves the 95th percentile at 19 h and is half-way: the mean of the two stops, #155190.
    const half = buildScene({ ...chain, edges: [{ ...chain.edges[0], metrics: { count: 10, medianLagHours: 9.5 } }, ...chain.edges.slice(1)] }, place, { measure: "performance" });
    expect([half.scales.domains.edgeColor, half.edgeMarks.find((m) => m.id === "e1")!.color]).toEqual([[0, 19], "#155190"]);
    expect(s.legend.rows.find((r) => r.kind === "ramp")).toEqual({ kind: "ramp", title: "Path colour: median lag (min, h, d)", id: "legendedgeColor-medianLagHours", stops: ["#2171b5", "#08306b"], values: ["0 min", "19 h"] });
    // In the dark scheme the stops at 3 : 1 on the dark paper, dim to bright.
    expect(buildScene(chain, place, { measure: "performance", scheme: "dark" }).legend.rows.find((r) => r.kind === "ramp")).toMatchObject({ stops: ["#2171b5", "#6baed6", "#c6dbef", "#f7fbff"] });
  });

  it("draws a path without a lag in the line colour and keys it as not evaluated, at its width", () => {
    const s = scene({ measure: "performance" });
    const path = s.edgeMarks.find((m) => m.id === "c-d")!;
    expect([path.color, path.notEvaluated, path.texts[0].text, path.width]).toEqual(["#cfd4dc", true, "– · 400", scene().edgeMarks.find((m) => m.id === "c-d")!.width]);
    expect(s.legend.rows.find((r) => r.kind === "key" && r.key === "notEvaluated")).toBeDefined();
  });

  it("shows a time on an activity only where the host gave its metric, never one derived from the paths' medians", () => {
    const without: FlowGraph = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, metrics: { ...n.metrics, medianNextHours: undefined as unknown as number } })) };
    const lines = numberLines(buildScene(without, positions, { measure: "performance" }));
    expect(lines).toEqual(numberLines(scene()));
    for (const line of Object.values(lines)) expect(line).not.toMatch(/\b(min|h|d)\b/u);
    expect(numberLines(scene({ measure: "performance" })).a).toBe("4.7 d to next · 100 %");
  });
});

describe("the frequency cue in every measure", () => {
  it("is as long as the share of all cases", () => {
    for (const measure of ["frequency", "shortfall", "performance"] as const) {
      for (const m of scene({ measure }).nodeMarks.filter((n) => n.kind === "activity")) {
        const share = m.node.metrics!.cases / 1000;
        expect([m.cue!.share, m.cue!.stripe!.box.width, m.cue!.foot!.box.width], `${measure} ${m.id}`).toEqual([share, share * 178, share * 178]);
      }
    }
  });
});

describe("what a measure's style is", () => {
  it("is the measure's named style with the host's style over it, entry by entry; the host's style alone without a measure", () => {
    const own = { edgeColor: { metric: "count", palette: "diverging" as const } };
    expect(measureStyle(undefined, own)).toBe(own);
    expect(measureStyle("shortfall", { edgeColor: { bins: [0.2, 0.4] } }).edgeColor).toEqual({ metric: "violationShare", palette: "shortfall", bins: [0.2, 0.4], required: true });
    expect(measureStyle("performance", { pathLabel: undefined }).pathLabel).toEqual({ metric: "medianLagHours" });
  });
});

describe("the exports and the Canvas map in a measure", () => {
  it("draw the measure's colours, labels and the cue's accent", () => {
    const svg = toSVG({ graph, positions, measure: "shortfall" }, { theme: "default" });
    expect(svg).toContain('class="wf-cue-accent" fill="#f2ded1"');
    expect(svg).toContain('class="wf-cue-foot-accent" fill="#b84a00"');
    expect(svg).toContain("35 % · 820");
    expect(svg).toContain(">Shortfall: share of cases");
    const prepared = prepareScene(graph, positions, { measure: "performance" });
    expect(prepared.edgeMarks.find((m) => m.id === "a-b")!.texts[0].text).toBe("12 d · 820");
  });
});

describe("checkTheme for the measures' palettes", () => {
  it("passes the presets and reports a palette a measure cannot draw and text the accent's tint does not carry", () => {
    expect(checkTheme(defaultTheme)).toEqual([]);
    expect(checkTheme(printTheme)).toEqual([]);
    const pale: Theme = { ...defaultTheme, palette: { ...defaultTheme.palette, performance: ["#f7fbff", "#c6dbef", "#2171b5"] } };
    expect(checkTheme(pale).filter((d) => d.kind === "measure")).toEqual([{ kind: "measure", scheme: "light", subject: "palette.performance", value: 1, minimum: 2 }]);
    const greyOrange: Theme = { ...defaultTheme, palette: { ...defaultTheme.palette, shortfall: ["#fdd0a2", "#7f2704"] } };
    expect(checkTheme(greyOrange).filter((d) => d.kind === "measure")).toEqual([
      { kind: "measure", scheme: "light", subject: "palette.shortfall", value: 1, minimum: 2 },
      { kind: "measure", scheme: "dark", subject: "palette.shortfall", value: 1, minimum: 2 },
    ]);
    const strongTint: Theme = { ...defaultTheme, opacity: { ...defaultTheme.opacity, tint: 0.9 } };
    expect(checkTheme(strongTint).map((d) => d.subject)).toContain("ink on accent tint");
  });
});
