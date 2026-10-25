---
"wise-flow": patch
---

The map's layout status no longer stays "pending" ("Arranging the map…")
after the map is complete. The move from a provisional arrangement to its
layout ends by the clock where the browser gives no animation frames (a window
in the background or occluded, a busy machine), and the map counts its layout
as in place when React Flow holds the same nodes at the same places, whatever
the array's identity.
