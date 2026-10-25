---
"wise-flow": minor
---

Paths around a selection. `lod.edgeLabels` may be `{ minPx }`: a path's label
is drawn while the path is that many screen pixels wide (`pathLabelShown`, the
one rule of every renderer). Every path touching a selected activity shows
its label whatever the rule (`lod.selectedPaths`, default `"label"`), and with
`style.selectedShare` adds the share of the selected activity's cases it
carries ("800 · 89 %", `emphasisLabel`, `touchesSelection`). A backward path is
drawn `Theme.stroke.backwardStep` thinner at `Theme.opacity.backward` until an
activity it touches is selected (`EdgeMark.lift`); the default theme keeps it
as any path, the `instrument` preset draws it 1 thinner at 0.6.

`LodRules.edgeLabels` widens to `number | { minPx: number }` and `lodAt`
returns no `selectedPaths`: code that reads the rule as a number needs a check.
