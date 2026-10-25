---
"wise-flow": minor
---

`stages: "partition"` never falls back to Dagre for its partitions (Workbench
#39). Where ELK throws on the partitions, or they put a route behind a card or
the stages out of order, ELK lays the stages out as compound nodes instead, and
the new `Positions.stages` says which (`partition` or `compound`). New
`routeFaults(graph, positions)` lists routes that cross a card other than their
own ends.
