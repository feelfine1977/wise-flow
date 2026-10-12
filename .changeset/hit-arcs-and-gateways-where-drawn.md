---
"@wise/flow": minor
---

The Canvas map, `CanvasRenderer.hitAt` and the hit index of `prepareScene`
hit arcs and self-loops where they are drawn: within the tolerance and half
the stroke of their curve, or on their label. Before, their whole box took
the hit, so a path running under an arc's box could not be hovered or
clicked there (1,164 of 40,000 grid points near a path on the BPIC global
scene with stage lanes returned an arc), and a point inside an activity near
its self-loop returned the loop. A gateway is hit inside its diamond, also
where a gateway wider than tall reaches beyond its box, and no longer in its
box's corners.

New: `HitItem.curve` (an arc's or a self-loop's curve, half its stroke and
its label's box), `HitItem.diamond`, and a sixth argument of
`HitIndex.fromScene`, `diamond(nodeId)`, for the nodes drawn as a diamond.
