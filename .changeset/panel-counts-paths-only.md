---
"@wise/flow": minor
---

The detail panel's "n selected · m drawn at this zoom" counts paths only, on
the React Flow map and the Canvas map alike: a constraint edge the edge
budget withholds is no path not drawn. Three paths and a constraint edge
under a budget of 3 read "3 selected · 2 drawn at this zoom"; now every path
is drawn and the panel has no such line. `EdgeSelection` has a new field,
`pathsNotShown`: how many of the edges in view the budget withholds are
paths (follows and flow edges, not indirect ones, and in a map's report the
loops in view it does not name).
