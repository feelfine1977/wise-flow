---
"@wise/flow": patch
---

The graph index answers the group hierarchy: `GraphIndex.ancestors`, `allMembers`
(nested groups included) and `label`. A selected group now keeps the members of
its nested groups bright, as a group focus, "filter to" and stage bands already
counted them; single-level groups behave as before. Positions are built through
the new `createPositions`, which computes bounds from the contents, and
`unionBoxes` is exported. `OverlayPayload` declares `displayLabel`, `observed` and
`edgeId`; `FlowGraph.meta` is typed as `FlowMeta` with `abstraction` as a number or
the recorded `AbstractionMeta`. `FlowComparison` treats a graph that `abstract`
left unreduced (zero thresholds, no collapse) as complete instead of comparing
the recorded object with `0`.
`describeMap` no longer reads a numeric `meta.abstraction` as zero thresholds, and
`roundPositions` (the positions `exportBpmn` returns) computes bounds from the
rounded contents.
