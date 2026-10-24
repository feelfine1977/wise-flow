---
"wise-flow": minor
---

The paths' arrowhead rule is the theme's (`Theme.arrowhead.edge`), with a
narrowest path that has a head (`Arrowhead.minWidth`). The `instrument`
preset grows a head by 5 per unit of width, so that its base is twice the
path's width, and draws no head on a path thinner than 2: its line then ends
on the route's end, in the interactive map, the Canvas map, the SVG export
and the PNG export alike. The default and print themes are unchanged.

Every renderer paints paths the widest first and the thinnest on top, equal
widths by id (`paintOrder`, new; the prepared Canvas scene carries the order
as `edgePaint`). The SVG export drew paths in id order, the maps in the
graph's order; the scene's `edgeMarks` stay in the graph's order.

Breaking for code that reads marks: `EdgeMark.arrow` is optional and
`pathArrowhead` returns `undefined` under the rule's `minWidth`; `lineEnd`
takes an optional head.
