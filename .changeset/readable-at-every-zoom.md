---
"wise-flow": patch
---

The map keeps its texts readable at every zoom. A theme's `text.minScreenPx`
(default 9; CSS variable `--wf-text-min-screen`) is the smallest text on the
screen: below a zoom of about 0.86 the DOM map and the Canvas map scale the
texts of activity and stage cards up to it while they still fit their
cards, and shed what no longer fits in a fixed order: the number line, the
second line of the name, the name. A card without text keeps its name as its
hover title and its accessible name. Paths' labels, self-loop labels and the
labels of events, gateways and notes are shed first, once they would fall
below the floor; deviation pills (badges, chips, arcs' labels) are scaled up
to it and shed last. Group titles go with the cards' names. Card boxes and
positions never change with the zoom, and a level comes back only once the
zoom is 10 % past where it went, so nothing flickers at a boundary.
`readableAt(scene.readable, zoom, minScreenPx, previous)` is the one
decision; the scene carries each card's lines for each level, fitted once
(`FlowScene.readable`, `NodeMark.levels`). The DOM map writes the level on
its root as classes, once per zoom change; the Canvas map picks it per
frame (`DrawOptions.readable`, `readableFrom`). `defaultLod` draws badges,
arcs and chips from 0.2, with the names, where they went at 0.22. A host
that counter-scaled the map's text with CSS or a script removes that and
sets `minScreenPx` instead (see "Readable at every zoom" in the API
document).

**Exports draw the `print` theme by default.** `toSVG` and `toPNG` without a
`theme` now draw `print`, never the page's scheme: white paper, no tints, an
opaque pattern on every stage colour, the print ramps of the paths, and
every text at least 7 pt (`text.minFigurePt`) at the figure's width. Given
a `preset`, a `width` or the new `widthMm` (the width the figure is declared
to be printed at, in millimetres; the SVG then states its size in mm), the
figure is laid out at that width with the map scaled into it, so the legend,
caption and title keep their sizes; the map's texts follow the same rule as
on the screen at that scale, and where the cards cannot show their names
they are numbered and a key of the names stands beside the map (below it in
a narrow figure). `lodZoom` defaults to the map's scale in such a figure.
This changes every host's exports. To keep the old output, pass
`theme: "default"`: the figure is then drawn as before, one picture scaled
to its width, and is byte for byte the same. `prepareScene` keeps the
`default` theme, which the live Canvas map draws.
