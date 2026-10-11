---
"@wise/flow": patch
---

`validateGraph` reports a cycle of group parents as an error: every group
whose chain of parents returns to it (two groups inside each other, a group
that is its own parent) gets one issue `group parent cycle`. Such a graph
passed validation before and failed later: `collapseGroups(g, "all")`
collapsed nothing and `layout` rejected with the engine's plain error.

`layoutBpmn`, and `exportBpmn` without positions, lay out a graph whose
groups form a cycle of parents: the nodes of those groups have no lane of
their own and follow their neighbours, as a node without a group does. They
overflowed the stack (`RangeError`) in `laneModel` and `spanLanes` before.

Positions with a number that is not finite (`NaN`, an infinity) in a box or
a route no longer reach a drawing or an export. `buildScene` (and with it
`toSVG`, `toPNG`, the Canvas map and `<ProcessMap/>`) and `exportBpmn` leave
such a box or route out as if it were missing; `coversGraph` no longer
counts such a box, so `<ProcessMap/>` lays the graph out instead of drawing
the given positions. Before, the numbers were written into the SVG and the
BPMN diagram interchange and given to the map's elements.
