---
"wise-flow": patch
---

The documentation of `keepConnected` (in `AbstractOptions`, `docs/API.md` and
the architecture) says what it does; its behaviour is unchanged. It joins
only the main part of the input: kept activities of another part are joined
only by direct edges between them, not through removed activities. And it
restores flow context only from activities still on the map, so an activity
whose incoming paths all came from removed activities stays without one: the
map is in one piece, but no path from the start reaches that activity. The
detail shares keep every shown activity on a way from a start to an end.
