# src/core

Framework-free TypeScript; runs in Node and in the browser. No DOM, no React.

| File | Content |
|---|---|
| `model.ts` | `FlowGraph` types (workbench schema, with `focus` and `paths`), `validateGraph`, `indexGraph`, `MAP_TARGET` |
| `aggregate.ts` | `abstract` (thresholds, collapse, keep-connected), `collapseGroups`, `isConnected`, `diff` |
| `layout.ts` | `layout` (ELK layered in a worker or in-process, Dagre fallback), `layoutUnion`, `filterPositions`, cache; `engine: "di"` marks positions read from BPMN DI, `"given"` positions supplied by the caller |
| `style.ts` | `buildScales`, palettes with pattern twins, contrast helpers, level-of-detail rules, `patternDefs` |
| `overlays.ts` | constraint presets → overlays, `canonicalOverlays`, `overlayGeometry`, `describeOverlay` |
| `views.ts` | `buildViews`, `resolveViews`: named views of one map with shared scale domains |
| `selection.ts` | `Selection` transitions (`selectElement`, `selectMany`), `selectionShape`, `relatedToSelection`, `describeSelection` |
| `actions.ts` | `menuTargetFor`, `defaultActions` (filter, explore, compare, author; accelerators; filter clauses), `menuTitle` |
| `paths.ts` | `pathsFor` (from the response's `paths` block or the map), `neighbourhood`, `pathBetween`, `pathRows`, `focusHighlight` |
| `filters.ts` | the contract's filter clauses, `canonicalFilter`, `addClause`, `removeClause`, `describeClause`, `clauseForTarget`, preview normalisation |
| `lanes.ts` | `laneBands`: stage groups as ordered bands along the flow, lane groups as bands across it |
| `hit.ts` | `HitIndex` (rbush) over nodes, groups, edge segments and overlay shapes |
| `export.ts` | `toSVG` with figure presets, lane bands and an embedded legend |
| `format.ts` | deterministic number and duration formatting, `Locale` |
| `strings.ts` | English and German strings, `t`, `metricLabel` |
