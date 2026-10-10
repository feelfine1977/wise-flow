---
"@wise/flow": minor
---

An edge budget bounds how many of the edges in view a map draws. The new
`edgeBudget?: number | "all"` of `<ProcessMap/>` (default `"all"`: every edge
drawn, as before) is resolved once by the new core function `budgetEdges`
(`EdgeBudget`, `EdgeProtection`, `EdgeSelection`), so the Canvas map and the
React Flow map draw the same edges: protected edges first, then by weight
(the metric the edge width reads, `count` by default) descending, then by id.
An edge is protected, and drawn even beyond the budget, when it carries an
overlay mark (one naming it through `edgeId`, or an arc from its source to
its target), when it is selected or at the keyboard
position, or when it lies on the focus of paths. While edges are withheld the
map shows "Showing n of m flows" (`map.edges.withheld`, English and German)
and announces it in its live region; the table view lists every edge. The
Canvas drawing takes `DrawOptions.edgeBudget` and `DrawState.highlighted`,
`drawScene` reports `withheld`, `CanvasRenderer` gains `onDraw` and its
`hitAt` skips withheld edges, and `<CanvasMap/>` takes `edgeBudget` and
`onAnnounce`.
