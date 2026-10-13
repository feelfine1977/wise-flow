---
"wise-flow": minor
---

The map can show three measures, switched by the host: `measure` on
`<ProcessMap/>` (with `onMeasureChange`, which makes the whole legend offer the
three), `buildScene`, `toSVG`, `toPNG` and Canvas `prepareScene`, each a named
style (`measureStyles`, `measureStyle`) that a given `style` changes entry by
entry. `frequency` draws what the default style draws. `shortfall` colours
paths by their share short in three classes (up to 10 % in the neutral
colour, 10 to 30 %, over 30 %; the thresholds are `edgeColor.bins`), leads
their labels ("35 % · 820") and the activities' number lines ("35 % short ·
900") with it and draws the cases short in the accent of each frequency cue.
`performance` colours paths by their median lag from 0 to the 95th percentile
of the paths shown, from a stop at 3 : 1 on, leads their labels with it ("12 d
· 112,924") and an activity's number line with the host's `medianNextHours`
("4.7 d to next · 93 %") where it is given. Path width is cases in all three;
a path without the measure's value is drawn in the line colour and keyed "not
evaluated"; the legend states the measure's sentence in English and German
and shows the classes or the ramp with their bounds. Without a measure the
map, the exports and the legend are unchanged.

New: `Measure`, `LineSpec`; `StyleSpec.measure`, `nodeLine`, `pathLabel` and
`cueAccent`; `ColorSpec.bins`, `percentile`, `readable` and `required`; the
legend item kind `classes`, the key kind `shortPart`; `NodeCue.accent`;
`nodeMark`'s options `line` and `accent`, `edgeMark`'s option `lead`;
`ThemeDeviation` kind `measure`, which `checkTheme` reports for a palette a
measure cannot draw, and its check of text on the accent's tint.
