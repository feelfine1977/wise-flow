// @vitest-environment jsdom
/**
 * Readable at every zoom: what `readableAt` decides from the zoom, the lines
 * the scene fits for each level of a card, and what the Canvas map and the
 * exports draw with it. The SVG export is read with jsdom's `DOMParser`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { constraintItems, globalScene, vendorScene, vendorSceneKey } from "../../fixtures/bpic2019";
import { type FlowGraph, type Positions, type Readable, type ReadableRules, abstract, buildScene, createPositions, distinctLines, estimateTextWidth, layout, overlaysFor, readableAt, readableZoom, toSVG } from "../../src/index";
import { type DrawContext, type PreparedScene, prepareScene, toPNGCanvas } from "../../src/canvas/index";
import { boostMark, pillBoost } from "../../src/core/readable";
import { MIN_TEXT_PX, type Reading, readCanvas } from "../support/reading";

const rules: ReadableRules = {
  levels: { full: { size: 11, floor: 14 }, name: { size: 13, floor: 24 }, line: { size: 13, floor: 35 } },
  labels: { path: 11, loop: 11, event: 11, glyph: 15, note: 11 },
  pills: 11,
};
const all = { path: true, loop: true, event: true, glyph: true, note: true };

describe("readableAt", () => {
  it("decides from the zoom the level, the boost, the labels and the pills, the floor rounded up to the ladder", () => {
    const at = (zoom: number, previous?: Readable) => readableAt(rules, zoom, 9, previous);
    // Zoom 1: 9 / 1 = 9, 8 · log2 9 = 25.36, rung 26: 2^(26/8) = 9.51, under every text.
    expect(at(1)).toEqual({ level: "full", boost: 1, floor: 2 ** (26 / 8), step: 26, labels: all, pills: true });
    // 0.75: 12, rung 29 (28.68 up): 12.34. The full level fits up to 14, scaled 12.34 / 11; the labels of 11 go, the glyph of 15 stays.
    const r = at(0.75);
    expect([r.level, r.step, r.boost]).toEqual(["full", 29, 2 ** (29 / 8) / 11]);
    expect(r.labels).toEqual({ path: false, loop: false, event: false, glyph: true, note: false });
    // 0.5: 18, rung 34: 19.03. Past the full level's 14, within the name's 24: scaled 19.03 / 13; the glyph goes at 15.
    expect([at(0.5).level, at(0.5).boost, at(0.5).labels.glyph]).toEqual(["name", 2 ** (34 / 8) / 13, false]);
    // 0.3: 30, rung 40: 32, within the line's 35. 0.2: 45, rung 44: 45.25, past every level: no card text.
    expect([at(0.3).level, at(0.3).boost]).toEqual(["line", 32 / 13]);
    expect([at(0.2).level, at(0.2).boost, at(0.2).pills]).toEqual(["box", 1, true]);
    // 0.06: 150, rung 58, beyond the ladder's 56 (128): nothing, not even the pills.
    expect([at(0.06).level, at(0.06).pills, Object.values(at(0.06).labels).some(Boolean)]).toEqual(["box", false, false]);
    // A floor of 0 keeps every text at its size; so does a zoom of 0.
    expect(readableAt(rules, 0.06, 0)).toEqual({ level: "full", boost: 1, floor: 0, labels: all, pills: true });
    // Below the ladder's first rung (4) the floor is 4: zoom 3 at 9 px is 3.
    expect([at(3).floor, at(3).boost]).toEqual([4, 1]);
  });

  it("keeps a level, a label and a rung that went until the floor is 10 % below where it went", () => {
    const at = (floor: number, previous?: Readable) => readableAt(rules, 9 / floor, 9, previous);
    // 24.5: rung 37 (24.68), past the name's 24: one line.
    const out = at(24.5);
    expect([out.step, out.level]).toEqual([37, "line"]);
    // Back to 22, which alone rounds up to rung 36 (22.63) and shows the name: from 37 the rung stays while the floor is
    // above 22.63 / 1.1 = 20.57, and the name comes back only at 24 / 1.1 = 21.82. So the line stays.
    expect([at(22).step, at(22).level]).toEqual([36, "name"]);
    expect([at(22, out).step, at(22, out).level]).toEqual([37, "line"]);
    // Back and forth in the band changes nothing.
    let state = out;
    for (const floor of [22, 24.5, 21.9, 24.6, 22.3, 23.9]) {
      state = at(floor, state);
      expect([state.level, state.step], `floor ${floor}`).toEqual(["line", 37]);
    }
    // At 20: rung 35 (20.75), under 21.82: the name again.
    expect(at(20, state).level).toBe("name");
    // A level goes exactly where it stops fitting, whatever came before: 24.68 > 24.
    expect(at(24.5, at(20, state)).level).toBe("line");
    // Paths' labels (11): gone at rung 28 (11.31), still gone at 10.2 (rung 28 kept: 10.2 > 10.37 / 1.1), back at 9.3.
    const shed = at(11.2);
    expect([shed.labels.path, at(10.2, shed).labels.path, at(9.3, at(10.2, shed)).labels.path]).toEqual([false, false, true]);
  });
});

describe("a card's levels", () => {
  // One activity card 180 × 64: its texts have 180 − 24 − 2 = 154 wide and 64 − 2 − 3 = 59 high, the middle 30.5 down.
  const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: "Record Goods Receipt", metrics: { cases: 1000 } }], edges: [], meta: { cases: 2000 } };
  const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");
  const scene = buildScene(graph, positions);
  const [card] = scene.nodeMarks;
  const lines = (texts: { text: string; x: number; y: number }[]) => texts.map((t) => [t.text, t.x, Number(t.y.toFixed(2))]);

  it("fit while the block, the start of the name and the number line fit the card at the boost", () => {
    // Full: two name lines (16 each) and the number line (14), 46 in 59: 1.2826; floor 11 × 1.2826 = 14.11.
    // Name: 32 in 59: 1.8438; floor 13 × 1.8438 = 23.97. Line: 16 in 59 would allow 3.69, but "Record G…" (9 characters
    // of 0.55 em at 13: 64.35) in 154 allows 2.3931; floor 13 × 2.3931 = 31.11. The number line, "1,000 · 50 %" (70.55), allows 2.18.
    const floors = Object.values(scene.readable.levels).map((l) => [l.size, Number(l.floor.toFixed(3))]);
    expect(floors).toEqual([[11, 14.109], [13, 23.969], [13, 31.111]]);
  });

  it("carry each level's lines fitted for its largest boost, laid out as one block in the middle at a boost of 1", () => {
    // The card's own texts at 13: "Record Goods Receipt" (20 characters, 143) fits one line; block 30, from 15.5.
    expect(lines(card.texts)).toEqual([["Record Goods Receipt", 16, 28.05], ["1,000", 16, 42.35], ["· 50 %", 50.25, 42.35]]);
    const l = card.levels!;
    expect(l.origin).toEqual({ x: 16, y: 30.5 });
    // Full at 1.2826 (16.67 px, 9.17 a character, 16 to a line): two lines, block 46 from 7.5.
    expect(lines(l.full)).toEqual([["Record Goods", 16, 20.05], ["Receipt", 16, 36.05], ["1,000", 16, 50.35], ["· 50 %", 50.25, 50.35]]);
    // Name at 1.8438 (13.18 a character, 11 to a line): "Record", then the rest cut with the ellipsis; block 32 from 14.5.
    expect(lines(l.name)).toEqual([["Record", 16, 27.05], ["Goods Rece…", 16, 43.05]]);
    // Line at 2.3931 (17.11 a character): its first 8 characters and the ellipsis; block 16 from 22.5.
    expect(lines(l.line)).toEqual([["Record G…", 16, 35.05]]);
    // Each keeps the card's styles.
    expect(l.line[0]).toMatchObject({ size: 13, weight: 500, role: "nameLine", paint: "ink" });
  });

  it("are the card's own texts at the full level where they are the same", () => {
    const short = buildScene({ ...graph, nodes: [{ ...graph.nodes[0], label: "Pay" }] }, positions).nodeMarks[0];
    expect(short.levels!.full).toBe(short.texts);
  });
});

describe("pills scaled up to the floor", () => {
  it("grow a card's row of badges from the row's bottom-right corner, a chip from its middle, by the floor over the smallest pill text", () => {
    // Two badges on a card at (0, 0, 180 × 64): pills 18 high, 2 above the card, from its right edge leftwards 4 apart;
    // "≥1 · 8 %" is 8 characters of 0.55 × 11 and 6 on either side, 60.4 wide. A chip on the map.
    const graph: FlowGraph = {
      nodes: [{ id: "a", kind: "activity", label: "A" }],
      edges: [],
      overlays: [
        { kind: "badge", target: "a", payload: { glyph: "≥1", value: 0.08 } },
        { kind: "badge", target: "a", payload: { glyph: "≤1", value: 0.08 } },
      ],
    };
    const scene = buildScene(graph, createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT"));
    expect(scene.readable.pills).toBe(11);
    const [first, second] = scene.marks;
    expect([first.box.x, first.box.y, first.box.width, second.box.x + second.box.width]).toEqual([expect.closeTo(119.6, 9), -20, expect.closeTo(60.4, 9), expect.closeTo(115.6, 9)]);
    // At the floor 22 a pill text of 11 is scaled 2, both badges from the row's corner (180, −2).
    const { boost, origin } = pillBoost(second, 22, scene.readable);
    expect([boost, origin]).toEqual([2, { x: 180, y: -2 }]);
    const grown = boostMark(first, 2, origin);
    expect([grown.box.x, grown.box.y, grown.box.width, grown.box.height, grown.radius, grown.stroke?.width, grown.texts[0].size]).toEqual([expect.closeTo(59.2, 9), -38, expect.closeTo(120.8, 9), 36, 18, 2 * first.stroke!.width, 22]);
    // A mark that is not a badge grows from its middle; under the floor nothing changes.
    const chip = { ...first, kind: "chip" as const };
    expect(pillBoost(chip, 22, scene.readable).origin).toEqual({ x: expect.closeTo(149.8, 9), y: -11 });
    expect(boostMark(first, pillBoost(first, 9.5, scene.readable).boost, origin)).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// The BPIC maps on the Canvas drawing

const global = abstract(globalScene, { minEdgeShare: 0.03, minNodeShare: 0.01 });
const vendor = abstract(vendorScene, { minEdgeShare: 0.02 });
let maps: { name: string; scene: PreparedScene }[];
beforeAll(async () => {
  const [pg, pv] = [await layout(global, { engine: "dagre" }), await layout(vendor, { engine: "dagre" })];
  const g = overlaysFor(constraintItems(), { graph: global });
  maps = [
    { name: "global", scene: prepareScene(global, pg, { overlays: g }) },
    { name: "global with stage lanes", scene: prepareScene(global, pg, { overlays: g, lanes: "stages" }) },
    { name: "vendor with references", scene: prepareScene(vendor, pv, { overlays: overlaysFor(constraintItems(vendorSceneKey), { graph: vendor }), activityLabels: { mode: "ids", references: {} } }) },
  ];
});

/** The zooms 2, 1.95, … 0.1 and back up. */
const ZOOMS = Array.from({ length: 39 }, (_, i) => Number((2 - i * 0.05).toFixed(2)));
const sweep = [...ZOOMS, ...ZOOMS.slice(0, -1).reverse()];

/** Every frame of a sweep of the map, each kept within the hysteresis of the one before, as the Canvas map draws; uncull, so every element is drawn. */
function swept(scene: PreparedScene): Reading[] {
  const out: Reading[] = [];
  for (const zoom of sweep) out.push(readCanvas(scene, { zoom, x: 0, y: 0, width: 1200, height: 800 }, { readableFrom: out.at(-1)?.readable }));
  return out;
}

describe("the BPIC maps on the Canvas map", () => {
  it("draw no text smaller than 9 px on the screen at any zoom from 0.1 to 2 in steps of 0.05, zooming out and in", () => {
    for (const { name, scene } of maps) {
      const frames = swept(scene);
      for (const f of frames) {
        const small = f.texts.filter((t) => t.size * f.zoom < MIN_TEXT_PX - 1e-9).map((t) => `${t.role} "${t.text}" at ${(t.size * f.zoom).toFixed(2)} px`);
        expect(small, `${name} at zoom ${f.zoom}`).toEqual([]);
      }
      // Every zoom draws something: the cards, and at the smallest the deviations.
      expect(frames.every((f) => f.cards.length === scene.nodes.length), name).toBe(true);
    }
  });

  it("shed paths' labels first, then the number line, the second line of the name and the name, and the pills last", () => {
    for (const { name, scene } of maps) {
      const down = swept(scene).slice(0, ZOOMS.length);
      // The first zoom, going down, at which each is no longer drawn (0 where it stays down to 0.1).
      const goes = (drawn: (f: Reading) => boolean) => down.find((f) => !drawn(f))?.zoom ?? 0;
      const order = {
        path: goes((f) => f.texts.some((t) => t.role === "path")),
        number: goes((f) => f.readable!.level === "full"),
        second: goes((f) => f.readable!.level === "full" || f.readable!.level === "name"),
        name: goes((f) => f.readable!.level !== "box"),
        pills: goes((f) => f.readable!.pills),
      };
      expect(order.path, name).toBeGreaterThan(order.number);
      expect(order.number, name).toBeGreaterThan(order.second);
      expect(order.second, name).toBeGreaterThanOrEqual(order.name);
      expect(order.name, name).toBeGreaterThan(order.pills);
      // Names were drawn where the floor allowed, never cut below one line.
      for (const f of down) if (f.readable!.level === "box") expect(f.texts.filter((t) => t.role === "node" || t.role === "group"), `${name} ${f.zoom}`).toEqual([]);
    }
    // On the global map: at 0.85 the paths' labels (11) are gone, at 0.65 the number line, at 0.35 the second line, at 0.3 the name.
    const down = swept(maps[0].scene).slice(0, ZOOMS.length);
    const level = (zoom: number) => down.find((f) => f.zoom === zoom)!.readable!.level;
    expect([0.9, 0.85, 0.7, 0.65, 0.4, 0.35, 0.3].map(level)).toEqual(["full", "full", "full", "name", "name", "line", "box"]);
  });

  it("never change a card's box or position with the zoom", () => {
    for (const { name, scene } of maps) {
      const boxes = new Map(scene.nodes.map((n) => [n.node.id, n.box]));
      for (const f of swept(scene)) {
        // What the outline was drawn around, in map units, rounded to the recorder's precision.
        for (const c of f.cards) {
          const b = boxes.get(c.id)!;
          expect([c.box.x, c.box.y, c.box.width, c.box.height].map((v) => Math.round(v)), `${name} ${c.id} at ${f.zoom}`).toEqual([b.x, b.y, b.width, b.height].map((v) => Math.round(v)));
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Exports

/** Every text of an SVG export in points: its size times the scales of its groups, times the points of a figure unit. */
function svgPoints(svg: string): { text: string; pt: number; numbered: boolean; key: boolean }[] {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const width = root.getAttribute("width")!;
  const [, , viewWidth] = root.getAttribute("viewBox")!.split(" ").map(Number);
  // A size in millimetres is 72 / 25.4 points each; in pixels, 0.75.
  const perUnit = width.endsWith("mm") ? (parseFloat(width) * 72) / 25.4 / viewWidth : (0.75 * parseFloat(width)) / viewWidth;
  return [...doc.querySelectorAll("text")].map((t) => {
    let scale = 1;
    for (let e: Element | null = t; e; e = e.parentElement) scale *= Number(/scale\(([\d.e-]+)\)/.exec(e.getAttribute("transform") ?? "")?.[1] ?? 1);
    return { text: t.textContent ?? "", pt: Number(t.getAttribute("font-size")) * scale * perUnit, numbered: !!t.closest(".wf-numbers"), key: !!t.closest(".wf-number-key") };
  });
}

describe("exports", () => {
  let positions: Positions;
  beforeAll(async () => void (positions = await layout(global, { engine: "dagre" })));
  const scene = () => ({ graph: global, positions, overlays: overlaysFor(constraintItems(), { graph: global }), title: "P2P" });
  const activities = () => global.nodes.filter((n) => n.kind === "activity").map((n) => n.label);

  it("draw the print theme without a theme, and the default theme's figure as before when told", () => {
    expect(toSVG(scene())).toBe(toSVG(scene(), { theme: "print" }));
    expect(toSVG(scene(), { theme: "default" })).not.toBe(toSVG(scene()));
    // Print's paper and opaque patterns; the default's patterns are 0.6 opaque.
    expect(toSVG(scene())).toContain('stroke-opacity="1"');
    expect(toSVG(scene(), { theme: "default" })).toContain('stroke-opacity="0.6"');
    const calls = (theme?: "print") => {
      const log: string[] = [];
      const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), createLinearGradient: () => ({ addColorStop() {} }) } as Record<string, unknown>, {
        get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void log.push(`${k}${JSON.stringify(a)}`)),
        set: (t, k: string, v) => (log.push(`${k}=${JSON.stringify(v)}`), (t[k] = v), true),
      });
      toPNGCanvas(scene(), { scale: 1, theme, createCanvas: (width, height) => ({ width, height, getContext: () => ctx }) });
      return log.join("\n");
    };
    expect(calls()).toBe(calls("print"));
  });

  it("never follow the page's dark scheme", () => {
    const plain = toSVG(scene());
    document.documentElement.setAttribute("data-theme", "dark");
    window.matchMedia = ((query: string) => ({ matches: query.includes("dark"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      expect(toSVG(scene())).toBe(plain);
      // Print has no dark scheme: asked for one, it draws the same.
      expect(toSVG(scene(), { scheme: "dark" })).toBe(plain);
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("at 85 mm in the print theme write no text under 7 pt, the cards' numbers and a key of every activity", () => {
    const svg = toSVG(scene(), { widthMm: 85 });
    expect(svg).toMatch(/^<svg [^>]*width="85mm" height="[\d.]+mm" viewBox="0 0 321\.26 /);
    const texts = svgPoints(svg);
    expect(texts.filter((t) => t.pt < 7 - 1e-9).map((t) => `${t.text} ${t.pt.toFixed(2)}`)).toEqual([]);
    // No name fits a card at 7 pt there: every card has its number, and the key names every activity once.
    const numbers = texts.filter((t) => t.numbered).map((t) => t.text);
    expect(numbers.map(Number)).toEqual(global.nodes.filter((n) => n.kind === "activity").map((_, i) => i + 1));
    const key = texts.filter((t) => t.key).map((t) => t.text);
    expect(key[0]).toBe("Activities by number");
    expect(key.slice(1).map((line) => line.replace(/^\d+ /, "")).sort()).toEqual(activities().sort());
    // The texts of the map are the numbers alone: names, counts and labels below 7 pt are shed.
    expect(texts.filter((t) => !t.numbered && !t.key && activities().includes(t.text))).toEqual([]);
  });

  it("at 85 mm in the print theme draw no text under 7 pt in the PNG either", () => {
    const fonts: { text: string; px: number }[] = [];
    let scale = 1;
    const stack: number[] = [];
    const ctx = new Proxy({ measureText: (s: string) => ({ width: s.length * 6 }), font: "10px sans-serif" } as Record<string, unknown>, {
      get: (t, k: string) => {
        if (k === "scale") return (x: number) => void (scale *= x);
        if (k === "save") return () => void stack.push(scale);
        if (k === "restore") return () => void (scale = stack.pop() ?? 1);
        if (k === "fillText") return (text: string) => void fonts.push({ text, px: Number(/([\d.]+)px/.exec(String(t.font))![1]) * scale });
        if (k === "createLinearGradient") return () => ({ addColorStop() {} });
        return k in t ? t[k] : () => {};
      },
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as DrawContext;
    // Drawn 1,000 pixels wide for 85 mm: a pixel is 85 / 1,000 mm, 0.2409 pt.
    const png = toPNGCanvas(scene(), { widthMm: 85, width: 1000, scale: 1, createCanvas: (width, height) => ({ width, height, getContext: () => ctx }) });
    expect(png.cssWidth).toBe(1000);
    const pt = (px: number) => (px * 85 * 72) / 25.4 / 1000;
    expect(fonts.filter((f) => pt(f.px) < 7 - 1e-9).map((f) => `${f.text} ${pt(f.px).toFixed(2)}`)).toEqual([]);
    expect(fonts.map((f) => f.text)).toContain("Activities by number");
  });
});

describe("the readable zoom", () => {
  it("is the smallest zoom at which a level still fits a rung of the ladder; none without a floor or a card", () => {
    // The line level fits up to a floor of 35: the largest rung at or below it is 41 (34.90); the name's 24 rung 36 (22.63); the full's 14 rung 30 (13.45).
    expect(readableZoom(rules, 9, "line")).toBeCloseTo(9 / 2 ** (41 / 8), 12);
    expect(readableZoom(rules, 9, "name")).toBeCloseTo(9 / 2 ** (36 / 8), 12);
    expect(readableZoom(rules, 9, "full")).toBeCloseTo(9 / 2 ** (30 / 8), 12);
    expect(readableZoom(rules, 9)).toBe(readableZoom(rules, 9, "line"));
    // At that zoom the level is drawn; a hair below it the floor rounds up to the next rung, past the level.
    for (const level of ["full", "name", "line"] as const) {
      const zoom = readableZoom(rules, 9, level);
      expect(readableAt(rules, zoom, 9).level, level).toBe(level);
      expect(readableAt(rules, zoom * 0.999, 9).level, level).not.toBe(level);
    }
    // At 11 px the zooms grow with the floor.
    expect(readableZoom(rules, 11, "name")).toBeCloseTo((11 / 9) * readableZoom(rules, 9, "name"), 12);
    // Without a floor, or without a card (a level that fits at every floor), no zoom is too small.
    expect(readableZoom(rules, 0, "line")).toBe(0);
    expect(readableZoom({ ...rules, levels: { ...rules.levels, line: { size: 13, floor: Infinity } } }, 9, "line")).toBe(0);
    // A level that fits no rung, not even the first (4), is readable at no zoom; one that fits past the ladder's top ends with the ladder (128).
    expect(readableZoom({ ...rules, levels: { ...rules.levels, line: { size: 13, floor: 3 } } }, 9, "line")).toBe(Infinity);
    expect(readableZoom({ ...rules, levels: { ...rules.levels, line: { size: 13, floor: 1000 } } }, 9, "line")).toBeCloseTo(9 / 128, 12);
  });
});

describe("names shortened alike", () => {
  const font = { size: 13 };
  // A line of 72 holds 10 characters of 13 (0.55 em each by the estimate).
  const room = 72;
  const lines = (names: string[], max = 1, width = room) => distinctLines(names.map((name) => ({ name, room: width, font })), max, estimateTextWidth);

  it("are told apart on the last line by their start, an ellipsis and the part from the first character that differs", () => {
    // Both are cut to "Vendor cr…". The part that differs ("invoice", "debit memo") takes the line first, cut where it does not fit, and the start what is left.
    expect(lines(["Vendor creates invoice", "Vendor creates debit memo"])).toEqual([["Ve…invoice"], ["…debit me…"]]);
    // Names that differ late keep most of their start.
    expect(lines(["Vendor creates invoice A1", "Vendor creates invoice A2"])).toEqual([["Vendor c…1"], ["Vendor c…2"]]);
    // Names that are not shortened alike are left as they are, and so are names that are the same.
    expect(lines(["Change Price", "Change Quantity", "Change Quantity", "Pay"])).toEqual([["Change Pr…"], ["Change Qu…"], ["Change Qu…"], ["Pay"]]);
    expect(lines(["Pay", "Pay"])).toEqual([["Pay"], ["Pay"]]);
  });

  it("are told apart again among those that still coincide, from the next character that differs", () => {
    // A line of 8: all three are cut to "P xx 12…". From the first character that differs two still go on alike ("…345678…") and
    // are told apart from the next one that differs, where they part; the third parts at once.
    expect(lines(["P xx 1234567890 a", "P xx 1234567890 b", "P xx 12zzzz"], 1, 8 * 0.55 * 13)).toEqual([["P xx 1…a"], ["P xx 1…b"], ["P x…zzzz"]]);
  });

  it("keep the lines before the last, and the cards' own two lines are told apart like each level's", () => {
    const a = "Closed after the second-line review confirmed the workaround with the reporter A";
    const b = "Closed after the second-line review confirmed the workaround with the reporter B";
    // Two lines of 154 (21 characters): the first line is the same, the second is cut alike and then told apart by its end.
    const [first, second] = lines([a, b], 2, 154);
    expect(first[0]).toBe("Closed after the");
    expect(second[0]).toBe(first[0]);
    expect(first[1]).toMatch(/^second-line review .*…A$/u);
    expect(second[1]).toMatch(/^second-line review .*…B$/u);
    const graph: FlowGraph = { nodes: [{ id: "a", kind: "activity", label: a }, { id: "b", kind: "activity", label: b }], edges: [] };
    const positions = createPositions({ nodes: { a: { x: 0, y: 0, width: 180, height: 64 }, b: { x: 0, y: 100, width: 180, height: 64 } }, groups: {}, edges: {} }, "given", "RIGHT");
    const [cardA, cardB] = buildScene(graph, positions).nodeMarks;
    const names = (texts: { role: string; text: string }[]) => texts.filter((t) => t.role === "nameLine").map((t) => t.text);
    expect(names(cardA.texts)).toEqual(first);
    expect(names(cardB.texts)).toEqual(second);
    // The whole name stays the card's title; each level's lines differ too, and the one-line level by its end as well.
    expect([cardA.title, cardB.title]).toEqual([a, b]);
    for (const level of ["full", "name", "line"] as const) expect(names(cardA.levels![level]), level).not.toEqual(names(cardB.levels![level]));
    expect(names(cardA.levels!.line)[0]).toMatch(/…A$/u);
  });
});
