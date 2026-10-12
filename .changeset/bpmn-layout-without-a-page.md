---
"@wise/flow": patch
---

Where no `Worker` exists (Node), `layoutBpmn` and `exportBpmn` run the Dagre
fallback whatever the size of the model, as up to 0.3.5: there is no page to
freeze. Since the fallback limit came in, a model above 500 nodes plus flows
whose ELK layout failed or timed out ended in `LayoutUnavailableError` there.
In a browser the limit stays, and a `fallbackLimit` the caller gives is kept
everywhere.
