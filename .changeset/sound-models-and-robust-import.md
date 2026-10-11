---
"@wise/flow": patch
---

`liteFromGraph` puts every node on a path from the start to the end. A part of
the graph that only its own nodes lead into (two activities that follow each
other, a loop) is now entered from the start, and a part that only leads into
itself is left to the end, through the nodes that start (end) cases there, else
its strongest node; a graph without activities gets a flow from the start to
the end. Before, such activities could never happen, or a case that reached them
could never end; on the BPIC 2019 fixture this happened with the activity
slider at 0 %. Models where every node was already on such a path are generated
as before. Flows from the start and to the end no longer carry a `NaN` count.
With `selfLoops: "flow"` a self-loop passes the node's exclusive split and join
instead of being a second outgoing flow of the task, which BPMN reads as a
parallel split.

`liteFromStages` with `lanes: "role"` adds the lane of a stage's role that only
the stage's gateways are in, after the other lanes; before, those gateways named
a group the model did not have.

`exportBpmn` writes an empty label as an empty `name`, so it comes back empty
instead of as the element's id.

`importBpmn` no longer throws a `TypeError` on a file with an element without an
id and a sequence flow without a source, and reads sub-processes and lanes
nested to any depth instead of exceeding the call stack. It reports in
`warnings`, and leaves out of `positions`, shapes and routes whose coordinates
are not finite numbers (and all positions of a diagram whose extent is not
finite), and it reports every issue `validateGraph` finds on the imported graph,
such as two elements with one `wise:flowId`. It rejects only with the parser's
error when the text is not BPMN definitions. `positionsFromDi` takes an optional
`warnings` array for these reports.
