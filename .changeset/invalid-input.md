---
"@wise/flow": patch
---

`validateGraph` reports a cycle of group parents as an error: every group
whose chain of parents returns to it (two groups inside each other, a group
that is its own parent) gets one issue `group parent cycle`. Such a graph
passed validation before and failed later: `collapseGroups(g, "all")`
collapsed nothing and `layout` rejected with the engine's plain error.

`layoutBpmn`, and `exportBpmn` without positions, lay out a graph whose
groups form a cycle of parents: the nodes of those groups have no lane of
their own and follow their neighbours, as a node without a group does. They
overflowed the stack (`RangeError`) in `laneModel` and `spanLanes` before.

Positions with a number that is not finite (`NaN`, an infinity) in a box or
a route no longer reach a drawing or an export. `buildScene` (and with it
`toSVG`, `toPNG`, the Canvas map and `<ProcessMap/>`) and `exportBpmn` leave
such a box or route out as if it were missing; `coversGraph` no longer
counts such a box, so `<ProcessMap/>` lays the graph out instead of drawing
the given positions. Before, the numbers were written into the SVG and the
BPMN diagram interchange and given to the map's elements.

`layout` with Dagre (asked for, or as the fallback) places a node and routes
an edge whose id is the empty string; it failed with a `TypeError` before.

`formatNumber` takes `decimals` between 0 and 100 (fewer as 0, more as 100);
a number outside threw a `RangeError` before.

`normalizeFilterPreview` reads `perClause` / `per_clause` only from a list,
of its entries whose `clause` is a number; anything else under that key threw
a `TypeError` before (also in `<FilterChips preview>` and `<ProcessMap
filterPreview>`).

`toSVG` escapes a node's kind in the node's `class` attribute. A kind outside
`NodeKind` that held a quote could end the attribute and add markup before.

`<Chip/>` renders nothing for an overlay that has no mark on its own (an arc,
or a kind outside `OverlayKind`); it threw a `TypeError` before.

`exportBpmn` gives every element an id of its own: a node, an edge and a
group that share a FlowGraph id (a collapsed stage and its group) were
written under one BPMN id, which made the file invalid and lost elements on
import; two nodes with one id now get a shape each. `ids.toBpmn` maps a
shared id to the node's BPMN id. A node or an edge without an id is exported
as one with the empty id; it threw a `TypeError` before.

`repositionNodes` (and `buildScene` with `moved`) routes an edge without an
id like any other; it threw a `TypeError` before.

`arcWidth` takes a coverage that is not a finite number as the default, 1:
`NaN` gave a width of `NaN`, which reached the arc's stroke in every
renderer, and `-Infinity` gave 2.

`canonicalClause` keeps a filter clause of a kind it does not know as it is
and reads an `any` group without `clauses` as an empty group; both threw a
`TypeError` before, in every function that compares or adds clauses.

`liteFromGraph` gives two edges between the same nodes (a follows edge and a
flow, say) two flow ids where a gateway takes the place of an end: the
second gets `:1` after the id. Both got one id before, so the graph failed
`validateGraph` and its BPMN export lost a flow.

`focusHighlight` reads a focus that is not a pair as one id, also when a node
came without an id; it threw a `TypeError` before.

`routeSequenceFlows` (and with it `repositionNodes` and the BPMN layout)
leaves a box with a number that is not finite out of the routing, as if it
were missing. Such a box could keep the search going until the route outgrew
an array: a `RangeError` after seconds of work and gigabytes of memory.

`layout` (both engines and the provisional arrangement) takes a spacing or a
node size that is not a finite number as not given and uses the default.
Dagre threw a `TypeError` or a plain error on such a value before, and ELK
returned boxes that were not finite.

`layout` with Dagre leaves out an edge whose source or target is not a node
of the graph; Dagre placed a node of its own for the missing end and routed
the edge through coordinates that were not finite before.

`layout` with a `timeoutMs` longer than a timer can wait (above 2³¹ − 1 ms,
`Infinity` included) waits that long. The timer fired at once before, so the
layout timed out at the start.

`validateBpmn` reads sub-processes and lanes nested deeper than the call
stack reaches, as `importBpmn` does; it overflowed the stack before.

`describeClause` and `changesCases` read an `any` group without `clauses` as
an empty group; they threw a `TypeError` before, and with them
`<FilterChips/>` and `<ProcessMap filters>`.
