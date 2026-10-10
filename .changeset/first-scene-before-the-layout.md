---
"@wise/flow": patch
---

`<ProcessMap/>` without `positions` draws at once instead of staying blank
until its layout finishes (a dense map of 500 activities took more than 10 s).
It shows a finished layout of the same inputs when its layout scope holds one,
otherwise the earlier positions of the activities still present with new
nodes beside their neighbours, otherwise a provisional arrangement computed in
linear time (longest-path ranks along the flow direction, one barycentre pass,
groups kept together, straight edges). Positions shown this way carry
`engine: "provisional"`, a new `LayoutEngine` value. The map stays fully
interactive; a status panel and the map's description say "Arranging the
map…" (new string `map.arranging`, English and German) and
`data-layout-status` is `"pending"`. When the layout arrives the nodes move
into place over 300 ms, or at once with reduced motion; selection, keyboard
position and focus stay, and a view the user moved keeps its zoom and the node
at its centre. Given positions are drawn as before.

`useStableLayout` returns these positions from the first render with the new
flag `provisional: true` and status `"pending"`, then the layout once
(`"ready"`, `provisional: false`); before, `positions` held the previous result
or nothing while a layout was pending. `CanvasMapHandle` gains `moved()`.
