# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, the source lint, workflow policies and artifact budgets | `npm run test:tooling` |
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

The origin of the current reference images is recorded in
[visual/baseline-provenance.json](visual/baseline-provenance.json): the source
commit, the date of the owner's approval, the macOS version and the container
image the Linux images were captured in, and the SHA-256 of all twelve files.
The Linux images were captured in that container, not on the hosted runner; a
strict run on the hosted runner is what qualifies them there.
