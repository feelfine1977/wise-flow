---
"wise-flow": minor
---

Rounded bends: `Theme.radius.bend` (0 in the default and print themes, 8 in
`instrument`) rounds every bend of a path, no more than half of either
segment it joins, as a cubic curve close to a circular arc
(`EdgeMark.path`, `PathSegment`, `roundedRoute`, `segmentsPath`), in the
interactive map, the Canvas map, the SVG export and the PNG export alike.
With 0 every route is the polyline it was; hit-testing keeps the polyline.
