---
"@wise/flow": minor
---

Removes the names marked `@deprecated` on the way to this release. This is a
breaking change: 0.3.5 exported fifteen of them and marked none deprecated,
so a host moving from 0.3.5 meets them removed; the other three were added
and deprecated before this release.

`@wise/flow` no longer exports `FlowElement` (use `FlowNode | FlowEdge`),
`isEdge` (`"source" in element`), `isStructuralNode`
(`node.kind === "event" || node.kind === "gateway"`), `byId` (compare `a.id`
and `b.id`), `DiffOptions` (`NonNullable<Parameters<typeof diff>[2]>`),
`colorOn` (`buildScales(graph, spec).color`), `rgbToHex` (format the rounded
channels as `#rrggbb`), `relativeLuminance` (`contrastRatio`), `PaletteName`
(`NonNullable<ColorSpec["palette"]>`), `PatternShape`
(`ReturnType<typeof patternTwin>`), `shapeAnchor`
(`{ x: s.labelX ?? s.x + s.width / 2, y: s.labelY ?? s.y }`), `HitKind`
(`HitItem["kind"]`), `BuildViewsOptions`
(`NonNullable<Parameters<typeof buildViews>[2]>`), `PathsOptions`
(`NonNullable<Parameters<typeof pathsFor>[2]>`), `ActivityOp`
(`ActivityClause["op"]`), `DefaultActionOptions`
(`NonNullable<Parameters<typeof defaultActions>[3]>`),
`FollowsSelfLoopOptions`
(`NonNullable<Parameters<typeof followsSelfLoops>[1]>`) and `NodeMarkOptions`
(`Parameters<typeof nodeMark>[2]`).

`@wise/flow/react` no longer has `OverlayLayerProps.showArcs` and
`OverlayLayerProps.showSelfLoops` (pass `zoom`; without it the layer now draws
every mark), `ActivityNodeData.badges` and `GroupNodeData.chips` (use `marks`,
drawn at `origin`).

`@wise/flow/bpmn` no longer exports `manhattanRoute` (use
`routeSequenceFlows` from `@wise/flow`).
