---
"wise-flow": patch
---

Keep start events in the first layer and end events in the last layer of ELK
layouts in every reading direction, including ordered stages and multiple or
disconnected events. Events sit outside stage groups. Dagre and provisional
placement retain their existing behavior; host-supplied positions still win.
Scoped layouts also update when event kinds or start/end tags change.
