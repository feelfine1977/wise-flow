---
"@wise/flow": patch
---

When ELK fails or times out and the Dagre worker (`dagreWorkerUrl`) then
fails or times out too, the layout rejects with `LayoutUnavailableError`
("Neither ELK nor the Dagre worker laid out the graph: …"), as it does
without a worker above `fallbackLimit`. `<ProcessMap/>` keeps its provisional
scene and says the layout is unavailable; `useStableLayout` keeps the
provisional positions. Before, it rejected with the worker's plain error,
and the map dropped the provisional scene and showed that message.
`engine: "dagre"` in a worker that fails still rejects with its own error,
and `engine: "elk"` with ELK's, also when a Dagre worker is given.
