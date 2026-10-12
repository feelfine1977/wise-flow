---
"@wise/flow": minor
---

A constraint arc whose course crosses an activity other than its ends now
takes the height, or the side of the map, whose course crosses the fewest
activities; an arc that crosses none keeps its course. Its height may then
exceed `arcHeight`'s upper bound, within the overlay margin. An arc's label
moves along the arc to the point nearest its middle where it covers no
activity, no earlier arc's label and no group's title; it sat at the middle
before. The rule is in the core scene, so the SVG export, `toPNG`, the
Canvas map, the React map and the BPMN view draw the same arcs; in the BPIC
P2P map, "Cancel Invoice Receipt" is no longer crossed and no arc label sits
on an activity.
