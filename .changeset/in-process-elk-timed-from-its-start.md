---
"wise-flow": patch
---

In-process ELK (no `elkWorkerUrl`, no `elk`) runs one layout at a time and
times each from when it starts: a layout behind an aborted long one is no
longer timed out while it waits (two nodes with `timeoutMs: 300` came back
from the Dagre fallback after 8.8 s), and one aborted while it waits never
starts. A run that finished is answered with its layout even when it took
longer than `timeoutMs`, since the timeout cannot fire while it holds the
thread; before, such a run ended in its layout or in the timeout depending
on timing. An `elk` instance the caller supplies is answered with a result it
sent before its timeout could fire. `docs/API.md` and the README now
recommend the workers in plain words: in-process ELK cannot be interrupted.
