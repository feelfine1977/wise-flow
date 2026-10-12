---
"@wise/flow": patch
---

A culled Canvas draw (above 1,500 elements, or `cull: true`) now draws every
element whose drawing reaches into the view, not only those whose box does:
`prepareScene` builds the hit index with each element's drawn extent (a
node's outline, selection ring and focus rectangle, a group's outline and
title, an edge's stroke, arrowhead and count label, an overlay mark's stroke,
arrowhead and texts), so a node at the edge of the view no longer loses its
outline, nor an edge its count label, a badge its share or a group its title.
`HitIndex.fromScene` takes an optional fifth argument `extentOf` that
supplies the box an item's bounds also cover; node, group and overlay items
carry the element's own box as the new `HitItem.box`, which hit tests read, so
`at` returns the same elements as before. Every bound of the index is rounded
outwards to a whole unit, so that the index holds whole numbers and costs no
more memory than before; an area query (`within`) may find an item whose
bounds end less than a unit short of the box. The hit index now lists what is painted
on top first: overlay shapes above the nodes, nodes, arcs, edges, tints,
groups (`HitItem.layer`, set from the shape's kind). Before, every overlay
shape came first, so on the Canvas map a click inside a tinted stage selected
the stage instead of the activity under the pointer, and where an arc crossed
an activity the hover and the click went to the arc. The box of an arc whose
ends sit at different heights now holds its whole curve; it was measured at
the curve's middle parameter, which is not its farthest point, so part of the
stroke and the arrowhead lay outside the box, outside the hit index and, for
an arc at the edge of the map, outside the exported figure's bounds.
