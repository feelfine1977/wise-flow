---
"wise-flow": minor
---

Start and End look like the process's ends, and their paths like recorded
history. An event tagged `start` or `end` is drawn by every renderer as its
circle outlined in `lineStrong` (it was the ink) with ▶ or ■ in the ink in its
middle (text role `eventGlyph`, `ElementText` role `glyph`, `eventGlyph()`)
and its label below it; an event without a label of its own reads "Start" /
"End" (German "Beginn" / "Ende"). `StyleSpec.terminals.statement` adds, under
the label, how many cases start or end there and how many of them at an
activity the map shows, from the event's metrics `cases` and `atShown`.

A follows edge from a start event or to an end event that the host did not
add (`added-by-map`) is a terminal path (`Scales.terminal`,
`EdgeMark.terminal`): drawn solid in the new `terminal` colour role in every
measure, on the width scale every path shares, labelled with its count alone,
outside the measure's colour domain and never "not evaluated" for lacking a
measure's value. The legend keys it beside the events, whose keys now show ▶
and ■ (they were ○ and ◉). The interactive map's path carries the new states
`start` and `end` of the styling contract (`data-wf-state`). The opted-in
host flows stay neutral round dots. Recorded paths of a graph with Start and
End are coloured over a domain without the terminal paths, so they can be a
shade darker than before.

New: `LegendKeyKind` `"terminal"`; strings `terminal.start`, `terminal.end`,
`terminal.statement`, `legend.terminal`.

A sequence flow from a start or to an end event that the host tags `start` or
`end` is a terminal path too (`terminalOf`, new), so a host that emits its
boundary links as tagged `flow` edges gets the same look; a BPMN model's own
untagged flows keep theirs. A terminal path's accessible description counts
cases ("800 cases begin with this activity"), not transitions, and an event
without a label is named "Start" or "End" in descriptions too.
