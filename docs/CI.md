# Continuous integration and release qualification

This repository has three boundaries: headless algorithms, renderer/interaction
adapters, and installed package exports. Test each boundary. Passing unit tests
alone does not qualify a package for use in Workbench.

## Required workflow

[ci.yml](../.github/workflows/ci.yml) runs on pushes, pull requests, merge queues
and manual dispatch. It publishes diagnostic and candidate artifacts, never npm
packages. Configure **CI passed** as the required branch check after its first
successful hosted run. It fails if any dependency failed, was cancelled or was
skipped. Branch protection is a repository setting, not something YAML enables.

| Lane | Executable checks | What it establishes |
| --- | --- | --- |
| Static and architecture | `lint`, `typecheck`, `check:architecture`, `check:workflows`, `test:tooling`, production `npm audit` | Strict source types; headless imports cannot reach React/renderers; the BPMN bridge's modules other than its entry point load neither React nor bpmn-js eagerly, and Node tests do not import the entry point or React; outside the core, names the core entry point provides are imported from it; the scene and the map controller stay in the core and no other module declares their names; the React map, the Canvas renderer and the BPMN bridge import each other only through their hosts (`CanvasMap`, `map-elements`, `BpmnView`) and only the owning adapter loads React, React Flow, bpmn-js or bpmn-moddle; no array is spread into `Math.max` or `Math.min`, whose argument count the engine limits; the built declarations of `@wise/flow` export exactly the names of `scripts/core-exports.json`, deprecated as listed; YAML/policy validation; regression checks for the checkers; no known high/critical production advisory. |
| Unit/component, Node 22 and 24 | `test:coverage` | Synthetic graph invariants, deterministic behavior, interaction callbacks and lifecycle. Both lanes enforce whole-source coverage. |
| Installed package | Node 22 + React 18.3.1 + Chromium; Node 24 + React 19.2.8 + Chromium/Firefox/WebKit | A fresh consumer installs the actual tarball. Tests Node ESM/headless imports, both layout engines, BPMN round trip, strict NodeNext declarations, production bundling, worker/fonts/CSS, viewer/modeler and selection lifecycle. |
| Browser accessibility | Production Storybook build, `test:browser` | Axe WCAG A/AA checks on graph and timeline tables, plus keyboard selection of a graph-table row. |
| Strict visuals | Ubuntu 24.04, locked Playwright/Chromium, `test:visual` | Ten behavioral checks including six screenshot assertions and the 5,000-activity Canvas scene. Missing/changed images fail; CI cannot approve them. |
| Artifact size | `check:budgets` after every packed-consumer lane | Bounds emitted library JavaScript, the worker, all consumer JavaScript including lazy assets, and the compressed tarball. |

The compatibility matrix is a set of deliberate pairings, not every Cartesian
combination. Runtime dependencies are resolved in each separate consumer; its
`consumer-package-lock.json` is retained so the exact graph is inspectable. The
package remains ESM-only. React peers still permit later versions, but versions
outside this matrix are not verified. There is no Windows/macOS hosted unit
matrix yet; local macOS execution does not prove Windows support.

## Coverage and test-driven changes

Vitest 4 uses separate Node and jsdom projects. Coverage includes **all production
TS/TSX files**, excluding declaration-only files; unimported implementation files
remain counted. Thresholds are statements **93%**, lines **95%**, branches **84%**,
functions **92%**: the measured whole-source values (93.3%, 95.08%, 84.18%, 92.24%
on Node 24) rounded down, raised from the initial floors of 82%, 84%, 69% and 81%
once the deepened modules gained tests at their interfaces. They are floors, not
quality targets. Review uncovered branches, especially filtering, replacement,
errors and resource cleanup; raise thresholds as meaningful tests are added. Never reduce them to hide a defect.

The previous Vitest 2 counters are not directly comparable to Vitest 4's AST
remapping. This change upgrades Vite to 6.4.3 and Vitest/coverage to 4.1.11 to close
high/critical tooling advisories. Coverage was remeasured with that exact toolchain
before setting these first gates. See [verification](VERIFICATION.md).

For a change:

1. Add a small synthetic failing example for the observable behavior. Use real
   graph IDs, repeated events, missing values and cohort changes where relevant.
2. Implement the smallest correction in its owning module. Keep exact case
   membership and scoring in the host/wise-pm, not in visual graph code.
3. Run its focused suite, then `npm run check`. Public behavior changes need
   relevant browser/installed-consumer checks and a Changeset.
4. For visual changes, inspect the actual/diff images on the target OS. Approve
   intentionally with `test:visual:approve` outside CI, then rerun strict tests.
   Do not rename macOS baselines to Linux or relax tolerances for unrelated changes.
5. Verify the candidate from a clean installation and record limitations. A failing
   assertion is investigated, not deleted merely to make the pipeline green.

Core tests already include seeded graph invariants. The new focused regressions
cover response focus, nested/collapsed membership, shortest-hop route semantics,
merged overlay identity, layout input changes and timeline replacement. Tooling
tests exercise negative boundary/budget/workflow examples, not just happy paths.
No private dataset, database, model server or credentials are needed.

## Security and dependency maintenance

[security.yml](../.github/workflows/security.yml) adds CodeQL JavaScript/TypeScript
analysis and a **full** dependency audit on main pushes, pull requests, weekly
schedule and manual dispatch. Audit fails at high/critical severity; moderate
advisories remain visible in the retained JSON. CodeQL upload permissions are
scoped to its job. If GitHub default CodeQL setup is already enabled, choose one
configuration before enabling this advanced workflow to avoid duplicate scans.
CodeQL execution success means analysis completed; alert severity/ruleset review
is separate. Require its status and review code-scanning alerts for releases.

All external Actions are pinned by full commit SHA; checkouts do not persist
credentials. Workflows use read-only default permissions, finite job timeouts,
concurrency cancellation and no `pull_request_target`. Dependabot proposes npm
and Actions updates weekly; there is no automatic merge or publishing. Schedules
run from the default branch, so this configuration becomes scheduled only after
it is merged there.

The npm audit gate uses the current advisory service and therefore needs network
access. An outage fails the check rather than silently certifying dependencies.
The initial scan retains three moderate entries for the same Storybook/uuid
chain; resolving them needs a supported Storybook migration. Do not force an
incompatible uuid major via an untested override.

## Local commands and diagnostics

Use Node 22 or 24; avoid accidentally running a different Node through an older
shell PATH. Then:

```sh
npm ci
npm run check
npx --no-install playwright install chromium firefox webkit
npm run test:package
npm run check:budgets
npm run storybook:build
npm run test:browser
npm run test:visual -- --update-snapshots=none
```

Focused commands: `test:core`, `test:components`, `test:tooling`. Set
`FLOW_REACT_VERSION=18.3.1 FLOW_REACT_TYPES=18` for a React 18 consumer, or
`FLOW_BROWSER=firefox` / `webkit` for another browser. `FLOW_ARTIFACT_DIR` changes
its output directory; use the same setting for `check:budgets`.

Unit coverage HTML/LCOV/JSON goes to `coverage/`; JUnit files go to `reports/` in
CI. Playwright retains screenshots, traces and video on failure, with an HTML
report. These folders and `artifacts/` are ignored. Artifacts expire after 14 days
on GitHub. The package consumer is temporary and removed on exit; its lockfile,
screenshot, asset sizes, tarball SHA and source provenance remain in artifacts.

[scripts/scene-memory.mjs](../scripts/scene-memory.mjs) is a diagnostic, not a
gate: after `npm run build` it prints the heap a prepared Canvas scene of a
sparse synthetic graph retains per node and per edge, part by part (hit index,
lookups, retained elements, marks and their texts); `--labels` turns activity
labels on, `--straight` leaves the edges without routes.

Budgets in [scripts/budgets.json](../scripts/budgets.json) are initial regression
limits, not load-time promises. The consumer total includes lazy BPMN/modeler and
ELK assets; it is **not initial page download size**. Runtime latency, memory,
manual screen-reader usability and broader host journeys remain explicit work in
[WF-02–WF-06](ROADMAP.md), not implied by coverage or screenshots.

## Owner release procedure

1. Commit and push the reviewed source and lockfile yourself. A Changeset records
   the patch intent; versioning and publishing remain separate owner actions.
2. Wait for **CI passed**, review security results and every required protection.
   This document does not claim remote branch rules are already configured.
3. Select a tarball from the passing run for that commit. Verify its SHA256 and
   provenance. Failure artifacts are diagnostics, never approved releases.
4. Test the exact tarball in Workbench before replacing its pinned vendor artifact.
   Host scope restoration and backend cohort correctness need host tests too.
5. Distribute those tested bytes. Do not rebuild after qualification and assume
   the new bytes are identical. A `v…` tag must match package.json; CI checks it.

References: [Vitest 4 migration](https://v4.vitest.dev/guide/migration.html),
[Playwright accessibility](https://playwright.dev/docs/accessibility-testing),
[visual comparison](https://playwright.dev/docs/test-snapshots),
[GitHub secure workflow use](https://docs.github.com/en/actions/reference/security/secure-use).
