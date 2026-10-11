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
