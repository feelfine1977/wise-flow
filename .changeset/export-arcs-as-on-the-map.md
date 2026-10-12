---
"@wise/flow": patch
---

`toSVG`, `toPNG` and `prepareScene` place overlays on the positions of the
graph's own elements when the positions hold more (another scene's
elements from `layoutUnion`, or wider bounds), so the arcs of an export take
the course and label place they take on the map. Before, the arcs' course
search also avoided the other scene's boxes and took its room from their
bounds, so an exported arc could run at another height or on the other side.
The figure's frame is unchanged. A prepared scene's hit index now holds only
the elements the scene draws, so such positions no longer turn culling off,
and their extra boxes are not hit.
