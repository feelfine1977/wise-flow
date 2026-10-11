---
"@wise/flow": minor
---

Appearance is scene data. The new `Theme` type holds the colour roles of the
light scheme and what the dark scheme changes, the data palettes (`neutral`,
`shortfall`, `performance`, `diverging`, `categorical`), the fonts, the text,
radius, stroke and spacing tables, a density and a list of rules (empty for
now); `defaultTheme` is the token table and `themeColors` resolves a scheme.
`buildScene(graph, positions, { theme, scheme })` resolves every mark's
outline, dash, radius, text style and data colour in it and carries the
colours of the paint roles (`FlowScene.theme`, `scheme`, `colors`). `toSVG`
and `toPNG` take `theme` and `scheme`, `prepareScene` and `<ProcessMap/>` take
`theme`; without them everything draws in the default theme and the light
scheme, as before. `buildScales`, `overlayMarks`, `overlayColor`,
`tintColor`, `arcWidth`, `edgeColor`, `edgeMarks`, `nodeMark`, `nodeMarks` and
`edgeMark` take an optional theme; `themePalette` names a palette of a theme,
and `ColorSpec.palette` also accepts `neutral`, `shortfall` and `performance`
(`sequential` and `sequentialBlue` keep working). Without `tokens`, the
Canvas drawing, its legend and the PNG export take the scene's colours and
font.

Groups are marks of the scene (`FlowScene.groupMarks`, `GroupMark`,
`groupMark`, `groupMarks`, `BoxSide`, `GroupNodeData.mark`,
`SceneGroup.mark`): tint, outline, a band's sides and rule, title and chip
anchor. The interactive map draws activities, stages, gateways, events,
notes and groups from their marks, the SVG export and the Canvas map draw
groups from them, and the four renderers now draw nodes and groups alike:

- Nodes cast no shadow in the interactive map.
- A gateway is a diamond in its box outlined 1.5 wide, its glyph at 14 (the
  interactive map drew a rotated square outlined 2 wide, glyph at 12).
- A stage's count is no longer semibold in the interactive map.
- The start event is outlined 2 wide everywhere (the scene said 1.5).
- Stage groups are outlined at full opacity in the SVG export, and with dashes
  of 6 and 4 at 1.5 in the interactive map, which drew a CSS dashed border.
- Bands are outlined in the line colour on the two sides between bands in the
  SVG export, as the other renderers drew them.
- A group covered by a tint keeps its own tint below it in the interactive map.

The stylesheet keeps the layout and interaction of nodes and groups; their
look comes from custom properties the components set from the marks
(`--wf-node-*`, `--wf-group-*`, `--wf-text-size`, `--wf-text-weight`,
`--wf-text-paint`). `tokens.css` no longer defines the role variables the
stylesheet read for node and group outlines, tints and texts (such as
`--wf-stroke-node`, `--wf-text-node-label`, `--wf-opacity-group-fill`); their
values come from the theme. `strokeTokens.eventStart` is 2.
