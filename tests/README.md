# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, workflow policies and artifact budgets | `npm run test:tooling` |
| `package/` | Separate consumer of the actual npm tarball; NodeNext types and real browser assets/lifecycle | `npm run test:package` |
| `browser/` | Production Storybook accessibility and keyboard tests | `npm run storybook:build` then `npm run test:browser` |
| `visual/` | Ten behavior checks including six screenshots and the large Canvas scene | `npm run test:visual` |

`npm run check` runs lint, typecheck, architecture/workflow guards, tooling tests
and unit/component coverage. Vitest counts all implementation files and enforces
reviewed floors (the measured values rounded down). It refuses focused `.only`
tests in CI. Reported coverage is not a claim of semantic completeness; graph
routes still differ from observed variants and grouped metric approximations
still require host evidence.

## Strict visual CI and deliberate approval

Strict visual tests use `updateSnapshots: "none"`; missing or changed baselines
fail without recording. CI pins Playwright 1.61.1 and runs Ubuntu 24.04 Chromium.
The hosted OS image can change independently and must still pass. For an intended
visual change, outside CI on the corresponding OS:

```sh
npm run test:visual:approve
npm run test:visual -- --update-snapshots=none
```

Approval refuses to run in CI. Review every proposed image and its behavior.
Never rename a `darwin` baseline to `linux`. Linux approval requires the matching
Linux environment. Failure artifacts contain actual/diff images and traces,
not automatically approved snapshots.

Historical provenance for recovered interaction Linux images is retained in
[visual/baseline-provenance.json](visual/baseline-provenance.json). They came from
[run 34035991497](https://github.com/feelfine1977/wise-flow/actions/runs/34035991497),
artifact 9990219174, source `a561766aa158e9effeee132f6c1c045feb606b6a`.
Their recovery does not establish a new candidate's Linux visual result.
