---
"@wise/flow": patch
---

An SVG export that withholds edges ends its accessible label with the note,
so that a screen reader announces it with the figure: `aria-label="Process
map with 9 nodes and 8 connections in 0 groups. Showing 3 of 8 flows."`, or
the title, ended with a full stop, and the note. The note was a `<text>`
inside the figure's `role="img"`, which assistive technology does not read.
Exports that withhold nothing keep their label.
