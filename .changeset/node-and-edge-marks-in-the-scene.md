---
"@wise/flow": minor
---

The scene now carries what every node and edge looks like
(`FlowScene.nodeMarks`, `FlowScene.edgeMarks`, `NodeMark`, `EdgeMark`):
outline, fill, border and dash, colour band, the label or glyph, the count
and the activity lines of a node with the level of detail each is drawn
from, and the route, colour, dash and count label of an edge. `toSVG`, the
Canvas renderer, `toPNG` and the React Flow map draw these marks. The rules
behind them exist once and are exported: `truncateText` with an injectable
`TextMeasure` (`estimateTextWidth`, `fitText`), `edgePoints`,
`routeMidpoint`, `edgeLabelPoint`, `edgeColor`, `gatewayGlyph`, `nodeCount`,
`nodeMark`, `edgeMark`, `nodeMarks`, `edgeMarks`. `MarkPaint` gains
`inkMuted` and `surface`, `MarkText.anchor` gains `end`, `fixedColors`
gains `inkMuted` and `surface`, `SceneNode`, `SceneEdge`,
`ActivityNodeData` and `FollowsEdgeData` gain `mark`.

Visible changes:

- SVG: a gateway shows its glyph (×, + or ○, 14 px bold) instead of its
  label, as on the map.
- SVG: a note is drawn as a note: on the surface colour with a dotted
  border, without a colour band and without the case count it had, its label
  at 11 px and at every zoom.
- SVG: an event's label sits inside its circle at 9 px, as on the map (it
  was below the circle at 10 px).
- SVG: a stage shows its members before its cases ("4 · 1.5k") and its
  label in semibold.
- SVG: flow and constraint edges with a count carry it, as on the map;
  edge counts sit 4 above the middle of the route's length (they sat above
  the middle of the middle segment, or at a given label point).
- SVG: node labels start 16 from the left on the Canvas baseline (2 px
  further in, 0.4 px higher); counts are in the muted ink `#5b6270` (they
  were `#8c8c8c`); a re-added event or gateway is dashed.
- SVG: labels, chip texts and legend rows are shortened by the same rule
  as in Canvas, with an estimate of 0.55 em per character: an activity
  label in a 180 wide node keeps 22 characters before the ellipsis (it kept
  24); legend rows and long chip texts keep a few more.
- Canvas and PNG: activity labels are cut to the node's width less its
  padding and no longer leave room for the case count, which sits in the
  corner below them; long labels show more of their name.
- Canvas and PNG: a note's label is 11 px and drawn at every zoom; flow and
  constraint edges with a count carry it.
- React Flow map: labels are shortened by the core rule (the stylesheet's
  ellipsis still applies where the text is narrower); an edge without a
  route runs straight between the two nodes instead of along a curve.
- BPMN export: a sequence flow whose given route has fewer than two points
  is written straight between its shapes instead of without a diagram
  edge.
