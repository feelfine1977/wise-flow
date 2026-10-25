---
"wise-flow": minor
---

A host words the map's sentences itself: `strings` (type `Strings`, a key's
text with the table's `{placeholders}`) on `<ProcessMap/>`, `<Legend/>`,
`<AbstractionControls/>`, `buildScene`, `prepareScene`, `toSVG` and `toPNG`
replaces the EN or DE text of the keys it names in the legend's sentence, the
detail panel and its statements, Start and End, the caption and the
descriptions of terminal paths, in every renderer alike. `t` takes the
overrides as a fourth argument; `createStrings(locale, overrides)` gives them
as one function (`Translate`). The interactive map compares `strings` by
value. A figure's caption says what terminal paths count where it draws them
(`export.terminals`, "… (Σ = 1,000)"). `ProcessMapProps.hideAttribution`
(default false) hides React Flow's credit for a host that credits it elsewhere.
