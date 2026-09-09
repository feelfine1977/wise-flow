# Tests

- `core/`: Node unit tests for graph invariants, layout, overlays, filters, lanes,
  Canvas scene preparation and BPMN XML import/export.
- `react/`: jsdom tests for components, callbacks, selection and accessibility.
- `package/`: a synthetic consumer copied to a temporary directory outside the
  checkout by `npm run test:package`. It installs the tarball with `npm ci` and
  uses package exports exclusively. Node ESM imports, both layout engines,
  declaration checking without `skipLibCheck`, a Vite production build, real
  browser Map/BPMN viewer/modeler, watermark, fonts and the ELK worker are checked.
- `visual/`: ten Playwright Storybook checks, including six screenshots per OS.
  All existing tolerances and behavioural assertions remain in force.

```sh
npm test
npm run test:package
npx playwright install chromium
npm run test:visual
```

## Strict visual CI and deliberate approval

`test:visual` uses `updateSnapshots: "none"`: a missing or changed baseline fails
without writing baselines. CI also passes `--update-snapshots=none` explicitly.
The runner is Ubuntu 24.04; `@playwright/test` is pinned to 1.61.1, which selects
Chromium 149.0.7827.55 (build 1228). Use `npm ci` to retain that environment.
The hosted runner's OS image updates separately; a future image change still
has to pass these checks.

For an intentional screenshot change, run outside CI on the matching OS:

```sh
npm run test:visual:approve
npm run test:visual
```

The approval config refuses to run when `CI` is set. Review each image and the
behaviour it represents before accepting the proposed baseline diff. Never
rename or copy a `darwin` file into a `linux` baseline. To approve Linux changes,
use an Ubuntu 24.04 environment with the locked Playwright and browser, then
run the strict suite there. CI diagnostic artifacts contain actual/diff files;
they do not approve a change automatically.

The two missing interaction Linux images were recovered byte-for-byte from
[run 34035991497](https://github.com/feelfine1977/wise-flow/actions/runs/34035991497),
artifact `visual-baselines-linux` (9990219174), for source commit
`a561766aa158e9effeee132f6c1c045feb606b6a`. Their archive and image SHA256 values,
original paths and runner image are in `visual/baseline-provenance.json`.
They were visually inspected for the focused paths/list and ordered stage bands.
Recovery is not a fresh Linux execution of the modified checkout: run the strict
Linux CI suite before treating the candidate as Linux-validated.
