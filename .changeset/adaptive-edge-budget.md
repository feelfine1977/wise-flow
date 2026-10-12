---
"wise-flow": minor
---

The edge budget adapts to the frame time, and that is the new default.
`edgeBudget` of `<ProcessMap/>` and `<CanvasMap/>`, and the new `edgeBudget`
of `<ViewSwitcher/>` (passed to every view's map), also take `"adaptive"`,
now their default; a number or `"all"` keeps the fixed behaviour and reads
no clock. The adaptive budget is a step of 500, 1,000, 2,000, 4,000, …
edges, starting at 2,000. On the Canvas map the frames of a pan or zoom
gesture are timed against 16.7 ms, and the budget moves one step only when
the view is at rest: down after 5 consecutive frames above 16.7 ms, up after
5 consecutive frames below half of it while edges are withheld. Protected
edges are drawn at every step and the note shows the current numbers; a
change is drawn at once, without animation. The React Flow map keeps the
first step, 2,000 edges. To keep every edge drawn as before, pass
`edgeBudget="all"`. `CanvasRenderer` takes a `clock` option and has
`beginGesture()` and `endGesture()`; its `drawOptions.edgeBudget` may be
`"adaptive"`. `<CanvasMap/>` takes `clock`.
