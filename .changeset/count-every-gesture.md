---
"@wise/flow": patch
---

`CanvasRenderer` counts the gestures its host reports whatever the edge
budget is. Before, a gesture that began while the budget was a number or
`"all"` was not counted, but its end was, so when a host turned the budget
`"adaptive"` during that gesture its end could apply a step while another
gesture (a drag during a wheel run, for instance) was still under way. The
budget now changes only once the last gesture has ended, as documented.
