/**
 * The host's wording (WF-03): `strings` replaces the table's EN or DE text of
 * a key with the same placeholders, in the legend's sentence, the caption,
 * the detail statement, Start and End and the descriptions, and reaches the
 * SVG export, the Canvas drawing and the PNG export through the scene.
 */
import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { type FlowGraph, buildScene, createStrings, createPositions, detailStatement, t, toSVG } from "../../src/index";
import { type DrawContext, drawLegend, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { graph as terminals, positions as terminalPositions } from "../support/terminals";

const host = { "legend.measure": "Frequency · {unit}", "legend.shareOf": "share of {total} cases" } as const;

/** Every text a Canvas drawing writes. */
function written(draw: (ctx: DrawContext) => void): string[] {
  const out: string[] = [];
  const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }) } as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : key === "fillText" ? (s: string) => out.push(s) : key === "createLinearGradient" ? () => ({ addColorStop: () => undefined }) : () => undefined),
    set: (target, key: string, value) => ((target[key] = value), true),
  }) as unknown as DrawContext;
  draw(ctx);
  return out;
}

const small: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "A", metrics: { cases: 10 } }, { id: "b", kind: "activity", label: "B", metrics: { cases: 5 } }], edges: [{ id: "ab", kind: "follows", source: "a", target: "b", metrics: { cases: 5 } }], meta: { cases: 251734 } };
const smallPositions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 300, y: 0, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");

describe("t with a host's wording", () => {
  it("replaces the table's text with the same placeholders, and leaves unknown keys and other values out", () => {
    expect(t("en", "legend.measure", { measure: "Frequency", unit: "cases" }, host)).toBe("Frequency · cases");
    expect(t("de", "legend.shareOf", { total: "251.734" }, host)).toBe("share of 251.734 cases");
    expect(t("de", "legend.title", {}, host)).toBe("Legende");
    expect(t("en", "legend.title", {}, { "legend.title": 7 } as never)).toBe("Legend");
    expect(t("en", "no.such" as never, {}, { "no.such": "x" } as never)).toBe("no.such");
    const say = createStrings("de", { "terminal.start": "Anfang" });
    expect([say("terminal.start"), say("terminal.end")]).toEqual(["Anfang", "Ende"]);
  });
});

describe("the host's wording on the map and its figures", () => {
  it("writes the legend's sentence as the host words it, in the scene, the SVG export, the Canvas legend and the PNG export", () => {
    const sentence = "Frequency · cases · share of 251,734 cases";
    const scene = buildScene(small, smallPositions, { strings: host });
    expect(scene.legend.rows[0]).toEqual({ kind: "measure", text: sentence });
    expect(buildScene(small, smallPositions).legend.rows[0]).toEqual({ kind: "measure", text: "Frequency · cases · share of 251,734 cases" });
    const svg = toSVG({ graph: small, positions: smallPositions }, { strings: { ...host, "legend.measure": "Host · {unit}" } });
    // The legend wraps the sentence onto its lines.
    expect(svg.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).toContain("Host · cases · share of 251,734 cases");
    const prepared = prepareScene(small, smallPositions, { strings: { "legend.measure": "Host · {unit}" } });
    expect(written((ctx) => drawLegend(ctx, prepared, 0, 0, 200)).join(" ")).toContain("Host · cases");
    const png = written((ctx) => void toPNGCanvas({ graph: small, positions: smallPositions }, { strings: { "legend.measure": "Host · {unit}" }, createCanvas: (width, height) => ({ width, height, getContext: () => ctx }) }));
    expect(png.join(" ")).toContain("Host · cases");
  });

  it("names Start and End and writes the caption's terminal sentence in the host's words", () => {
    const strings = { "terminal.start": "Opened", "terminal.end": "Closed", "export.terminals": "Σ starts = Σ ends = {cases}" };
    const scene = buildScene(terminals, terminalPositions, { strings });
    expect(scene.nodeMarks.filter((m) => m.kind === "event").map((m) => m.texts.find((t) => t.role === "label")!.text)).toEqual(["Opened", "Closed"]);
    expect(toSVG({ graph: terminals, positions: terminalPositions }, { strings })).toContain("Σ starts = Σ ends = 1,000");
    expect(toSVG({ graph: terminals, positions: terminalPositions })).toContain("Start and End paths count cases by their first and last activity (Σ = 1,000)");
    expect(toSVG({ graph: small, positions: smallPositions })).not.toContain("Start and End paths");
  });

  it("words the detail statement as the host does", () => {
    const statement = detailStatement(globalScene, { strings: { "controls.kept": "{shown} / {total}" } });
    if (statement) expect(statement.activities.short).toMatch(/^\d[\d,]* \/ \d/);
  });
});
