---
"@wise/flow": patch
---

`validateGraph` reports a cycle of group parents as an error: every group
whose chain of parents returns to it (two groups inside each other, a group
that is its own parent) gets one issue `group parent cycle`. Such a graph
passed validation before and failed later: `collapseGroups(g, "all")`
collapsed nothing and `layout` rejected with the engine's plain error.
