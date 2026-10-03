# src/canvas

Canvas 2D renderer for the same scene model as the React renderer, and PNG
export. Framework-free apart from the canvas API; `prepareScene` and the
drawing routines run in Node against a recording context (tests).

| File | Content |
|---|---|
| `scene.ts` | `prepareScene`: the core scene (`buildScene`) plus retained geometry (boxes, routes, colours, labels) and the R-tree for hover, click and culling |
| `draw.ts` | `drawScene` (groups, edges, nodes, overlays, edge labels; level of detail by zoom; viewport culling above 1,500 elements), `drawLegend` (the scene's legend with pattern twins), `tracePath` |
| `renderer.ts` | `CanvasRenderer`: canvas, viewport (pan, zoom, fit, centre), interaction state, hit-testing, animation-frame redraw, device pixel ratio |
| `png.ts` | `toPNG`, `toPNGCanvas`, `toPNGDataUrl`: the scene as a bitmap in the figure frame and with the legend of `toSVG` |
| `tokens.ts` | colours and fonts from the core's token table; `readTokens` picks the live values of their CSS variables up from an element |

`<ProcessMap renderer="auto">` uses the renderer above 2,000 activities plus
paths through `<CanvasMap/>` in `src/react`, with the same overlays,
selection, actions menu, keyboard routes, controls and legend.
