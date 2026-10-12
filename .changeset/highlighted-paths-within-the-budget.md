---
"@wise/flow": minor
---

Highlighted paths of a focus are drawn within the edge budget. This changes
a rule settled earlier: highlighted paths were protected and drawn beyond
any budget, so a focus on the paths of a hub drew every one of them (5,000
paths took 44 ms a frame in motion, against 9.3 ms under the default budget
of 2,000).

Now the budget draws the protected edges (overlay marks, the selection, the
keyboard position; unchanged, still beyond the budget), then the highlighted
paths heaviest first, then the others heaviest first, as many as it has room
for. The note says how many highlighted paths it does not show: "Showing 10
of 30 flows, 20 highlighted not shown" (new string
`map.edges.withheldHighlighted`, German "10 von 30 Flüssen gezeigt, 20
hervorgehobene nicht gezeigt"). `EdgeSelection` has a new field,
`highlightedNotShown`, and `EdgeSelection.kept` no longer counts highlighted
paths. The path list keeps listing every path of the focus. Exports have no
highlighted paths and are unchanged.
