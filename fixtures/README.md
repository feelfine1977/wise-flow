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
