# tests

| Folder | Runner | Content |
|---|---|---|
| `core/` | Vitest (Node) | `abstract` keeps the fixture and random graphs connected and monotone; `layoutUnion` yields identical positions across filtered scenes; overlay geometry stays inside the declared bounds; scales and `toSVG` are deterministic; presets, hit index, model validation, formatting |
| `react/` | Vitest (jsdom, `setup.ts` mocks ResizeObserver and layout APIs) | `<ProcessMap/>` ARIA, selection, hover, keyboard, controls, table view, own layout; `<TableAlternative/>` |
| `visual/` | Playwright (`playwright.config.ts` starts Storybook on port 6007) | screenshots of the P2P map and the stable-layout story; baselines per platform in `__screenshots__/` (macOS recorded); on a platform without a baseline the first run records it and reports a failure, the second run passes |

```sh
npm test                                   # core + react
npm run test:visual                        # needs `npx playwright install chromium`
npm run test:visual -- --update-snapshots  # refresh baselines after an intended change
```
