---
"@wise/flow": patch
---

A scene retains less memory: the node and edge marks share the parts that do not
differ between elements (one frozen outline per paint, width and dash, one
frozen dash per kind of dashed edge, one frozen empty `texts` list for the edges
without a count), equal counts share one string, each mark and text is one
allocation, and wrapped activity lines and descriptions are kept as one string
each. The Canvas scene gives the nodes without badges one frozen empty `badges`
list and indexes a two-point route by its own `points` array. A sparse prepared
scene with 100,000 nodes and edges retains about 23 % less (with activity
labels about 32 % less). Every value, the SVG export and the Canvas calls are
unchanged; a host that changed a shared part in place now copies it first.
