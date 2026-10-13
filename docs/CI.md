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
| Static and architecture | `lint`, `typecheck`, `check:architecture`, `check:workflows`, `test:tooling`, production `npm audit` | Strict source types; headless imports cannot reach React/renderers; the BPMN bridge's modules other than its entry point load neither React nor bpmn-js eagerly, and Node tests do not import the entry point or React; outside the core, names the core entry point provides are imported from it; the scene and the map controller stay in the core and no other module declares their names; the React map, the Canvas renderer and the BPMN bridge import each other only through their hosts (`CanvasMap`, `map-elements`, `BpmnView`) and only the owning adapter loads React, React Flow, bpmn-js or bpmn-moddle; stories take their maps (and any library component that renders one) from `stories/maps.tsx` with a fixed edge budget and never ask for an adaptive one, so the browser and visual lanes do not depend on the machine's speed; no array is spread into `Math.max` or `Math.min`, whose argument count the engine limits; `tokens.css` is what `npm run tokens` generates from the token table; no pixel length, font size or weight, radius, stroke width, dash, opacity or z-order is written as a literal in `src/` outside the token table and the explained allow-list `scripts/literal-allow-list.json`; the built declarations of `wise-flow` export exactly the names of `scripts/core-exports.json`, deprecated as listed, and `docs/API.md` names every name the four entry points export; the library is emitted as the build does it (`tsconfig.build.json` for the JavaScript and its source maps, without comments; `tsconfig.types.json` for the declarations and their maps, with them): no emitted JavaScript file carries a comment but its `//# sourceMappingURL` line and the `/*! … */` notices its source writes, and none lacks such a notice (the compiler keeps a notice only at the head of a file with a line before the first statement that is blank or holds a comment other than a notice; a test compiles the cases that keep and remove one), every documentation comment of the source, on a declaration, a member, a member of a union or a parameter, stays on the same node in the declarations, and one position of a `.js` and of a `.d.ts` file leads through its map to its source line; YAML/policy validation; regression checks for the checkers; the parts, kinds and states of `docs/styling-contract.json` are drawn by the rendered fixtures and listed in the API document, and no part is drawn that the contract does not list; no known high/critical production advisory. |
| Unit/component, Node 22 and 24 | `test:coverage` | Synthetic graph invariants, deterministic behavior, interaction callbacks and lifecycle. Both lanes enforce whole-source coverage. |
| Installed package | Node 22 + React 18.3.1 + Chromium; Node 24 + React 19.2.8 + Chromium/Firefox/WebKit | A fresh consumer installs the actual tarball. Tests Node ESM/headless imports, both layout engines (Dagre also in its worker), BPMN round trip, strict NodeNext declarations, production bundling, worker/fonts/CSS, viewer/modeler and selection lifecycle. |
| Browser accessibility and renderer parity | Production Storybook build, `test:browser` | Axe WCAG A/AA checks on graph and timeline tables and on the paged, searchable tables, plus keyboard selection of a graph-table row; the paint order of the map (constraint arcs above the paths and below the activities); and a click on a BPMN task under hatching or a tint selects the task. A host rule of the styling contract's data attributes alone outlines a selected activity and strokes a path; an unlayered reset wins over the layered stylesheet and the unlayered one wins back. The computed styles of every element of fifteen story states equal their record (`tests/browser/computed-styles.json`, made before the stylesheet moved into its cascade layer, again when nodes and groups began to be drawn from their marks, again when the legend began to list only the kinds of marks drawn, and again when paths took the grey of their count and deviations the one accent, again when activities became cards, again when the legend became a key with paths by their cases and stages in stage order, and again when the controls became one zoom control and one set of panel primitives, the legend a strip and the map's menu and hover went back to "Clear Invoice", again when path width took one scale per graph, and again when paths began to end in a head that grows with the line, and again when the record began to hold only the library's elements and the form controls took their colours from the tokens, and again when the abstraction panel became the detail panel and the stories opened at detail shares, and again when the BPMN view's tints and hatching began to let clicks through to their task); only elements inside the library's roots are compared, never what a story draws around them in the browser's default font, and widths, heights and positions are left out, so the record holds on any OS; a test draws the story around the library in another font and colour and finds the record unchanged. Every form control of the panels, in every state the stories show (pressed, disabled, focused by keyboard, its placeholder), has a text, border and outline colour of the theme's tokens in the light and the dark scheme, not the browser's own. Hovering, selecting and focusing an activity's card changes its outline and keeps its fill, and a card outside the scope keeps a solid outline and a muted name. Moving the detail panel's "Activities" slider to the left by keyboard draws fewer activities and fewer paths at each step and leaves the "Paths" thumb in place while its statement changes, in the P2P map and the comparison of a vendor with the whole log. At the fitted zoom no panel (the legend strip, the detail panel, the zoom control, the status, the path list) covers an activity in the stories of the strict screenshots, and the right click meant for "Clear Invoice" at 1280 × 800 reaches it; in the dark scheme no panel, control, tooltip or table cell is lighter than the surface and the pattern ink has 3 : 1 on every stage colour; Axe WCAG A/AA checks on the panels of the DOM map (English and German), the Canvas map and the BPMN view, every control with a name, and the legend expanded and collapsed by keyboard and announced. The interactive DOM map, the Canvas map, the SVG export and the PNG export draw five committed fixtures, one node of every kind, a fixture in a second theme, a fixture under a host's CSS variables, the element kinds restyled by a theme's rules by kind, tag and state, and BPIC global with activity names in English and in German with another text measure alike, element by element (texts with the same lines and the same truncation, a card's frequency cue as long within a pixel; paths with their line join and arrowhead and its width, overlay marks with their arrowhead and label pill), three of them in the dark scheme too, except for the differences `tests/browser/parity/expected.json` lists exactly as found ([tests](../tests/README.md#parity-of-the-four-renderers)); and the DOM map and the live Canvas map draw a theme's rules of the selected and dimmed states alike. |
| Strict visuals | Ubuntu 24.04, locked Playwright/Chromium, `test:visual` | Ten behavioral checks including six screenshot assertions and the 5,000-activity Canvas scene. Missing/changed images fail; CI cannot approve them. |
| Artifact size | `check:budgets` after every packed-consumer lane | Bounds emitted library JavaScript, the ELK and Dagre workers together (assets, not library JavaScript), all consumer JavaScript including lazy assets, and the compressed tarball. |

The compatibility matrix is a set of deliberate pairings, not every Cartesian
combination. Runtime dependencies are resolved in each separate consumer; its
`consumer-package-lock.json` is retained so the exact graph is inspectable. The
package remains ESM-only. React peers still permit later versions, but versions
outside this matrix are not verified. There is no Windows/macOS hosted unit
matrix yet; local macOS execution does not prove Windows support.

## Coverage and test-driven changes

Vitest 4 uses separate Node and jsdom projects, at most four forks at a time (the
hosted runners have two to four cores). `tests/core/graph-size.test.ts` holds a
million-edge scene, about 1.9 GB per fork with coverage, so its own project runs it
alone after the others, with a time limit of two minutes per test. Vitest's limit
is 30 seconds per test; a test that needs more on two cores names its own limit,
twice what it takes there, scaled with `caseCount(1)` when it is a search
(`SEARCH_TIMEOUT` in `tests/support/malformed.ts` for the searches over malformed
input), never a global raise and never a retry. Coverage includes **all production
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

All external Actions are pinned by full commit SHA with the release version in
a trailing comment (`# v7.0.1`); checkouts do not persist credentials.
Workflows use read-only default permissions, finite job timeouts, concurrency
cancellation and no `pull_request_target`. Dependabot proposes npm and Actions
updates weekly; there is no automatic merge or publishing. Schedules run from
the default branch, so this configuration becomes scheduled only after it is
merged there.

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

Before pushing a change that adds tests or makes them slower, run the unit and
component suites at the hosted runners' size:

```sh
npm run test:hosted                          # two cores, one run
npm run test:hosted -- --runs 3              # three runs in a row
PATH=/path/to/node-22/bin:$PATH npm run test:hosted   # the Node that runs the script runs Vitest
```

[scripts/test-hosted.mjs](../scripts/test-hosted.mjs) runs `vitest run --coverage`
with `CI` set, as the workflow's `test:coverage` does, pinned with `taskset` to the
first two processors the machine allows (`--cores` changes the number), and Vitest's
four forks share them as on a hosted runner. It lists every test that failed and every
test that passed in more than half its time limit (`--headroom` changes the share),
and fails on either. Two cores of an Apple-silicon machine in a Linux container
came close to a hosted run: on 12 October 2026 the suites took 474 seconds there
(405 to 420 on the runners), every test that timed out on the runners took 30
seconds or more, and tests that passed on the runners took up to 27, so only half
the limit leaves a margin. Arguments after the options go to Vitest; reports are
written to `reports/hosted/`. `taskset` is
Linux's (util-linux); elsewhere run the script in a container limited to two
processors, for example
`docker run --rm --cpuset-cpus=0-1 -v "$PWD":/work -v /work/node_modules -w /work node:24 sh -c "npm ci && npm run test:hosted"`.

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

`npm run bench` is the benchmark, also not a gate: it times scene preparation,
simplification, Canvas frames, the React map's readiness, the first scene and
the abort of a layout, and the retained scene memory, in Node and in the
Playwright Chromium, and writes `artifacts/bench/bench.json` and `bench.md`
beside the numbers measured before the repairs and the latency targets. How to
run and read it is in [tests](../tests/README.md#benchmark).

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
