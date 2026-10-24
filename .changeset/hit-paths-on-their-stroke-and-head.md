---
"wise-flow": minor
---

The Canvas map, `CanvasRenderer.hitAt` and the hit index of `prepareScene`
hit a path on the whole line and head it is drawn with, plus the tolerance,
as they hit arcs and self-loops. Before, a path was hit within the
tolerance (4) of its route whatever its width, so the outer part of a path
8 wide and of its head, which grows with the line and reaches 7.2 to each
side, answered no hit on the Canvas map, where the React Flow map hits it.

New: an eighth argument of `HitIndex.fromScene`, `pathOf(edgeId)`, the mark
an edge is drawn as, and `HitItem.stroke`, the line along a segment with
half its width and, on the last segment, the head's triangle with half its
outline, which hit tests read. With `pathOf` an edge item's bounds cover
its line and head, so an index built without `extentOf` finds the hit too.
Without `pathOf` an edge is hit as before.
