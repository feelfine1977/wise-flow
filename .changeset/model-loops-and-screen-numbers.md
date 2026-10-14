---
"wise-flow": minor
---

Draw model flow self-loops as ordinary paths, with supplied courses or a
sequence-flow course around the activity. They remain drawn under live path
budgets and count once, without being described as observed repeats.

When activity names cannot remain readable on screen, both maps draw numbered
markers and a keyboard-focusable key of full names. The key uses the styling
part `activity-key`. Shown SVG/PNG figures given a reported selection and `lodZoom` use the screen
text floor. `ExportOptions.readable`, `PngOptions.readable` and
`FigureFrameOptions.readable` replay the exact text state, including hysteresis.
Default figures retain their numbering and path selection. No entry-point
name, map prop or callback changes.
