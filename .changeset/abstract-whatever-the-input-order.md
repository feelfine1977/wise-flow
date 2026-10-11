---
"@wise/flow": patch
---

`abstract` with `relativeTo: "total"` divides each strength by a sum taken in
ascending order. The sum was taken in the input order, so with fractional
metrics such as `share` an element standing exactly on a threshold could be
kept in one order of the input's nodes and edges and removed in another; the
same holds for self-loops, which are measured against the total of the other
follows edges. Integer counts were not affected, and the BPIC fixture maps are
unchanged at every threshold.

`collapseGroups` (and `abstract` with `collapse`) names merged edges in the
order of their smallest original id. Where edges of two kinds between the
same nodes merge (follows and flow edges from a collapsed stage to one
activity, for example), the one named first keeps the id `source->target`
and the other becomes `source->target:kind:1`; which one did depended on the
input order of the edges, and with it the targets of their overlays and
`meta.collapsedEdgeTargets`.
