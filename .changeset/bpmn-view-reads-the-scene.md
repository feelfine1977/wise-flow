---
"@wise/flow": patch
---

`BpmnView` reads the core scene: the order of the overlays, the level of
detail and the overlay geometry come from `buildScene` over the imported graph
and the boxes of the diagram's element registry.

Visible changes, now the same as on the map and in the SVG export: overlays
whose target (or, for an arc, an endpoint) names no element of the diagram are
no longer listed in the table, counted in the description or shown in the
legend; overlays are ordered by the diagram ids their targets resolve to, so a
table that mixes BPMN ids and FlowGraph ids may list them in another order; a
self-loop with neither `displayLabel` nor a value draws no text instead of a
bare `↻`; and observed repeats (`payload.observed`) stay visible at every zoom.
