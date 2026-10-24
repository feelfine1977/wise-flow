---
"wise-flow": patch
---

`<BpmnView/>` no longer announces a selection that stays the same when only
`mapping` changes or when the import arrives with a mapping. The view now
speaks of a selection by its FlowGraph ids (a controlled selection in
activity ids is resolved through `mapping`) and renames tasks to activity ids
for the table only. Before, the renaming counted as a new selection and
"Selected: …" was spoken again. What the view reports to `onSelect` is
unchanged.
