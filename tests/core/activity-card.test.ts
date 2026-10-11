import { describe, expect, it } from "vitest";
import { globalScene } from "../../fixtures/bpic2019";
import { smallP2P } from "../../fixtures/p2p_small";
import { textMeasures } from "../../fixtures/text-measures";
import { type FlowGraph, type FlowScene, type NodeMark, type Positions, type TextMeasure, type Theme, abstract, activityNodeSize, buildScene, checkTheme, contrastRatio, createPositions, defaultNodeSize, defaultTheme, estimateTextWidth, printTheme, themeColors, toSVG, unionBoxes, wrapText } from "../../src/index";

/** Every node in a row at its default size, 40 apart. */
function row(graph: FlowGraph, size: (n: FlowGraph["nodes"][number]) => { width: number; height: number } = defaultNodeSize): Positions {
  let x = 0;
  const nodes = Object.fromEntries(graph.nodes.map((n) => {
    const s = size(n);
    const box = { x, y: 0, ...s };
    x += s.width + 40;
    return [n.id, box];
  }));
  return createPositions({ nodes, groups: {}, edges: {} }, "given", "RIGHT");
}

const cards = (scene: FlowScene) => scene.nodeMarks.filter((m) => m.kind === "activity" || m.kind === "stage");
const lines = (m: NodeMark) => m.texts.filter((t) => t.role === "nameLine").map((t) => t.text);
const numbers = (m: NodeMark) => m.texts.filter((t) => t.role === "countLine" || t.role === "share").map((t) => t.text);

describe("an activity's card", () => {
  const scene = buildScene(smallP2P, row(smallP2P));

  it("shows the name, the cases and their share of all cases of the log on every activity of the small P2P", () => {
    // The log has 1,000 cases (meta); each share is the activity's cases over them.
    expect(cards(scene).map((m) => [lines(m).join(" "), ...numbers(m)])).toEqual([
      ["Create Purchase Order Item", "1,000", "· 100 %"],
      ["Change Price", "120", "· 12 %"],
      ["Record Goods Receipt", "900", "· 90 %"],
      ["Record Service Entry Sheet", "60", "· 6 %"],
      ["Record Invoice Receipt", "850", "· 85 %"],
      ["Cancel Invoice Receipt", "40", "· 4 %"],
      ["Clear Invoice", "780", "· 78 %"],
    ]);
    expect(cards(scene).map((m) => m.cue?.share)).toEqual([1, 0.12, 0.9, 0.06, 0.85, 0.04, 0.78]);
  });

  it("shows the share of the log's cases on every activity of BPIC global, in grouped integers", () => {
    const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
    const built = buildScene(global, row(global));
    const activities = cards(built);
    expect(activities.length).toBeGreaterThan(10);
    for (const m of activities) {
      const cases = m.node.metrics!.cases;
      expect(m.cue!.share).toBe(cases / 251734);
      expect(numbers(m)[0]).toBe(cases.toLocaleString("en-US"));
      expect(numbers(m)[1]).toMatch(/^· \d+(\.\d)? %$/);
    }
  });

  it("draws the stripe and the foot as long as the share of its inner width: after the band, inside the outline", () => {
    const [create, change] = cards(scene);
    // 180 × 64 at (76, 0) and (296, 0), after the start event's 36 and 40: the inner width is 180 − the band of 8 − the
    // outline of 1 on the right, 171; the stripe fills the height inside the outline, the foot its lowest 3.
    expect(create.cue).toEqual({
      share: 1,
      stripe: { box: { x: 84, y: 1, width: 171, height: 62 }, paint: "cueStripe" },
      foot: { box: { x: 84, y: 60, width: 171, height: 3 }, paint: "cueFoot" },
    });
    expect(change.cue!.stripe!.box).toEqual({ x: 304, y: 1, width: 0.12 * 171, height: 62 });
    expect(change.cue!.foot!.box).toEqual({ x: 304, y: 60, width: 0.12 * 171, height: 3 });
  });

  it("places the cue as the theme says: behind the texts, along the bottom, both (by default) or none", () => {
    const place = (frequencyCue: Theme["frequencyCue"]) => {
      const [create] = cards(buildScene(smallP2P, row(smallP2P), { theme: { ...defaultTheme, frequencyCue } }));
      return [!!create.cue?.stripe, !!create.cue?.foot];
    };
    expect(defaultTheme.frequencyCue).toBe("both");
    expect([place("both"), place("behind"), place("bottom"), place("none")]).toEqual([[true, true], [true, false], [false, true], [false, false]]);
  });

  it("shows no cue at a share of 0 or without one, and a dash for a missing value", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "none", kind: "activity", label: "No cases", metrics: { cases: 0 } },
        { id: "missing", kind: "activity", label: "Unknown" },
      ],
      edges: [],
      meta: { cases: 50 },
    };
    const [none, missing] = buildScene(graph, row(graph)).nodeMarks;
    expect([none.cue, missing.cue]).toEqual([undefined, undefined]);
    expect([numbers(none), numbers(missing)]).toEqual([["0", "· 0 %"], ["–", "· –"]]);
    // Without the log's cases there is no share either.
    const [alone] = buildScene({ ...smallP2P, meta: undefined }, row(smallP2P)).nodeMarks.filter((m) => m.kind === "activity");
    expect([alone.cue, numbers(alone)]).toEqual([undefined, ["1,000", "· –"]]);
  });

  it("carries the stage's colour only in its band: no outline, fill or cue of a card is in a stage colour", () => {
    const stageColors = new Set(cards(scene).map((m) => m.color));
    expect(stageColors.size).toBe(3);
    for (const m of cards(scene)) {
      expect([m.fill, m.stroke.paint, m.cue?.stripe?.paint, m.cue?.foot?.paint, m.band]).toEqual(["paper", "lineStrong", "cueStripe", "cueFoot", 8]);
      for (const t of m.texts) expect(["ink", "inkMuted"]).toContain(t.paint);
    }
    // In the SVG export a stage's colour fills the band of its cards and nothing else of them.
    const svg = toSVG({ graph: smallP2P, positions: row(smallP2P) }, { legend: false });
    for (const group of svg.match(/<g class="wf-node wf-node-activity"[^]*?<\/g>/g)!) {
      const painted = [...group.matchAll(/<rect[^>]*>/g)].map((r) => r[0]).filter((r) => [...stageColors].some((c) => r.includes(c)));
      expect(painted.length).toBe(1);
      expect(painted[0]).toContain('class="wf-band"');
    }
    // Stage groups are hairlines without a tint: each around its members.
    const boxes = row(smallP2P);
    const around = (id: string) => unionBoxes(smallP2P.nodes.filter((n) => n.group === id).map((n) => boxes.nodes[n.id]));
    const grouped = buildScene(smallP2P, { ...boxes, groups: Object.fromEntries(smallP2P.groups!.map((g) => [g.id, around(g.id)])) });
    expect(grouped.groupMarks.map((g) => [g.fill.opacity, g.stroke, g.texts[0].paint])).toEqual(smallP2P.groups!.map(() => [0, { paint: "line", width: 1 }, "inkMuted"]));
  });

  it("writes the name of an activity outside the scope in the muted ink, under a solid outline", () => {
    const hatched = buildScene(smallP2P, row(smallP2P), { overlays: [{ kind: "hatch", target: "service_entry" }] });
    const entry = hatched.nodeMarks.find((m) => m.id === "service_entry")!;
    expect(entry.outOfScope).toBe(true);
    expect(entry.stroke).toEqual({ paint: "lineStrong", width: 1 });
    expect(entry.texts.map((t) => [t.role, t.paint])).toEqual([["nameLine", "inkMuted"], ["nameLine", "inkMuted"], ["countLine", "ink"], ["share", "inkMuted"]]);
    expect(hatched.nodeMarks.filter((m) => m.outOfScope).map((m) => m.id)).toEqual(["service_entry"]);
  });

  it("is drawn by a stage node with a semibold name", () => {
    const collapsed = abstract(globalScene, { collapse: "all" });
    const stages = buildScene(collapsed, row(collapsed)).nodeMarks.filter((m) => m.kind === "stage");
    expect(stages.length).toBeGreaterThan(2);
    for (const m of stages) {
      expect(m.texts.filter((t) => t.role === "nameLine").map((t) => [t.size, t.weight])).toEqual(lines(m).map(() => [13, 600]));
      expect(m.cue!.share).toBe(m.node.metrics!.cases / 251734);
    }
  });
});

describe("the name on a card", () => {
  // The room the interactive map gives a name: 180 − 16 − 8 of padding − 2 × 1 of outline.
  const room = 180 - 24 - 2;
  const name = { size: 13, weight: 500 };

  /** Checks every activity: a name that fits two lines is written whole, a longer one ends in an ellipsis and is given whole to hover. */
  function check(graph: FlowGraph, measure: TextMeasure, locale: "en" | "de") {
    const scene = buildScene(graph, row(graph), { textMeasure: measure, locale });
    let cut = 0;
    for (const m of cards(scene).filter((c) => c.kind === "activity")) {
      const whole = wrapText(m.node.label, room, name, measure);
      if (whole.length <= 2) {
        expect(lines(m)).toEqual(whole);
        expect(m.title).toBeUndefined();
      } else {
        cut++;
        expect(lines(m)).toHaveLength(2);
        expect(lines(m)[0]).toBe(whole[0]);
        expect(lines(m)[1].endsWith("…")).toBe(true);
        expect(measure(lines(m)[1], name)).toBeLessThanOrEqual(room + 1e-6);
        expect(m.title).toBe(m.node.label);
      }
    }
    return cut;
  }

  it("is not shortened where it fits two lines at the default size, in English with the estimate and in German with another measure", () => {
    const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
    expect(check(global, estimateTextWidth, "en")).toBe(0);
    expect(check(smallP2P, estimateTextWidth, "en")).toBe(0);
    // The wider measure (0.7 em) needs a third line for some names: they end in an ellipsis.
    expect(check(global, textMeasures.wide, "de")).toBeGreaterThan(0);
    expect(check(smallP2P, textMeasures.wide, "de")).toBe(0);
  });

  it("ends a name longer than two lines in an ellipsis and gives it whole to hover and assistive technology", () => {
    const long: FlowGraph = { nodes: [{ id: "x", kind: "activity", label: "Vendor creates debit memo for the purchase order item after the goods receipt", metrics: { cases: 3 } }], edges: [], meta: { cases: 3 } };
    const [m] = buildScene(long, row(long)).nodeMarks;
    // 21 characters of 7.15 fit the room of 154: the second line keeps 20 and the ellipsis.
    expect(lines(m)).toEqual(["Vendor creates debit", "memo for the purchas…"]);
    expect(m.title).toBe(long.nodes[0].label);
    expect(toSVG({ graph: long, positions: row(long) }, { legend: false })).toContain(`<title>${long.nodes[0].label}</title>`);
  });
});

describe("the label of an event", () => {
  it("sits below the circle, never spills past its 96 and gives a shortened label whole to hover", () => {
    const graph: FlowGraph = {
      nodes: [
        { id: "s", kind: "event", label: "Start", tags: ["start"] },
        { id: "e", kind: "event", label: "Purchase order item closed and archived", tags: ["end"] },
      ],
      edges: [],
    };
    const [start, end] = buildScene(graph, row(graph)).nodeMarks;
    // 4 below the 36 high circle, the baseline 11 lower; centred on it.
    expect([start.shape, start.texts[0].text, start.texts[0].x, start.texts[0].y, start.texts[0].anchor, start.title]).toEqual(["circle", "Start", 18, 36 + 4 + 11, "middle", undefined]);
    // 96 at 11 px by the estimate (6.05 each) holds 14 characters and the ellipsis.
    expect([end.texts[0].text, end.texts[0].maxWidth, end.title]).toEqual(["Purchase order…", 96, graph.nodes[1].label]);
  });
});

describe("the size of a card", () => {
  it("is reserved once: the layout's box is the box the scene draws, whatever the name", () => {
    const activity = smallP2P.nodes.find((n) => n.kind === "activity")!;
    expect(defaultNodeSize(activity)).toEqual({ width: 180, height: 64 });
    expect(defaultNodeSize({ id: "s", kind: "stage", label: "S" })).toEqual({ width: 200, height: 64 });
    const long = { ...activity, label: "A name that takes far more than two lines on a card of any width at all" };
    const names = { mode: "names" as const, references: {} };
    expect([activityNodeSize(activity, names), activityNodeSize(long, names), activityNodeSize(long, { ...names, showCounts: false }), activityNodeSize(long, { mode: "ids", references: {} })]).toEqual([
      { width: 280, height: 64 },
      { width: 280, height: 64 },
      { width: 280, height: 64 },
      { width: 140, height: 64 },
    ]);
    const positions = row(smallP2P);
    for (const m of buildScene(smallP2P, positions).nodeMarks) expect(m.box).toEqual(positions.nodes[m.id]);
  });
});

describe("the cue's colours", () => {
  it("keep text on the stripe at 7 : 1 (the muted ink 4.5 : 1) and the foot at 4.5 : 1 on the card, in both schemes of both presets", () => {
    for (const theme of [defaultTheme, printTheme]) {
      for (const scheme of ["light", "dark"] as const) {
        const c = themeColors(theme, scheme);
        expect(contrastRatio(c.ink, c.cueStripe)).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(c.inkMuted, c.cueStripe)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(c.cueFoot, c.paper)).toBeGreaterThanOrEqual(4.5);
      }
      expect(checkTheme(theme)).toEqual([]);
    }
  });

  it("are checked by checkTheme", () => {
    const pale: Theme = { ...defaultTheme, color: { ...defaultTheme.color, cueStripe: "#8c94a1", cueFoot: "#cfd4dc" } };
    expect(checkTheme(pale).filter((d) => d.subject.includes("cue"))).toEqual([
      { kind: "text", scheme: "light", subject: "ink on cueStripe", value: expect.any(Number), minimum: 7 },
      { kind: "text", scheme: "light", subject: "inkMuted on cueStripe", value: expect.any(Number), minimum: 4.5 },
      { kind: "line", scheme: "light", subject: "cueFoot on paper", value: expect.any(Number), minimum: 4.5 },
    ]);
  });
});
