---
"@wise/flow": minor
---

Exports can show what the map shows. `<ProcessMap/>` and `<CanvasMap/>`
take `onEdgesShown`, called with the new `ShownEdges` (`{ edges, total }`)
while the edge budget withholds edges and with undefined once every edge is
drawn again. `toSVG`, `toPNG`, `toPNGCanvas` and `toPNGDataUrl` take
`edgeBudget?: EdgeBudget | ShownEdges`:
- given what a map reported, the figure draws exactly those edges;
- given a number, it draws by the map's order;
- given `"all"`, it draws every edge.

While edges are withheld, the figure carries the map's note ("Showing 3 of 8
flows", `map.edges.withheld` in the scene's locale) as text under the map and
inside the frame. Without a value the output is the same as before.

`budgetEdges` and `DrawOptions.edgeBudget` also accept a `ShownEdges`.
`figureFrame` takes `withheld` and returns the note's place in `note`, and
`figureMetrics` gains `noteRow`, `noteBaseline` and `noteSize`.
