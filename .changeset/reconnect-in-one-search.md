---
"@wise/flow": minor
---

`abstract` with `keepConnected` (the default) joins separated components in
one growing search instead of one search per join, so its work grows like
(nodes + edges) · log nodes on the measured graphs: a cyclic graph of 100,000
activities with `minEdgeShare: 0.3, minNodeShare: 0.2` is abstracted in a few
seconds, where 0.3.5 did not finish in 500 s. Every join still takes the
component nearest to what is joined, through its cheapest path (each edge
costs `1 + (1 − strength)`). Equally cheap alternatives are now chosen by id
and no longer by the input order of nodes and edges, so where 0.3.5 broke
such a tie differently the re-added paths may differ from 0.3.5, and on such
graphs the total cost of the later joins may differ in either direction. The
BPIC fixture maps are unchanged at every threshold.
