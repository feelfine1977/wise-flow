---
"wise-flow": patch
---

Disposing a layout scope (`createLayoutScope().dispose()`) stops waiting for
its latest request: a layout still running for it rejects with an
`AbortError` ("The layout scope was disposed.") and its worker is terminated
unless another caller of the same layout still waits for it. Before, the
layout kept its worker running after the scope was disposed until it finished
or its caller aborted the request; `useStableLayout` and the maps abort their
own requests, so they behave as before. `maxEntries` is documented as what it
is: the number of finished layouts a scope keeps, not of layouts running.
