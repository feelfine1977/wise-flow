# Analysis interaction roadmap for wise-flow

27 September 2026 · Renderer analysis plan and acceptance requirements. Source checkpoint: **`0751f51d13b5e7157de81e5fa3c4e3ed4a76de44`**, local 0.3.1 candidate. Status claims apply to this source checkpoint; release qualification is separate.

## 1. Purpose and relationship to existing plans

Help users connect process behavior to the same evidence they inspect in tables and statistical charts. A selected activity, stage, route, variant or event should have a readable meaning and stable identity. Visual focus changes emphasis; only an explicit host-resolved filter changes analytical membership.

Follow [ROADMAP.md](ROADMAP.md), [FEATURE_MAP.md](FEATURE_MAP.md), [ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md), [CI.md](CI.md) and [VERIFICATION.md](VERIFICATION.md). This document expands their analysis contract; it does not restart WF-01–WF-07. Existing verification reports describe local checks with hosted qualification pending. Historical local results do not establish the current integrated release. “Shipped” in the feature map means implemented/exported in the local candidate, not a published or universally qualified release.

Workbench currently consumes a vendored 0.3.1 tarball. Its name/version alone does not establish byte/source equivalence with this checkout. Keep source and consumed-artifact qualification separate.

## 2. Source-grounded status and gaps

| Surface | Inspected implementation | Limit / next behavior | Priority and ownership |
| --- | --- | --- | --- |
| Graph model and exports | [model.ts](../src/core/model.ts), [root](../src/index.ts), [React exports](../src/react/index.ts) | Metadata can carry supplied context but is not a universal typed evidence envelope | P1 D2 schema with D1/D3 agreement |
| Selection/focus/filter callbacks | [types.ts](../src/react/types.ts), [selection.ts](../src/core/selection.ts), [filters.ts](../src/core/filters.ts) | Controlled selection/focus and host filter intent exist; cross-phase context/freshness remains partial | P0 D2 intent; D3 state; D1 membership |
| Paths and pair routes | [paths.ts](../src/core/paths.ts), [PathList.tsx](../src/react/PathList.tsx) | Aggregate routes and transition counts are not complete observed variants or unique-case totals | P0 labels/semantics; P1 variant surface |
| Collapse and abstraction | [aggregate.ts](../src/core/aggregate.ts), original-member/edge metadata | Summaries use policies including maxima and weighted averages; these are not recomputed union counts or pooled quantiles | P0 qualification metadata; D1 exact statistics |
| Layout/fit/scales | [layout.ts](../src/core/layout.ts), [views.ts](../src/core/views.ts), [label-sizing.ts](../src/core/label-sizing.ts) | Existing cache/layout/scales support stability; runtime bounds and all host placements need qualification | P1 D2; D3 placement integration |
| ProcessMap/Canvas/BPMN | [ProcessMap.tsx](../src/react/ProcessMap.tsx), [CanvasMap.tsx](../src/react/CanvasMap.tsx), [BpmnView.tsx](../src/react/BpmnView.tsx) | Multiple renderers; no authority to calculate host cohorts or arbitrary BPMN execution/conformance | P1 interaction parity; preserve attribution |
| Timeline and table | [TraceTimeline.tsx](../src/react/TraceTimeline.tsx), [TableAlternative.tsx](../src/react/TableAlternative.tsx) | Usable foundations; timezone/anchors/large sample/manual accessibility remain bounded claims | P1 D2; D1 supplies intervals/events |
| Exact variant list/strip | Not exported by current React index; planned WF-03 | Workbench's new variant summaries do not mean a reusable Flow component exists | P1 D2 component after D1 contract |
| Spectrum, Sankey, advanced analysis | Planned options in WF-07 | A visual name in earlier architecture is not an implemented export | P2 choose one justified view at a time |
| Packaging/accessibility/performance | Existing scripts, consumers, visual/browser tests and local report | Hosted results, complete assistive-technology equivalence and runtime targets not newly verified here | P0/P1 current WF qualification |

## 3. D2 responsibility in linked analysis

Core (`wise-pm`, D1) owns exact membership, full ordered variants, grouped statistics, interval pairing, units, denominators and evaluation. Workbench (D3) owns API queries, filters, scope history, permissions, persistence, comparison choices and investigations. Flow (D2) owns supplied process representations, abstraction/layout and accessible typed intent.

Keep generic facet/case tables and histograms/ECDF/scatter/control charts in Workbench unless a reusable process-specific component genuinely needs them. Do not move table joins, statistical models, scoring, causal language generation or a project database into Flow. A shared selection schema does not require a shared computation implementation in the browser.

Proposed additive envelope, to agree before coding:

| Field group | Meaning | Renderer behavior |
| --- | --- | --- |
| schema/context revision | compatible payload version; question/scope response identity | retain with callbacks; reject or ignore incompatible/stale payload under host protocol |
| analysis/mapping identity | observation, mapping, optional norm/view and origin | display readable context; do not infer identities from labels |
| membership | unit, digest, selected/base count, supported exact predicates | show supplied population; never derive exact membership from edges |
| measure metadata | unit, numerator/denominator, missingness/support, exact/approximate aggregation | legends/table/export carry meaning; missing does not render as zero |
| original identity | original activity IDs, edge targets, stage members, ordered variant occurrences | all actions reference original identities even after collapse |
| comparison | A/B identities, overlap, fixed/moving policy and scale policy | shared scale/geometry where possible; visibly label pinned or incompatible contexts |

Legacy payloads remain supported within a documented profile. Missing metadata means unknown and can make an exact action unavailable; it must not create fabricated provenance. Do not require all future fields in one breaking release.

## 4. Selection and interaction semantics

This is the target interaction contract. Existing controlled selection/focus and host filter callbacks are foundations; coordinated multi-table recomputation, exact cross-grain membership and frozen comparison history are planned host capabilities, not current Flow features.

**Highlight:** clicking/hovering a visual element identifies related elements and linked table rows without changing counts or scores. Transient hover differs from persistent selection; both can be cleared without clearing filters.

**Filter intent:** explicit Keep/Exclude/Apply requests a supported predicate over original IDs. The host resolves it against the analytical base population and returns a new scope revision. The renderer cannot assert that a filter succeeded merely because a chip appeared. Show pending/refused/active states from the host.

**Boolean composition:** Workbench owns union/intersection and history. Emit enough typed identity for the host to implement union within a named categorical group and intersection between independent groups. Nested/stage actions must not expand into ambiguous joins or synthetic IDs. Unknown-value/exclusion semantics are analytical, not visual.

**History and comparisons:** undo/redo, clear-to-base and frozen/pinned references are host operations. Flow preserves selection by original identity when valid, and explains invalidation when the new mapping/population no longer contains it. Layout mode, collapse/detail level, sorting and renderer changes do not change membership. A comparison must not silently change its baseline because the visible nodes change.

**Different grains:** a timeline event can select an event, a containing case or a matched interval through distinct labelled intents. Showing only selected events must not imply that their shortened sequence is an exact case variant. Case, event, transition and interval counts can differ; render the declared units instead of forcing them to agree numerically.

**Accessibility:** table rows and keyboard controls expose the same target IDs/actions as pointer interactions. Provide visible focus, escape/dismissal, status announcements and non-color cues. Keep text readable in compact panels as well as full-screen mode. A screenshot or automated scan is not a complete screen-reader/usability certification.

## 5. Visual choice matrix

These are recommendations for selecting the smallest adequate view, not a commitment to build every option.

| User question | View / role | Interaction | Semantic limits and owner |
| --- | --- | --- | --- |
| What happened before/after A? | Existing DFG + path table | focus A; explicit direct/eventual keep/exclude | routes through aggregates may be unobserved; D1 supplies exact cases, D2 labels |
| Which actual sequences dominate or contain repeats? | Proposed ordered variant strip/list + coverage table | highlight first; exact-case filter separately; inspect sample trace | repeats have occurrence index; top-N/other/unknown coverage; D1 membership, D2 representation |
| What happened to one case? | Existing timeline + event table | select witness/event/interval, link expectation | tied/missing clocks and lifecycle remain qualified; elapsed ≠ active work |
| Where does a phase connect to other phases? | Stage map with boundary/return edges | expand context while retaining selection | collapse/detail is visual; crossings/repeats cannot disappear semantically |
| Which groups differ in delay? | Workbench facet table + ECDF/histogram | brush range and link case/map focus | bins/measurement denominators/comparator fixed; D1 stats, D3 chart |
| How do defined populations transfer between states? | Possible Sankey/alluvial | select band → host membership query | needs explicit conserved unit and repeated-stage policy; DFG transition totals are insufficient |
| Are intervals clustered/batched over time? | Possible performance spectrum / dotted event chart | brush interval/time, link timeline | needs pairing, timezone/calendar and supported payload; D1 computes, D2 renders only if reusable |
| Is a process changing or stable? | Workbench run/control chart/calendar | select period, annotate context | control limits/seasonality/censoring defined elsewhere; D2 need only honor linked focus |
| Do measured outcomes support a pilot? | Workbench outcome series/effect plot | inspect frozen cohort and deviations | attribution/pilot state belongs in D3; no “causal success” inferred by renderer |

Variant/timeline work has higher immediate value than an additional decorative summary graph. A Sankey can be useful for a defined state-transition question but must not suggest conservation the data cannot establish. BPMN support remains limited to the declared import/export mappings and warnings; visual conversion is not full execution semantics. [OMG BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2).

## 6. Ordered delivery aligned with existing WF milestones

| Slice | Existing alignment | Deliverable | Testable exit |
| --- | --- | --- | --- |
| FL-A0 | WF-01 / WF-06 | qualify current correctness fixes and consumed artifact | exact source/tarball and supported consumer checks; hosted limits stated |
| FL-A1 | WF-02 | additive context/metric/original-ID contract | unknown/zero/approximate distinctions in map/table/export; late payload cannot claim current focus |
| FL-A2 | WF-03 | exact supplied variant list/strip and linked trace | ordered repeats, coverage and unavailable exact-action states; keyboard/table equality |
| FL-A3 | WF-02 / WF-04 | coordinated host journey and accessibility | map↔tables↔variants↔timeline↔norm/findings preserve original intent and context |
| FL-A4 | WF-05 / WF-06 | measured resource/performance and release qualification | bounded layout/cache/cancellation, real exports, strict visuals and packed consumer |
| FL-A5 | WF-07 | one extra process visual for a documented question | semantic payload, accessible alternative, host scope integration and measured cost before next view |

Do not combine a mechanical fit/label extraction with new defaults, collision behavior, lane ordering or score interpretation. Preserve existing defaults first; review new visual behavior separately with intentional baselines. Never add an internal network request to compensate for an underspecified host payload.

### FL-A1 acceptance

Use a graph with overlapping stage cases, unequal distributions, missing metrics and a delayed focus response. The renderer preserves supplied context/metadata through abstraction. A max of case counts is labelled as the existing aggregation, not a union; an absent interval is unavailable, not zero. Original IDs survive nested collapse and keep/exclude actions. Reconnected visual paths remain labelled as such.

### FL-A2 acceptance

Use `[a,x]` and `[x,b]` to demonstrate a DFG route that is not an observed variant. Use `[a,b,a,c]` and `[a,b,c]` to retain repeats and occurrence order. Add null labels, self loops, return-to-stage paths, ties and open cases. Keep the selected variant visible or explicitly explain invalidation after paging/mapping change. Top-N/other/unknown counts come from the host and reconcile; rare severe exceptions remain reachable without pretending frequency rank is intervention priority.

### FL-A3 acceptance

Acceptance for the proposed coordinated-table workflow: Workbench's tables must share one scope revision. Highlighting a variant changes emphasis only; applying its exact filter sends typed intent and waits for the returned population. A table action and the matching map action emit equivalent original targets. Switching Map/Model/Table does not change scope, comparison, selection or norm. Undo/clear belong to the host, and renderer updates retain focus sensibly. A saved finding is verified in Workbench, not inferred from a Flow callback test.

## 7. Test and qualification plan

Follow [CI.md](CI.md). Retain core/component tests, architecture/workflow checks, installed-package consumers, browser accessibility, strict target-platform visuals and artifact-size checks. Existing local reports are not fresh results for this handoff.

| ID | Minimal regression / gate | Owning test layer |
| --- | --- | --- |
| FL-T1 | collapsed/nested target equals explicit original IDs | core filter/action + component intent |
| FL-T2 | highlight emits no implicit population change; filter requires host result | controlled component + Workbench browser |
| FL-T3 | stale response/focus cannot appear under a newer scope | host async test + renderer replacement |
| FL-T4 | aggregate route never labelled exact variant | paths/variant component + host fixture |
| FL-T5 | ordered repeated activities survive strip, map focus and timeline | core payload + component/browser |
| FL-T6 | missing/zero/inapplicable/approximate metrics retain distinct text/export | metadata + table/legend/export |
| FL-T7 | same selection through Map/Canvas/BPMN/Table and keyboard | browser + packed consumer |
| FL-T8 | removed/empty trace, invalid clock, repeated anchor and timezone edge | timeline unit/component/browser |
| FL-T9 | layout options/input change, independent maps, cancellation/unmount | layout/resource tests and named benchmark |
| FL-T10 | packaged worker/fonts/CSS/BPMN attribution and real nonblank export | external consumer + browser export |
| FL-T11 | selected variant/query survives host navigation or explicit invalidation | Workbench integration using the tested tarball |

Write the failing minimal behavior first, implement in the correct owner, run focused checks, then relevant browser/package gates. Keep independent synthetic oracles in D1/D3 for counts and membership; Flow fixtures may use recorded synthetic payloads. Unit/recording-context Canvas tests do not prove pixel-correct export. Do not automatically approve screenshots or relax tolerances to make a changed layout pass.

Measure cold layout, cached layout, selection-to-paint, mount/change/unmount resources and cancellation on named fixture/runner/browser combinations. Existing WF-05 performance budgets are proposed targets until measured; artifact gzip size is not a runtime latency guarantee. Bound large graphs and offer reduced detail/table fallback rather than promising every view at every scale.

The configured package matrix includes deliberate Node 22/React 18 and Node 24/React 19 pairings with declared browsers; do not infer all future-major or Cartesian combinations are supported. Qualify and distribute the exact tarball, then test those bytes in Workbench. Source and version labels alone are inadequate.

## 8. D2 → D1/D3 handoff and verification boundary

D1 must provide exact/qualified statistics, full-sequence identity and supported selection semantics. D3 must provide current scope/context, error/freshness states, comparison policy and durable navigation/history. Flow must emit original identities, preserve order and meaning through abstraction, and offer accessible equivalent interactions.

The eleven-stage journey menu, goals, findings, norm authoring, causal/pilot/outcome status and multi-table persistence belong in Workbench. Saved-norm previews and a new valid draft norm do not establish the planned incomplete-draft/guided-authoring workflow; Flow renders supplied evidence and owns none of that persistence. Flow should not implement a duplicate completion state machine or endorse a causal label. It can render supplied evidence states without strengthening them.

Before additive integration, check whether later Flow changes already implement part of this plan. Reverify current export inventory, callback/context schema, aggregation qualifications, exact variant component status, packed artifact identity, hosted CI and browser/accessibility limits. This handoff makes no claim that future variants, Sankey/spectrum, causal support or complete linked-workspace persistence are already built.

