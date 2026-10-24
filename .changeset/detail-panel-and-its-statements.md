---
"wise-flow": minor
---

The abstraction panel is the panel "Detail" ("Detailgrad") and selects by
the detail shares: two sliders, "Activities" from "Most frequent" to "All"
and "Paths" from "Fewest paths" to "All paths", the right end showing
everything. The check box "Keep connected" has left the panel (the option
stays in `AbstractOptions`); its promise is now the left end of "Paths".
The sliders are native range inputs over positions by rank: an arrow key
moves one rank (a tie of activities enters whole), Page Up and Page Down
ten. Moving a slider calls `onAbstractionChange` with both detail shares
(`activityDetail`, `pathDetail`) where it called it with a threshold; a
host that controls the map with thresholds sees the sliders where its
thresholds stand. Neither thumb moves by itself.

Beside each slider a statement says what is shown, from `meta.shown`: "25
of 42 · 99.2 % of events" and "61 of 677 · 30 kept" (with "strongest not
shown: 20,000" where that path is stronger than the weakest shown), in full
as the title and the description of the slider; the short form is the
slider's value text, and moving one slider says the other's statement
politely. Further lines say how many paths are drawn at the zoom where the
map withholds some ("61 selected · 40 drawn at this zoom"), how many marks
are not shown and which ("3 marks not shown", a list), and how many
elements are shown for a protected deviation. Pointing at or focusing "30
kept" marks exactly those paths on the map. New: `detailStatement`,
`detailNotes`, `DetailStatement`, `DetailStatementOptions`,
`StatementLine`, `DetailPositions`; `ShownMeta` gains `byFrequency`,
`weakestShown`, `events` and `positions`; `AbstractionControlsProps` gains
`positions`, `statement`, `drawn`, `onHighlightKept` and `onAnnounce`
(`counts` is read where no statement is given).

The tooltips and assistive text of the map's elements say what the detail
setting hides: an activity the passages in and out on paths not shown, a
kept path which activity it keeps on a way from start to end, an element
shown for a protected deviation that it is. An indirect path is drawn
dashed in the line colour at the thinnest width, labelled "via 2
activities not shown" and without a number (`EdgeMark.indirect`), in every
renderer, and the legend has a key for it (`LegendKeyKind` "indirect"). The
caption of an export of a graph abstracted by detail shares carries the
statements.
