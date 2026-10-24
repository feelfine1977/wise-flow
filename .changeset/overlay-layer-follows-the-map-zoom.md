---
"wise-flow": patch
---

`<OverlayLayer/>` without a `zoom` prop draws each mark from its `minZoom` at
the zoom of the React Flow map it sits in, as the marks that nodes carry
already do. It drew every arc and self-loop at any zoom before, so a host that
placed the layer in its own React Flow map saw them where `ProcessMap` and the
Canvas map shed them. `zoom={Infinity}` keeps the old drawing. `ProcessMap`
passes its zoom and draws as before.
