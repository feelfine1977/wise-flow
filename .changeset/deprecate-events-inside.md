---
"@wise/flow": patch
---

The time mode `events_inside` (`TimeMode`) is deprecated; it is removed in the
next minor version and works as before in this one. A time clause with it
keeps only the events inside its window, so it cuts events out of cases, while
a selection is a set of whole cases. The library never makes such a clause.
Migration: use `case_start`, `case_end` or `active`, which keep whole cases; a
host that needs only the events in a window trims them outside the filter.
The deprecation is in the type's documentation and in `docs/API.md`
("Filters", "Deprecated names").
