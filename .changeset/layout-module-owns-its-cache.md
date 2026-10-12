---
"@wise/flow": minor
---

The layout module owns its cache and its ELK workers. New `createLayoutScope`
(with `LayoutScope` and `LayoutScopeOptions`) keeps layouts keyed by their
inputs (graph structure, resolved node sizes and options), at most
`maxEntries` (default 8), and releases them on `dispose()`. `<ProcessMap/>` and
`useStableLayout` lay out in a scope of their own, released on unmount, so
returning to earlier inputs, such as a previous abstraction level, no longer
lays out again. ELK workers started for `elkWorkerUrl` are now terminated once
no scope and no running layout uses them; before, they ran until the page
closed. `cacheKey` and `clearLayoutCache` keep their meaning; a global
`clearLayoutCache()` also empties every scope.
