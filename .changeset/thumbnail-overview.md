---
"wise-flow": minor
---

`minimap: "thumbnail"` draws the overview as the scene itself, small (bands,
paths and cards through the Canvas drawer, once per scene). The library no
longer draws React Flow's minimap: `minimap: true` now means `"overflow"`
(deprecated), and the `.react-flow__minimap` rule is gone. Hosts that styled
React Flow's minimap should switch to the `overview` part.
