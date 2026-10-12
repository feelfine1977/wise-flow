---
"@wise/flow": minor
---

The scene now carries one resolved mark per overlay (`FlowScene.marks`,
`OverlayMark`): box or path, fill, stroke, dash, arrowhead, texts, layer and
the zoom from which it is drawn. `toSVG`, `toPNG` and the Canvas map draw these
marks instead of deciding per overlay kind. The rules behind them are exported
once: `overlayColor`, `tintColor`, `arcWidth`, `TINT_OPACITY` and
`overlayArrow`. `DrawOptions.lodZoom` decides the Canvas level of detail at
another zoom than the view's.

Visible changes:

- SVG: a badge without a glyph shows a dot and its share once, beside it; it
  used to print the share inside and again beside the badge. Canvas and PNG
  show the same dot instead of the share inside the badge.
- SVG: hatching is drawn at opacity 0.55 without an outline, as on the map
  (it was 0.9 with a grey outline).
- SVG: arcs and self-loops end in the map's arrowhead, 12 px in scene units
  (arcs used a marker of 4 × the stroke width, self-loops the edge marker);
  its marker is `wf-overlay-arrow` (it was `wf-arrow-arc`).
  Canvas and PNG: self-loop arrowheads are 12 px instead of 10, and arc and
  self-loop arrowheads reach 1.2 px beyond the end of the path, as on the map.
- SVG: chip text sits 0.5 px higher, where Canvas puts it.
- Canvas and PNG: a group tint is filled once; it used to be filled by the
  group and again by the tint overlay.
- Canvas and PNG: hatching is drawn per hatch overlay after the nodes, also
  on groups, and is no longer dimmed with its node; a node hatched by two
  constraints shows both, as in SVG.
- SVG, PNG and the Canvas map: map-level chips, which these renderers list
  with the legend rather than on the map, no longer count towards the bounds
  or answer hits. Figures with map-level chips lose the empty band above the
  map that was reserved for them.
- SVG: an observed self-loop given with a value is drawn in its value colour,
  as on the map and in Canvas (it was neutral).
- SVG: overlays are drawn in the scene's canonical order. The export used to
  sort them again by shape id as text, which could swap overlays of one kind
  once there were ten or more.
