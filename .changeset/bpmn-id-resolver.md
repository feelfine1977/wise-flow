---
"@wise/flow": patch
---

`<BpmnView/>` with an activity `mapping`: a task selected in the diagram now
highlights its row in the table alternative, and a row clicked in the table
reports the task's FlowGraph id through `onSelect`, as a diagram click does
(before, the table reported the activity id and did not show the diagram's
selection). A controlled `selection` also accepts activity ids mapped to a task
by its BPMN id. Ids are resolved by the new `createIdResolver` of
`@wise/flow/bpmn` (with `renameToActivities`, `createIdMap` and `registerId`),
which import, export, the mapping functions and the view share; BPMN output is
unchanged.
