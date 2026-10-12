---
"wise-flow": patch
---

`CanvasRenderer` lets go of what it no longer draws. `setScene(undefined)`
forgets the scene the last draw drew; the renderer keeps only the ids of the
edges that draw drew while the edge budget withheld some, so a hit before the
next draw still leaves the withheld ones out. `dispose()` releases the scene,
the drawing context, `onDraw` and `onViewportChange` (`lastDraw` stays
readable), and every method that changes something then returns without an
effect: a disposed renderer no longer resizes its canvas, takes a new scene or
state, or calls `onViewportChange` when it is panned, zoomed or fitted.
