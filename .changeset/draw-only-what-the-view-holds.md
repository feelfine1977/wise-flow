---
"wise-flow": patch
---

A culled Canvas draw (above 1,500 elements, or `cull: true`) reads only the
groups, overlay marks, edges and nodes the hit index finds in the viewport,
instead of walking every element and testing it against the query's result, so
its cost follows what the view holds rather than the size of the scene. The
elements are drawn in the same order as before. Groups wholly outside the
viewport are no longer drawn in a culled view, like nodes and edges. Every item
of `PreparedScene.hit` carries its element's position in the scene's lists as
the new optional `HitItem.index`, and `HitIndex.fromScene` takes an optional
fourth argument that supplies it; hit tests return the same items as before.
A scene whose hit index was built without that argument is drawn by walking
every element, as before.
