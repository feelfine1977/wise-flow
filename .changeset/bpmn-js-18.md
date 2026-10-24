---
"wise-flow": minor
---

`<BpmnView/>` draws on bpmn-js 18, and the BPMN bridge reads and writes with
bpmn-moddle 10, of which the package now holds one copy. The `wise`
extension and the XML that `exportBpmn` writes are unchanged. The diagram's
canvas is a stop in the tab order and takes the keyboard when focused (Ctrl
or Cmd with an arrow key moves it); `keyboard.bindTo` in `viewerOptions`
only logs an error. The view adds the selection outline, which bpmn-js 18
draws only in its modeler, so a selected task stays outlined. An external
label is laid out in its `BPMNLabel` bounds, so a label that another
modeler measured narrower than its text breaks into lines. Modules passed in
`additionalModules` must work with bpmn-js 18.
