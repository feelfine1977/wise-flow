---
"wise-flow": patch
---

The interactive map's cards carry their handles as data (`handles`), so React
Flow draws every path from the cards' sizes without waiting for a DOM
measurement. A measurement that never landed (a card object replaced before it
was laid out) left a card's handle bounds missing for good, and its paths were
not drawn until a reload (Workbench #39).
