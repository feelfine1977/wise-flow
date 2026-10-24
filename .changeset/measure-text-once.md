---
"wise-flow": minor
---

Text is measured once, when the scene is built, and the legend is described
once, as rows of what the scene draws.

`buildScene`, `toSVG`, `toPNG` and `prepareScene` take a `textMeasure`
(`TextMeasure`), and `FlowScene.textMeasure` names the one they used. Node
labels and chip texts are shortened to their width by it, activity names and
their case counts wrapped by it, chips sized by it, and the legend's texts, the
figure's note and its activity key measured by it; the marks carry the texts
as drawn, and the interactive map, the Canvas map and both exports write them
as they are, so with one measure they show the same lines and the same
truncation. The default, `estimateTextWidth`, is 0.55 em per character as
before, and now a full em for characters of the East Asian wide scripts and
emoji. `canvasTextMeasure` (`wise-flow/canvas`) measures with a Canvas
context's `measureText`. New: `wrapText`; `activityNodeSize`,
`activityLabelLines`, `activityKeyLines`, `wrapActivityText`, `overlayMarks`,
`nodeMark` and `nodeMarks` take an optional measure.

`<ProcessMap/>` takes `textMeasure`; without it the map measures with the
browser's font (`canvasTextMeasure` in the theme's font, created again once
the page's fonts have loaded, the estimate without a 2D canvas), and sizes
activity boxes by the same measure. Its stylesheet no longer adds an ellipsis
to node labels: they arrive shortened. The live Canvas map writes the
scene's texts instead of measuring them with its context.

Changed results with the default estimate:

- Activity names wrap at 0.55 em per character where they wrapped at 0.7 em,
  so a name takes as many lines as the other texts' measure finds; activity
  boxes sized by `activityNodeSize` can be one line lower.
- A chip's text and its box are measured by the estimate (its label in bold)
  where they took 6.2 px per character.
- The label of an activity or stage leaves the room the interactive map gives
  it: inside a solid outline, and before the count it writes on the same line.
  In exports by the estimate long labels are cut up to four characters
  earlier.

The legend is an ordered list of typed rows, `SceneLegend.rows` (`LegendRow`:
path width with its samples, a colour ramp with its values, activity colours
as swatches with their pattern twins, one key per kind of mark drawn, the
map-level chips), with its heading as `SceneLegend.title`. The scene builds it
with the new `legendOfScene` (`LegendSource`) from what it draws: a kind of
mark the scene does not draw has no key (re-added paths too, which were
always listed), a kind it draws has one, and the path scales are listed where
paths are drawn. `<Legend/>`, the SVG export, the Canvas `drawLegend` and the
PNG export render these rows; `LegendLayout.rows` gives each row's top and
the texts an export writes, shortened by the scene's measure
(`legendLayout(legend, { measure, width, text })`). `sceneLegend` takes an
optional locale and keeps listing the overlay kinds given and re-added paths;
`LegendProps.scales` is optional. `<ViewSwitcher/>`'s grid shows, per
distinct style, the legend of what the maps of that style's views draw, so
follows self-loops now have their key there.

Deprecated: `fitChars` (the mark texts arrive fitted; use `truncateText`) and
`PreparedScene.labelCache` (nothing fills it); `chipLayout.char` is read by
nothing.
