/**
 * The `instrument` preset (WF-10): the WISE process map's look as one name.
 * Every role of the decided table, both schemes passing `checkTheme`, the
 * prompt's values that fail the gate moved to the nearest that passes, and
 * its CSS variables (the band, borders instead of shadows in the dark scheme).
 */
import { describe, expect, it } from "vitest";
import { checkTheme, contrastRatio, defaultTheme, instrumentTheme, resolveTheme, themeColors, themePresets } from "../../src/index";
import { themeFromVariables, themePalettes, themeVariables } from "../../src/core/theme";

describe("the instrument preset", () => {
  it("is a preset by name and changes the default over the table it was decided with", () => {
    expect(resolveTheme("instrument")).toBe(instrumentTheme);
    expect(themePresets.instrument).toBe(instrumentTheme);
    const light = themeColors(instrumentTheme, "light");
    expect({ paper: light.paper, surface: light.surface, ink: light.ink, inkMuted: light.inkMuted, line: light.line, lineStrong: light.lineStrong, focus: light.focus, selection: light.selection, terminal: light.terminal, neutral: light.neutral, accent: light.accent }).toEqual({
      paper: "#ffffff", surface: "#f7f8fa", ink: "#1a1d21", inkMuted: "#5c6470", line: "#d9dde3", lineStrong: "#8c94a1", focus: "#2456c4", selection: "rgba(36, 86, 196, 0.14)", terminal: "#c9ced6", neutral: "#8c94a1", accent: defaultTheme.color.accent,
    });
    const dark = themeColors(instrumentTheme, "dark");
    expect({ paper: dark.paper, surface: dark.surface, ink: dark.ink, inkMuted: dark.inkMuted, line: dark.line, lineStrong: dark.lineStrong, focus: dark.focus, selection: dark.selection, terminal: dark.terminal, neutral: dark.neutral, accent: dark.accent }).toEqual({
      paper: "#15181c", surface: "#0f1114", ink: "#e6e9ee", inkMuted: "#9aa3ae", line: "#2a2f36", lineStrong: "#5e6672", focus: "#6ea0ff", selection: "rgba(110, 160, 255, 0.22)", terminal: "#3a4049", neutral: "#6b747f", accent: defaultTheme.dark.accent,
    });
    expect(themePalettes(instrumentTheme, "light").neutral).toEqual(["#8c94a1", "#5f6873", "#3a4049", "#1a1d21"]);
    expect(themePalettes(instrumentTheme, "dark").neutral).toEqual(["#6b747f", "#a3acb7", "#cfd2d6", "#e6e9ee"]);
    expect(themePalettes(instrumentTheme, "light").performance).toEqual(["#cfe0f5", "#7fb0e0", "#2f6fb5", "#0b3d7a"]);
    expect(themePalettes(instrumentTheme, "dark").performance).toEqual(["#1e3a5f", "#2f6fb5", "#7fb0e0", "#bcd7f5"]);
    // Okabe–Ito without orange and yellow; each colour keeps the twin it had.
    expect(instrumentTheme.palette.categorical).toEqual(["#0072B2", "#009E73", "#CC79A7", "#56B4E9", "#999999"]);
    expect(instrumentTheme.patterns).toEqual(["solid", "dots", "crosshatch", "horizontal", "grid"]);
    expect(instrumentTheme.font.family.startsWith("Inter, system-ui")).toBe(true);
    expect([instrumentTheme.radius.node, instrumentTheme.radius.large, instrumentTheme.size.band]).toEqual([8, 8, 6]);
    expect([instrumentTheme.stroke.eventStart, instrumentTheme.stroke.eventEnd, instrumentTheme.stroke.band, instrumentTheme.stroke.backwardStep]).toEqual([1, 1, 3, 1]);
    expect([instrumentTheme.opacity.groupFill, instrumentTheme.opacity.bandFill, instrumentTheme.opacity.bandOddFill, instrumentTheme.opacity.dimmed, instrumentTheme.opacity.dimmedPath, instrumentTheme.opacity.backward]).toEqual([0, 0.035, 0.019, 0.35, 0.25, 0.6]);
    expect([instrumentTheme.frequencyCue, instrumentTheme.text.minScreenPx]).toEqual(["none", 9]);
    // A head of size s is 0.4 s wide: 5 per unit of width makes its base twice the line's width; none under 2.
    expect([instrumentTheme.arrowhead.edge.perWidth, instrumentTheme.arrowhead.edge.minWidth]).toEqual([5, 2]);
    // The default theme is untouched by the preset.
    expect([defaultTheme.size.band, defaultTheme.radius.node, defaultTheme.frequencyCue, defaultTheme.arrowhead.edge.perWidth, defaultTheme.stroke.backwardStep, defaultTheme.opacity.backward]).toEqual([8, 4, "both", 4, 0, 1]);
  });

  it("passes checkTheme in the light and the dark scheme", () => {
    expect(checkTheme(instrumentTheme)).toEqual([]);
    expect(checkTheme(defaultTheme)).toEqual([]);
  });

  it("starts both path ramps at 3 : 1 on the paper, which the prompt's palest greys do not reach, and keeps them for the terminal paths", () => {
    expect(contrastRatio("#8c94a1", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#6b747f", "#15181c")).toBeGreaterThanOrEqual(3);
    // The prompt's palest stops: under the gate, so they paint the terminal paths, which checkTheme gates as hairlines.
    expect(contrastRatio("#c9ced6", "#ffffff")).toBeLessThan(3);
    expect(contrastRatio("#3a4049", "#15181c")).toBeLessThan(3);
    const ramp = { ...instrumentTheme, palette: { ...instrumentTheme.palette, neutral: ["#c9ced6", ...instrumentTheme.palette.neutral.slice(1)] } };
    expect(checkTheme(ramp).map((d) => [d.kind, d.scheme, d.subject])).toContainEqual(["rampStart", "light", "palette.neutral"]);
    // The prompt's dark lineStrong reaches 2.98 : 1; the preset's 3.07.
    expect(contrastRatio("#5c6470", "#15181c")).toBeLessThan(3);
    expect(contrastRatio("#5e6672", "#15181c")).toBeGreaterThanOrEqual(3);
  });

  it("reports a terminal paint that falls into the paper or the hairlines", () => {
    const pale = { ...instrumentTheme, color: { ...instrumentTheme.color, terminal: "#fbfbfb" } };
    expect(checkTheme(pale).map((d) => [d.kind, d.scheme, d.subject])).toContainEqual(["line", "light", "terminal on paper"]);
    const hairline = { ...instrumentTheme, color: { ...instrumentTheme.color, terminal: instrumentTheme.color.line } };
    expect(checkTheme(hairline).map((d) => [d.kind, d.scheme, d.subject])).toContainEqual(["line", "light", "terminal on line"]);
  });

  it("writes the band's width and draws borders instead of shadows in the dark scheme", () => {
    expect(themeVariables(instrumentTheme, "light")["--wf-size-band"]).toBe("6px");
    expect(themeVariables(instrumentTheme, "light")["--wf-shadow"]).toBe(defaultTheme.size.shadow);
    expect(themeVariables(instrumentTheme, "dark")["--wf-shadow"]).toBe("none");
    expect(themeVariables(defaultTheme, "dark")["--wf-shadow"]).toBe(defaultTheme.size.shadow);
    // A host's shadow read in the dark scheme is the dark one.
    const read = (name: string) => (name === "--wf-shadow" ? "none" : name === "--wf-size-band" ? "6px" : "");
    expect(themeFromVariables(read, "dark", (c) => c)).toMatchObject({ size: { darkShadow: "none", band: 6 } });
  });
});
