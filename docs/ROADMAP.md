# Roadmap

Updated 27 September 2026. Version 0.3.1 remains an unpublished packaging
candidate. **Correctness fixes and CI are implemented and locally verified; hosted qualification remains pending.**
This plan replaces the broad 0.4 feature bundle with ordered, independently
testable milestones. [FEATURE_MAP.md](FEATURE_MAP.md) distinguishes implemented
surfaces from incomplete contracts and planned work; [API.md](API.md) and
[ARCHITECTURE.md](ARCHITECTURE.md) describe the existing interfaces and layers.
Milestone completion requires evidence for the final source revision, not a
historical test count. Dates and version numbers are not delivery commitments.

## Product direction and ownership

Make exploration understandable: choose an observed variant, inspect its repeated
activities and exceptions, follow the relevant cases, then carry that context
through expectation authoring, evaluation, comparison and improvement planning.
Keep one library with its existing core, React, Canvas and BPMN boundaries.

| Owner | Responsibility |
| --- | --- |
| **wise-pm** | Canonical activity mapping; exact case membership for direct/eventual follows and complete ordered variants; grouped statistics, denominators, missingness and evaluation results. |
| **wise-flow** | Validate supplied snapshots; abstract, lay out and render them; retain original element identities; expose accessible evidence and typed user intent. Visual focus changes emphasis, not case membership. |
| **Workbench** | Fetch and reject stale responses; persist investigation context, filters, selected variants, expectations, comparisons and decisions; translate intent into wise-pm queries; enable only supported actions. |

A route through aggregate edges is not an observed variant. Traces `[a,x]` and
`[x,b]` create route `a→x→b` without any case traversing it. Likewise, collapsed
`cases` maxima are not distinct-case unions, and weighted medians are not
recomputed quantiles. These distinctions must survive drawing, tables and export.

## Ordered milestones

### WF-01 — Correctness and CI qualification

**State:** implemented and locally verified; awaiting hosted CI. **Dependencies:** none.
Budget this as correctness and checks only; defer new analytical surfaces.
Retain a regression for each of the six audit defect categories:

| Regression | Testable acceptance | Test location |
| --- | --- | --- |
| Focus identity | Abstraction retains response focus; mismatched or delayed payloads never appear under another activity. | [paths](../tests/core/paths.test.ts), [interaction](../tests/react/Interaction.test.tsx) |
| Stage membership | Expanded, nested and collapsed keep/exclude actions emit equivalent original activity IDs; no synthetic stage IDs enter queries. | [filters](../tests/core/filters.test.ts), [actions](../tests/core/actions.test.ts), interaction |
| Layout identity | Direction, size, spacing, grouping and changed endpoints invalidate automatic reuse; independent maps cannot share incompatible positions. | [layout](../tests/core/layout.test.ts), [ProcessMap](../tests/react/ProcessMap.test.tsx) |
| Timeline replacement | Removing a hovered case or event, empty traces and invalid timestamps do not crash; valid selections still work. | [TraceTimeline](../tests/react/TraceTimeline.test.tsx) |
| Route objective | Fewer hops win before strength; ties and loops have deterministic results regardless of input order. | paths |
| Collapsed overlays | Merged edges retain valid overlay targets; multiple overlays have an explicit aggregation policy and unsupported combinations are disclosed. | [abstraction](../tests/core/abstract.test.ts), [overlays](../tests/core/overlays.test.ts) |

Exit only after the final candidate passes the gate below. Record actual test
counts and unsupported checks in the verification report. Existing green tests
alone do not close these regressions.

### WF-02 — Context and truthful evidence contracts

**State:** planned. **Dependency:** WF-01. Deliver the smallest additive contract
agreed with wise-pm and Workbench before building new charts.

Proposed snapshot fields: schema version, investigation/context ID, dataset,
mapping, norm and cohort versions, response focus, metric unit/denominator,
exact-or-approximate aggregation, and original node/edge membership. These are
proposals, not existing required API fields. Preserve legacy inputs; absent
metadata must produce an explicit unknown state, never fabricated certainty.

**Acceptance:** delayed responses from another context cannot replace current
evidence. Detail changes preserve host filter meaning. Lists explain which rows
are visible, hidden or reconnected; route tables retain traversal step numbers
even when sorted. Show missing, zero, not-applicable and approximate statistics
distinctly. Disjoint cohorts and unequal-distribution fixtures demonstrate why
case unions and quantiles must come from wise-pm.

Add core mapping/metric tests and component callback tests around
[aggregate](../src/core/aggregate.ts), [paths](../src/core/paths.ts),
[ProcessMap](../src/react/ProcessMap.tsx) and [PathList](../src/react/PathList.tsx).
Workbench must also test context restoration across exploration, authoring,
evaluation and comparison; Flow tests cannot establish host persistence.

### WF-03 — Variants first, with loops and exceptions

**State:** planned. **Dependency:** WF-02 plus a wise-pm variant/membership contract.
Scope the first slice to an ordered variant list/strip, its accessible table,
linked map focus and case/timeline drill-down.

**Acceptance:** `[a,b,a,c]` remains four ordered occurrences, distinct from
`[a,b,c]`; self-loops and repeated cross-stage visits stay inspectable. A stage
summary offers the original sequence on demand. Distinguish observed variants,
aggregate routes, direct follows and eventual follows in labels and actions.
Selecting a variant highlights it; a separate explicit action requests exact
membership. Disable that action with a reason when the host lacks support.

For a declared eligible cohort, displayed top-N, other and incomplete/unknown
populations reconcile without double counting. A rare severe exception outside
top-N remains reachable by exception ranking or search. Preserve a selected
variant through paging and cross-phase navigation, or explain its invalidation
after a context change. Never infer exact membership from edge counts.

Start with synthetic contract fixtures for loops, interleavings, tied frequencies,
open cases and the aggregate-route counterexample. Then add component and browser
journey tests and a packed-consumer example. No variant implementation or dedicated
variant suite exists yet; [TraceTimeline](../src/react/TraceTimeline.tsx) and
[PathList](../src/react/PathList.tsx) are integration points, not substitutes.

### WF-04 — Accessible exploration and dependable rendering

**State:** partial foundations; planned completion. **Dependencies:** WF-02, WF-03.
Apply accessibility acceptance to WF-03 from its first implementation.

**Acceptance:** pointer, keyboard and table expose equivalent actions and target
IDs across Map, Canvas, BPMN and timeline. Focus remains usable after cohort
replacement, menu dismissal and renderer changes. Test timeline empty/shortened
data, missing anchors, repeated anchors, invalid times and timezone boundaries.
New variant/timeline interactions pass automated accessibility checks and a
documented keyboard/screen-reader walkthrough; colour alone conveys no status.

Extend [interaction browser tests](../tests/visual/interaction.spec.ts) and
[table tests](../tests/react/TableAlternative.test.tsx). Verify real-browser PNG
output, font loading, dimensions and nonblank pixels as well as recording-context
Canvas tests. Keep strict screenshots for layout changes. English/German wording
and metric units must agree in controls, announcements, tables and exports.
Full assistive-technology and cross-browser equivalence remain unverified until
those checks run; an automated scan is only one part of this gate.

### WF-05 — Bounded layout and rendering performance

**State:** planned measurement and enforcement. **Dependencies:** WF-01, WF-04.
Candidate package-size guardrails belong to WF-01 qualification; the runtime
benchmarks and tighter initial-load target below remain future work.
The following are initial engineering targets, not measured guarantees:

| Fixture / resource | Proposed budget |
| --- | --- |
| Small synthetic map: 100 nodes, 300 edges | p95 cold layout ≤2 seconds; selection-to-paint ≤100 ms. |
| Dense synthetic map: 1,000 nodes, 5,000 edges | p95 layout ≤5 seconds; Canvas selection-to-paint ≤100 ms. |
| Stress map: 5,000 nodes, 20,000 edges | At 5 seconds offer cancel, reduced detail or table fallback; do not promise full interactive layout. |
| Layout cache and workers | At most 32 retained entries; deterministic eviction; teardown/cancellation releases owned workers and pending work. |
| Bundle | Target ≤300 KiB gzip initial JS for a minimal map consumer; separately record every lazy engine/BPMN chunk and worker. Assets requested initially count toward initial cost. |

Establish measurements on a named runner, locked browser and fixed seeds: three
warm-ups, twenty samples, cold and cached results reported separately. Record
memory before/after twenty mount/change/unmount cycles; set a numeric memory
ceiling after a reproducible baseline, without claiming one now. Check worker and
listener counts return to baseline. Gate stable resource limits immediately;
promote timing targets to enforced limits after calibration and review.

Benchmark [layout](../src/core/layout.ts), [Canvas renderer](../src/canvas/renderer.ts)
and [packed consumer](../scripts/test-package.mjs) separately from screenshot
tests. Stale layout results must be ignored; timeout fallback must not leave
expensive background work running indefinitely. Inputs exceeding supported bounds
get an explained reduction or failure state.

### WF-06 — Supported release

**State:** planned. **Dependencies:** WF-01 through WF-05.

**Acceptance:** qualify Node 22/24 and React/React DOM 18/19 with matching type
packages in clean packed consumers. The broad `>=18` peer range does not establish
future-major compatibility. Keep ESM and the headless root; preserve exported CSS,
fonts, worker and notices. Declare Chromium as the tested browser until explicit
Firefox/WebKit checks pass. Test missing assets, rejected imports and failed
loads as well as successful package installation.

Review API/declaration changes and Changesets, verify required remote checks,
and distribute the exact tested tarball with its checksum and check results.
No rebuild after qualification. Publish only after release review; neither
`prepack` nor a version number proves release readiness.

### WF-07 — One additional view at a time

**State:** planned options. **Dependencies:** WF-03 through WF-06.

Choose performance spectrum, dotted chart **or** Sankey only for a documented
user question that variants/timeline cannot answer. Each requires a bounded data
contract, accessible table, metric semantics, performance check and end-to-end
acceptance example before another view starts. Advanced routing, workshop
annotations, token replay and authoring conveniences remain separately scoped.
Workbench owns saved annotations and authoring workflows; wise-pm owns evaluation.

## Test-driven implementation and qualification

For each milestone: write the smallest failing synthetic example, implement core
semantics, test component intent, exercise a browser journey, then verify emitted
package behavior and update documentation. Use committed public fixtures and
synthetic data. Ordinary checks require neither private datasets nor fixture CSV
rebuilding, credentials or an analysis service.

WF-01's required gate is clean `npm ci`; `npm run check` for lint, strict
typecheck, architecture/workflow validation, tooling tests and coverage; build;
isolated `test:package`; `check:budgets`; production dependency advisory checks;
built Storybook plus `test:browser`; and strict Linux `test:visual` with
`--update-snapshots=none`. The aggregate CI gate must fail if a required lane
fails, is skipped or is cancelled. Retain browser diagnostics and package artifacts
on failure. [CI configuration](../.github/workflows/ci.yml),
[test scripts](../package.json), [Vitest configuration](../vitest.config.ts) and
[testing instructions](../tests/README.md) are the executable references.

CI additions are implemented in the current candidate; local results and hosted limits are recorded in [VERIFICATION.md](VERIFICATION.md): coverage reporting
with reviewed baseline thresholds, React 18/19 consumers, Firefox/WebKit package
smokes, accessibility and export checks. The configured minimum compatibility
pairings are Node 22/React 18 and Node 24/React 19; report untested combinations.
Review uncovered branches in identity, filtering and replacement handling;
percentage coverage cannot replace semantic regressions. Never silently lower a
threshold or approve screenshots in CI. Linux baselines require Linux execution
and deliberate review. Browser, performance and cross-phase host checks are
separate evidence; unit success cannot stand in for them.
