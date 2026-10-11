---
"@wise/flow": minor
---

Path width has one scale per graph, every path shows its direction, and chips keep clear of stage names.

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
- **Every path shows its direction.** A path ends in a head that grows with
  its line: 4 times the path's width where that is more than the rule's 12
  (`Arrowhead.perWidth`), so it is at least 1.8 times as wide as the line at
  every width; the line ends inside the head and the tip lies on the route's
  end (`arrowheadTokens.edge.overhang` 3.75, was 0). New: `EdgeMark.arrow`,
  `pathArrowhead`, `lineEnd`. The SVG export defines `wf-arrow-<size>` for each
  larger head; the React Flow map defines its heads with the export's
  `arrowMarker` (`wf-edge-arrow-<size>`) instead of React Flow's
  `MarkerType.ArrowClosed`.
- **Paths back and paths both ways.** A path against the reading direction
  runs as its own line below the flow it returns over and enters its target
  from below (`EdgeMark.backward`); a layout drew it as a frame around the
  groups between its ends. Two paths in opposite directions between the same
  activities run side by side, each with its head and its label. The new
  `pathCourses` (with `PathCourses`, `CourseLabel`) gives these courses;
  `buildScene` puts them into the scene's positions, so a map's and an
  export's bounds include them. `edgeMark` takes `label` and `backward`,
  `edgeMarks` the courses; a path's label can be anchored at its start or end.
- **Chips clear of stage names.** A chip of a measure that belongs to a stage
  stays in the stage's title row where it covers nothing there; otherwise it
  goes above or below the stage, where it covers no activity, title, badge,
  self-loop or other chip and crosses the fewest paths, else where it covers
  fewest (it was stacked downwards from the stage's top-right corner, over
  its name and its activities).
