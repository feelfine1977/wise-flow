# src/core

Framework-free TypeScript; runs in Node and in the browser. No DOM, no React.

| File | Content |
|---|---|
| `index.ts` | the entry point of `@wise/flow`: every exported name listed (deprecated ones marked, see `docs/API.md`); `scripts/core-exports.json` holds the names the built declarations must export |
| `model.ts` | `FlowGraph` types (workbench schema, with `focus` and `paths`), `validateGraph`, `validateGateways` (unpaired parallel gateways), `indexGraph` (lookups, adjacency, group ancestors, nested members, labels), `MAP_TARGET` |
| `aggregate.ts` | `abstract` (thresholds, collapse, keep-connected), `collapseGroups`, `isConnected`, `diff` |
| `layout.ts` | `layout` (ELK layered in a worker or in-process, Dagre fallback), `layoutUnion`, `filterPositions`, `createPositions` (the one constructor; bounds from contents), `unionBoxes`, the caller-key cache and layout scopes keyed by their inputs (`createLayoutScope`), ELK workers terminated when unused; `engine: "di"` marks positions read from BPMN DI, `"given"` positions supplied by the caller |
| `layout-key.ts` | Internal: the key of a layout's inputs (nodes with resolved sizes, edges, groups, options) |
| `activity-labels.ts` | `ActivityLabelOptions` and the activity label helpers: references, wrapped lines, counts, descriptions, node sizes and key lines |
| `collapsed-members.ts` | Internal: `collapsedActivityIds`, the original activity ids a collapsed stage stands for |
| `label-sizing.ts` | Pure zoom-to-label sizes, shape scale and screen-pixel conversion; opt-in host display policy |
| `tokens.ts` | the design token table: colours of both schemes, palettes, font stack, node sizes, mark sizes, the arrowhead rule, pattern twins (`patternTwin`), hatching, and the CSS variables of `tokens.css` (`tokenVariables`); imports nothing |
| `style.ts` | `buildScales`, palettes with pattern twins, contrast helpers, level-of-detail rules, `patternDefs` |
| `overlays.ts` | constraint presets → overlays, `canonicalOverlays`, `overlayGeometry`, `describeOverlay` |
| `overlay-geometry.ts` | placement of overlays already in canonical order: badge slots, arcs (the course crossing the fewest other nodes, the label clear of nodes, other labels and group titles), self-loops, hatch, tint, chips |
| `overlay-marks.ts` | `overlayMarks`: one resolved mark per placed overlay (box or path, fill, stroke, dash, arrowhead, texts, layer, zoom threshold); `overlayColor`, `tintColor`, `arcWidth`, `overlayArrow` |
| `observed-loops.ts` | `followsSelfLoops`, `withFollowsSelfLoops`, `withObservedSelfLoops`: follows edges from a node to itself as self-loop overlays |
| `element-marks.ts` | node and edge marks (`nodeMark`, `edgeMark`, `nodeMarks`, `edgeMarks`): outline, fill, band, texts, route, colour, dash and count label; `truncateText`, `fitText`, `estimateTextWidth` |
| `mark-svg.ts` | `markSvg`, `svgMarkup`: overlay marks, arrowhead markers and pattern tiles as SVG elements |
| `edge-budget.ts` | `budgetEdges`: which edges in view a budget draws (protected edges, then weight, then id), or exactly the edges a map reported; `edgeBudgetAdapter` (internal), the adaptive budget's steps |
| `scene.ts` | `buildScene`: graph and positions resolved once into activity references, lane bands, scales, the overlays to show, level-of-detail rules, overlay geometry, overlay, node and edge marks and the legend |
| `provisional.ts` | Internal: `provisionalLayout` and `reusePositions`, what a map shows until its layout arrives |
| `views.ts` | `buildViews`, `resolveViews`: named views of one map with shared scale domains |
| `selection.ts` | `Selection` transitions (`selectElement`, `selectMany`), `selectionShape`, `relatedToSelection`, `describeSelection` |
| `map-controller.ts` | Internal: the map controller. `mapStep` applies a click, key, hover, focus or menu event to the interaction state (selection, focus of paths, abstraction, view, keyboard position, hover, actions menu) and returns the next state, the live region's sentence and the intents for the host; `announceChange`; the actions menu's keyboard (`menuKey`, `firstEntry`) and header (`menuHeading`); `clickSelection`; `mapEmphasis` (focus in effect, what stays bright) |
| `describe.ts` | Internal: `describeEdge`, the sentence for a path that the map announces and labels with; `describeIndexedEdge` reads the end labels from a `GraphIndex` built once per graph |
| `actions.ts` | `menuTargetFor`, `defaultActions` (filter, explore, compare, author; accelerators; filter clauses), `menuTitle` |
| `paths.ts` | `pathsFor` (from the response's `paths` block or the map), `neighbourhood`, `pathBetween`, `pathRows`, `focusHighlight` |
| `filters.ts` | the contract's filter clauses, `canonicalFilter`, `addClause`, `removeClause`, `describeClause`, `clauseForTarget`, preview normalisation |
| `lanes.ts` | `laneBands`: stage groups as ordered bands along the flow, lane groups as bands across it; the lane model shared with the BPMN layout (`laneModel`, `stackLanes`, `spanLanes`, `laneRoutes`) |
| `routing.ts` | `routeSequenceFlows` (orthogonal obstacle router), `repositionNodes` |
| `hit.ts` | `HitIndex` (rbush) over nodes, groups, edge segments and overlay shapes |
| `figure.ts` | `sceneLegend`, `legendLayout`, `figureFrame`: the legend's rows and their heights, and the figure frame of the exports (header, map, legend column, activity key, output size for a preset) |
| `export.ts` | `toSVG`: draws a `buildScene` scene, its marks and its legend in the figure frame |
| `format.ts` | deterministic number and duration formatting, `Locale` |
| `strings.ts` | English and German strings, `t`, `metricLabel` |
