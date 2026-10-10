---
"@wise/flow": patch
---

Generated BPMN models no longer contain unpaired parallel gateways. With
`andGateways`, `liteFromGraph` emits a parallel split and a parallel join
only as a pair: when the successors of a node follow each other in both
orders, are entered only from that node or from each other and lead only to
one common node whose predecessors they are; the paths between these
branches become no flows. Every other split and join is exclusive. Before, a split or a join
became parallel on its own, so a model could contain a parallel join fed by
exclusive splits (it never completes) or a parallel split merged
exclusively (it completes more than once); the model of the BPIC 2019 log
at the default abstraction had such a join. Models without parallel
gateways, and every model without `andGateways`, are generated as before.
The new `validateGateways(graph)` in `@wise/flow` reports, as warnings, a
parallel split whose branches do not all reach one parallel join and a
parallel join that is the partner of no parallel split, on generated and
imported graphs alike; it rejects nothing.
