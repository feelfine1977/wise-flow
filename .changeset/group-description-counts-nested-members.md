---
"wise-flow": patch
---

The map describes a group by the activities inside it at any depth, as every
other part of the library reads a group's members: a pool whose activities
sit in its lanes reads "Pool, pool. 12 activities." in its `aria-label` and in
the Canvas map's element list, where it read "0 activities", and a stage with
a nested stage counts the nested stage's activities too. `describeGroup` is
unchanged: it says the number it is given.
