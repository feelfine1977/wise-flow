---
"wise-flow": patch
---

`wrapText`, and with it `wrapActivityText`, `activityKeyLines`, the
activity key and caption of `figureFrame`, `toSVG` and the PNG export, and
the legend's wrapped texts, finds the words that still fit on a line by
doubling and halving instead of measuring the line again for each word. A
text of thousands of words on a wide line, such as the activity key of a
very wide map, took seconds; it now costs a few measures per line. The
lines are the same as before.
