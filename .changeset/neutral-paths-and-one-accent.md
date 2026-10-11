---
"@wise/flow": minor
---

The map draws the process in neutrals and deviations in one accent.

- **Paths by cases.** In `defaultStyle` a path's colour means its count, as
  its width does: the same square-root scale along the theme's grey `neutral`
  ramp, darker with more cases in the light scheme (`#8c8c8c` to `#141414`)
  and brighter with more cases in the dark scheme (`#6e737d` to `#f2f3f5`,
  the new `Theme.darkPalette.neutral`); the lightest has at least 3 : 1 on
  the paper in both. `ColorSpec.scale` (`"linear"`, the default, or `"sqrt"`)
  says how a sequential palette runs over its domain. The colouring by the
  expectation shortfall share, the default up to now, is the new export
  `shortfallStyle` (`style={shortfallStyle}`, or `edgeColor: { metric:
  "violationShare", palette: "shortfall", domain: [0, 1] }`).
- **Deviations are the one hue.** A new colour role `accent` (`#b84a00`,
  `#ff8c42` in the dark scheme; CSS variable `--wf-accent`) draws badges,
  chips, constraint arcs and their labels, tints, constraint self-loops and
  constraint edges; `overlayColor` returns it whatever the value. Orange and
  vermilion leave the categorical palette (six colours, five in `print`);
  the colours left keep their pattern twins (`defaultTheme.patterns` is
  `solid, dots, crosshatch, horizontal, diagonal-reverse, grid`; `PATTERNS`
  still lists every twin). Stage colours assigned by hashed key change.
- **Arcs.** Every arc is solid and one width (`stroke.arc`, 1.5; `arcWidth`
  no longer reads the coverage, `stroke.arcCoverage` is read by nothing) and
  keeps 4 of paper from the activities it passes. Its label is a pill of
  paper outlined in the accent (`OverlayMark.pill`, `stroke.pill`) with the
  share first and its base second: "late 35 % of 820", "order 14 % of 820";
  a reverse-order arc runs below the flow and
  reads "⇐ 14 % of 820". The presets put the cases a constraint was
  evaluated on into the arc's payload (`OverlayPayload.evaluated`). New
  strings `arc.lag`, `arc.precedence`, `arc.reverse`, `arc.base` (English and
  German); the legend's arc and reverse-arc rows say so, the reverse key's
  glyph is `⇐`.
- **Badges** are pills (18 tall by default, `badgeSize`) with their glyph and
  share in the accent ("≥1 · 22 %"), wholly above their activity, left of a
  self-loop it carries.
- **Labels keep apart.** Self-loop labels and arc labels are placed after
  the badges and chips and cover no activity, badge, chip, other label or
  group title where a place is free (`OverlayShape.label` holds the box of a
  label). Tints take the corners of what they cover.
- **A dash means "not directly observed".** Only re-added paths and
  activities are dashed; notes, constraint edges, box groups and reverse
  arcs are solid (`dashTokens.note`, `constraint`, `group` and `reverseArc`
  are read by nothing).
- `checkTheme` checks the accent (text on the paper at 4.5 : 1, a line at
  3 : 1) and the path ramp of each scheme, which must rise in contrast
  against the paper from stop to stop (`rampOrder` now carries its
  `scheme`). Both presets pass in both schemes.
