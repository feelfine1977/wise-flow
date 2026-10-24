---
"wise-flow": minor
---

The `instrument` theme preset (`theme="instrument"`, `instrumentTheme`,
`instrumentTokens`): the WISE process map's look, light and dark. Ink on
paper, cards with corners of 8 and no frequency cue, a band of 6 only on an
activity with a stage, one grey path ramp of four stops, the paths from a
start and to an end event in a pale grey of their own, blues for the
performance measure, the categorical colours without yellow (each keeping
its pattern twin), Inter where the page has it, end events outlined as thin
as start events, a lane's rule 3 wide and lighter lane tints, heads twice as
wide as their path and none on a path under 2, paths against the reading
direction a step thinner at 0.6, and borders instead of shadows in the dark
scheme. It passes `checkTheme` in both schemes; three values of the decided
table that do not are moved to the nearest that does: the path ramps start at
`#8c94a1` and `#6b747f` (the paler `#c9ced6` and `#3a4049` paint the terminal
paths), the dark `lineStrong` is `#5e6672` (3.07 : 1 instead of 2.98 : 1), and
text on the dark accent is dark.

New colour role `terminal` (light `#c9ced6`, dark `#4b515b` in the default
theme), which `checkTheme` gates as a hairline: 1.3 : 1 on the paper and apart
from `line`. A stroke of 0 in a theme's table draws nothing and is no longer
reported as thinner than the minimum. `ThemePreset` is
`"default" | "print" | "instrument"`. `Theme.readable.nameChars` and
`Theme.arrowhead` carry what were fixed token values. New tokens:
`textTokens.eventGlyph`, `strokeTokens.backwardStep` (0),
`opacityTokens.backward` (1), `dimensionTokens.eventStatement`, and
`Arrowhead.minWidth`. `tokens.css` gains the variables of the card's, the
stage's, the group's and the event's text roles (`--wf-text-activity-name`,
`--wf-weight-activity-name`, …), which the stylesheet reads where a text has
no size of its own, and every number of the stylesheet is drawn in
`tabular-nums lining-nums`.
