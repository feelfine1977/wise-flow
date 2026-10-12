---
"@wise/flow": patch
---

The `@wise/flow` entry point lists each of its names instead of re-exporting
whole modules, and import paths are unchanged. Eighteen names that the
package's renderers, its tests and its documentation do not use were marked
`@deprecated` with it and are removed in this release (see the Changeset that
removes them): `FlowElement`, `isEdge`, `isStructuralNode`, `byId`,
`DiffOptions`, `colorOn`, `rgbToHex`, `relativeLuminance`, `PaletteName`,
`PatternShape`, `shapeAnchor`, `HitKind`, `BuildViewsOptions`,
`PathsOptions`, `ActivityOp`, `DefaultActionOptions`, `FollowsSelfLoopOptions`
and `NodeMarkOptions`. Every other name exported before is still exported.
`docs/API.md` names a replacement for each one that has one.
