---
"wise-flow": minor
---

A collapsed stage's card prints a lower bound compactly, "≥ 211,379 · ≥ 84 %"
(it read "at least 211,379"); descriptions, tooltips and tables keep "at
least" (`MetricFormatOptions.compactBasis`). The legend explains the mark (new
key kind `atLeast` of `LegendKeyKind`; code that switches over the union
needs a case) only where a card carries it. `FlowGroup.metrics` (new) carries
the host's exact numbers of a stage: `collapseGroups` takes its `cases`,
`events` and `share` instead of the members' maximum, so the card prints
plain numbers.
