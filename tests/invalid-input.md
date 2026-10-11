# Invalid input at the public entry points

What each public function and component that takes data does with invalid
input: what [the API document](../docs/API.md) promises, what the searching
tests observe, and the test that feeds it at least 300 malformed cases by
default (`caseCount(300)`; fifty times as many with `WISE_DEEP=1`).

**Invalid input** is what a host's backend may send inside the documented
shapes: a graph with missing, duplicate or empty ids, edges to missing nodes,
cycles of group parents, no nodes or one, zero cases, metrics that are
missing, negative, not finite or strings, unknown kinds of nodes, edges,
groups and overlays, overlays on missing targets or with junk payloads, very
long and markup-like labels, junk `meta`, `focus` and `paths`; positions that
are missing, not finite or extreme; constraint statistics, filter clauses and
previews, traces, cohorts, BPMN files and mappings in the same state; and
numbers a host computes (zoom levels, widths, budgets, limits, timeouts)
that are zero, negative, fractional, huge or not finite. Option objects and
the library's own structures passed back to it (scales, scenes, marks,
selections, menu targets) are taken as typed: a wrong JavaScript type there is
a programming error TypeScript reports. Ids named like members of
`Object.prototype` are an open decision (`tests/core/prototype-ids.test.ts`).

Every function below must return, or fail as its documentation says, never
with a `TypeError`, `RangeError` or other untyped error, and settle within the
search's time bound. The plain errors each search allows are listed in the
test; a new one fails it. **Not documented** marks input the documentation
is silent about; each such case is a finding to decide.

`tests/tooling/invalid-input.test.mjs` keeps this table in step with the package:
it checks that every callable value export of the four entry points that takes a
parameter has a row, and that every row's test exists and names the function.


## Model and aggregation

Test: `tests/core/malformed-input.test.ts` › "model and aggregation".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `metric` | `.` | A value that is not a finite number (missing, `NaN`, a string) yields the fallback. | Returns. |
| `hasTag` | `.` | Not documented. | Returns. |
| `indexGraph` | `.` | `ancestors` ends at an unknown parent and before a group would repeat; `label` falls back to the id. | Returns. |
| `validateGraph` | `.` | Errors: duplicate node, edge and group ids, unknown edge ends, unknown group parents, cycles of group parents (since this change); warnings: unknown node groups, overlays on unknown targets. Not reported: missing, empty or unknown-kind elements, metric values. | Returns. |
| `validateGateways` | `.` | Warnings only; rejects nothing. | Returns. |
| `normalizeGraph` | `.` | Not documented. | Returns the elements de-duplicated by id (the first kept) and sorted. |
| `strengths` | `.` | Not documented. | Returns. |
| `collapseGroups` | `.` | Not documented. A cycle of group parents collapses nothing (validation reports it). | Returns. |
| `components` | `.` | Not documented. | Returns. |
| `isConnected` | `.` | Not documented. | Returns. |
| `abstract` | `.` | Metrics through `metric` (missing and `NaN` count as 0); otherwise not documented for invalid thresholds or metrics. | Returns; a graph validation accepts stays acceptable. |
| `diff` | `.` | Not documented. | Returns. |
| `unionGraph` | `.` | Not documented. | Returns the union by id, the first definition kept. |

## Positions, routing and lanes

Test: `tests/core/malformed-input.test.ts` › "positions, routing and lanes".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `defaultNodeSize` | `.` | Not documented. | Returns a finite size, also for an unknown kind. |
| `unionBoxes` | `.` | Boxes without a non-negative width and height are ignored; no boxes give the empty box. | Returns; numbers that are not finite pass through to the result. (a non-finite x or y with a valid size) |
| `positionsBounds` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `createPositions` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `clearLayoutCache` | `.` | Not documented. | Returns. |
| `filterPositions` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `coversGraph` | `.` | A box counts when its four numbers are finite (since this change). | Returns. |
| `straightRoute` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `repositionNodes` | `.` | Unroutable geometry: a clipped direct route; an edge without an id is routed (since this change); boxes that are not finite are left out of routing (since this change). | Returns; plain `Error` "Cannot route …" (documented). |
| `routeSequenceFlows` | `.` | Unroutable geometry raises a descriptive error; boxes that are not finite are left out (since this change). | Returns, or the documented plain `Error`. |
| `laneGroups` | `.` | Not documented. | Returns. |
| `laneAssignment` | `.` | Not documented. | Returns. |
| `laneModel` | `.` | Groups on a cycle of parents have no leaf; their nodes follow their neighbours (since this change). | Returns. |
| `stackLanes` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `spanLanes` | `.` | A cycle of parents ends where it returns (since this change). | Returns; numbers that are not finite pass through to the result. |
| `laneRoutes` | `.` | As `routeSequenceFlows` for `routed`. | Returns, or the documented plain `Error`. |
| `laneBands` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. Junk padding or gaps give bands that are not finite. |

## Style, tokens, label sizing, formatting and strings

Test: `tests/core/malformed-input.test.ts` › "style, tokens, label sizing and formatting".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `hexToRgb` | `.` | Not documented. | Returns for any string. |
| `interpolatePalette` | `.` | Not documented. | Returns. |
| `contrastRatio` | `.` | Not documented. | Returns. |
| `contrastText` | `.` | Not documented. | Returns. |
| `hashKey` | `.` | Not documented. | Returns a finite number. |
| `lodAt` | `.` | Not documented. | Returns. |
| `lodForSize` | `.` | Not documented. | Returns. |
| `buildScales` | `.` | Not documented. | Returns; widths from the data alone are finite; a host's domain or range that is not finite gives widths that are not. |
| `patternDefs` | `.` | Not documented. | Returns. |
| `arrowheadExtent` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `patternTwin` | `.` | Not documented. | Returns. |
| `cssVariable` | `.` | Not documented. | Returns. |
| `labelUnitsAt` | `.` | A nonpositive or nonfinite zoom gives the supplied target; the target is clamped to 11–14 for the inverse-zoom part. | As documented; a target that is not finite passes through. |
| `smallLabelUnitsAt` | `.` | A nonpositive or nonfinite zoom gives 11. | As documented. |
| `mapScaleAt` | `.` | Not documented. | Returns a finite number. |
| `labelScreenPx` | `.` | Multiplies; does not clamp or round. | Returns; numbers that are not finite pass through to the result. |
| `formatCount` | `.` | A value that is not a finite number prints `–`. | As documented. |
| `formatNumber` | `.` | As `formatCount`; `decimals` is taken between 0 and 100 (since this change). | As documented. |
| `formatShare` | `.` | As `formatCount`. | As documented. |
| `formatDelta` | `.` | As `formatCount`. | As documented. |
| `formatHours` | `.` | As `formatCount`. | As documented. |
| `formatDays` | `.` | As `formatCount`. | As documented. |
| `formatCompact` | `.` | As `formatCount`. | As documented. |
| `t` | `.` | Falls back to English; placeholders are filled from `vars`. | Returns. |
| `metricLabel` | `.` | Not documented. | Returns the name itself for an unknown metric. |

## Overlays and their marks

Test: `tests/core/malformed-input.test.ts` › "overlays and their marks".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `constraintOverlays` | `.` | "not applicable in this scene" without evaluated cases; otherwise not documented for junk statistics or unknown types. | Returns. |
| `overlaysFor` | `.` | As `constraintOverlays`. | Returns. |
| `canonicalOverlays` | `.` | Not documented. | Returns. |
| `describeOverlay` | `.` | Not documented. | Returns. |
| `overlayGeometry` | `.` | Shapes never extend beyond `overlayMargin()` around the bounds. | Returns; shapes are finite for finite positions and sound options; junk options (an arc height of 10³⁰⁸) overflow. |
| `overlayMargin` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `overlayColor` | `.` | Neutral without a value. | Returns a colour; a value that is not a finite number is neutral. |
| `tintColor` | `.` | None without a value. | Returns. |
| `arcWidth` | `.` | 2 + 8 × coverage in [0, 1], default 1, also for a coverage that is not a finite number (since this change). | As documented. |
| `markArrowhead` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `chipText` | `.` | Not documented. | Returns. |
| `overlayMarks` | `.` | Not documented. | Returns. |
| `fitChars` | `.` | Not documented. | Returns. |
| `fitLead` | `.` | Not documented. | Returns. |
| `markSvg` | `.` | Not documented. | Returns. |
| `arrowMarker` | `.` | Not documented. | Returns. |
| `patternTwinSvg` | `.` | Not documented. | Returns. |
| `hatchSvg` | `.` | Not documented. | Returns. |
| `svgMarkup` | `.` | Escapes `&`, `<`, `>` and `"` in texts and attribute values (stated for `toSVG`). | As documented. |
| `followsSelfLoops` | `.` | Not documented. | Returns. |
| `withFollowsSelfLoops` | `.` | Not documented. | Returns. |
| `withObservedSelfLoops` | `.` | Not documented. | Returns. |
| `HitIndex` | `.` | Not documented. | Returns. |

## Scene, marks, legend, figure and SVG export

Test: `tests/core/malformed-input.test.ts` › "scene, marks, legend, figure and SVG export".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `buildScene` | `.` | Overlays on unknown targets are dropped; boxes and routes that are not finite are left out as if missing (since this change). | Returns; every drawn element has a finite box, every text is readable. |
| `budgetEdges` | `.` | `NaN`, `"all"`, undefined or null withhold nothing. | Returns. |
| `nodeMarks` | `.` | One mark per node with a box. | Returns. |
| `edgeMarks` | `.` | One mark per edge between two placed nodes. | Returns. |
| `nodeMark` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `edgeMark` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `edgeColor` | `.` | Not documented. | Returns. |
| `edgePoints` | `.` | Undefined where an end has no box. | Returns. |
| `routeMidpoint` | `.` | Not documented. | Returns. |
| `edgeLabelPoint` | `.` | Not documented. | Returns. |
| `gatewayGlyph` | `.` | × unless tagged `and` or `or`. | Returns. |
| `nodeCount` | `.` | Not documented. | Returns a readable count or nothing. |
| `truncateText` | `.` | Not documented. | Returns. |
| `fitText` | `.` | Not documented. | Returns. |
| `estimateTextWidth` | `.` | Not documented. | Returns. |
| `sceneLegend` | `.` | Not documented. | Returns. |
| `legendItemHeight` | `.` | Not documented. | Returns. |
| `legendLayout` | `.` | Not documented. | Returns. |
| `figureFrame` | `.` | Not documented. | Finite for sound options; a width, padding or scale out of range (10³⁰⁸, a padding of 10⁻³²⁰ on an empty map) gives sizes that are not finite. |
| `toSVG` | `.` | Every text and id is escaped (since this change for kinds); deterministic. | Returns well-formed SVG; no `NaN` or `Infinity` for accepted input and sound options. |
| `resolveViews` | `.` | Not documented. | Returns. |
| `viewsSharePositions` | `.` | Not documented. | Returns. |

## Selection, paths, filters and actions

Test: `tests/core/malformed-input.test.ts` › "selection, paths, filters and actions".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `isSelected` | `.` | Not documented. | Returns. |
| `selectionSize` | `.` | Not documented. | Returns. |
| `selectionEquals` | `.` | Not documented. | Returns. |
| `selectionElements` | `.` | Not documented. | Returns. |
| `selectElement` | `.` | Not documented. | Returns. |
| `selectMany` | `.` | Not documented. | Returns. |
| `clearSelection` | `.` | Takes nothing. | Returns. |
| `selectionShape` | `.` | Not documented. | Returns. |
| `relatedToSelection` | `.` | Not documented. | Returns. |
| `describeSelection` | `.` | Not documented. | Returns a readable sentence. |
| `normalizePath` | `.` | The contract's `median_lag` / `violation_share` are accepted. | Returns. |
| `pathsFor` | `.` | Reads `paths` only when it belongs to the focus; otherwise computes from the map. | Returns. |
| `focusMembers` | `.` | Not documented. | Returns. |
| `neighbourhood` | `.` | Not documented. | Returns. |
| `pathBetween` | `.` | `found: false` when there is no path. | Returns. |
| `pathRows` | `.` | Not documented. | Returns. |
| `focusHighlight` | `.` | A focus that is not a pair is one id, also a missing one (since this change). | Returns. |
| `asFilter` | `.` | `undefined` and `null` give the empty filter. | Returns. |
| `normalizeFilterPreview` | `.` | Numbers only where finite; marginal removals only from a list, entries with a numeric clause (since this change). | Returns. |
| `canonicalClause` | `.` | A clause of an unknown kind stays as it is; an `any` without clauses is empty (since this change). | Returns. |
| `clauseKey` | `.` | As `canonicalClause`. | Returns. |
| `canonicalFilter` | `.` | As `canonicalClause`. | Returns. |
| `filterEquals` | `.` | As `canonicalClause`. | Returns. |
| `addClause` | `.` | As `canonicalClause`. | Returns. |
| `removeClause` | `.` | Not documented. | Returns; an index out of range removes nothing. |
| `changesCases` | `.` | An `any` without clauses changes none (since this change). | Returns. |
| `describeClause` | `.` | An unknown kind reads "clause.unknown"; an `any` without clauses is empty (since this change). | Returns. |
| `describePreview` | `.` | Not documented. | Returns a readable sentence or nothing. |
| `clauseForTarget` | `.` | Undefined where no exact filter exists. | Returns. |
| `menuTargetFor` | `.` | Not documented. | Returns. |
| `defaultActions` | `.` | Not documented. | Returns. |
| `sortActions` | `.` | Not documented. | Returns. |
| `menuTitle` | `.` | Not documented. | Returns a readable title. |

## Activity labels

Test: `tests/core/malformed-input.test.ts` › "activity labels".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `activityReferences` | `.` | Absent entries are kept, new ones added without renumbering. | Returns. |
| `activityLabel` | `.` | Not documented. | Returns. |
| `wrapActivityText` | `.` | Not documented. | Returns. |
| `activityNodeCounts` | `.` | Missing values are marked unavailable. | Returns a readable text. |
| `activityCounts` | `.` | As `activityNodeCounts`. | Returns a readable text. |
| `activityDescription` | `.` | As `activityNodeCounts`. | Returns a readable text. |
| `activityLabelLines` | `.` | Not documented. | Returns. |
| `activityNodeSize` | `.` | Not documented. | Returns a finite size. |
| `activityKeyLines` | `.` | Not documented. | Returns. |

## Canvas entry point, headless

Test: `tests/core/malformed-input.test.ts` › "the Canvas entry point's headless functions".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `prepareScene` | `./canvas` | As `buildScene`. | Returns; every node has a finite box. |
| `selfLoopOverlays` | `./canvas` | Not documented. | Returns. |
| `groupLabelOf` | `./canvas` | Not documented. | Returns. |
| `drawScene` | `./canvas` | Not documented. | Draws with finite numbers for a sound view. |
| `drawLegend` | `./canvas` | Not documented. | Returns. |
| `tracePath` | `./canvas` | Not documented. | Returns. |
| `toPNGCanvas` | `./canvas` | As `toSVG` for the scene. | Draws with finite numbers for accepted input and a scale in (0, 16]; a scale of 10³⁰⁸ gives a canvas of infinite size. |
| `toPNGDataUrl` | `./canvas` | Not documented. | Returns. |

## BPMN bridge, synchronous

Test: `tests/core/malformed-input.test.ts` › "the BPMN bridge's synchronous functions".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `liteFromStages` | `./bpmn` | Role lanes get the lane of a gateway's role (documented). | Returns, or plain `Error` "liteFromStages: duplicate id …" (tested, not documented). |
| `liteFromGraph` | `./bpmn` | Every node on a path from start to end; edges between the same nodes get ids apart (since this change). | Returns; a graph validation accepts stays acceptable. |
| `stageModelFromGraph` | `./bpmn` | Not documented. | Returns. |
| `liteCounts` | `./bpmn` | Not documented. | Returns. |
| `gatewayLabel` | `./bpmn` | Not documented. | Returns. |
| `bpmnNodeSize` | `./bpmn` | Not documented. | Returns. |
| `roundPositions` | `./bpmn` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `xmlId` | `./bpmn` | Unique against `taken`. | Returns. |
| `exportableEdges` | `./bpmn` | Not documented. | Returns. |
| `matchActivities` | `./bpmn` | Not documented. | Returns. |
| `applyMapping` | `./bpmn` | Not documented. | Returns. |
| `mappingIndex` | `./bpmn` | Not documented. | Returns. |
| `normalizeLabel` | `./bpmn` | Not documented. | Returns. |
| `createIdResolver` | `./bpmn` | Not documented. | Returns; a mapping under an id named like a member of `Object.prototype` throws a `TypeError` (finding, `tests/core/prototype-ids.test.ts`). |
| `createIdMap` | `./bpmn` | Takes nothing. | Returns. |
| `registerId` | `./bpmn` | Not documented. | Returns. |
| `renameToActivities` | `./bpmn` | Not documented. | Returns. |
| `tagOfType` | `./bpmn` | Not documented. | Returns. |
| `typeOfTag` | `./bpmn` | Not documented. | Returns. |

## Layout, asynchronous

Test: `tests/core/malformed-layout.test.ts` › "layout, layoutUnion, a layout scope and buildViews settle in time with positions of every node or a known error".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `layout` | `.` | `LayoutUnavailableError` above the fallback limit; "layout timed out after … ms"; a non-finite spacing or node size counts as not given, Dagre leaves edges to missing nodes out, empty ids and ids named like `Object.prototype` members are laid out, a timeout beyond a timer's reach waits that long (all since this change). | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `layoutUnion` | `.` | As `layout`. | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `createLayoutScope` | `.` | As `layout` for its layouts. | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `buildViews` | `.` | As `layout` and `resolveViews`. | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `toPNG` | `./canvas` | Not documented. | Returns. |
| `LayoutUnavailableError` | `.` | Named `LayoutUnavailableError`. | Returns. |

## BPMN bridge, asynchronous

Test: `tests/core/malformed-bpmn.test.ts` › "lays out, exports, imports and validates in time, with every problem reported and no number that is not finite".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `layoutBpmn` | `./bpmn` | Unroutable geometry raises a descriptive error; groups on a cycle of parents are laid out (since this change). | Returns, or the documented plain `Error`, or the engines' errors on a graph validation rejects (not documented). |
| `exportBpmn` | `./bpmn` | Elements without a position are listed in `warnings`; every element gets its own id and shape; non-finite boxes are left out (since this change). | Returns XML without `NaN`, `Infinity` or a repeated id. |
| `importBpmn` | `./bpmn` | Rejects only text that is not BPMN definitions, with the parser's plain `Error` (`unparsable content …`, `failed to parse document …`); everything else imports with `warnings`, including every `validateGraph` issue. | As documented. |
| `validateBpmn` | `./bpmn` | Reads nesting deeper than the call stack (since this change); otherwise not documented for text that is not BPMN. | Returns, or the parser's plain `Error` (not documented). |
| `positionsFromDi` | `./bpmn` | Shapes and routes that are not finite are left out and reported. | As documented. |
| `flowIdOf` | `./bpmn` | Not documented. | Returns. |
| `wiseAttr` | `./bpmn` | Not documented. | Returns. |
| `isType` | `./bpmn` | Not documented. | Returns. |
| `isAnyType` | `./bpmn` | Not documented. | Returns. |

## React: the map

Test: `tests/react/MalformedMap.test.tsx` › "renders every case in each renderer and as the table without an error, a broken coordinate or a broken text".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `ProcessMap` | `./react` | Given positions are used as long as they cover the graph (finite boxes since this change); `describedLimit`, `pageSize`, `edgeBudget` and thresholds are not documented for junk values. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). No coordinate that is not finite is drawn for accepted input and sound props; the Canvas map draws with finite numbers. |

## React: the view switcher

Test: `tests/react/MalformedMap.test.tsx` › "renders every case's views in the view switcher, side by side and one at a time".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `ViewSwitcher` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). A `columns` value that is not a positive whole number reaches the grid's CSS (finding). |

## React: tables, lists, chips, legends and overlay layers

Test: `tests/react/MalformedComponents.test.tsx` › "tables, path lists, filter chips, legends and overlay layers".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `TableAlternative` | `./react` | Without `pageSize` every row; with it pages of that size (not documented for zero, negative or fractional sizes). | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `PathList` | `./react` | As `pathsFor`; a focus that is not a pair is one id (since this change). | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `FilterChips` | `./react` | As `normalizeFilterPreview` and `describeClause`. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `Legend` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `OverlayLayer` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). Needs the React Flow context, as documented for custom controls. |
| `Badges` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `Chip` | `./react` | Renders nothing for an overlay without a mark of its own (since this change). | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `PatternSwatch` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |

## React: menus, controls, timelines, comparisons, hooks and descriptions

Test: `tests/react/MalformedComponents.test.tsx` › "menus, controls, timelines, comparisons, hooks and descriptions".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `ContextMenu` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). A position that is not finite gives React's style warning (finding). |
| `AbstractionControls` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). A threshold that is not a number gives React's `NaN` attribute warning (finding). |
| `TraceTimeline` | `./react` | Invalid timestamps stay in the table and are left off the time axis, with an explanation. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). Two traces with one case id give React's key warning (finding). |
| `FlowComparison` | `./react` | Invalid counts, duplicate labels or pairs and zero cohort sizes are unavailable. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). Two cohorts with one id give React's key warning (finding). |
| `useFlowGraph` | `./react` | As `abstract`. | Returns. |
| `useStableLayout` | `./react` | A failed layout gives status `"error"`; `LayoutUnavailableError` keeps the provisional positions. | Returns. |
| `useOverlays` | `./react` | As `overlaysFor`. | Returns. |
| `describeNode` | `./react` | Not documented. | Returns a readable sentence for accepted input. |
| `describeEdge` | `./react` | Not documented. | Returns a readable sentence for accepted input. |
| `describeGroup` | `./react` | Not documented. | Returns. |
| `describeMap` | `./react` | Names the thresholds only for the object `abstract` records. | Returns a readable sentence for accepted input. |
| `groupNodeId` | `./react` | Not documented. | Returns. |
| `midpoint` | `./react` | Not documented. | Returns. |

## React and Canvas: the Canvas map, the renderer and the tokens

Test: `tests/react/MalformedCanvas.test.tsx` › "draws every case on the Canvas map and drives the renderer through every method".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `CanvasMap` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). Draws with finite numbers for accepted input and a fixed budget. |
| `CanvasRenderer` | `./canvas` | Zoom clamped to `minZoom` … `maxZoom`. | Every method runs on junk sizes, viewports, zooms, points and ids. |
| `readTokens` | `./canvas` | Not documented. | Returns. |

## React and BPMN: the BPMN view

Test: `tests/react/MalformedCanvas.test.tsx` › "shows every case's graph, its export or a broken file in the BPMN view, as a diagram and as the table".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `BpmnView` | `./react, ./bpmn` | Overlays whose target names nothing in the diagram are neither drawn nor listed; a file that cannot be shown calls `onError`. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |

## Not this library's

`useReactFlow`, `useNodesInitialized` and `useStore` are React Flow's hooks,
re-exported from `@wise/flow/react` unchanged so that custom controls share
the renderer's context; they take no graph data.

## Taking nothing

`clearSelection`, `createIdMap`, `createModdle`, `tokenVariables` and
`usePrefersReducedMotion` take no parameter.

## Markup

Labels, ids, kinds, tags, metric names and overlay texts holding `<`, `>`,
`&`, quotes and script-like text are text in the SVG export, the BPMN XML,
the tooltip, the table cells, the legend, the map chips, the Canvas element
list, the live region and the descriptions: `tests/react/MarkupSafety.test.tsx`.
No source file inserts raw HTML (`innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `dangerouslySetInnerHTML`, `document.write`); the SVG
export and `svgMarkup` build markup as strings and escape every text and
value that comes with the data, and the BPMN view hands bpmn-js DOM
elements, never strings, as overlays.
