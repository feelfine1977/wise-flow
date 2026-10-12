# src/canvas

Canvas 2D renderer for the same scene model as the React renderer, and PNG
export. Framework-free apart from the canvas API; `prepareScene` and the
drawing routines run in Node against a recording context (tests).

| File | Content |
|---|---|
| `index.ts` | the entry point of `@wise/flow/canvas` |
| `scene.ts` | `prepareScene`: the core scene (`buildScene`) plus retained geometry (boxes, routes, colours, labels) and the R-tree for hover, click and culling, each item covering the element's drawn extent (outline, selection ring, the arrowhead that grows with its path, texts) |
| `draw.ts` | `drawScene` (groups, edges, nodes, overlays, edge labels; level of detail by zoom; above 1,500 elements only what the R-tree finds in the viewport, read by its position in the scene's lists; with `edgeBudget` only the edges in view that `budgetEdges` keeps), `drawLegend` (the scene's legend rows with pattern twins), `tracePath`; the texts as the scene's measure fitted them; `canvasTextMeasure`, the text measure of a browser (Canvas `measureText`) |
| `renderer.ts` | `CanvasRenderer`: canvas, viewport (pan, zoom, fit inside insets, centre), interaction state, hit-testing, animation-frame redraw, device pixel ratio; the adaptive edge budget (frames of the gestures its host reports with `beginGesture` and `endGesture`, timed with the injected `clock`) |
| `png.ts` | `toPNG`, `toPNGCanvas`, `toPNGDataUrl`: the scene as a bitmap in the figure frame and with the legend of `toSVG`; with `edgeBudget` the edges a map showed or a budget keeps, and the note |
| `tokens.ts` | colours and fonts from the core's token table; `readTokens` picks the live values of their CSS variables up from an element |

`<ProcessMap renderer="auto">` uses the renderer above 2,000 activities plus
paths through `<CanvasMap/>` in `src/react`, with the same overlays,
selection, actions menu, keyboard routes, controls and legend.
