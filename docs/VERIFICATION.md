# Candidate verification — 27 September 2026

Base source: `1038764005c169dd22dfd997b7ca6b38c79f78c4`; candidate includes the
uncommitted correctness/CI changes described in its Changeset. Version remains
0.3.1, unpublished. This is local verification, not a hosted Actions result.

Environment: macOS arm64, Node 24.14.0, npm 11.9.0, TypeScript 5.9.3,
Vite 6.4.3, Vitest/coverage 4.1.11 and Playwright 1.61.1. Dependencies were installed
from the lockfile in an isolated checkout; existing application servers and data
were not used. No raw/private BPIC log is required for these checks.

| Check | Observed result |
| --- | --- |
| Clean `npm ci --ignore-scripts --no-fund --no-audit` | Passed; emitted build and browser tests run separately below. |
| Lint / typecheck / headless boundary / workflow policies | Passed; lint permits zero warnings. |
| Workflow schema/expression validation | actionlint 1.7.7 passed locally; download checksum verified. |
| Tooling regressions | 5 passed: architecture, workflow and size-check failure cases. |
| Unit/component suite | **179 passed in 26 files**, up from 137 in 25 files; no skip/expected-failure substitution. |
| Whole-source coverage | **84.95% lines, 82.14% statements, 69.82% branches, 81.47% functions**; all configured floors pass. |
| Build | TypeScript output and required styles, fonts, worker and notices produced. |
| Installed consumer, React 19 | Chromium, Firefox and WebKit passed, including strict declarations, ESM/headless, ELK/Dagre, BPMN and controlled selection lifecycle. |
| Installed consumer, React 18.3.1 | Chromium and strict React 18 declarations passed on local Node 24. Hosted Node 22 pairing remains unverified locally. |
| Browser accessibility | 3 passed: axe scans for graph/timeline tables and keyboard selection. This is scoped automation, not full WCAG certification. |
| Strict macOS visuals | 10 passed; six screenshot assertions; **no baseline updates**. This does not prove Linux equivalence. |
| Artifact size checks | Passed; reports retain separate library, worker, all-consumer-JavaScript and tarball measurements. |
| Dependency audit | Zero high/critical and zero production advisories at scan time. Three moderate records remain in the Storybook/uuid chain. |

The original Vitest 2 baseline was 85.80% lines/statements, 76.36% branches and
82.73% functions. Vitest 4 changes coverage remapping and denominators; those
figures are not a regression comparison. The first enforced floors use the new
whole-source measurement, with no implementation directories hidden from coverage.

## Corrections exercised

- Response focus and paths survive graph transforms; a mismatched focused response
  cannot be reused as another activity's paths.
- Nested/collapsed stage filters use original activity IDs; unsupported collapsed
  edge/pair filters are unavailable rather than emitting synthetic IDs.
- Fewer hops take priority over route strength; ties are deterministic.
- Overlays retain valid merged-edge or containing-stage targets. Separate values
  are preserved; folded arcs become labeled chips.
- Automatic layout keys include graph geometry/options and are map-owned; caller
  keys retain explicit reuse semantics.
- Removed/replaced hovered events no longer crash. Enter/Space selects the same
  current event as a pointer. Invalid timestamps remain in the table and are
  omitted from the time axis, with an explanation.

## What remains to qualify

Push the candidate and verify **CI passed** on GitHub, including Node 22, Linux
visuals and Linux browser dependencies. Review the separate CodeQL and full audit
results, then configure the required checks in repository settings. No hosted
run, branch protection change, registry publication or downstream Workbench
upgrade is claimed here.

Exact observed variants, host context digests, explicit approximation presentation,
large-input resource budgets, Windows compatibility and comprehensive manual
accessibility remain in the [roadmap](ROADMAP.md). A green screenshot or unit
suite is not proof of exact cohort membership, causal effects or readability for
every process. The [feature map](FEATURE_MAP.md) marks these distinctions.

The tested tarball's SHA, source patch/identity and installed consumer lockfile
are generated under `artifacts/`; they are not embedded here, which would change
the packaged document and its own hash. Use the final hosted passing run's
artifact for distribution rather than rebuilding it after qualification.
