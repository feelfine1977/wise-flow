---
"wise-flow": minor
---

A card carries the colour band along its left edge only where its colour
says something: its stage, or another category or value of the style's
`nodeColor` (`Scales.nodeColored`, new). A card without a stage, whose colour
is the neutral fallback, has no band in any renderer; before, every card of a
graph without stages had a grey one. The band is as wide as the theme's new
`size.band` (8 in the default and print themes, 6 in `instrument`; 0 draws
none), which `tokens.css` writes as `--wf-size-band`. The frequency cue of a
card without a band starts inside its outline.

New: `Theme.size` (`band`, `shadow`, `darkShadow`), `Scales.nodeColored`, the
`banded` option of `nodeMark`.
