---
"@wise/flow": minor
---

Every renderer draws an activity, and a stage node, as one card: a 1 px
neutral outline (`lineStrong`) with corners of 4 and no shadow, the stage
once as the patterned band on the left edge (the outline and fill no longer
take the stage's colour), the name on up to two lines and then an ellipsis
(the whole name in the mark's `title`, the SVG `<title>` and the card's
`title`), and the number line "1,000 · 100 %": the cases in full grouped
digits, in the ink and semibold, then their share of the log's cases
(`graph.meta.cases`), muted; a missing value is "–". Behind the texts a flat
stripe and along the bottom edge a 3 px foot, both as long as the share, are
the frequency cue: `Theme.frequencyCue` places it (`"both"`, the default,
`"behind"`, `"bottom"`, `"none"`), and a card with a share of 0 or without
one shows neither. A card outside the scope keeps a solid outline and writes
its name in the muted ink; hover, selection and focus change the outline,
never the fill; badges sit wholly above the card.

New: `Theme.frequencyCue` and the type `FrequencyCue`; the colour roles
`cueStripe` and `cueFoot` (with `--wf-cue-stripe`, `--wf-cue-foot` and
`--wf-size-cue-foot`), checked by `checkTheme` (ink on the stripe 7 : 1, the
muted ink 4.5 : 1, the foot 4.5 : 1 on the paper); `NodeMark.cue` (`NodeCue`)
and `NodeMark.outOfScope`; the text role `activityShare`; the `share` role of
`ElementText`; the paints `lineStrong`, `cueStripe` and `cueFoot` of
`MarkPaint`; optional `cueStripe` and `cueFoot` in `CanvasTokens`; `total`
and `outOfScope` options of `nodeMark`, and `outOfScope` of `nodeMarks`; the
styling contract's parts `node-cue` and `node-cue-foot`; and the prop
`backgroundGrid` of `<ProcessMap/>`: the grid of dots behind the interactive
map is now off by default.

Changed: the token table's sizes are on scales: text 11, 13 and 15 px,
weights 400, 500 and 600, radii 4, 8 and full, strokes 1 and 2 (the range of
path widths, the arc's coverage width and the pointer's width on a path
apart); the default font stack starts with the system font; the default
activity and stage node are 64 high, and `activityNodeSize` reserves the
card's size once (280 × 64 for names, 140 × 64 for references, whatever the
name), so maps lay out anew. Stage groups are solid hairlines without a
tint with a muted title; start and end events write their label below the
circle, shortened to 96. A stage node's description (`describeNode`) says how
many activities it holds, which its card no longer shows. `textTokens.nodeLabel` and `nodeCount` are no longer
read and are deprecated: use `activityName`, `activityNumber` and
`activityShare` (a stage's name is `stageLabel`). `--wf-space-7` is gone (no
rule read it), and `comparisonNote` and `comparisonDenominator` are sizes in
px.
