---
"wise-flow": patch
---

A layout's arrival only moves forward: an animation frame that a browser
gives out after the clock already finished the arrival no longer sets it back
to its start, which turned a complete map's layout status back to "pending".
