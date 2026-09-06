# fixtures

`bpic2019_p2p.json` — two `FlowGraph` scenes derived from the BPI Challenge
2019 purchase-to-pay log (4TU.ResearchData, CC-BY-4.0) plus constraint
statistics:

- `scenes.global`: all 251,734 purchase order items, 1,595,923 events, 42
  activities in five stage groups (requisition, order, receipt, invoice,
  payment), 677 directly-follows paths with counts, cases, median and 90th
  percentile lags, plus start and end events;
- `scenes.vendor_0128`: one vendor (327 items) on the same ids;
- `constraints`: descriptions (presence, singularity, exclusion, lag,
  precedence, balance, applicability) with per-scene statistics such as
  `violationShare`, `coverage`, `medianDays`, `nodeShareInScope`.

`violationShare` on nodes and paths is the share of cases through the
element that violate at least one fixture constraint, so the scales have
something realistic to colour. `bpic2019.ts` gives typed access for
stories and tests.

`build_bpic2019_fixture.py` rebuilds the JSON from the CSV export of the
log (`npm run fixture`, pandas required); the CSV itself is not part of the
repository.

`p2p_stages.ts` — a purchase-to-pay stage model with known activities and
no log (five stages, optional steps, a goods-or-service choice, a loop),
on the ids and labels of the BPIC fixture; `withSceneMetrics` copies a
scene's metrics onto its activities.

`p2p_small.bpmn` — a hand-written BPMN 2.0 model (pool "Purchase-to-pay",
lanes Purchasing / Warehouse / Accounts payable, seven tasks of three
types, an exclusive split and merge, a rejection loop, DI for every
element) for the import tests and the "overlays on a model" story; one
task id equals a fixture activity id, the labels match fixture labels, and
"Approve Invoice" has no counterpart, so the mapping shows all three cases.
