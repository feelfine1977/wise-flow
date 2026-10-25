---
"wise-flow": minor
---

Panels where the host puts them: `legendPosition`, `controlsPosition` and
`overviewCorner` (`PanelCorner`) on `<ProcessMap/>`; the key of full activity
names takes the side the legend leaves. `fitInsets` is now room kept beside
the panels (`mode: "add"`, the default), so a host's drawer and the library's
panels both stay clear of the fitted map; `mode: "replace"` keeps the 0.3
behaviour. `insetBoxes` and `cornerBox` join `panelBoxes` in `wise-flow/react`.

`minimap: "overflow"` shows the library's overview of card outlines whenever
part of the map is out of view at rest, and never React Flow's minimap.

Changed: a host that passed `fitInsets` and relied on it replacing the
panels' insets passes `mode: "replace"`.
