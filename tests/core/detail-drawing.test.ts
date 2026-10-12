import { describe, expect, it } from "vitest";
import { ANCHOR_TAG, INDIRECT_TAG, type FlowGraph, abstract, buildScene, dashTokens, defaultTheme, estimateTextWidth, figureCaption, hasTag, layout, toSVG } from "../../src/index";
import { prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { readCanvasMap, readPng } from "../browser/parity/canvas";
import { exportedMarks, kindsOf } from "../browser/parity/drawn";
import { readSvg } from "../browser/parity/svg";

/**
 * Four activities: "late" is entered only from "rarer" and "rare". At two activities of four and no path by frequency
 * "late" is shown with "busy", and its way in passes both rarer activities: one indirect path "start->rarer->rare->late"
 * standing for them, and three paths of the graph kept as anchors.
 */
const graph: FlowGraph = {
  nodes: [
    { id: "start", kind: "event", label: "Start", tags: ["start"] },
    { id: "busy", kind: "activity", label: "Busy", metrics: { cases: 100 } },
    { id: "late", kind: "activity", label: "Late", metrics: { cases: 90 } },
    { id: "rare", kind: "activity", label: "Rare", metrics: { cases: 5 } },
    { id: "rarer", kind: "activity", label: "Rarer", metrics: { cases: 3 } },
    { id: "end", kind: "event", label: "End", tags: ["end"] },
  ],
  edges: ([["start", "busy", 100], ["busy", "end", 100], ["start", "rarer", 3], ["rarer", "rare", 3], ["rare", "late", 5], ["late", "end", 90]] as const).map(([source, target, count]) => ({ id: `${source}->${target}`, kind: "follows" as const, source, target, metrics: { count } })),
};
const INDIRECT = "start->rarer->rare->late:indirect";
const shown = abstract(graph, { activityDetail: 0.5, pathDetail: 0 });
const measure = (text: string, font: string) => estimateTextWidth(text, { size: Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) });

describe("paths of the detail shares, drawn", () => {
  it("draw a kept path solid with its count and an indirect path dashed, labelled without a count, in the scene and the legend", async () => {
    expect(shown.edges.map((e) => [e.id, hasTag(e, ANCHOR_TAG) ? "anchor" : hasTag(e, INDIRECT_TAG) ? "indirect" : "frequency"])).toEqual([
      ["start->busy", "anchor"],
      ["busy->end", "anchor"],
      ["late->end", "anchor"],
      [INDIRECT, "indirect"],
    ]);
    const positions = await layout(shown, { engine: "dagre" });
    const scene = buildScene(shown, positions, { locale: "en" });
    const marks = new Map(scene.edgeMarks.map((m) => [m.id, m]));
    for (const [id, count] of [["start->busy", "100"], ["busy->end", "100"], ["late->end", "90"]] as const) {
      expect(marks.get(id), id).toMatchObject({ dash: undefined, reconnected: false, texts: [expect.objectContaining({ text: count })] });
      expect(marks.get(id)!.indirect).toBeUndefined();
    }
    // Dashed as what is not directly observed, in the line colour at the thinnest width; its label says what it passes.
    const indirect = marks.get(INDIRECT)!;
    expect(indirect).toMatchObject({ dash: [...dashTokens.reconnectedPath], color: defaultTheme.color.line, width: defaultTheme.stroke.pathMin, indirect: true, reconnected: false });
    expect(indirect.notEvaluated).toBeUndefined();
    expect(indirect.texts.map((t) => t.text)).toEqual(["via 2 activities not shown"]);
    expect(indirect.texts.some((t) => /^\d/.test(t.text))).toBe(false);
    const keys = scene.legend.keys.map((k) => k.kind);
    expect(keys).toContain("indirect");
    expect(keys).not.toContain("notEvaluated");
    expect(scene.legend.rows).toContainEqual({ kind: "key", key: "indirect", glyph: "┄", text: "Path through activities not shown" });
    expect(buildScene(shown, positions, { locale: "de" }).edgeMarks.find((m) => m.id === INDIRECT)!.texts[0].text).toBe("über 2 nicht gezeigte Aktivitäten");
  });

  it("draw them alike in the SVG export, the Canvas map and the PNG export", async () => {
    const positions = await layout(shown, { engine: "dagre" });
    const scene = buildScene(shown, positions);
    const kinds = kindsOf(scene);
    const drawings = {
      svg: readSvg(toSVG({ graph: shown, positions }), exportedMarks(scene)),
      canvas: readCanvasMap(prepareScene(shown, positions), kinds, measure),
      png: readPng((createCanvas) => toPNGCanvas({ graph: shown, positions }, { scale: 1, createCanvas }), prepareScene(shown, positions, { lodBySize: false }), kinds, measure),
    };
    for (const [renderer, drawn] of Object.entries(drawings)) {
      expect(drawn.get(`edge:${INDIRECT}`)!.props.dash, renderer).toBe("6 5");
      expect(drawn.get(`edge:${INDIRECT}`)!.texts.map((t) => t.text), renderer).toEqual(["via 2 activities not shown"]);
      expect(drawn.get("edge:late->end")!.props.dash, renderer).toBe("none");
      expect(drawn.get("edge:late->end")!.texts.map((t) => t.text), renderer).toEqual(["90"]);
    }
  });

  it("caption an export with the panel's statements", () => {
    expect(figureCaption(shown)).toBe("2 of 4 activities shown; the 2 rarest are not shown. 3 of 6 paths: 0 by frequency, 3 kept so that every activity lies on a way from start to end. 1 dashed path stands for a way through activities not shown. Strongest path not shown: 5.");
    // Thresholds keep the caption they had.
    expect(figureCaption(abstract(graph, { minNodeShare: 0.5 }))).toBe("2 of 4 activities, 3 of 6 paths shown");
  });
});
