---
"@wise/flow": minor
---

`ProcessMap` reads the core scene: bands, scales, overlays, level-of-detail
rules and overlay geometry come from one `buildScene` call, and in Canvas mode
the same scene is handed to the Canvas map instead of being prepared a second
time. `buildScene` accepts `moved`, nodes placed by hand after the lane bands.

Visible changes on the live map, now the same as in the SVG export: plain
self-loop labels are formatted in the map's `locale` (German `1,5k ×` instead of
`1.5k ×`); a given self-loop overlay that stands for a follows edge is replaced
by the derived one instead of being drawn twice; an arc is listed and drawn only
when both its endpoints are on the map; and the Canvas map draws each graph
overlay once instead of twice. Arcs and self-loops on the React Flow map carry
`data-overlay-id`, the id of their shape in the scene.
