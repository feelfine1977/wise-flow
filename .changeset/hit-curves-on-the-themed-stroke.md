---
"@wise/flow": minor
---

The Canvas map, `CanvasRenderer.hitAt` and the hit index of `prepareScene`
hit an arc or a self-loop on the whole stroke the theme draws it in. Before,
the curve was hit within half the default theme's stroke (0.5) and the
tolerance, so an arc drawn 12 wide (`theme.stroke.arc`) answered no hit on
most of its stroke.

New: a seventh argument of `HitIndex.fromScene`, `markOf(shapeId)`, the mark
a shape is drawn as; a curve is hit within half its stroke.
