---
"@wise/flow": minor
---

While `<ProcessMap/>` shows its table view, which lists every path,
`onEdgesShown` is called with undefined, with either renderer: an export
taken from there draws every path and no note. When the map is shown again,
the host is told what the map then withholds. Before, the React Flow map kept
reporting its budgeted set in the table view, and the Canvas map, which the
table view replaces, left the host with its last report, so an export taken
there drew the map's set (stale with Canvas after a change of the budget or
the graph).
