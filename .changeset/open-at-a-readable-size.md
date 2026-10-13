---
"wise-flow": minor
---

The DOM and Canvas maps now open fitted when the whole map fits inside the
open panels at zoom 0.75 or above. Otherwise they open at 0.75 on the start
of the process with a named, keyboard and pointer operable overview in a
free corner. Its marked rectangle follows the viewport. Activities open
clear of panels. The fit button still shows everything, and a view the
person moved survives detail changes. Replacing the graph opens it again.
Exports keep showing the whole figure.

New props: `ProcessMap.opening` and `CanvasMap.opening` (`"readable"` by
default; `"fit"` restores the previous opening), and `CanvasMap.openKey`
for graph replacement (defaults to the scene's graph object). A standalone
Canvas map opens even without a `fitKey`; refreshing its scene under the
same keys keeps its view. New styling part: `overview`. Its accessible name
and instructions are available in English and German.
