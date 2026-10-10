# Feature map

Updated 27 September 2026. **Shipped** means implemented/exported in the local
0.3.1 candidate, not published or fully qualified. **Partial** means a usable
surface has known contract or verification gaps. **Planned** means an acceptance
target without a completed implementation. Correctness and CI are **implemented and locally verified, with hosted qualification pending**; see [verification](VERIFICATION.md) for actual counts and limits.
Milestone IDs refer to [ROADMAP.md](ROADMAP.md).

## Current surfaces and next acceptance

| Feature / status | Source | Existing test evidence and remaining work |
| --- | --- | --- |
| Headless graph model — **shipped** | [model](../src/core/model.ts), [root exports](../src/index.ts) | [Model tests](../tests/core/model.test.ts), [consumer core](../tests/package/core.mjs). WF-02 adds versioned context and metric semantics; root must remain DOM/React independent. |
| Abstraction, collapse, diff — **partial** | [aggregate](../src/core/aggregate.ts) | [Abstraction tests](../tests/core/abstract.test.ts). WF-01 verifies focus and overlay repairs; WF-02 exposes original membership and approximation. Connectivity restoration does not establish observed traces. |
| ELK/Dagre, shared positions, lanes — **partial** | [layout](../src/core/layout.ts), [lanes](../src/core/lanes.ts) | [Layout](../tests/core/layout.test.ts), [cache and workers](../tests/core/layout-cache.test.ts), [stopping and fallback](../tests/core/layout-stop.test.ts), [lanes](../tests/core/lanes.test.ts), [map](../tests/react/ProcessMap.test.tsx). WF-01 verifies cache identity; Abort, timeout and replaced requests terminate their workers; WF-05 adds bounds and measurements. |
| Scales, constraint overlays, label sizing — **shipped** | [style](../src/core/style.ts), [overlays](../src/core/overlays.ts), [labels](../src/core/label-sizing.ts) | [Scales](../tests/core/scales.test.ts), [overlays](../tests/core/overlays.test.ts), [labels](../tests/core/label-sizing.test.ts). Supplied results are displayed; no conformance computation. WF-02 makes units and approximation inspectable. |
| ProcessMap, selection, menus and filters — **partial** | [ProcessMap](../src/react/ProcessMap.tsx), [actions](../src/core/actions.ts), [filters](../src/core/filters.ts) | [Interaction](../tests/react/Interaction.test.tsx), [filters](../tests/core/filters.test.ts), [selection](../tests/core/selection.test.ts). WF-01 verifies nested/collapsed target equivalence; WF-02 adds stale-context and cross-phase contracts. |
| Activity paths and pair routes — **partial** | [paths](../src/core/paths.ts), [PathList](../src/react/PathList.tsx) | [Paths](../tests/core/paths.test.ts), [PathList](../tests/react/PathList.test.tsx). WF-01 verifies focus and route objective; WF-02 explains hidden/reconnected rows and traversal order. Routes are not exact variants. |
| Named views and comparison scales — **shipped** | [views](../src/core/views.ts), [ViewSwitcher](../src/react/ViewSwitcher.tsx) | [Views](../tests/core/views.test.ts), [browser views](../tests/visual/bpmn.spec.ts). Shared geometry/scales exist; compatible cohort/denominator selection and saved comparisons belong to Workbench. |
| Canvas and PNG/SVG export — **partial** | [Canvas](../src/canvas/index.ts), [PNG](../src/canvas/png.ts), [SVG](../src/core/export.ts) | [Canvas](../tests/core/canvas.test.ts), [export](../tests/core/export.test.ts), [browser interaction](../tests/visual/interaction.spec.ts). Recording-context tests do not establish pixel correctness. WF-04/05 qualify real export and performance. |
| BPMN-lite, import/export, viewer/modeler — **shipped** | [BPMN exports](../src/bpmn/index.ts), [BpmnView](../src/react/BpmnView.tsx) | [Round-trip](../tests/core/bpmn-roundtrip.test.ts), [selection](../tests/react/BpmnSelection.test.tsx), [browser](../tests/visual/bpmn.spec.ts). Supported mappings and warnings apply; arbitrary XML is not guaranteed lossless or executable. |
| TraceTimeline — **partial** | [TraceTimeline](../src/react/TraceTimeline.tsx) | [Replacement regressions](../tests/react/TraceTimeline.test.tsx) cover stale state, invalid timestamps and Enter/Space selection. WF-04 extends anchor/timezone and manual accessibility coverage. No large-sample guarantee. |
| Accessible tables, announcements, localisation — **partial** | [table](../src/react/TableAlternative.tsx), [strings](../src/core/strings.ts) | [Table](../tests/react/TableAlternative.test.tsx), [menu](../tests/react/ContextMenu.test.tsx). English/German strings and map keyboard support exist; WF-04 verifies complete interaction/text parity and manual accessibility. |
| Exact variant exploration — **planned** | No exported variant component; [React exports](../src/react/index.ts) | WF-03 adds sequence/loop/population tests, accessible strip/list and linked case journey. wise-pm supplies exact membership; Flow highlights and emits intent. |
| Cross-phase investigation context — **planned** | Existing [callback types](../src/react/types.ts) are the extension point | WF-02/03 require delayed-response, mapping-change and restore-context tests. Workbench persists state; Flow has no investigation store. |
| Advanced charts, replay and workshop tools — **planned** | No exported spectrum/dotted-chart/variant-strip components | WF-07 chooses one justified view at a time. Timeline span annotations already exist; durable workshop annotation editing is separate. |
| Packaging and CI qualification — **partial** | [workflow](../.github/workflows/ci.yml), [package gate](../scripts/test-package.mjs) | [Consumer](../tests/package/), [visual suite](../tests/visual/), [accessibility](../tests/browser/accessibility.spec.ts). WF-01 verification pending; WF-06 qualifies Node 22/24 and React 18/19 support and release bytes. Hosted success and remote branch rules require separate confirmation. |

## User actions and responsibility

| User action | Flow presents/emits | Exact calculation or persistence |
| --- | --- | --- |
| Focus an activity, stage or variant | Related geometry and sequence context; no automatic cohort claim. | Workbench retains selection; wise-pm is queried only for explicit analysis/filter intent. |
| Keep/exclude a transition or activity pair | Typed direct-follows or eventual-follows intent over original IDs. | wise-pm evaluates membership; Workbench updates filters and rejects stale results. |
| Inspect a repeated variant | Ordered occurrences, counts, coverage, exception ranking and table: planned WF-03. | wise-pm defines exact variant identity and eligible population, including incomplete cases. |
| Author/evaluate an expectation | Selected targets and supplied evaluation overlays. | Workbench owns forms and saved expectations; wise-pm evaluates them. |
| Compare phases or plan improvement | Shared scales, readable metrics and selected evidence. | Workbench preserves investigation context and decisions; wise-pm supplies comparable statistics. |

Do not label local highlighting as filtering or a route as an observed sequence.
The current path totals count transitions; they do not prove unique case totals.
Abstraction can hide detail without changing host membership. Collapsed counts,
maxima and weighted summaries require explicit meaning, not stronger statistical
claims. Unsupported exact actions need a visible explanation.

## Verification boundaries

Existing core, jsdom, packed-consumer and Chromium suites cover different layers.
Stories and screenshots establish neither exact membership nor complete
accessibility. Candidate bug regressions, coverage and compatibility additions
must be assessed on the final revision; advanced-variant, full cross-phase,
bounded-performance and comprehensive accessibility acceptance remain open.

Use [public fixtures](../fixtures/README.md) and synthetic counterexamples for
every new contract. Routine CI needs no private data or running wise-pm service.
Host integration tests can start from recorded synthetic responses, then validate
the agreed schema in both products. The [roadmap](ROADMAP.md) defines completion
gates and proposed budgets; no performance target here is a measured guarantee.
