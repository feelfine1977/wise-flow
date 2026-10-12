---
"wise-flow": patch
---

A paged table keeps the input focus on a button that works. In
`<TableAlternative pageSize/>` (and the table view of a large
`<ProcessMap/>`), "Next rows" pressed from the keyboard onto the last page,
or "Previous rows" onto the first, was disabled while it held the focus, so
the keyboard lost its place; the focus now moves to the other button. A click
that does not carry the focus moves none.
