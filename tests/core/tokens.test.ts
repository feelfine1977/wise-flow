import { describe, expect, it } from "vitest";
import {
  type PatternId,
  DEFAULT_SIZES,
  PATTERNS,
  arrowheadTokens,
  colorTokens,
  fixedColors,
  fontTokens,
  palettes,
  patternDefs,
  patternTwin,
  toSVG,
  tokenVariables,
} from "../../src/index";
import { defaultTokens } from "../../src/canvas/index";
import * as elements from "./element-kinds";

/** A marker's triangle in user units: (point − ref) × markerWidth / view box width. */
function markerTriangle(svg: string, id: string) {
  const marker = svg.match(new RegExp(`<marker id="${id}"([^>]*)>(.*?)</marker>`));
  if (!marker) throw new Error(`no marker ${id}`);
  const attr = (name: string, from = marker[1]) => from.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? "";
  const [, , boxWidth] = attr("viewBox").split(" ").map(Number);
  const k = Number(attr("markerWidth")) / boxWidth;
  const ref = [Number(attr("refX")), Number(attr("refY"))];
  const points = [...attr("d", marker[2]).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [(Number(m[1]) - ref[0]) * k, (Number(m[2]) - ref[1]) * k].map((v) => Math.round(v * 100) / 100 + 0));
  return { points, outline: Number(attr("stroke-width", marker[2]) || 0) * k, units: attr("markerUnits") };
}

describe("the token table", () => {
  it("is where the fixed colours, the palettes, the node sizes and the Canvas defaults come from", () => {
    for (const [name, value] of Object.entries(fixedColors)) expect(colorTokens[name as keyof typeof colorTokens], name).toBe(value);
    // Okabe–Ito without orange (#E69F00) and vermilion (#D55E00), which would read as the accent.
    expect(palettes.categorical).toEqual(["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#F0E442", "#999999"]);
    expect(DEFAULT_SIZES.activity).toEqual({ width: 180, height: 64 });
    expect(defaultTokens).toEqual({
      font: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      paper: "#ffffff",
      surface: "#f6f7f9",
      ink: "#1f1f1f",
      inkMuted: "#5b6270",
      line: "#cfd4dc",
      lineStrong: "#8c94a1",
      cueStripe: "#e6e8ec",
      cueFoot: "#5f6672",
      patternInk: "#1f1f1f",
      focus: "#0072b2",
      selection: "rgba(0, 114, 178, 0.14)",
      neutral: "#8c8c8c",
      outOfScope: "#b0b0b0",
    });
  });

  it("gives the CSS variables of both schemes", () => {
    const { light, dark } = tokenVariables();
    expect(light["--wf-font"]).toBe('system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif');
    expect(light["--wf-ink-muted"]).toBe("#5b6270");
    expect(light["--wf-out-of-scope"]).toBe("#b0b0b0");
    expect(light["--wf-fail"]).toBe("#d55e00");
    // Nothing reads the text on the focus colour since pressed toggles and selected tabs have colours of their own.
    expect(light["--wf-on-focus"]).toBeUndefined();
    expect(light["--wf-radius-lg"]).toBe("8px");
    expect([light["--wf-cue-stripe"], light["--wf-cue-foot"], light["--wf-size-cue-foot"]]).toEqual(["#e6e8ec", "#5f6672", "3px"]);
    expect(light["--wf-note-width"]).toBe("160px");
    expect(light["--wf-mechanism"]).toBeUndefined();
    // Pressed toggles and the pattern twins' ink have roles of their own; native controls follow the scheme.
    expect([light["--wf-pressed"], light["--wf-on-pressed"], light["--wf-pattern-ink"], light["--wf-color-scheme"]]).toEqual(["#0072b2", "#ffffff", "#1f1f1f", "light"]);
    expect([light["--wf-size-icon"], light["--wf-stroke-icon"]]).toEqual(["16px", "2px"]);
    expect(dark).toEqual({
      "--wf-color-scheme": "dark",
      "--wf-paper": "#16181d",
      "--wf-surface": "#1f2229",
      "--wf-ink": "#ececec",
      "--wf-ink-muted": "#a7adb8",
      "--wf-line": "#3a3f49",
      "--wf-line-strong": "#6b7280",
      "--wf-cue-stripe": "#2c3038",
      "--wf-cue-foot": "#8f96a3",
      "--wf-pressed": "#0b1f2e",
      "--wf-on-pressed": "#ececec",
      "--wf-pattern-ink": "#101114",
      "--wf-selection": "rgba(86, 180, 233, 0.22)",
      "--wf-hover": "rgba(255, 255, 255, 0.07)",
    });
  });

  it("gives the SVG export its font stack", () => {
    const svg = toSVG({ graph: elements.graph, positions: elements.positions, style: elements.style }, { legend: false });
    expect(svg).toContain(`font-family="${fontTokens.family}"`);
    expect(toSVG({ graph: elements.graph, positions: elements.positions }, { legend: false, fontFamily: "serif" })).toContain('font-family="serif"');
  });
});

describe("the arrowhead rule", () => {
  const svg = toSVG({ graph: elements.graph, positions: elements.positions, style: elements.style }, { legend: false });

  it("ends edges in the map's closed arrow: 3 long, 4.8 wide, outlined by 0.6, the tip on the path's end", () => {
    expect(arrowheadTokens.edge).toEqual({ size: 12, box: 20, length: 5, width: 8, overhang: 0, outline: 1 });
    expect(markerTriangle(svg, "wf-arrow")).toEqual({ points: [[0, 0], [-3, 2.4], [-3, -2.4]], outline: 0.6, units: "userSpaceOnUse" });
  });

  it("ends arcs and self-loops in a triangle 12 long and wide, the tip 1.2 beyond the path's end", () => {
    expect(markerTriangle(svg, "wf-overlay-arrow")).toEqual({ points: [[1.2, 0], [-10.8, 6], [-10.8, -6]], outline: 0, units: "userSpaceOnUse" });
  });
});

describe("pattern twins", () => {
  it("have one 6-unit definition per pattern", () => {
    const shapes = Object.fromEntries(PATTERNS.map((p) => [p, patternTwin(p)]));
    expect(shapes).toEqual({
      solid: { size: 6, lines: [], dots: [] },
      diagonal: { size: 6, lines: [[0, 6, 6, 0]], dots: [] },
      dots: { size: 6, lines: [], dots: [[3, 3]] },
      crosshatch: { size: 6, lines: [[0, 6, 6, 0], [0, 0, 6, 6]], dots: [] },
      horizontal: { size: 6, lines: [[0, 3, 6, 3]], dots: [] },
      vertical: { size: 6, lines: [[3, 0, 3, 6]], dots: [] },
      "diagonal-reverse": { size: 6, lines: [[0, 0, 6, 6]], dots: [] },
      grid: { size: 6, lines: [[0, 3, 6, 3], [3, 0, 3, 6]], dots: [] },
    } satisfies Record<PatternId, unknown>);
  });

  it("are the tiles of the SVG export, with the out-of-scope hatching beside them", () => {
    const defs = patternDefs();
    expect(defs).toContain('<pattern id="wf-pattern-solid" width="6" height="6" patternUnits="userSpaceOnUse"/>');
    expect(defs).toContain('<pattern id="wf-pattern-diagonal" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6L6 0" stroke="#1f1f1f" stroke-width="1" stroke-opacity="0.6"/></pattern>');
    expect(defs).toContain('<pattern id="wf-pattern-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1" fill="#1f1f1f" fill-opacity="0.7"/></pattern>');
    expect(defs).toContain('<pattern id="wf-pattern-grid" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 3L6 3M3 0L3 6" stroke="#1f1f1f" stroke-width="1" stroke-opacity="0.6"/></pattern>');
    expect(defs).toContain('<pattern id="wf-pattern-outofscope" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="#b0b0b0" stroke-width="1"/></pattern>');
    expect(patternDefs("p", "#000000")).toContain('<pattern id="p-vertical" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M3 0L3 6" stroke="#000000"');
    const svg = toSVG({ graph: elements.graph, positions: elements.positions }, { legend: false });
    expect(svg).toContain(defs);
  });
});
