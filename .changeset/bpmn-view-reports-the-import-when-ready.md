---
"@wise/flow": patch
---

`<BpmnView/>` calls `onImport` once the viewer shows the diagram with its
fitted viewport (`data-bpmn-status="ready"`, overlays projected), or once the
diagram cannot be shown (`error`). Before, `onImport` was called as soon as the
headless import of the XML finished, usually before the viewer had imported and
fitted the diagram, so a host that read the viewport in it could read the
unfitted one on a slow machine. The argument is unchanged and the callback still
fires once per import of an `xml` value.
