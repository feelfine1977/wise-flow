---
"wise-flow": minor
---

`useStableLayout` marks the provisional arrangement it keeps after a
`LayoutUnavailableError` as final: `positions.final` is true (a new optional
member of `Positions`; a new object, the positions shown while pending are
not changed). A `<ProcessMap/>` given such positions says that the refined
layout is unavailable and sets `data-layout-status="error"`, as with its own
layout. Before, a map given them said "Arranging the map…" with
`data-layout-status="pending"` for good.
