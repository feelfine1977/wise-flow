---
"@wise/flow": patch
---

The actions menu of `<ProcessMap/>`, the pointer input of its React Flow and
Canvas renderers, the table alternative and `<BpmnView/>` take their
transitions from the map controller in the core. Props, exports and DOM roles
and labels are unchanged. Visible changes:

- `<BpmnView/>` announces a selection with the sentences of `<ProcessMap/>`
  ("Selected: Approve Invoice.", "Selected: path A → B.", "Selected: 3
  elements.", "Selection cleared.") instead of counts ("Selected: 1 tasks,
  0 flows, 0 lanes."), and announces that a selection was cleared.
- A row of `<TableAlternative/>` (on its own, in the map's table view and in
  `<BpmnView/>`) selects as a click on the map does: clicking the only
  selected row again clears the selection, and Shift, Ctrl or Cmd with a click
  adds the row to the selection or removes it.
