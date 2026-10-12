---
"@wise/flow": patch
---

`meta.abstraction.removedEdges` lists its kinds in sorted order
(`constraint`, then `flow`), whatever the order of the input's edges, as
every other record of `abstract`'s result is free of the input order. Its
keys followed the order in which the input gave the removed edges; the
counts were the same.
