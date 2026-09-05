# src/core

Framework-free TypeScript; runs in Node and in the browser. No DOM, no React.

| File | Content |
|---|---|
| `model.ts` | `FlowGraph` types (workbench schema), `validateGraph`, `indexGraph`, `MAP_TARGET` |
| `aggregate.ts` | `abstract` (thresholds, collapse, keep-connected), `collapseGroups`, `isConnected`, `diff` |
| `layout.ts` | `layout` (ELK layered in a worker or in-process, Dagre fallback), `layoutUnion`, `filterPositions`, cache |
| `style.ts` | `buildScales`, palettes with pattern twins, contrast helpers, level-of-detail rules, `patternDefs` |
| `overlays.ts` | constraint presets → overlays, `canonicalOverlays`, `overlayGeometry`, `describeOverlay` |
| `hit.ts` | `HitIndex` (rbush) over nodes, groups, edge segments and overlay shapes |
| `export.ts` | `toSVG` with figure presets and an embedded legend |
| `format.ts` | deterministic number and duration formatting, `Locale` |
| `strings.ts` | English and German strings, `t`, `metricLabel` |
