---
"@wise/flow": minor
---

Layouts nobody waits for are stopped instead of running on. `layout`,
`layoutUnion` and a layout scope's requests accept `signal` (an
`AbortSignal`, not part of the layout's inputs): an abort rejects with the
signal's reason and, once nobody else waits for the same layout, terminates
the worker that runs it; nothing it sends afterwards is read and nothing is
kept. A request to a layout scope replaces the scope's earlier one: a still
running earlier request rejects with an `AbortError` and its worker is
terminated unless another caller waits for it. `timeoutMs` now bounds each
engine run and terminates the worker running it; a timeout no longer tries
ELK a second time without stage partitions. In-process ELK and a supplied
`elk` instance cannot be interrupted (documented): the promise rejects at
once and the result is discarded. One worker runs one layout at a time; a
scope keeps one idle worker per URL.

The Dagre fallback is bounded. New asset `@wise/flow/dagre-worker.min.js`
(Dagre's browser build, MIT, and the package's Dagre step) and option
`dagreWorkerUrl` run Dagre in a Web Worker, as a fallback and for
`engine: "dagre"`, with the same positions as on the calling thread. Without
it the fallback runs on the calling thread only up to `fallbackLimit` nodes
plus edges (default 500); above it the layout rejects with the new
`LayoutUnavailableError` instead of freezing the page. `engine: "dagre"`
still runs whatever the size.

`useStableLayout` aborts the layout of a request it no longer shows (it
passes its own `signal`; one in its options, or in `<ProcessMap layout>`, has
no effect there); on a `LayoutUnavailableError` it keeps the provisional
positions (status `"error"`, `provisional: true`). `<ProcessMap/>` then keeps the provisional
scene and its status panel and description say "The refined layout is
unavailable; the map shows a provisional arrangement." (new string
`map.layoutUnavailable`, English and German); `data-layout-status` is
`"error"`.
