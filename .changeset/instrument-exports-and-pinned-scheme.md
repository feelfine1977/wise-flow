---
"wise-flow": minor
---

`toSVG` and `toPNG` with `theme: "instrument"` draw the preset in the light
scheme (`scheme: "dark"` where asked), and a figure's caption says what its
terminal paths count. A map follows `data-theme` on the nearest element around
it (`useFlowTheme`), so a host can pin one map to a scheme on a page in the
other; the map then writes the scheme's variables itself
(`FlowTheme.pinned`).
