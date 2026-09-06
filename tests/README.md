# tests

| Folder | Runner | Content |
|---|---|---|
| `core/` | Vitest (Node) | `abstract` keeps the fixture and random graphs connected and monotone; `layoutUnion` yields identical positions across filtered scenes; overlay geometry stays inside the declared bounds; scales and `toSVG` are deterministic; presets, hit index, model validation, formatting; BPMN-lite from the stage model (one start, one end, all activities as tasks, gateways only where needed) and from the log (gateways where nodes branch, AND heuristic, deterministic ids); export → import round trip (tasks, flows, lanes, ids, positions, metrics, idempotent re-export); import of the hand-written BPMN file with the mapping by id, label and alias; views keep positions and share scale domains |
| `react/` | Vitest (jsdom, `setup.ts` mocks ResizeObserver and layout APIs) | `<ProcessMap/>` ARIA, selection, hover, keyboard, controls, table view, own layout; `<TableAlternative/>`; `<BpmnView/>` headless import, ARIA description, table alternative, view toggle (bpmn-js itself needs SVG geometry that jsdom lacks, so its rendering is covered by Storybook and Playwright); `<ViewSwitcher/>` tabs and grid |
| `visual/` | Playwright (`playwright.config.ts` starts Storybook on port 6007) | screenshots of the P2P map, the stable-layout story, the BPMN stage-model diagram and the view grid; a viewport check while overlay datasets switch; baselines per platform in `__screenshots__/` (macOS recorded); on a platform without a baseline the first run records it and reports a failure, the second run passes |

```sh
npm test                                   # core + react
npm run test:visual                        # needs `npx playwright install chromium`
npm run test:visual -- --update-snapshots  # refresh baselines after an intended change
```
