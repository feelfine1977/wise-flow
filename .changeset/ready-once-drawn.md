---
"wise-flow": patch
---

`<ProcessMap/>`'s `data-layout-status` turns `"ready"` only once React Flow
draws the nodes in the layout's places, as documented. React Flow takes new
nodes into its store a commit after the map renders them, so the attribute
could say `"ready"` for one commit while the nodes were still drawn in their
provisional or previous places (seen with `fitView` and reduced motion). The
Canvas renderer and the table view are unchanged.
