---
"@wise/flow": minor
---

Build the scene a renderer draws once in the core: `buildScene` resolves a graph
and its positions into activity references, lane bands, scales, the overlays to
show in canonical order, level-of-detail rules and overlay geometry, and `toSVG`
now draws from it. `followsSelfLoops` and `withFollowsSelfLoops` derive self-loop
overlays from follows edges in one place for the plain and the observed labels.

SVG export changes: follows edges from an activity to itself are now drawn as
self-loops by default, as on the live map, also without `activityLabels`; set
`selfLoops: false` on the scene to hide them (also honoured by `toPNG`). Overlays
whose target is not a node, group or the map (and arcs whose endpoints are not in
the graph) are dropped before the overlays are ordered, so they can no longer
change the drawing order of the others. Everything else in the SVG output is
unchanged.
