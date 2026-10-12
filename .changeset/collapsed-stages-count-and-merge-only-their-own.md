---
"@wise/flow": patch
---

Collapsing stages counts and merges only what belongs to them.

- A collapsed stage's `internalCount` counts only the follows edges between
  its members, by their `count`, else their `cases`, and nothing for one with
  neither. A constraint edge, a flow edge and a follows edge without a `count`
  counted as one transition each: two activities with a path of 5, a
  constraint, a flow and a self-loop of 6 cases gave 8 instead of 11.
- Only edges with an end in a collapsed stage merge. Parallel edges between
  two nodes outside every collapsed stage stay as they are, with their ids,
  metrics, tags and payloads: two constraint edges between the same two
  activities became one edge without either payload.

The committed purchase-to-pay fixtures abstract to the same graphs at every
recorded setting.
