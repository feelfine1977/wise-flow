---
"wise-flow": patch
---

The edge budget ranks paths by the value their width reads as the scales
resolve it: their cases, or their transitions where no path of the scene
gives cases. A path without cases among paths with cases, drawn at the
thinnest width as not evaluated, now comes last; it was ranked by its
transitions.

An arc's label is hit on the pill it is drawn in, and a self-loop's on its
text, in the Canvas map, `CanvasRenderer.hitAt` and the hit index of
`prepareScene`; a curve is cut into at most 1,024 chords for the hit test,
so a curve of no finite length no longer throws. An arc's pill keeps clear
of the paths' counts in `buildScene`, as it keeps clear of activities,
badges, chips, labels and group titles.

`abstract` counts the constraint and flow edges removed with an element at
an end (`meta.abstraction.removedEdges`) at detail shares too; by detail
shares a flow edge between shown activities is shown, as a path no metric
measured is. `meta.model.pathMax` and `metricBasis` list their metrics
by name and the events of `meta.shown` are summed in ascending order, so
that no order of the input changes them.

`buildScales` draws a path at the thinnest width where a width domain or
value is not a number, instead of throwing. `wrapText`, and with it the
activity key of an export, wraps a word of thousands of characters in about
as many measures as it has lines.

`pathArrowhead` ends a path whose width gives no head of a finite size in the
rule's head; a width of `NaN` gave a head of size `NaN` and `Infinity` one of
size `Infinity`. `orderedCategorical` gives a key that is not a string no
entry; `null` threw a `TypeError`.

The detail panel of a Canvas `<ProcessMap/>` says how many paths are drawn of
those selected from what the Canvas map shown now withholds: after the table
view, a Canvas map that withholds nothing leaves no "… drawn at this zoom"
of the map before it, and a host that starts listening then is not told that
map's last report. The panel kept the old count where the budget or the graph
changed while the table was shown.
