---
"wise-flow": minor
---

Constraint arcs are drawn above the edges and below the nodes, so that an
activity and the badges it carries stay readable where an arc crosses it;
they were drawn above the nodes. `OverlayMark.layer` gains the value
`between`, which arc marks now carry (they carried `above`). `toSVG` writes
the arc groups after the last edge and before the first node, the Canvas map
and `toPNG` draw them after the edges and before the nodes, and
`<OverlayLayer/>` draws them in React Flow's edge label layer, which lies
between the edges and the nodes; self-loops stay above the nodes. The arcs
themselves are unchanged. The BPMN view still draws arcs in its SVG layer
above the diagram.
