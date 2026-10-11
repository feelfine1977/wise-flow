/**
 * The theme: what the scene is drawn in. `buildScene` reads it once and
 * resolves every paint, width, radius and text style of the marks from it, so
 * that the interactive map, the Canvas map, the SVG export and the PNG export
 * all follow it. `defaultTheme` is the token table (`tokens.ts`).
 */
import { type ColorToken, colorTokens, darkColorTokens, fontTokens, paletteTokens, radiusTokens, spaceTokens, strokeTokens, textTokens } from "./tokens.js";

/** The colour scheme a scene is resolved in. */
export type ColorScheme = "light" | "dark";

/** A table of the token table's shape with any values of the same types. */
type Values<T> = T extends number ? number : T extends string ? string : T extends readonly (infer U)[] ? readonly Values<U>[] : { readonly [K in keyof T]: Values<T[K]> };

/** The data palettes: ramps from low to high, and the categorical colours in the order of the pattern twins. */
export interface ThemePalettes {
  /** Paths and activities without a measure. */
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
  font: { readonly family: string; readonly mono: string };
  /** Text by role: size, weight and line height (`textTokens`). */
  text: Values<typeof textTokens>;
  /** Corner radii by element (`radiusTokens`). */
  radius: Values<typeof radiusTokens>;
  /** Stroke widths by element and state (`strokeTokens`). */
  stroke: Values<typeof strokeTokens>;
  /** Spacing: multiples of `unit` (`spaceTokens`). */
  space: Values<typeof spaceTokens>;
  /** How much room the map's elements take; the renderers draw `comfortable`. */
  density: "comfortable" | "compact";
  /** Rules that restyle elements; there are none yet. */
  rules: readonly never[];
}

/** Today's look: the token table as a theme. */
export const defaultTheme: Theme = {
  color: colorTokens,
  dark: darkColorTokens,
  palette: {
    neutral: [colorTokens.neutral],
    shortfall: paletteTokens.sequential,
    performance: paletteTokens.sequentialBlue,
    diverging: paletteTokens.diverging,
    categorical: paletteTokens.categorical,
  },
  font: fontTokens,
  text: textTokens,
  radius: radiusTokens,
  stroke: strokeTokens,
  space: spaceTokens,
  density: "comfortable",
  rules: [],
};

/** The colour of every role in a scheme: the light roles with the dark scheme's changes over them. */
export function themeColors(theme: Theme, scheme: ColorScheme = "light"): Readonly<Record<ColorToken, string>> {
  return scheme === "dark" ? { ...theme.color, ...theme.dark } : theme.color;
}
