---
"@wise/flow": minor
---

A threshold after collapsing compares a stage by an upper bound of the cases
that touch it, so that no stage is removed for a number that may be too low.
A collapsed stage's `cases` is the largest of its activities' (a lower bound,
printed "at least …" as before); `collapseGroups` now also records, in
`meta.collapsedCasesAtMost` (new, by stage id), the sum of its activities'
cases, at most all cases of the graph (`meta.cases`) and at least the stage's
own `cases`. `abstract` measures a stage's strength by that bound, against the
same maximum or total as every activity's, for thresholds and detail shares
alike, also on a graph collapsed beforehand.

A stage of four activities with 25 cases each beside an activity of 100 cases
read 25 of 100 and went at 50 %; it now reads 100 of 100 and stays. On the
whole-log fixture with every stage collapsed, the requisition stage (at least
46,592 cases, at most 57,347) now stays at a node threshold of 20 % of the
strongest.
