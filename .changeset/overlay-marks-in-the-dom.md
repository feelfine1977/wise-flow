---
"@wise/flow": minor
---

`<ProcessMap/>`, `<OverlayLayer/>` and `<BpmnView/>` draw overlays from the
scene's marks (`FlowScene.marks`) instead of deciding per overlay kind. One
mapping turns a mark into SVG elements (`markSvg`, `svgMarkup`, `SvgElement`,
`MarkSvgOptions`, `fitText`, `fitLead`); the SVG export writes them and the
two DOM renderers create the same elements with the theme's CSS variables as
paints. Chip marks carry what the map's chips show (`MarkText.lead`,
`OverlayMark.gauge`, `MarkGauge`, `chipText`, `chipLayout`, the paint
`line` and `fixedColors.line`). `OverlayLayerProps` gains `marks` and `zoom`;
`shapes` becomes optional and `showArcs` and `showSelfLoops` are deprecated
(without `zoom` the layer behaves as before). `ActivityNodeData` and
`GroupNodeData` gain `tint`, `marks` and `origin`; `ActivityNodeData.badges`
and `GroupNodeData.chips` are deprecated.

Visible changes:

- Map: an activity, gateway, event or note with a tint overlay is tinted in
  the value colour at 0.18, as in SVG, Canvas and the BPMN view; only groups
  were tinted before.
- Map: badges are drawn where the core places them (slots leftwards from the
  top-right corner, half above the element), as pills with the glyph and the
  share beside them with a halo, as in the exports; they used to be HTML
  pills with glyph and share inside, laid out by the stylesheet. A gateway's
  badges no longer turn with its diamond. Badges and chips now answer the
  pointer exactly where the scene's hit geometry has them.
- Map: chips are drawn at the box the core gives them, with the glyph, the
  gauge and the label in bold before the text; their share is formatted in
  the map's `locale` (group chips were always English).
- Map: hatching is the exports' pattern (8 px diagonal, 2 px line, 0.55
  opacity) over the element's box, also on groups; badges, chips and
  hatching below their zoom are left out of the DOM rather than hidden by
  `wf-lod-*` classes. Self-loop labels are 10 px, as in the exports (11 px
  before).
- Map and BPMN view: map-level chips in the legend, `<Chip/>` and `<Badges/>`
  are SVG drawings of their marks.
- BPMN view: badges, chips, tints and hatching are the same SVG drawings as
  on the map, inside the bpmn-js overlays; chips gain the gauge. Self-loops
  are drawn at full opacity (0.9 before) with 10 px labels. Overlay elements
  are classed `wf-<kind>` (`wf-bpmn-tint` and `wf-bpmn-hatch` before; tints
  also `wf-mark--below`), and the element markers are `wf-bpmn--<kind>`
  (`wf-bpmn--tinted` and `wf-bpmn--hatched` before).
- SVG, PNG and the Canvas map: chips show their glyph, the gauge and the
  label in bold before the text, as on the map; they used to show only the
  glyph and the text (or the label when there was no text). A chip with a
  label or a gauge is wider: 16 px padding, 12.4 px for the glyph, 46 px for
  the gauge and 6.2 px per character, up to 260 px.
- Stylesheet: the rules for `.wf-badges`, `.wf-badge`, `.wf-badge__share`,
  `.wf-group__chips`, `.wf-chip__gauge*` and `.wf-node--hatched::after` are
  gone, and the look of `.wf-chip` moved to `.wf-filter-chip` (filter chips
  carry both classes and look as before). Overrides of these classes in a
  host no longer apply to overlays. `.wf-badge` and `.wf-chip` on the map are
  SVG groups; the reverse arc's `wf-arc--reverse` class is gone (its dash
  comes from the mark).
