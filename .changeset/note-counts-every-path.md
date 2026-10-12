---
"@wise/flow": minor
---

The note on withheld paths ("Showing n of m flows") counts the paths that
loop on one activity in both numbers, as the map's description, the canvas
sentence, the bounded list's sentence and the table do. They are drawn as
loops and never withheld. So the note's total is now the number of paths the
other texts give for the whole map: on the BPIC global scene "of 677", where
it said "of 656". The same holds for the note in SVG and PNG exports.

`onEdgesShown` reports the loops in view among the drawn edges (after the
edges drawn as lines), so an export of that report counts them too.
`EdgeSelection` gains `loops`, the ids of the loops it counts, and
`budgetEdges` reads the scene's `graph` and `positions` and takes the loops
in view as an optional fifth argument (every loop of the scene by default).
