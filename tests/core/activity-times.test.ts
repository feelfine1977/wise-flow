import { expect, it } from "vitest";
import { type FlowGraph, buildScene, estimateTextWidth, formatHours, metricName, nodeMark, toSVG } from "../../src/index.js";

import { describeEdge } from "../../src/core/describe";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { timedGraph, timedPositions, timedStyle } from "../support/activity-times";
import { readCanvasMap, readPng } from "../browser/parity/canvas";
import { differences, exportedMarks, kindsOf } from "../browser/parity/drawn";
import { readSvg } from "../browser/parity/svg";
const measure = (text: string, font: string) => estimateTextWidth(text, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) });

it("names activity times and mean lag in both languages", () => {
  for (const locale of ["en", "de"] as const) {
    for (const key of ["medianPrevHours", "meanPrevHours", "meanNextHours", "meanLagHours", "prevPassages", "nextPassages", "lagPassages"]) {
      expect(metricName(key, locale)).not.toBe(key);
    }
  }
});

it("keeps the direction on a missing time and suppresses a stage's pooled time", () => {
  const box = { x: 0, y: 0, width: 180, height: 64 };
  const options = { color: "#000", pattern: "solid" as const, line: { metric: "medianNextHours", format: "toNext" as const } };
  expect(nodeMark({ id: "a", label: "Activity", kind: "activity" }, box, options).texts.find(t => t.role === "countLine")?.text).toBe("– to next");
  expect(nodeMark({ id: "s", label: "Stage", kind: "stage", metrics: { medianNextHours: 2 }, metricBasis: { medianNextHours: "mean" } }, box, options).texts.find(t => t.role === "countLine")?.text).toBe("–");
});

it("distinguishes a positive duration that rounds to zero from zero", () => {
  expect(formatHours(1 / 600)).toBe("< 1 min");
  expect(formatHours(0)).toBe("0 min");
});

it("explains why a stage without supplied times has no duration", () => {
  const mark = nodeMark({ id: "s", label: "Stage", kind: "stage" }, { x: 0, y: 0, width: 180, height: 64 }, { color: "#000", pattern: "solid", line: { metric: "medianNextHours", format: "toNext" } });
  expect(mark.title).toContain("No stage duration");
});

it("writes all three time lines at the existing size in both directions and every export renderer", () => {
  for (const direction of ["RIGHT", "DOWN"] as const) for (const format of ["fromPrev", "toNext", "both"] as const) {
    const positions = timedPositions(direction);
    const given = { graph: timedGraph, positions, style: timedStyle(format), measure: "performance" as const };
    const scene = buildScene(timedGraph, positions, given);
    const kinds = kindsOf(scene);
    const svg = readSvg(toSVG(given, { theme: "default" }), exportedMarks(scene));
    const canvas = readCanvasMap(prepareScene(timedGraph, positions, given), kinds, measure);
    const png = readPng((createCanvas) => toPNGCanvas(given, { scale: 1, createCanvas, theme: "default" }), prepareScene(timedGraph, positions, { ...given, lodBySize: false }), kinds, measure);
    expect(differences([{ name: format, kinds, svg, others: { canvas, png } }])).toEqual([]);
    expect(svg.get("node:a")!.texts.at(-1)?.text).toBe(format === "fromPrev" ? "3.4 d from previous" : format === "toNext" ? "2 min to next" : "prev 3.4 d · next 2 min");
    for (const mark of scene.nodeMarks) {
      expect(mark.box).toMatchObject({ width: 180, height: 64 });
      for (const text of mark.texts) expect(estimateTextWidth(text.text, { size: text.size })).toBeLessThan(164);
    }
    const b = svg.get("node:b")!.texts.map(t => t.text).join(" ");
    expect(b).toContain(format === "toNext" ? "0 min" : "< 1 min");
    if (format === "both") expect(b).toContain("0 min");
  }
});

it("names every supplied statistic in legends, hovers and exports in both languages", () => {
  for (const locale of ["en", "de"] as const) {
    const positions = timedPositions("RIGHT");
    const given = { graph: timedGraph, positions, locale, measure: "performance" as const, style: timedStyle("both") };
    const scene = buildScene(timedGraph, positions, given);
    const title = scene.nodeMarks.find(n => n.id === "a")!.title!;
    for (const key of ["medianPrevHours", "meanPrevHours", "medianNextHours", "meanNextHours"]) expect(title).toContain(metricName(key, locale));
    expect(title).toContain(locale === "en" ? "8 passages" : "8 Übergänge");
    expect(title).toContain(locale === "en" ? "7 passages" : "7 Übergänge");
    const edge = describeEdge(timedGraph.edges[0], timedGraph, locale);
    expect(edge).toContain(metricName("medianLagHours", locale));
    expect(edge).toContain(metricName("meanLagHours", locale));
    expect(edge).toContain(locale === "en" ? "6 passages" : "6 Übergänge");
    const exported = toSVG(given);
    expect(exported).toContain(locale === "en" ? "Performance: mean" : "Durchlaufzeit: mittlere");
    for (const key of Object.keys(timedGraph.nodes[0].metrics!).filter(k => k !== "cases")) {
      expect(title).not.toContain(key);
      expect(exported).not.toContain(key);
    }
    expect(exported.replace(/<[^>]*>/g, "")).not.toContain("meanLagHours");
    const median = toSVG({ ...given, style: { ...given.style, edgeColor: { metric: "medianLagHours" } } });
    expect(median).toContain(locale === "en" ? "Performance: median" : "Durchlaufzeit: mediane");
  }
});

it("pairs means, allows an explicit next statistic, and keeps words on either missing direction", () => {
  const box = { x: 0, y: 0, width: 180, height: 64 };
  const line = { metric: "meanPrevHours", format: "both" as const };
  const mark = (metrics: Record<string, number>, nextMetric?: string) => nodeMark({ id: "a", kind: "activity", label: "Activity", metrics }, box, { color: "#000", pattern: "solid", line: { ...line, nextMetric } }).texts.find(t => t.role === "countLine")!.text;
  expect(mark({ meanPrevHours: 81.6, meanNextHours: 2 / 60 })).toBe("prev 3.4 d · next 2 min");
  expect(mark({ meanPrevHours: 81.6, medianNextHours: 3 / 60 }, "medianNextHours")).toBe("prev 3.4 d · next 3 min");
  expect(mark({ meanNextHours: 0 })).toBe("prev – · next 0 min");
  expect(mark({ meanPrevHours: 0 })).toBe("prev 0 min · next –");
  expect(mark({ meanPrevHours: NaN })).toBe("prev – · next –");
});

it("does not infer passages from cases and retains a supplied zero passage count", () => {
  const graph: FlowGraph = { ...timedGraph, nodes: [{ ...timedGraph.nodes[0], metrics: { cases: 999, medianNextHours: 0 } }] };
  const scene = buildScene(graph, timedPositions("RIGHT"));
  expect(scene.nodeMarks[0].title).toBe(`${graph.nodes[0].label}. median time to next event 0 min.`);
  graph.nodes[0].metrics = { ...graph.nodes[0].metrics, nextPassages: 0 };
  expect(buildScene(graph, timedPositions("RIGHT")).nodeMarks[0].title).toContain("0 passages");
});
