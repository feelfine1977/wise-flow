# Contributing

- `core/` stays free of DOM and React; add a Vitest test with every change
  (`npm test`). Core tests run in Node, component tests in jsdom.
- Components ship with a Storybook story (`npm run storybook`) and a
  Playwright screenshot (`npm run test:visual`; use the separate
  `npm run test:visual:approve` only after an intended change; see `tests/README.md`).
- Public API changes go through `docs/API.md` and a Changeset
  (`npx changeset`); `CHANGELOG.md` is generated from them at release time.
- Colour never carries meaning alone; every visual has a table alternative,
  an ARIA description and a legend.
- User-visible text follows the workbench vocabulary: "priority",
  "expectation shortfall"; never "root cause", "fault" or "effect". Add new
  strings to `src/core/strings.ts` in English and German.
- Before finishing: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:package`.
- The fixture is derived data; rebuild it with `npm run fixture` when the
  script changes, never edit the JSON by hand.
