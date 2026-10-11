/**
 * The theme: what the scene is drawn in. `buildScene` reads it once and
 * resolves every paint, width, radius and text style of the marks from it, so
 * that the interactive map, the Canvas map, the SVG export and the PNG export
 * all follow it. `defaultTheme` is the token table (`tokens.ts`); `printTheme`
 * changes what the table's `printTokens` names. A host sets a theme as a
 * preset's name or as changes over a preset (`resolveTheme`), and writes it as
 * CSS variables too (`themeFromVariables`), which the React components read.
 */
import { type ColorToken, type PatternId, type PatternLook, categoricalPatterns, colorTokens, cssVariable, darkColorTokens, darkPaletteTokens, fontTokens, minimumTokens, opacityTokens, paletteTokens, patternTokens, printTokens, radiusTokens, spaceTokens, strokeTokens, textTokens, tokenVariables } from "./tokens.js";

/** The colour scheme a scene is resolved in. */
export type ColorScheme = "light" | "dark";

/** The place of an activity's frequency cue (`Theme.frequencyCue`). */
export type FrequencyCue = "both" | "behind" | "bottom" | "none";

/** A table of the token table's shape with any values of the same types. */
type Values<T> = T extends number ? number : T extends string ? string : T extends readonly (infer U)[] ? readonly Values<U>[] : { readonly [K in keyof T]: Values<T[K]> };

/** The data palettes: ramps from low to high, and the categorical colours in the order of the pattern twins. */
export interface ThemePalettes {
  /** Paths by cases, from few to many: the path ramp of the default style. */
  neutral: readonly string[];
  /** Expectation shortfall shares, light to dark. */
  shortfall: readonly string[];
  /** Performance (lags, durations), light to dark. */
  performance: readonly string[];
  /** Deltas: negative over neutral to positive. */
  diverging: readonly string[];
  /** Categories (stages, kinds, tags), stable by hashed key, each with its pattern twin. */
  categorical: readonly string[];
}

export interface Theme {
  /** Colour roles in the light scheme. */
  color: Readonly<Record<ColorToken, string>>;
  /** The colour roles the dark scheme changes. */
  dark: Readonly<Partial<Record<ColorToken, string>>>;
  palette: Readonly<ThemePalettes>;
  /** The palettes the dark scheme changes: in the default theme the path ramp, which runs dim to bright. */
  darkPalette?: Readonly<Partial<ThemePalettes>>;
  /** The pattern twin of each categorical colour, in the palette's order. */
  patterns: readonly PatternId[];
  /** How the pattern twins are drawn: tile, line width, dot radius and their opacities (`patternTokens`). */
  pattern: PatternLook;
  font: { readonly family: string; readonly mono: string };
  /** Text by role: size, weight and line height (`textTokens`). */
  text: Values<typeof textTokens>;
  /** Corner radii by element (`radiusTokens`). */
  radius: Values<typeof radiusTokens>;
  /** Stroke widths by element and state (`strokeTokens`). */
  stroke: Values<typeof strokeTokens>;
  /** Opacities by element and state (`opacityTokens`); the tints are `tint`, `groupFill`, `bandFill` and `bandOddFill`. */
  opacity: Values<typeof opacityTokens>;
  /** Spacing: multiples of `unit` (`spaceTokens`). */
  space: Values<typeof spaceTokens>;
  /**
   * Where an activity's card shows its frequency cue, the share of all cases:
   * a stripe `behind` its texts, a foot along its `bottom` edge, `both`, or
   * `none`.
   */
  frequencyCue: FrequencyCue;
  /** How much room the map's elements take; the renderers draw `comfortable`. */
  density: "comfortable" | "compact";
  /** The smallest text and stroke the theme's tables may hold, in points at the figure's output size (one layout unit is 0.75 pt); `checkTheme` reports what is smaller. */
  minimum: { readonly text: number; readonly stroke: number };
  /** Rules that restyle elements; there are none yet. */
  rules: readonly never[];
}

/** The default look: the token table as a theme. */
export const defaultTheme: Theme = {
  color: colorTokens,
  dark: darkColorTokens,
  palette: {
    neutral: paletteTokens.neutral,
    shortfall: paletteTokens.sequential,
    performance: paletteTokens.sequentialBlue,
    diverging: paletteTokens.diverging,
    categorical: paletteTokens.categorical,
  },
  darkPalette: darkPaletteTokens,
  patterns: categoricalPatterns,
  pattern: patternTokens,
  font: fontTokens,
  text: textTokens,
  radius: radiusTokens,
  stroke: strokeTokens,
  opacity: opacityTokens,
  space: spaceTokens,
  frequencyCue: "both",
  density: "comfortable",
  minimum: minimumTokens,
  rules: [],
};

/** The names of the presets a theme starts from. */
export type ThemePreset = "default" | "print";

/** Changes over a theme: any part of it, each table entry on its own; a list replaces the preset's list. */
type Changes<T> = T extends readonly unknown[] ? T : T extends object ? { readonly [K in keyof T]?: Changes<T[K]> } : T;

/** A theme written as changes over a preset (`default` unless named); a whole `Theme` is such changes too. */
export type ThemeOverrides = Changes<Theme> & { readonly preset?: ThemePreset };

/** What a host sets as the theme: a preset's name, or changes over a preset. */
export type ThemeSetting = ThemePreset | ThemeOverrides;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `base` with `changes` over it, entry by entry; lists and other values replace. */
function merge<T>(base: T, changes: unknown): T {
  if (!isObject(base) || !isObject(changes)) return changes === undefined ? base : (changes as T);
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(changes)) if (value !== undefined) out[key] = merge(out[key], value);
  return out as T;
}

/** For print: white paper, no tints, an opaque pattern on every categorical colour, ramps that start at 3 : 1 on the paper, no text under 7 pt and no stroke under 0.75 pt; no dark scheme. */
export const printTheme: Theme = merge({ ...defaultTheme, dark: {}, darkPalette: {} }, printTokens);

/** The presets by name. */
export const themePresets: Readonly<Record<ThemePreset, Theme>> = { default: defaultTheme, print: printTheme };

/** The channels of a literal colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`): red, green and blue from 0 to 255, alpha from 0 to 1; none for anything else. */
export function colorChannels(css: string): [number, number, number, number] | undefined {
  const s = css.trim().toLowerCase();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length < 5 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b, a = 255] = full.match(/../g)!.map((pair) => parseInt(pair, 16));
    return [r, g, b, a / 255];
  }
  const args = /^rgba?\(([\d.%\s,/]+)\)$/.exec(s)?.[1].split(/[\s,/]+/).filter(Boolean);
  if (!args || (args.length !== 3 && args.length !== 4)) return undefined;
  const value = (arg: string, full: number) => (arg.endsWith("%") ? (parseFloat(arg) / 100) * full : parseFloat(arg));
  const [r, g, b] = args.slice(0, 3).map((arg) => value(arg, 255));
  const a = args[3] === undefined ? 1 : value(args[3], 1);
  return [r, g, b, a].every(Number.isFinite) ? [r, g, b, a] : undefined;
}

/** Changes with the colours that are not literals left out, and the palettes (of both schemes) with a stop that is not `#rgb` or `#rrggbb` (they are interpolated from hex). */
function literalColors(changes: ThemeOverrides): ThemeOverrides {
  const keep = (roles: Partial<Record<ColorToken, string>> | undefined) => roles && Object.fromEntries(Object.entries(roles).filter(([, v]) => typeof v === "string" && colorChannels(v)));
  const hex = (palettes: Partial<ThemePalettes> | undefined) => palettes && Object.fromEntries(Object.entries(palettes).filter(([, stops]) => stops?.every((s) => /^#([\da-f]{3}){1,2}$/i.test(s))));
  return { ...changes, color: keep(changes.color), dark: keep(changes.dark), palette: hex(changes.palette), darkPalette: hex(changes.darkPalette) };
}

/**
 * The theme a setting names: the preset (`default` unless the setting names
 * another), then `variables` over it (what a host wrote as CSS variables,
 * `themeFromVariables`), then the setting's own changes over both. Colours
 * must be literals (`colorChannels`); others are left out, so that every paint
 * of an export is one. No setting is the default theme.
 */
export function resolveTheme(setting?: ThemeSetting, variables?: ThemeOverrides): Theme {
  const { preset = "default", ...changes } = typeof setting === "string" ? { preset: setting } : (setting ?? {});
  const base = themePresets[preset] ?? defaultTheme;
  if (!variables && !Object.keys(changes).length) return base;
  return merge(merge(base, variables && literalColors(variables)), literalColors(changes));
}

/** The colour of every role in a scheme: the light roles with the dark scheme's changes over them. */
export function themeColors(theme: Theme, scheme: ColorScheme = "light"): Readonly<Record<ColorToken, string>> {
  return scheme === "dark" ? { ...theme.color, ...theme.dark } : theme.color;
}

/** The palettes in a scheme: the light ones with the dark scheme's changes over them. */
export function themePalettes(theme: Theme, scheme: ColorScheme = "light"): Readonly<ThemePalettes> {
  return scheme === "dark" ? { ...theme.palette, ...theme.darkPalette } : theme.palette;
}

// ---------------------------------------------------------------------------
// CSS variables

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const TEXT_PREFIX: Record<string, string> = { size: "text", weight: "weight", lineHeight: "leading" };
/** Tables whose numbers are CSS lengths. */
const LENGTHS = new Set(["radius", "stroke", "size", "lineHeight"]);

/** Every CSS variable that writes a part of a theme, with the path of that part: `--wf-paper` is `color.paper`, `--wf-text-panel` is `text.panel.size`. */
function variableParts(theme: Theme): [string, string[]][] {
  const out: [string, string[]][] = [];
  for (const role of Object.keys(theme.color)) out.push([cssVariable(role), ["color", role]]);
  out.push(["--wf-font", ["font", "family"]], ["--wf-font-mono", ["font", "mono"]]);
  for (const [role, style] of Object.entries(theme.text)) for (const key of Object.keys(style)) out.push([`--wf-${TEXT_PREFIX[key]}-${kebab(role)}`, ["text", role, key]]);
  // The names of `tokens.css` for the node's and the large radius, then every radius by its role.
  out.push(["--wf-radius", ["radius", "node"]], ["--wf-radius-lg", ["radius", "large"]]);
  for (const table of ["radius", "stroke", "opacity"] as const) for (const role of Object.keys(theme[table])) out.push([`--wf-${table}-${kebab(role)}`, [table, role]]);
  return out;
}

const at = (theme: Theme, path: string[]): unknown => path.reduce<unknown>((v, key) => (v as Record<string, unknown> | undefined)?.[key], theme);

/** A part's value as CSS: lengths in px, colours and fonts as `tokens.css` writes them. */
function cssValue(value: unknown, path: string[]): string {
  if (typeof value === "number") return LENGTHS.has(path[0]) || LENGTHS.has(path[2]) ? `${value}px` : String(value);
  const s = String(value);
  return path[0] === "font" ? s.replace(/'/g, '"') : s.startsWith("#") ? s.toLowerCase() : s;
}

/** Every CSS variable of a theme in a scheme, as `tokens.css` writes the default theme's, and `--wf-color-scheme`, the scheme itself. */
export function themeVariables(theme: Theme, scheme: ColorScheme = "light"): Record<string, string> {
  const colors = themeColors(theme, scheme);
  const out: Record<string, string> = {};
  for (const [name, path] of variableParts(theme)) out[name] = cssValue(path[0] === "color" ? colors[path[1] as ColorToken] : at(theme, path), path);
  // The scheme the browser draws native controls in, as tokens.css writes it.
  out["--wf-color-scheme"] = scheme;
  return out;
}

let styled: ReadonlySet<string> | undefined;

/** The variables of a theme that the stylesheet reads (those `tokens.css` defines): the inline style of a component drawn in it. */
export function themeStyle(theme: Theme, scheme: ColorScheme = "light"): Record<string, string> {
  styled ??= new Set(Object.keys(tokenVariables().light));
  return Object.fromEntries(Object.entries(themeVariables(theme, scheme)).filter(([name]) => styled!.has(name)));
}

/**
 * The parts of a theme a host wrote as CSS variables: `read` gives a
 * variable's value (empty when it is not set), `color` turns a CSS colour into
 * a literal (none when it cannot). A value equal to the default theme's in the
 * scheme is what `tokens.css` sets, not the host, and is left out. Colours
 * belong to the scheme they were read in: in the dark scheme they are the
 * theme's `dark` roles, so an export in the light scheme does not draw them.
 * Lengths are read in px, weights and opacities as numbers.
 */
export function themeFromVariables(read: (name: string) => string, scheme: ColorScheme, color: (css: string) => string | undefined): ThemeOverrides {
  const defaults = themeVariables(defaultTheme, scheme);
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, path] of variableParts(defaultTheme)) {
    const raw = read(name).trim();
    if (!raw || raw === defaults[name]) continue;
    const given = at(defaultTheme, path);
    const value = path[0] === "color" ? color(raw) : path[0] === "font" || typeof given === "string" ? raw : /^-?\d*\.?\d+(px)?$/.test(raw) ? parseFloat(raw) : undefined;
    if (value === undefined) continue;
    const [table, role, key] = path[0] === "color" && scheme === "dark" ? ["dark", path[1]] : path;
    const entry = (out[table] ??= {});
    if (key === undefined) entry[role] = value;
    else entry[role] = { ...(entry[role] as object), [key]: value };
  }
  return out as ThemeOverrides;
}

/**
 * What of a theme the marks are built from in a scheme: everything but the
 * colours they name by role, which renderers look up when they draw, and the
 * fonts. The neutral colour, the accent and the scheme's palettes are drawn
 * into the marks. Two themes with the same key give the same marks.
 */
export function markedThemeKey(theme: Theme, scheme: ColorScheme): string {
  const colors = themeColors(theme, scheme);
  return JSON.stringify({ ...theme, color: [colors.neutral, colors.accent], dark: undefined, palette: themePalettes(theme, scheme), darkPalette: undefined, font: undefined });
}
