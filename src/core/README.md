# src/core

Framework-free TypeScript; runs in Node and in the browser. No DOM, no React.

| File | Content |
|---|---|
| `index.ts` | the entry point of `@wise/flow`: every exported name listed (deprecated ones marked, see `docs/API.md`); `scripts/core-exports.json` holds the names the built declarations must export |
| `model.ts` | `FlowGraph` types (workbench schema, with `focus` and `paths`), `validateGraph`, `validateGateways` (unpaired parallel gateways), `indexGraph` (lookups, adjacency, group ancestors, nested members, labels), `MAP_TARGET` |
| `aggregate.ts` | `abstract` (thresholds, collapse, keep-connected; records `meta.model`), `collapseGroups` (marks merged values in `metricBasis`), `isConnected`, `diff` |
| `layout.ts` | `layout` (ELK layered in a worker or in-process, Dagre fallback), `layoutUnion`, `filterPositions`, `createPositions` (the one constructor; bounds from contents), `unionBoxes`, the caller-key cache and layout scopes keyed by their inputs (`createLayoutScope`), ELK workers terminated when unused; `engine: "di"` marks positions read from BPMN DI, `"given"` positions supplied by the caller |
| `layout-key.ts` | Internal: the key of a layout's inputs (nodes with resolved sizes, edges, groups, options) |
| `label-sizing.ts` | Pure zoom-to-label sizes, shape scale and screen-pixel conversion; opt-in host display policy |
| `tokens.ts` | the design token table: colours of both schemes, palettes, font stack, node sizes, the arrowhead rule, pattern twins (`patternTwin`), hatching, every size, radius, stroke, dash, text size and weight, opacity, spacing step and z-order by role, what rules draw at (`ruleTokens`), and the CSS variables of `tokens.css` (`tokenVariables`, written by `npm run tokens`); imports nothing |
| `theme.ts` | the `Theme` type (colour roles with the dark scheme's changes, data palettes and the pattern twins' order, fonts, text, radius, stroke, opacity and spacing tables, density, the smallest text and stroke, rules), the presets `defaultTheme` (the token table) and `printTheme`, `resolveTheme` (a setting over CSS variables over a preset), `themeColors`, the CSS variable of every part (`themeVariables`, `themeFromVariables`, `themeStyle`) and `markedThemeKey` |
| `style.ts` | `buildScales` in a theme's palettes (paths by cases, stage colours in stage order: `orderedCategorical`), `themePalette`, palettes with pattern twins, contrast helpers, `checkTheme` (contrasts, the path ramp, sizes, non-literal colours and rules out of range of a theme, as data), level-of-detail rules, `patternDefs` |
| `rules.ts` | a theme's rules: which apply (`ruleDeviations` for the others), what they set on an element by part, kind, tag and state (`ruleSet`) and the paints, widths, dashes, radii and texts they resolve to, which the mark builders apply; `stateStyle` and `markInState` for the interactive states, which the DOM map and the Canvas map draw |
| `overlays.ts` | constraint presets → overlays, `canonicalOverlays`, `overlayGeometry`, `describeOverlay` |
| `overlay-geometry.ts` | placement of overlays already in canonical order: badge slots, arcs (the course crossing the fewest other nodes, the label clear of nodes, other labels and group titles), self-loops, hatch, tint, chips |
| `overlay-marks.ts` | `overlayMarks`: one resolved mark per placed overlay (box or path, fill, stroke, dash, arrowhead, texts, layer, zoom threshold); `overlayColor`, `tintColor`, `arcWidth`, `overlayArrow` |
| `observed-loops.ts` | `followsSelfLoops`, `withFollowsSelfLoops`, `withObservedSelfLoops`: follows edges from a node to itself as self-loop overlays |
| `scene.ts` | `buildScene`: graph and positions resolved once, in a theme and colour scheme with one text measure, into activity references, lane bands, scales, the overlays to show, level-of-detail rules, overlay geometry, overlay, node, edge and group marks, the colours of the paint roles and the legend |
| `views.ts` | `buildViews`, `resolveViews`: named views of one map with shared scale domains |
| `selection.ts` | `Selection` transitions (`selectElement`, `selectMany`), `selectionShape`, `relatedToSelection`, `describeSelection` |
| `map-controller.ts` | Internal: the map controller. `mapStep` applies a click, key, hover, focus or menu event to the interaction state (selection, focus of paths, abstraction, view, keyboard position, hover, actions menu) and returns the next state, the live region's sentence and the intents for the host; `announceChange`; the actions menu's keyboard (`menuKey`, `firstEntry`) and header (`menuHeading`); `clickSelection`; `mapEmphasis` (focus in effect, what stays bright) |
| `describe.ts` | Internal: `describeEdge`, the sentence for a path that the map announces and labels with; `describeIndexedEdge` reads the end labels from a `GraphIndex` built once per graph |
| `actions.ts` | `menuTargetFor`, `defaultActions` (filter, explore, compare, author; accelerators; filter clauses), `menuTitle` |
| `paths.ts` | `pathsFor` (from the response's `paths` block or the map), `neighbourhood`, `pathBetween`, `pathRows`, `focusHighlight` |
| `filters.ts` | the contract's filter clauses, `canonicalFilter`, `addClause`, `removeClause`, `describeClause`, `clauseForTarget`, preview normalisation |
| `lanes.ts` | `laneBands`: stage groups as ordered bands along the flow, lane groups as bands across it; the lane model shared with the BPMN layout (`laneModel`, `stackLanes`, `spanLanes`, `laneRoutes`) |
| `routing.ts` | `routeSequenceFlows` (orthogonal obstacle router), `repositionNodes` |
| `courses.ts` | `pathCourses`: a path against the reading direction as its own line below the flow it returns over, two opposite paths side by side, and where their labels go |
| `hit.ts` | `HitIndex` (rbush) over nodes, groups, edge segments and overlay shapes |
| `figure.ts` | `legendOfScene`, `sceneLegend`, `legendLayout`, `figureFrame`, `figureCaption`: the legend's typed rows (`LegendRow`: the measure, the scales by metric and unit, a key per kind of mark drawn, the chips) from what a scene draws, their heights and texts at the export's width, and the figure frame of the exports (header, map, legend column, caption line, activity key, output size for a preset) |
| `viewport.ts` | `fitViewport`, `panelInsets`: the fitted view of a map inside its area less insets, and the insets that keep it clear of the panels over it |
| `text.ts` | `TextMeasure`, `estimateTextWidth`, `truncateText`, `wrapText`, `fitText`, `fitLead`: the one measure of text widths a scene is built with, and the rules that shorten and wrap text by it |
| `export.ts` | `toSVG`: draws a `buildScene` scene, its marks and its legend in the figure frame |
| `format.ts` | deterministic number and duration formatting (`formatPathCount` for paths), `Locale` |
| `metrics.ts` | the metric registry: each metric's name, unit and format in English and German, `MetricBasis` (lower bounds and means of merged values) and how they read |
| `strings.ts` | English and German strings, `t`, `metricLabel` |
