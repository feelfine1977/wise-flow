---
"@wise/flow": patch
---

A culled Canvas draw reads an element whose drawing reaches into the view by
the theme's strokes and the scene's text measure. Before, a node's extent
allowed 6 around its box and a group's 1.5, whatever the theme's selection
ring (`stroke.canvasSelection`), focus rectangle (`stroke.focus`) or a
group's selected outline (`stroke.canvasGroupSelected`), and a text 0.7 em per
character: a selected activity drawn with a ring 10 wide whose box ended just
outside the view lost its ring, and an event's label in a wide script (1 em
per character) that reached into the view was not drawn.
