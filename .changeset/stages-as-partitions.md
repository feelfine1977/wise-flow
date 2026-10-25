---
"wise-flow": minor
---

`LayoutOptions.stages: "partition"` lays out stages as partitions without
compound nodes: every activity in its top-level stage's columns in stage
order, Start before and End after, paths back to an earlier stage laid out
reversed and drawn the way they run, and the stage boxes drawn around their
members. An activity keeps its stage's columns whatever the cohort. The
default stays `compound`.
