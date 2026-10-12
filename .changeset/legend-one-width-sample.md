---
"@wise/flow": patch
---

Where every path a map shows has the same count, the legend's path width row
shows that one sample, at the width every path is drawn at, instead of a scale
from 0: a map whose paths all count 9 showed the samples "3" and "9" and now
shows "9" alone. Without a measured path the legend has no width row, as
before. The width scale itself is unchanged (`LegendItem.samples` holds one
entry; `domain` still runs from 0 to the strongest path).
