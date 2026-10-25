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
`Object.prototype` are reserved (after 0.3.5): validation reports them and the
exports refuse them with `InvalidGraphError` (`tests/core/prototype-ids.test.ts`);
the searches do not generate them.

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
| `validateGraph` | `.` | Errors: duplicate node, edge and group ids, reserved ids and cycles of group parents (both after 0.3.5), unknown edge ends, unknown group parents; warnings: unknown node groups, overlays on unknown targets. Not reported: missing, empty or unknown-kind elements, metric values. | Returns. |
| `InvalidGraphError` | `.` | Named `InvalidGraphError`, with the `issues` it is given (after 0.3.5). | Returns. |
| `validateGateways` | `.` | Warnings only; rejects nothing. | Returns. |
| `normalizeGraph` | `.` | Not documented. | Returns the elements de-duplicated by id (the first kept) and sorted. |
| `strengths` | `.` | Not documented. | Returns. |
| `collapseGroups` | `.` | Not documented. A cycle of group parents collapses nothing (validation reports it). | Returns. |
| `components` | `.` | Not documented. | Returns. |
| `isConnected` | `.` | Not documented. | Returns. |
| `abstract` | `.` | Metrics through `metric` (missing and `NaN` count as 0); otherwise not documented for invalid thresholds or metrics. | Returns; a graph validation accepts stays acceptable. |
| `diff` | `.` | Not documented. | Returns. |
| `unionGraph` | `.` | Not documented. | Returns the union by id, the first definition kept. |
| `detailStatement` | `.` | Not documented. | Returns the statement of `meta.shown`, or none without it; every text readable, also for shares and marks that are not numbers or not known. |
| `detailNotes` | `.` | Not documented. | Returns the notes of the shown elements; every text readable. |

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
| `coversGraph` | `.` | A box counts when its four numbers are finite (after 0.3.5). | Returns. |
| `straightRoute` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `repositionNodes` | `.` | Unroutable geometry: a clipped direct route; an edge without an id is routed (after 0.3.5); boxes that are not finite are left out of routing (after 0.3.5); a target no route reaches gets its fallback at once (after 0.3.5). | Returns; plain `Error` "Cannot route …" (documented). |
| `routeSequenceFlows` | `.` | Unroutable geometry raises a descriptive error; boxes that are not finite are left out; a target no route reaches is given up at once (both after 0.3.5). | Returns, or the documented plain `Error`. |
| `laneGroups` | `.` | Not documented. | Returns. |
| `laneAssignment` | `.` | Not documented. | Returns. |
| `laneModel` | `.` | Groups on a cycle of parents have no leaf; their nodes follow their neighbours (after 0.3.5). | Returns. |
| `stackLanes` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `spanLanes` | `.` | A cycle of parents ends where it returns (after 0.3.5). | Returns; numbers that are not finite pass through to the result. |
| `laneRoutes` | `.` | As `routeSequenceFlows` for `routed`. | Returns, or the documented plain `Error`. |
| `laneBands` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. Junk padding or gaps give bands that are not finite. |
| `fitViewport` | `.` | Not documented. | Returns. |
| `panelInsets` | `.` | Not documented. | Returns. |
| `openingView` | `.` | Not documented. | Returns. |
| `processStart` | `.` | Undefined without a node with a box. | Returns. |
| `partInView` | `.` | A view without a zoom shows nothing; not documented for junk numbers. | Returns counts. |
| `inViewText` | `.` | Not documented. | Returns a text. |
| `elementPoint` | `.` | Undefined for an element without a box or a route. | Returns a point or nothing. |
| `pathCourses` | `.` | Not documented. | Returns; on finite positions and a width from 0 to 100, every course through finite points. |

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
| `measureStyle` | `.` | Not documented. | Returns; with thresholds or a percentile that are not finite every path still has a colour and a finite width. |
| `patternDefs` | `.` | Not documented. | Returns. |
| `arrowheadExtent` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `patternTwin` | `.` | Not documented. | Returns. |
| `cssVariable` | `.` | Not documented. | Returns. |
| `labelUnitsAt` | `.` | A nonpositive or nonfinite zoom gives the supplied target; the target is clamped to 11–14 for the inverse-zoom part. | As documented; a target that is not finite passes through. |
| `smallLabelUnitsAt` | `.` | A nonpositive or nonfinite zoom gives 11. | As documented. |
| `mapScaleAt` | `.` | Not documented. | Returns a finite number. |
| `labelScreenPx` | `.` | Multiplies; does not clamp or round. | Returns; numbers that are not finite pass through to the result. |
| `formatCount` | `.` | A value that is not a finite number prints `–`. | As documented. |
| `formatNumber` | `.` | As `formatCount`; `decimals` is taken between 0 and 100 (after 0.3.5). | As documented. |
| `formatShare` | `.` | As `formatCount`. | As documented. |
| `formatDelta` | `.` | As `formatCount`. | As documented. |
| `formatHours` | `.` | As `formatCount`. | As documented. |
| `formatDays` | `.` | As `formatCount`. | As documented. |
| `formatCompact` | `.` | As `formatCount`. | As documented. |
| `t` | `.` | Falls back to English; placeholders are filled from `vars`. | Returns. |
| `metricLabel` | `.` | Not documented. | Returns the name itself for an unknown metric. |
| `orderedCategorical` | `.` | Not documented; a key that is not a string has no entry (its comment, after 0.3.5). | Returns. |
| `themePalette` | `.` | Not documented. | Returns, for a palette it does not know too. |
| `resolveTheme` | `.` | A setting over CSS variables over a preset; not documented for values of the wrong kind. | Returns a theme for an unknown preset, junk values and junk variables. |
| `themeColors` | `.` | Not documented. | Returns, for an unknown scheme too. |
| `checkTheme` | `.` | Reports what a theme sets out of range as data. | Returns. |
| `readableAt` | `.` | A floor that is not a positive number keeps every text; not documented for rules of junk numbers. | Returns a state: a boost of at least 1, at a level the rules allow or none. |
| `readableZoom` | `.` | 0 without a floor or a card, Infinity for a level that fits no rung; not documented for rules of junk numbers. | Returns a number. |
| `formatPathCount` | `.` | A value that is not a finite number prints as `–`. | Returns a readable text. |
| `metricEntry` | `.` | None for a metric the registry does not hold. | Returns. |
| `metricKind` | `.` | From the name for a metric the registry does not hold. | Returns. |
| `metricName` | `.` | The name itself for a metric the registry does not hold. | Returns a readable text. |
| `metricUnit` | `.` | Not documented. | Returns. |
| `metricBasis` | `.` | Not documented. | Returns. |
| `formatMetricValue` | `.` | A missing value is `–`. | Returns a readable text, for an unknown basis too. |
| `elementMetric` | `.` | A missing value is `–`. | Returns a readable text. |
| `metricLabelOf` | `.` | Not documented. | Returns. |
| `metricMeanNote` | `.` | Not documented. | Returns. |
| `channelTitle` | `.` | Not documented. | Returns. |
| `wrapText` | `.` | At least the font's size wide; not documented for sizes that are not numbers. | Returns, within the time bound for a word of thousands of characters. |

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
| `arcWidth` | `.` | The theme's arc stroke, whatever the coverage, also one that is not a finite number (after 0.3.5). | As documented. |
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
| `buildScene` | `.` | Overlays on unknown targets are dropped; boxes and routes that are not finite are left out as if missing (after 0.3.5). | Returns; every drawn element has a finite box, every text is readable. |
| `budgetEdges` | `.` | `NaN`, `"all"`, undefined or null withhold nothing. | Returns. |
| `pathsAtZoom` | `.` | A rule that is not a positive number, or a zoom that is not, withholds nothing. | Returns. |
| `nodeMarks` | `.` | One mark per node with a box. | Returns. |
| `edgeMarks` | `.` | One mark per edge between two placed nodes. | Returns. |
| `nodeMark` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `edgeMark` | `.` | Not documented. | Returns; numbers that are not finite pass through to the result. |
| `edgeColor` | `.` | Not documented. | Returns. |
| `edgePoints` | `.` | Undefined where an end has no box. | Returns. |
| `routeMidpoint` | `.` | Not documented. | Returns. |
| `edgeLabelPoint` | `.` | Not documented. | Returns. |
| `gatewayGlyph` | `.` | × unless tagged `and` or `or`. | Returns. |
| `eventGlyph` | `.` | ▶ for an event tagged `start`, ■ for `end`, none otherwise (0.4). | Returns one of the three. |
| `terminalOf` | `.` | `start`, `end` or none; an end the lookup does not find is no event (0.4). | Returns one of the three. |
| `paintOrder` | `.` | Every index once, widest first; widths that are not numbers sort as they compare (0.4). | Returns a permutation of the indices. |
| `placeEdgeLabels` | `.` | Marks with routes or texts that are not finite keep their labels; a box that is not finite covers nothing (0.5). | Returns one mark per mark. |
| `roundedRoute` | `.` | A radius that is not a positive number rounds nothing to a curve of zero length (0.5). | Returns. |
| `segmentsPath` | `.` | Not documented. | Returns. |
| `pathLabelShown` | `.` | A width or zoom that is not a number shows no label by width, and compares as JavaScript does by zoom (0.4). | Returns a boolean. |
| `touchesSelection` | `.` | Not documented. | Returns. |
| `emphasisLabel` | `.` | The mark's own label where the selected activity has no cases or the path no count (0.4). | Returns a readable label or nothing. |
| `createStrings` | `.` | A host value that is not a string, and a key the table does not know, are left out (0.4). | Returns a function that returns a string for every key. |
| `nodeCount` | `.` | Not documented. | Returns a readable count or nothing. |
| `truncateText` | `.` | Not documented. | Returns. |
| `restOf` | `.` | Not documented. | Returns. |
| `distinctLines` | `.` | Names that are the same stay the same; not documented for junk rooms, fonts or line counts. | Returns a list of lines per name, within the time bound. |
| `fitText` | `.` | Not documented. | Returns. |
| `estimateTextWidth` | `.` | Not documented. | Returns. |
| `sceneLegend` | `.` | Not documented. | Returns. |
| `legendItemHeight` | `.` | Not documented. | Returns. |
| `legendLayout` | `.` | Not documented. | Returns. |
| `figureFrame` | `.` | Not documented. | Finite for sound options; a width, padding or scale out of range (10³⁰⁸, a padding of 10⁻³²⁰ on an empty map) gives sizes that are not finite. |
| `toSVG` | `.` | Every text and id is escaped (after 0.3.5 for kinds); deterministic; `InvalidGraphError` on a reserved id (after 0.3.5). | Returns well-formed SVG; no `NaN` or `Infinity` for accepted input and sound options. |
| `resolveViews` | `.` | Not documented. | Returns. |
| `viewsSharePositions` | `.` | Not documented. | Returns. |
| `stateStyle` | `.` | Not documented. | Returns, for every part and state. |
| `markInState` | `.` | Not documented. | Returns. |
| `ruleTextRole` | `.` | Not documented; an unknown role is the label. | Returns. |
| `pathArrowhead` | `.` | Not documented; a width whose head is not a finite number ends in the rule's head (its comment, after 0.3.5). | Returns a head of a finite size. |
| `lineEnd` | `.` | Not documented. | Returns. |
| `groupMark` | `.` | Not documented. | Returns. |
| `groupMarks` | `.` | Not documented. | Returns; every group drawn has a finite box. |
| `legendOfScene` | `.` | Not documented. | Returns. |
| `figureCaption` | `.` | None where nothing is known; not documented for junk `meta`. | Returns none or a readable text. |

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
| `focusHighlight` | `.` | A focus that is not a pair is one id, also a missing one (after 0.3.5). | Returns. |
| `asFilter` | `.` | `undefined` and `null` give the empty filter. | Returns. |
| `normalizeFilterPreview` | `.` | Numbers only where finite; marginal removals only from a list, entries with a numeric clause (after 0.3.5). | Returns. |
| `canonicalClause` | `.` | A clause of an unknown kind stays as it is; an `any` without clauses is empty (after 0.3.5). | Returns. |
| `clauseKey` | `.` | As `canonicalClause`. | Returns. |
| `canonicalFilter` | `.` | As `canonicalClause`. | Returns. |
| `filterEquals` | `.` | As `canonicalClause`. | Returns. |
| `addClause` | `.` | As `canonicalClause`. | Returns. |
| `removeClause` | `.` | Not documented. | Returns; an index out of range removes nothing. |
| `changesCases` | `.` | An `any` without clauses changes none (after 0.3.5). | Returns. |
| `describeClause` | `.` | An unknown kind reads "clause.unknown"; an `any` without clauses is empty (after 0.3.5). | Returns. |
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
| `toPNGCanvas` | `./canvas` | As `toSVG` for the scene, `InvalidGraphError` included. | Draws with finite numbers for accepted input and a scale in (0, 16]; a scale of 10³⁰⁸ gives a canvas of infinite size. |
| `toPNGDataUrl` | `./canvas` | `InvalidGraphError` on a reserved id (after 0.3.5); otherwise not documented. | Returns. |
| `canvasTextMeasure` | `./canvas` | The estimate without a context. | Returns a measure; measuring returns. |

## BPMN bridge, synchronous

Test: `tests/core/malformed-input.test.ts` › "the BPMN bridge's synchronous functions".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `liteFromStages` | `./bpmn` | Role lanes get the lane of a gateway's role (documented). | Returns, or plain `Error` "liteFromStages: duplicate id …" (tested, not documented). |
| `liteFromGraph` | `./bpmn` | Every node on a path from start to end; edges between the same nodes other than constraints are one flow with summed counts and cases (after 0.3.5). | Returns; a graph validation accepts stays acceptable. |
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
| `createIdResolver` | `./bpmn` | Not documented. | Returns; a mapping under a reserved id (named like a member of `Object.prototype`, which validation reports) throws a `TypeError` (`tests/core/prototype-ids.test.ts`). |
| `createIdMap` | `./bpmn` | Takes nothing. | Returns. |
| `registerId` | `./bpmn` | Not documented. | Returns. |
| `renameToActivities` | `./bpmn` | Not documented. | Returns. |
| `tagOfType` | `./bpmn` | Not documented. | Returns. |
| `typeOfTag` | `./bpmn` | Not documented. | Returns. |

## Layout, asynchronous

Test: `tests/core/malformed-layout.test.ts` › "layout, layoutUnion, a layout scope and buildViews settle in time with positions of every node or a known error".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `layout` | `.` | `LayoutUnavailableError` above the fallback limit; "layout timed out after … ms"; a non-finite spacing or node size counts as not given, Dagre leaves edges to missing nodes out, empty ids and ids named like `Object.prototype` members are laid out, a timeout beyond a timer's reach waits that long (all after 0.3.5). | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `layoutUnion` | `.` | As `layout`. | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `createLayoutScope` | `.` | As `layout` for its layouts. | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `buildViews` | `.` | As `layout` and `resolveViews`. | Returns, or a plain error: `LayoutUnavailableError` and "layout timed out after … ms" (documented); the engines' own errors on a graph validation rejects (ELK on edges to missing nodes and missing ids, Dagre on cycles of group parents; not documented). |
| `toPNG` | `./canvas` | Rejects with `InvalidGraphError` on a reserved id (after 0.3.5); otherwise not documented. | Returns. |
| `LayoutUnavailableError` | `.` | Named `LayoutUnavailableError`. | Returns. |

## BPMN bridge, asynchronous

Test: `tests/core/malformed-bpmn.test.ts` › "lays out, exports, imports and validates in time, with every problem reported and no number that is not finite".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `layoutBpmn` | `./bpmn` | Unroutable geometry raises a descriptive error; groups on a cycle of parents are laid out with lane bands or `ignore` (after 0.3.5); with `compound` the engine rejects them (finding 4). | Returns, or the documented plain `Error`, or the engines' errors on a graph validation rejects (not documented). |
| `exportBpmn` | `./bpmn` | Elements without a position are listed in `warnings`; every element gets its own id and shape; non-finite boxes are left out; rejects with `InvalidGraphError` on a reserved id (all after 0.3.5); characters XML 1.0 does not allow are dropped from the text with a warning, tab and carriage return are written as references (after 0.3.5). | Returns XML without `NaN`, `Infinity`, a repeated id or a character XML 1.0 does not allow (`tests/core/bpmn-xml-text.test.ts`, read by a second parser). |
| `importBpmn` | `./bpmn` | Rejects only text that is not BPMN definitions, with the parser's plain `Error` (`unparsable content …`, `failed to parse document …`); everything else imports with `warnings`, including every `validateGraph` issue. | As documented. |
| `validateBpmn` | `./bpmn` | Reads nesting deeper than the call stack (after 0.3.5); otherwise not documented for text that is not BPMN. | Returns, or the parser's plain `Error` (not documented). |
| `positionsFromDi` | `./bpmn` | Shapes and routes that are not finite are left out and reported. | As documented. |
| `flowIdOf` | `./bpmn` | Not documented. | Returns. |
| `wiseAttr` | `./bpmn` | Not documented. | Returns. |
| `isType` | `./bpmn` | Not documented. | Returns. |
| `isAnyType` | `./bpmn` | Not documented. | Returns. |

## React: the map

Test: `tests/react/MalformedMap.test.tsx` › "renders every case in each renderer and as the table without an error, a broken coordinate or a broken text".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `ProcessMap` | `./react` | Given positions are used as long as they cover the graph (finite boxes after 0.3.5); a `describedLimit` below one is one (after 0.3.5); `pageSize`, `edgeBudget`, thresholds and a `describedLimit` that is not a number are not documented for junk values. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). No coordinate that is not finite is drawn for accepted input and sound props; the Canvas map draws with finite numbers. |

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
| `PathList` | `./react` | As `pathsFor`; a focus that is not a pair is one id (after 0.3.5). | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `FilterChips` | `./react` | As `normalizeFilterPreview` and `describeClause`. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `Legend` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `OverlayLayer` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). Needs the React Flow context, as documented for custom controls. |
| `Badges` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `Chip` | `./react` | Renders nothing for an overlay without a mark of its own (after 0.3.5). | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |
| `PatternSwatch` | `./react` | Not documented. | Renders; nothing logged but React's key warnings for ids missing or repeated (findings). |

## React: menus, controls, timelines, comparisons, hooks and descriptions

Test: `tests/react/MalformedComponents.test.tsx` › "menus, controls, timelines, comparisons, hooks and descriptions".

| Function | Entry | Documented for invalid input | Observed |
| --- | --- | --- | --- |
| `insetBoxes` | `./react` | An inset that is not a positive number is no strip (0.4). | Returns. |
| `cornerBox` | `./react` | Not documented. | Returns. |
| `panelBoxes` | `./react` | The boxes of the panels inside the element, none outside a map (0.4). | Returns. |
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
| `ZoomControl` | `./react` | Not documented. | Renders; every text readable, also for a zoom that is not a number. |
| `useFlowTheme` | `./react` | Not documented. | Renders, for an unknown preset, junk values and junk CSS variables. |

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
re-exported from `wise-flow/react` unchanged so that custom controls share
the renderer's context; they take no graph data.

## Taking nothing

`clearSelection`, `createIdMap`, `createModdle`, `tokenVariables` and
`usePrefersReducedMotion` take no parameter.

## Markup

Labels, ids, kinds, tags, metric names and overlay texts holding `<`, `>`,
`&`, quotes and script-like text are text in the SVG export, the BPMN XML,
the tooltip, the table cells, the legend, the map chips, the Canvas element
list, the live region and the descriptions: `tests/react/MarkupSafety.test.tsx`.

No source file inserts raw HTML: a search of `src/` for `innerHTML`,
`outerHTML`, `insertAdjacentHTML`, `dangerouslySetInnerHTML`,
`document.write`, `createContextualFragment`, `DOMParser`, `srcdoc`,
`href`, `eval` and `new Function` finds nothing. What comes closest, judged
one by one:

| Where | What | Judgement |
| --- | --- | --- |
| `src/core/export.ts` (`toSVG`), `src/core/overlay-marks.ts` (`svgMarkup`) | Build SVG as a string. | Safe: every text and attribute value that comes with the data is escaped (`&`, `<`, `>`, `"`); the node kind in `class` after 0.3.5. Attribute names are the library's own. |
| `src/react/marks.tsx` (`svgDom`) | Builds the overlay marks of the BPMN view as DOM: `createElementNS`, `setAttribute`, `style.setProperty`, text nodes. | Safe: no markup is parsed; attribute names are the library's own, data reaches only values and text nodes. |
| `src/bpmn/bpmn-js.ts`, `src/react/BpmnView.tsx` | Hand bpmn-js overlays (`overlays.add`) and markers (`canvas.addMarker`). | Safe: overlays are DOM elements, never strings (`ViewerOverlay.html: HTMLElement`); a marker is a class name of the library's own (`wf-bpmn--…`). |
| `src/bpmn/export.ts` (`exportBpmn`) | Writes XML through bpmn-moddle. | Safe: moddle escapes text and attribute values; the XML is read back in the markup test. |
| `src/canvas/` | Draws text with `fillText`. | Safe: a canvas draws text as pixels. |

## Findings

Where the documentation is silent about invalid input, or says something the
searching tests contradict. Each is a proposal for the owner; none of them
changes the public behaviour here.

1. **Unknown kinds.** `validateGraph` does not report a node, edge, group or
   overlay kind outside `NodeKind`, `EdgeKind`, `GroupKind` and
   `OverlayKind`; the documentation does not say what such an element does.
   Today an unknown node kind gets the activity's size and box (without the
   activity labels) in the scene, the SVG export and the Canvas map, and
   reaches React Flow as a node type it does not have, which React Flow
   draws as its default node; an unknown edge kind is drawn as an ordinary
   edge; an unknown overlay kind has no mark.
   *Proposal:* a `validateGraph` warning `unknown kind` per element, and one
   sentence in the API document: an unknown node kind is drawn as an
   activity, an unknown edge kind as `follows`, an unknown group kind as a
   `stage` without lane, an unknown overlay kind not at all.
2. **Metric values.** Missing, negative, not finite and string-typed metric
   values pass validation (pinned in `tests/core/generators.test.ts`).
   `metric` documents the fallback for a value that is not a finite number;
   nothing says what a negative count or share means for widths, shares,
   `abstract` and the tables. *Proposal:* a `validateGraph` warning
   `metric not a finite number` (strings included) and `negative metric`,
   and a sentence that every reader of metrics goes through `metric` and
   reads a negative count or share as 0.
3. **Missing and empty ids.** `validateGraph` does not report an element
   without an id or with the empty id. Both are now drawn, laid out and
   exported, but React logs key warnings for a missing id, and two such
   elements are the same element to every table keyed by id. *Proposal:* a
   missing or non-string id is an error (`missing id`), the empty id a
   warning.
4. **Layout of a graph validation rejects.** `layout`, `layoutUnion`,
   `createLayoutScope`, `buildViews` and `layoutBpmn` document
   `LayoutUnavailableError`, timeouts and aborts; on a graph `validateGraph`
   rejects they may also reject with the engine's own plain error (ELK on
   edges to missing nodes and on missing ids, Dagre on cycles of group
   parents). *Proposal:* document that a graph validation rejects may make
   the layout reject with the engine's error, and that a host validates
   first. (A typed `InvalidGraphError` would be a new public name: an option
   for the owner, not proposed here.)
5. **React keys.** Every component that lists elements logs React's key
   warning for two elements with one id (which validation reports) or an
   element without an id (finding 3), also `BpmnView` for a file that names
   one flow id on two elements (`importBpmn` warns `duplicate node id`; found
   by the deep run, seed 4987); so do `TraceTimeline` for two traces with one
   case id and `FlowComparison` for two cohorts with one id, which are not
   documented as invalid. Rendering is otherwise intact.
   *Proposal:* document that ids, case ids and cohort ids are unique and that
   a graph validation rejects is drawn as far as it goes; key repeated ids
   apart (id and position) only if the owner wants the warnings gone.
6. **A host's numbers that are not sound.** Not documented, observed in the
   searches: `ViewSwitcher` passes a `columns` that is not a positive whole
   number to the grid's CSS; `ContextMenu` at a position that is not finite
   gives React's style warning; `AbstractionControls` with a threshold that
   is not a number gives React's `NaN` attribute warning; `TableAlternative`
   and `<ProcessMap/>` say nothing about a `pageSize`, `describedLimit`,
   `canvasThreshold` or `edgeBudget` that is zero, negative or fractional;
   `abstract` says nothing about thresholds outside [0, 1].
   *Proposal:* one rule in the API document — a count is read as a whole
   number at least 1 (`columns`, `pageSize`) or 0 (`describedLimit`,
   `edgeBudget`), a share is clamped to [0, 1], anything not finite is the
   default — and the three components follow it.
7. **Options that overflow.** `overlayGeometry` promises that shapes never
   extend beyond `overlayMargin()`, `figureFrame` and `toPNGCanvas` say
   nothing about their range; with an arc height, width, padding or scale
   near 10³⁰⁸ (or a padding of 10⁻³²⁰ on an empty map) they return sizes that
   are not finite, and `toPNGCanvas` asks for a canvas of infinite size.
   `buildScales` does the same for a domain or range that is not finite, and
   `laneBands` for junk padding or gaps. *Proposal:* document the ranges
   (`scale` in (0, 16], sizes below 10⁶) and read a value outside as the
   default, as `layout` now does for spacing and node size.
8. **Geometry helpers pass numbers that are not finite through.**
   `unionBoxes`, `positionsBounds`, `createPositions`, `filterPositions`,
   `straightRoute`, `stackLanes`, `spanLanes`, `nodeMark`, `edgeMark`,
   `markArrowhead`, `arrowheadExtent`, `overlayMargin`, `labelScreenPx`,
   `labelUnitsAt` (for its target) and `roundPositions` return `NaN` or an
   infinity where their input had one. `unionBoxes` contradicts its own
   sentence in part: it ignores a box without a non-negative size, but not
   one whose `x` or `y` is not finite. Scenes and exports no longer let such
   numbers through (after 0.3.5). *Proposal:* document "finite in,
   finite out" for these helpers, and have `unionBoxes` ignore a box whose
   four numbers are not finite, as `coversGraph` does.
9. **Errors that are tested but not documented.** `liteFromStages` throws a
   plain `Error` "liteFromStages: duplicate id …"; `validateBpmn` rejects
   text that is not BPMN with the parser's plain `Error`, as `importBpmn`
   does. *Proposal:* document both, in the words used for `importBpmn`.
10. **Statistics and payloads.** `constraintOverlays` and `overlaysFor`
    document "not applicable" without evaluated cases, but not junk
    statistics (negative, not finite or string counts) or unknown constraint
    types; they return overlays with neutral colours today.
    *Proposal:* document that such statistics count as not evaluated.
11. **The many pure functions marked "Not documented"** in the tables above
    all return for every case. *Proposal:* one sentence at the top of the API
    document: every function takes any value of its declared types, throws
    only the errors its section names, and treats a missing or non-finite
    number as missing.

## Open decisions

**Ids named like members of `Object.prototype`** (`__proto__`,
`constructor`, `toString`, …; `tests/core/prototype-ids.test.ts`), decided
after 0.3.5 as option A of this list: `validateGraph` reports such an id of a
node, an edge or a group as an error (`reserved id`), the API document says
ids must not name a member of `Object.prototype`, and the exports (`toSVG`,
`toPNGCanvas`, `toPNGDataUrl`, `toPNG`, `exportBpmn`) refuse a graph with one
with `InvalidGraphError` instead of failing with a `TypeError`. Other
functions do not check; `createIdResolver` still throws a `TypeError` for an
activity mapped under such an id. The other options were prototype-free
records or `Map`s everywhere (B) and leaving it documented as unsupported (C).

**React's key warnings** (finding 5) and **the host's unsound numbers**
(finding 6) change what a host sees in the console and the DOM; they wait for
the owner with the proposals above.
