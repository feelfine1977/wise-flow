---
"wise-flow": minor
---

At a small zoom the maps draw only the paths whose lines can be told apart.
A path is drawn while its line is at least half a pixel wide on the screen
(its width on the width scale times the zoom; `viewTokens.pathPx`, 0.5), so
at zoom 0.75 and above every path is drawn. Paths with a deviation mark,
selected or focused paths, paths on a highlighted route and the paths that
keep every activity between a start and an end (each activity's strongest
path from and to a more frequent one) are always drawn. The rule changes
only when the view is at rest; zooming in brings paths back in steps. While
it withholds paths, the note "Showing N of M flows" and the detail panel's
line "M selected · N drawn at this zoom" count over the whole map, so a pan
never changes them, and `onEdgesShown` reports the paths drawn over the
whole map, so an export of what the map shows draws them with the note. The
selection, the table view and an export without that report are unchanged.

New: `pathsAtZoom`, `ZoomedPaths` and `viewTokens` (with the opening zoom
and the overview's size for the opening view below), the props
`minPathPx` of `<ProcessMap/>`, `<CanvasMap/>` and `<ViewSwitcher/>` (0 draws every path, as
before), `DrawOptions.pathRule` (none by default, so `drawScene`, `toPNG`
and the pinned recordings draw as before), and in the core
`openingView`, `OpeningView`, `OpeningOptions` and `processStart`: the view
a map opens at, fitted where the whole map fits at a zoom of 0.75 or more,
otherwise at 0.75 on the start of the process with room for an overview and
no activity under a panel. The maps use it for their readable opening.

A host that wants every path at every zoom, as up to this version, passes
`minPathPx={0}`.

The path budget and zoom rule now choose paths over the whole map before
Canvas culling. Connecting and highlighted paths survive even a budget of
zero, including at zooms where the width rule alone withholds nothing.

The note counts selected paths, including loops; constraints and indirect
connectors remain drawn without contributing to its counts. `ShownEdges.shown`
optionally carries the shown path count when its edge ids include those
uncounted connectors, keeping the screen and shown export notes equal.

Adaptive live-map budgets stay fixed through pure pans and move only with
the zoom direction, so their settled counts remain monotone when zooming.

Counted path loops remain drawn below the overlay LOD on live maps and in
shown exports. Default exports keep their previous output.
