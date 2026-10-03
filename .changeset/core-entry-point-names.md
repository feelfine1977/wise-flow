---
"@wise/flow": patch
---

The `@wise/flow` entry point lists each of its names instead of re-exporting
whole modules. Every name exported before is still exported, and import paths
are unchanged. Seventeen names that the package's renderers, its tests and its
documentation do not use are now marked `@deprecated`. They leave the entry
point in the next major version: `FlowElement`, `isEdge`, `isStructuralNode`,
`DiffOptions`, `colorOn`, `rgbToHex`, `relativeLuminance`, `PaletteName`,
`PatternShape`, `shapeAnchor`, `HitKind`, `BuildViewsOptions`, `PathsOptions`,
`ActivityOp`, `DefaultActionOptions`, `FollowsSelfLoopOptions` and
`NodeMarkOptions`. `docs/API.md` names a replacement for each one that has one.
