---
"@wise/flow": patch
---

Role bands and `layoutBpmn` share one lane model, exported from the core:
`laneModel`, `stackLanes`, `spanLanes`, `laneRoutes` with `LaneModel`,
`LaneModelOptions` and `LaneSlot`. Its `crossLaneEdges` option states how edges
across lanes are treated: dropped for the renderer to draw directly (role bands)
or routed around the shapes (BPMN). Both keep their output. The orthogonal
obstacle router `routeSequenceFlows` is exported from `@wise/flow`.
`manhattanRoute` in `@wise/flow/bpmn` is deprecated; no layout uses it.
