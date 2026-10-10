---
"@wise/flow": patch
---

`<ProcessMap/>` takes `describedLimit` (default 500 activities plus groups).
Above it the Canvas map's hidden element list for assistive technology holds
at most that many elements, the element at the keyboard position and its
neighbours (predecessors, successors, group), and follows every keyboard move;
before, a map with 20,000 activities rendered 20,000 hidden elements. The live
region announces the number of activities and paths and that the table view
lists all of them, and the table view shows its rows in pages of 100 with a
search field. `<TableAlternative/>` takes `pageSize` for this: one page per
table with previous and next buttons, a status line naming the rows shown, a
search field over all tables, and `aria-rowcount`/`aria-rowindex`. At or below
the limit, and without `pageSize`, the DOM is unchanged. New strings
`map.described.bounded`, `table.search`, `table.rows`, `table.previous` and
`table.next` in English and German.
