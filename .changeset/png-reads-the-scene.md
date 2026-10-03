---
"@wise/flow": minor
---

The Canvas renderer and the PNG export read the scene built in the core
(`buildScene`); `PreparedScene` now extends `FlowScene` (adding `style` and
`geometry`) and `prepareScene` accepts `lodBySize` (default true, the live
map's level of detail tightened by the number of nodes).

PNG and Canvas changes:

- Every graph overlay is drawn once. `prepareScene` used to add
  `graph.overlays` to the overlays it was given, so `toPNG` and the Canvas
  map drew each overlay of the graph twice (badges side by side). The
  overlays are now `overlays`, or `graph.overlays` without it, as in `toSVG`.
- `toPNG` decides the level of detail at `lodZoom` (default 1) without
  tightening it by the number of nodes, as `toSVG` does. A figure scaled
  down to a preset width now keeps its node and edge labels, badges, arcs
  and self-loops instead of hiding them at the figure scale.
- `toPNG` draws follows self-loops by default, as `toSVG` and the live map
  do, also without `activityLabels`; `Scene.selfLoops: false` hides them.
- As in `toSVG`, an arc is shown only when both of its endpoints are in the
  graph, and a self-loop overlay that already stands for a follows edge is
  replaced by the derived one instead of being drawn next to it.

For the committed fixtures the recorded Canvas calls are otherwise unchanged.
