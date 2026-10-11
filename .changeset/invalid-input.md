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
