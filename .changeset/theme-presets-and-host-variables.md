---
"@wise/flow": minor
---

A host sets the theme as a preset, as changes over a preset, or as CSS
variables, and the exports take it too.

- Presets `default` (today's look, light and dark) and `print` (`printTheme`:
  white paper, no tints, a pattern twin on every categorical colour, a neutral
  ramp of three greys, no text under 7 pt and no stroke under 0.75 pt, no dark
  scheme), by name in `themePresets`. Their values are the token table's
  (`printTokens`, `minimumTokens`, also in `designTokens`).
- `ThemeSetting` is a preset's name or `ThemeOverrides`, any part of a theme
  over a preset (`{ preset: "default", density: "compact", radius: { node: 4 } }`;
  a whole `Theme` is one too). `resolveTheme(setting, variables)` puts the
  setting over what a host wrote as CSS variables over the preset and keeps
  only literal colours, and only palettes of hex stops.
- `Theme` gains `patterns` (the pattern twin of each categorical colour),
  `opacity` (the opacity table; the tints are `tint`, `groupFill`, `bandFill`,
  `bandOddFill`) and `minimum` (the smallest text and stroke, in pt). The
  marks, `tintColor`, the categorical scale, the Canvas map's dimming and the
  exports' legend rule read them; in the default
  theme they are the table's values, so nothing draws differently.
- `checkTheme(theme)` returns as `ThemeDeviation`s what falls short in either
  scheme: text contrast under 4.5 : 1, line contrast under 3 : 1, a path ramp
  that is not monotonic in luminance or starts under 3 : 1 against the paper,
  text and strokes under the theme's minimum, colours that are not literals.
  Both presets pass. The React components log its findings in development.
- `toSVG`, `toPNG` and `prepareScene` take a `ThemeSetting` as `theme`.
  Without one they draw the `default` preset in the light scheme, as before,
  and they never read the page: an export of a map in the dark scheme is
  light unless `scheme: "dark"` is passed.
- In the dark scheme the marks draw the scheme's neutral and constraint
  colours (the default theme's are the light ones, so nothing changes).
- `@wise/flow/react`: `useFlowTheme(ref, setting?)` resolves a theme in a
  page: the setting over the `--wf-*` variables of the element (every part of
  a theme has one; values `tokens.css` sets are left out) over the preset, in
  the scheme `tokens.css` draws in, with any CSS colour turned into a literal,
  following attribute changes and the system's scheme; opaque palette stops
  of the setting become hex. Colours read in the
  dark scheme are the theme's `dark` roles. It returns `{ theme, scheme }`
  (`FlowTheme`), which an export takes to draw what the map draws.
- `<ProcessMap theme>` takes a `ThemeSetting` (it took a `Theme`) and reads
  the variables of its element, set there (`className`, `containerStyle`) or
  inherited; given a theme it writes the theme's variables that the
  stylesheet reads on its element, over its `containerStyle`, and reads
  those of its container. A change of a colour or
  the font repaints the DOM map and the Canvas map without a new scene; a
  change of a size builds the scene once; neither lays the map out again.
  `<CanvasMap/>` and `<ViewSwitcher/>` take `theme`. `<CanvasMap/>` reads its
  colours and font through `useFlowTheme` on its element, no longer through
  `readTokens`; `readTokens` itself is
  unchanged.
