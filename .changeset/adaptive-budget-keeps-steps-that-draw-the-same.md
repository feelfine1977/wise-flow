---
"@wise/flow": minor
---

The adaptive edge budget takes no step down that would draw the same edges,
as documented. A slow frame counts only when it drew more edges than the
step below would, which draws the protected edges (overlay marks, the
selection, the keyboard position, a highlighted path) at every step. Before,
it counted whenever it drew more than half the budget, so a Canvas map with
2,500 selected or highlighted paths of 5,000 in view stepped from 2,000 to
1,000 and 500 although each step drew the same 2,500, and after the
selection was cleared it drew only 500 paths until fast gestures brought the
budget back.

New: `EdgeSelection.kept`, the protected edges among those drawn, and
`kept` in the statistics `drawScene` returns (and `CanvasRenderer.lastDraw`)
whenever it is given an edge budget other than `"all"`.
