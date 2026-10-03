---
"@wise/flow": minor
---

The legend and the figure frame are described once. The scene carries the
legend (`FlowScene.legend`, `SceneLegend`, `sceneLegend`): the scales in
use, a key for each overlay kind present and re-added paths, and the
map-level chips. `legendLayout` places its rows from their heights
(`legendMetrics`, `legendItemHeight`) and `figureFrame` measures an exported
figure (`figureMetrics`, `FigureFrame`, `FigureFrameOptions`); `toSVG`,
`toPNG`, the Canvas `drawLegend` and `<Legend/>` draw from them.
`FigurePreset` and `FIGURE_WIDTHS` moved to the new module and are exported
as before. `LegendItem.title` is typed as a `StringKey` (it was `string`).
`<Legend/>` takes the scene's legend as `legend`; without it the rows still
follow from `scales` and `overlays`. `drawLegend` takes an optional last
argument with `createCanvas` for its pattern tiles.

Visible changes:

- SVG: the legend lists only the overlay kinds the scene shows, then
  re-added paths, as the map's legend does (it listed all six keys).
- SVG: the legend's rows are 188 wide, as in PNG (they were 204): the
  second path-width sample and the right end of the colour gradient sit
  16 further left, and long key and chip rows are cut a few characters
  earlier.
- SVG and PNG: reverse-order arcs are keyed "⌒┄", as on the map (it was
  "⌒ ┄").
- SVG: a figure whose legend is taller than its map is as tall as the
  legend it now draws, which is shorter when kinds are absent.
- PNG: the figure's height follows the legend's drawn height instead of an
  estimate that assumed every key and taller rows; a figure whose legend is
  taller than its map is shorter, with the activity key directly under the
  legend.
- PNG: the categories in the legend show their pattern twins, as in SVG and
  on the map.
- PNG: a figure of an empty graph is no longer one unit wider and taller
  than its padding.
- SVG and PNG: an empty graph exported without padding and legend
  measures 0 × 0 (the SVG's height was `NaN`); the PNG's canvas stays
  1 × 1 pixel.
