---
"@wise/flow": patch
---

`liteFromGraph` merges edges between the same two nodes (two follows edges,
or a follows edge and a flow) into one sequence flow with their counts and
cases summed, named by the smallest id, and the self-loops of one node into
one loop marker with their counts summed. Up to 0.3.5 they became several
flows with one id: the graph failed `validateGraph`, a node got a gateway for
flows that all lead to one place, and the BPMN export wrote one id twice. A
flow whose id an edge of the input already has gets `:1` after it.
