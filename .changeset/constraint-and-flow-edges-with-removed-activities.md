---
"@wise/flow": patch
---

`abstract` says and does the same about constraint and flow edges. They were
documented as never removed, but an edge to an activity the thresholds remove
went with it, as it must: an edge to an element that is not on the map cannot
be drawn. The documentation now says that a constraint or flow edge is removed
only with an activity or stage at one of its ends, and
`meta.abstraction.removedEdges` (new, optional) counts those by kind,
`{ constraint, flow }`; it is absent while none went, and abstracting an
abstracted graph adds to the count it carries.

With `keepConnected`, an activity re-added to keep the map connected now
brings back its constraint and flow edges to elements on the map, tagged
`reconnected` like every re-added element. Before, it came back without them.
On the committed fixtures no node or edge changes; the BPMN-lite map of the
P2P stages records the flow edges that went with its weak activities.
