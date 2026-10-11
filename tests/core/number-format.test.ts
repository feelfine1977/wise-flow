import { describe, expect, it } from "vitest";
import { type FlowEdge, buildScene, createPositions, elementMetric, formatHours, formatMetricValue, formatPathCount, formatShare, metricLabelOf, metricName, metricUnit } from "../../src/index";

describe("number formats", () => {
  it("write activities, lists and tooltips as grouped full integers", () => {
    expect(formatMetricValue("cases", 1000)).toBe("1,000");
    expect(formatMetricValue("cases", 1000, "de")).toBe("1.000");
    expect(formatMetricValue("cases", 234112)).toBe("234,112");
    expect(formatMetricValue("cases", 234112, "de")).toBe("234.112");
    expect(formatMetricValue("events", 1595923)).toBe("1,595,923");
  });

  it("write paths in full up to 99,999, then in thousands and millions, never 1.0k", () => {
    expect(formatPathCount(1000)).toBe("1,000");
    expect(formatPathCount(1000, "de")).toBe("1.000");
    expect(formatPathCount(99999)).toBe("99,999");
    expect(formatPathCount(100000)).toBe("100k");
    expect(formatPathCount(112924)).toBe("113k");
    expect(formatPathCount(999499)).toBe("999k");
    // 999,500 is a thousand thousands: a million.
    expect(formatPathCount(999500)).toBe("1M");
    expect(formatPathCount(1_000_000)).toBe("1M");
    expect(formatPathCount(1_234_567)).toBe("1.2M");
    expect(formatPathCount(1_234_567, "de")).toBe("1,2M");
    expect(formatPathCount(12_345_678)).toBe("12M");
    expect(formatPathCount(1_250_000_000, "de")).toBe("1.250M");
    expect(formatMetricValue("cases", 112924, "en", { path: true })).toBe("113k");
    expect(formatMetricValue("count", 38, "en", { path: true })).toBe("38");
  });

  it("write percentages as integers, with one decimal under 1 %, and a share that is not zero never as 0 %", () => {
    expect(formatShare(0.2258)).toBe("23 %");
    expect(formatShare(0.84)).toBe("84 %");
    expect(formatShare(1)).toBe("100 %");
    expect(formatShare(0)).toBe("0 %");
    expect(formatShare(0.004)).toBe("0.4 %");
    expect(formatShare(0.004, "de")).toBe("0,4 %");
    expect(formatShare(0.0096)).toBe("1 %");
    expect(formatShare(0.0006)).toBe("0.1 %");
    expect(formatShare(0.0004)).toBe("<0.1 %");
    expect(formatShare(0.000001, "de")).toBe("<0,1 %");
    expect(formatShare(-0.3)).toBe("-30 %");
    expect(formatMetricValue("violationShare", 0.35)).toBe("35 %");
  });

  it("write durations in minutes under an hour, hours under 48 hours, then days", () => {
    expect(formatHours(0.5)).toBe("30 min");
    expect(formatHours(59.4 / 60)).toBe("59 min");
    // 59.6 minutes round to an hour.
    expect(formatHours(59.6 / 60)).toBe("1.0 h");
    expect(formatHours(4.25)).toBe("4.3 h");
    expect(formatHours(4.25, "de")).toBe("4,3 h");
    expect(formatHours(12)).toBe("12 h");
    expect(formatHours(47.4)).toBe("47 h");
    expect(formatHours(48)).toBe("2.0 d");
    expect(formatHours(112.8)).toBe("4.7 d");
    expect(formatHours(400)).toBe("17 d");
    // 9.996 days round to ten: whole days from there, as hours are from 9.95 h.
    expect(formatHours(239.9)).toBe("10 d");
    expect(formatHours(9.96)).toBe("10 h");
    expect(formatHours(238.7, "de")).toBe("9,9 d");
    expect(formatMetricValue("medianLagHours", 288)).toBe("12 d");
  });

  it("write a missing value as –, never 0", () => {
    for (const name of ["cases", "count", "share", "violationShare", "medianLagHours", "unknown"]) {
      expect(formatMetricValue(name, undefined)).toBe("–");
      expect(formatMetricValue(name, Number.NaN, "de")).toBe("–");
    }
    expect(formatPathCount(Number.NaN)).toBe("–");
    expect(elementMetric({ metrics: {} }, "cases")).toBe("–");
  });

  it("write a lower bound as at least, in English and German", () => {
    const stage = { metrics: { cases: 211379, share: 0.84 }, metricBasis: { cases: "atLeast", share: "atLeast" } as const };
    expect(elementMetric(stage, "cases")).toBe("at least 211,379");
    expect(elementMetric(stage, "cases", "de")).toBe("mindestens 211.379");
    expect(elementMetric(stage, "share")).toBe("at least 84 %");
    expect(elementMetric(stage, "share", "de")).toBe("mindestens 84 %");
    // Without a basis the value is exact.
    expect(elementMetric({ metrics: { cases: 500 } }, "cases")).toBe("500");
  });

  it("name a mean of medians as one, never as a median", () => {
    expect(metricLabelOf("medianLagHours")).toBe("median lag");
    expect(metricLabelOf("medianLagHours", "en", "mean")).toBe("lag, mean of medians");
    expect(metricLabelOf("medianLagHours", "de", "mean")).toBe("Wartezeit, Mittel der Mediane");
    expect(metricLabelOf("p90LagHours", "en", "mean")).toBe("lag, mean of 90th percentiles");
    expect(metricLabelOf("violationShare", "en", "mean")).toBe("expectation shortfall, weighted mean");
    expect(metricLabelOf("violationShare", "de", "mean")).toBe("Erwartungslücke, gewichtetes Mittel");
  });

  it("name every metric with its unit from the registry", () => {
    expect([metricName("cases"), metricUnit("cases")]).toEqual(["cases", "count"]);
    expect([metricName("count", "de"), metricUnit("count", "de")]).toEqual(["Übergänge", "Anzahl"]);
    expect([metricName("violationShare"), metricUnit("violationShare")]).toEqual(["expectation shortfall", "% of cases"]);
    expect([metricName("medianLagHours", "de"), metricUnit("medianLagHours", "de")]).toEqual(["Median-Wartezeit", "min, h, d"]);
    expect([metricName("delta_violationShare"), metricUnit("delta_violationShare")]).toEqual(["difference expectation shortfall", "% of cases"]);
    expect(formatMetricValue("delta_violationShare", 0.05)).toBe("+5 %");
    expect([metricName("score"), metricUnit("score")]).toEqual(["score", ""]);
    expect(formatMetricValue("score", 2.25)).toBe("2.3");
  });

  it("label a path without a value –, draw it at the thinnest width in the line colour and list it as not evaluated", () => {
    const edges: FlowEdge[] = [
      { id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 120, count: 130 } },
      { id: "bc", kind: "follows", source: "b", target: "c", metrics: { cases: 900 } },
      { id: "ca", kind: "follows", source: "c", target: "a" },
    ];
    const graph = { nodes: ["a", "b", "c"].map((id) => ({ id, kind: "activity" as const, label: id, metrics: { cases: 900 } })), edges };
    const box = (x: number) => ({ x, y: 0, width: 100, height: 40 });
    const scene = buildScene(graph, createPositions({ nodes: { a: box(0), b: box(200), c: box(400) }, groups: {}, edges: {} }, "given", "RIGHT"), { selfLoops: false });
    const mark = (id: string) => scene.edgeMarks.find((m) => m.id === id)!;
    // Paths are labelled with their cases, as activities are.
    expect(mark("ab").texts.map((t) => t.text)).toEqual(["120"]);
    expect(mark("ca").texts.map((t) => t.text)).toEqual(["–"]);
    expect(mark("ca")).toMatchObject({ color: scene.theme.color.line, width: scene.theme.stroke.pathMin, notEvaluated: true });
    expect(mark("ab").notEvaluated).toBeUndefined();
    expect(scene.legend.rows.filter((r) => r.kind === "key")).toEqual([{ kind: "key", key: "notEvaluated", glyph: "─", text: "not evaluated" }]);
    const german = buildScene(graph, scene.positions, { selfLoops: false, locale: "de" });
    expect(german.legend.rows.find((r) => r.kind === "key")).toMatchObject({ text: "nicht bewertet" });
  });
});
