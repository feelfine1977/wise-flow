# tests

| Folder | Runner | Content |
|---|---|---|
| `core/` | Vitest (Node) | `abstract` keeps the fixture and random graphs connected and monotone; `layoutUnion` yields identical positions across filtered scenes; overlay geometry stays inside the declared bounds; scales and `toSVG` are deterministic; presets, hit index, model validation, formatting; BPMN-lite from the stage model and from the log; export → import round trip; import of the hand-written BPMN file with the mapping; views with shared domains; selection transitions, shapes, related elements and announcements; menu targets and default actions per element, pair and set; paths from the map and from the response's `paths` block, totals, sorting, the path between two activities; canonical filters, clause descriptions, preview normalisation, clauses of the map actions; stage and role lane bands on hand-made positions and on an ELK layout of the fixture; `prepareScene`, `drawScene` on a recording context (counts, level of detail, culling, dimming), `tracePath`, `drawLegend`, `toPNGCanvas`, `CanvasRenderer` viewport maths and hits |
| `react/` | Vitest (jsdom, `setup.ts` mocks ResizeObserver and layout APIs) | `<ProcessMap/>` ARIA, selection, hover, keyboard, controls, table view, own layout; the interaction of 0.3 (menu on right click and Enter, accelerators, announcements, host actions, Shift-click pairs, focus with the side list, pair path, response paths, filter chips, lane bands); `<ContextMenu/>`; `<FilterChips/>`; `<PathList/>`; `<TableAlternative/>`; `<BpmnView/>` headless import, ARIA description, table alternative, view toggle (bpmn-js itself needs SVG geometry that jsdom lacks, so its rendering is covered by Storybook and Playwright); `<ViewSwitcher/>` tabs and grid |
| `visual/` | Playwright (`playwright.config.ts` starts Storybook on port 6007) | screenshots of the P2P map, the stable-layout story, the BPMN stage-model diagram, the view grid, the paths of a focused activity and the stage lanes; a viewport check while overlay datasets switch; keyboard-only menu operation, filter chips and the Canvas renderer (hover tooltip, menu); baselines per platform in `__screenshots__/` (macOS recorded, Linux for the 0.2 stories); on a platform without a baseline the first run records it and reports a failure, the second run passes |

```sh
npm test                                   # core + react
npm run test:visual                        # needs `npx playwright install chromium`
npm run test:visual -- --update-snapshots  # refresh baselines after an intended change
```
