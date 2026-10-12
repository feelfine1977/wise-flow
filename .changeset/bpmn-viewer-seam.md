---
"wise-flow": patch
---

`<BpmnView/>` reaches bpmn-js through an internal viewer interface, and where
its overlay marks go is computed as data from the marks and the boxes of the
element registry. Props, the imperative handle, callbacks, ARIA output, the
drawn overlays and the bpmn.io watermark are unchanged; the entry points export
the same names. The BPMN bridge's headless modules no longer import React;
`wise-flow/bpmn` still exports `<BpmnView/>`.
