---
"@wise/flow": minor
---

Path width has one scale per graph.

- **One width scale per graph.** A path's width depends on its value alone: a
  square-root scale from 0 to the strongest path of the graph the map is
  given, before any abstraction, onto 0 to 8, and a path whose width rounds
  under the thinnest line (1) is drawn at it. Moving the sliders, focusing or
  collapsing stages no longer changes the width of a path that stays (up to
  0.3 the scale ran from the weakest to the strongest path shown). `abstract`
  records the upper end in the new `ModelOutline.pathMax` (the largest value
  of each metric over the paths of the graph before it).
- **A shared scale.** The new `ChannelSpec.max` gives the width's upper end, so
  that several maps draw equal values at equal widths. `resolveViews` shares
  the width of its views through it (it shared the width's `domain`, the
  extent of the values); a `domain` keeps its former reading, the range
  stretched over its values.
- **Legend.** The width row names the scale ("Path width: cases (count) ·
  scale of the whole graph", or "scale shared by the maps") and shows the same
  three samples at every setting: the thinnest line with the counts it stands
  for ("≤ 3,044 (thinnest)"), a count near the middle width and the
  strongest path. The width `LegendItem` gains `scale` and its samples
  `floor`.
