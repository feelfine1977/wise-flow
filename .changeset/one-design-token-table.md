---
"wise-flow": minor
---

Colours, palettes, the font stack, the default node sizes, the sizes of the
node and edge marks, the arrowhead rule and the pattern twins now live in one
token table in the core (`colorTokens`, `darkColorTokens`, `paletteTokens`,
`fontTokens`, `nodeSizeTokens`, `sizeTokens`, `textSizeTokens`,
`arrowheadTokens`, `patternTokens`, `hatchTokens`, `designTokens`), with
`patternTwin`, `arrowheadExtent`, `cssVariable`, `themedColors`,
`tokenVariables`, `arrowMarker`, `patternTwinSvg`, `hatchSvg` and
`markArrowhead`. `fixedColors`, `palettes`, `DEFAULT_SIZES`, `overlayArrow`,
`PatternId`, `PATTERNS` and the Canvas `defaultTokens` read the table and keep
their names and values. `patternDefs` takes any ink colour: its `ink`
parameter is typed `string` (it was the literal type of the default ink), and
`overlayArrow` is typed `{ readonly size: number; readonly overhang: number }`
(it had the literal types 12 and 0.1). `tokens.css` is checked against the
table.

Visible changes:

- SVG, PNG and the Canvas map: edges end in the live map's arrowhead, a
  closed triangle 3 long and 4.8 wide outlined by 0.6 in the edge's colour,
  its tip on the route's end. In SVG it was a marker 7 stroke widths wide; in
  Canvas a triangle of 8 plus the edge width (at most 16).
- SVG: pattern twins are 6-unit tiles with lines of 1 at 0.6 opacity and a
  dot of radius 1 at 0.7, as on the map. They were 8-unit tiles with lines of
  1.2 at 0.55 and a dot of 1.3 at 0.6.
- Canvas and PNG: the dotted pattern twin is a filled dot of radius 1 at 0.7,
  as on the map. It was filled and outlined at 0.6.
- The live Canvas map follows theme changes: it reads the CSS variables
  again when the `class`, `style` or `data-theme` of its host or an ancestor
  changes or the system's colour scheme switches. It read them once, when it
  mounted.
- `tokens.css` adds `--wf-on-focus` (text on the accent colour, used by
  pressed and selected buttons in place of `#fff`) and the default boxes of
  the other node kinds (`--wf-stage-width`, `--wf-stage-height`,
  `--wf-gateway-width`, `--wf-gateway-height`, `--wf-event-width`,
  `--wf-event-height`, `--wf-note-width`, `--wf-note-height`), which the
  stylesheet reads. A stage node takes its size from them instead of an
  inline style.
- `tokens.css` no longer defines the variables nothing read:
  `--wf-severity`, `--wf-mechanism`, `--wf-reservoir`, `--wf-pass`,
  `--wf-cat-0` to `--wf-cat-7`, `--wf-seq-0` to `--wf-seq-4`,
  `--wf-div-neg`, `--wf-div-mid` and `--wf-div-pos`. A stylesheet that used
  them can define them itself; the values are in `colorTokens` and
  `paletteTokens`.
