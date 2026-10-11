---
"@wise/flow": minor
---

One set of controls, and a dark scheme with values of its own.

- **One zoom control** (new, `@wise/flow/react`): `ZoomControl` and
  `ZoomControlProps`: zoom in, zoom out, the current zoom and fit, as icon
  buttons with accessible names in a group named "Zoom". The DOM map, the
  Canvas map and the BPMN view draw it. The React Flow map no longer renders
  React Flow's `<Controls/>` (no `.react-flow__controls` element);
  `data-wf-part="controls"` is on the new control. The Canvas map's group was
  named "Fit the map" and is now "Zoom"; the BPMN view's text pills are icon
  buttons with the same names ("Readable size" a fifth one).
- **Fit inside insets** (new, `@wise/flow`): `fitViewport`, `panelInsets`
  and the types `Insets`, `FitView`, `FitOptions`. `CanvasRenderer.fit` takes
  insets after its padding, `CanvasMapHandle.fit` and `BpmnViewHandle.fit`
  take insets, and `<ProcessMap/>` and `<CanvasMap/>` take `fitInsets`. By
  default the fitted view keeps clear of the panels over the map (the
  abstraction panel, the legend, the zoom control, notes, a host's React Flow
  panels), so that no panel covers an activity. The React Flow map's fit
  button fits as the map does after a layout (it took React Flow's default
  padding of 0.1).
- **Legend strip.** `<Legend/>` opens as a one-line strip that names the
  measure and its unit, with the width samples, and a button
  (`aria-expanded`) expands it to the whole key and collapses it; the change
  is announced. New props `expanded`, `defaultExpanded`, `onExpandedChange`,
  `onAnnounce`. Exports always draw the whole key.
- **Sliders say what they keep.** `<AbstractionControls/>` takes `counts`
  (`KeptCount`, new): its readouts say "7 of 12" activities and "13 of 31"
  paths, and the sliders' value texts the threshold as well. The map passes
  the numbers of the shown graph.
- **Primitives.** Panels, buttons, chips and tooltips share one look modelled
  on the actions menu, through the tokens: buttons are paper with the
  control radius (they were the surface colour and pills), pressed toggles
  and the switcher's selected tab use the new colours `pressed` and
  `onPressed` (`tokens.css` no longer defines `--wf-on-focus`, which nothing
  reads now), tooltips (also the
  timeline's, which was ink) are panels, the table alternative has the paper
  as its ground, the sliders are drawn from the tokens. Every button of the
  panels carries `data-wf-part="button"`, the current zoom
  `data-wf-part="zoom-level"` (both new in the styling contract). Keys on a
  control of a panel are no longer taken by the map's keyboard.
- **Dark scheme.** Controls, panels, tooltips and table cells are no lighter
  than the surface. New colour `patternInk` (light #1f1f1f, dark #101114): the
  pattern twins of the stages are drawn in it by the DOM map, the Canvas map,
  `toSVG` and `toPNG`, where they were drawn in the ink (black in the DOM map
  and #ececec in the others in the dark scheme). `CanvasTokens.patternInk`
  (optional) is new. `tokens.css` sets `--wf-color-scheme`, and the stylesheet
  draws native controls in it; `themeVariables` writes it. `checkTheme`
  reports a pattern ink under 3 : 1 on a stage colour and `onPressed` under
  4.5 : 1 on `pressed`.
- **Tokens and strings.** New sizes `icon`, `sliderTrack`, `sliderThumb`
  and stroke `icon`; new strings in English and German for the zoom control,
  the legend's toggle and its announcements and the sliders' readouts.
