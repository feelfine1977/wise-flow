---
"wise-flow": minor
---

A readable opening for a large map. `<ProcessMap/>` and `<CanvasMap/>` take
a smallest zoom (`minZoom`): a number, or on the React map `{ readable:
level }`, the zoom from which every card still shows that level of its texts
at the theme's smallest screen text (`readableZoom`, from the scene's
readable rules). No fit, opening, wheel or button goes below it, and a fit
that cannot show the whole map at it shows the map from the start of the
process, with the overview; `openingView` judges whether the whole map fits
before the smallest zoom clamps it. `openKey` opens the map again when it
changes, so that a host that builds a new graph for each detail keeps the
view. `bringIntoView` brings a node, an edge or a group to the centre of the
view at a host's request (`elementPoint`; the map controller's new `reveal`
event, which the keyboard's routes use too), at the current zoom but at
least the smallest, and the keyboard position follows a node or an edge.
`onInView` tells the host, when the view rests on another part of the map,
how many cards and paths are in view of all (`partInView`, `inViewText`);
the detail panel says it while part of the map is out of view, and the
overview says it to assistive technology, in English and German. Where two
activities' names are shortened alike, on the cards and at every level, each
shows its start, an ellipsis and the part from the first character that
tells it from the other (`distinctLines`, with `restOf`); the whole name
stays the title and the accessible name. Nothing changes for a host that
sets none of these.
