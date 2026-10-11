---
"@wise/flow": minor
---

The legend is a key and the numbers say what they are.

- **Metric registry** (new, `@wise/flow`): `metricRegistry`, `metricEntry`,
  `metricKind`, `metricName`, `metricUnit`, `metricBasis`,
  `formatMetricValue`, `elementMetric`, `metricLabelOf`, `metricMeanNote`,
  `channelTitle`, and the types `MetricEntry`, `MetricKind`, `MetricBasis`,
  `MetricFormatOptions`: each metric's name, unit and number format in English
  and German.
- **Legend.** It names the measure with its unit and what the shares are of
  (a new first row, `{ kind: "measure" }`: "Shortfall · cases · share of
  251,734 cases"), titles every scale "channel: metric (unit)" ("Path width:
  cases (count)"), shows three width samples with their values, one per line,
  and has one key per kind of mark drawn: one per badge glyph, the start and
  the end of the process, paths not evaluated (`notEvaluated`) and elements
  not directly observed (re-added; the key was "Re-added path"). Stages are
  listed by their labels in stage order. `LegendKeyKind` gains
  `"notEvaluated"`, `"start"` and `"end"`; `LegendRow` gains `"measure"`;
  `LegendLayout.rows` gains `lines` (the wrapped title), and a key's `texts`
  are its wrapped lines (it was one shortened line); `LegendSource` takes the
  optional `graph`, `scales.pathMetric`, `nodeMarks[].node` and
  `edgeMarks[].notEvaluated`; `legendMetrics` gains `measureEnd`. A code that
  switches over the row kinds must handle `"measure"`.
- **Paths count cases**, as activities do: `defaultStyle` and `diffStyle` read
  `cases` for the width, and `defaultStyle` for the colour on the neutral
  ramp (they read `count`), paths are labelled with their
  cases, and the edge budget ranks by them. A graph whose paths give only
  transitions is read by `count`, and the legend says so. `Scales.pathMetric`
  and `Scales.notEvaluated` are new. A follows edge without that value is
  drawn in the line colour at the thinnest width, labelled "–", and the
  legend lists "not evaluated" (`EdgeMark.notEvaluated`).
- **Numbers.** Activities, lists and tooltips are grouped in full ("1,000",
  where the map wrote "1.0k"); paths in full up to 99,999, then "113k",
  "1.2M" (`formatPathCount`, new); a share that is not zero never reads
  "0 %" ("<0.1 %"); minutes round into hours at 60, hours into days at 48 and days into whole days at 10 (never "10.0 d").
- **Stage colours** follow stage order: `StyleSpec.stages` (new) holds the
  host's full stage list; without it the order `abstract` records of the
  unfiltered graph (`meta.model.groups`), then the graph's. Each stage takes
  its hashed colour or the next free one, so no two stages share a swatch
  until the palette is used up, and patterns tell them apart after that
  (`orderedCategorical`, new; `CategoricalEntry.label`). Filtering keeps the
  colours. In the committed fixture Purchase order, Invoice and Payment take
  other colours (Purchase order shared Requisition's grey).
- **Collapsed stages are honest.** `collapseGroups` keeps its values and marks
  in `metricBasis` (new on `FlowNode` and `FlowEdge`) the maximum of cases
  and share as `atLeast` and averaged metrics as `mean`, for a stage and for
  merged parallel paths of more than one element. The card, the description
  and tooltip, `<TableAlternative/>`, `<PathList/>` and both exports print
  "at least 211,379" ("mindestens"), and name an averaged median "lag, mean
  of medians", never a median. Summed counts and a host's own stage numbers
  print as exact. `pathsFor` derives no share from a lower bound.
- **Caption.** `toSVG` and `toPNG` write a caption line under the figure from
  the graph's `meta`: label, cases, period, filters and how much of the model
  is shown ("16 of 42 activities, 35 of 656 paths shown"; a collapsed
  stage's activities count as shown, and the paths of a map with merged
  stages are left out); a part without data is left out. `figureCaption` (new), `ExportOptions.caption`,
  `PngOptions.caption`, `FigureFrameOptions.caption`, `FigureFrame.caption`.
  `abstract` records `meta.model` (`ModelOutline`, new): the activities,
  paths and group order of the graph before abstraction.
