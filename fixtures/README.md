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
log (pandas and numpy required); the CSV itself is not part of the repository.
Download the [public log](https://doi.org/10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1)
and export it as CSV, then run:

```sh
npm run fixture -- path/to/BPI_Challenge_2019.csv
# Or use the environment:
BPIC2019_CSV=path/to/BPI_Challenge_2019.csv npm run fixture
```

The argument takes precedence over the environment variable. Without either,
the script stops with download instructions.

`p2p_stages.ts` — a purchase-to-pay stage model with known activities and
no log (five stages, optional steps, a goods-or-service choice, a loop),
on the ids and labels of the BPIC fixture; `withSceneMetrics` copies a
scene's metrics onto its activities.

`p2p_small.bpmn` — a hand-written BPMN 2.0 model (pool "Purchase-to-pay",
lanes Purchasing / Warehouse / Accounts payable, seven tasks of three
types, an exclusive split and merge, a rejection loop behind an exclusive
"Approved?" choice, so one token never becomes two, DI for every
element) for the import tests and the "overlays on a model" story; one
task id equals a fixture activity id, the labels match fixture labels, and
"Approve Invoice" has no counterpart, so the mapping shows all three cases.

`p2p_small.ts` — a small synthetic purchase-to-pay graph of 1,000 cases
(seven activities in four stages, the paths between them and a self-loop),
which the overlay catalogue and the parity stories draw; its activities'
shares of all cases are round (100 %, 12 %, 90 %, 6 %, 85 %, 4 %, 78 %).

`path-direction.ts` — small graphs for what the committed scenes do not
hold: two paths in opposite directions between the same activities
(`oppositePaths`), a path back across two stages (`backAcrossStages`) and a
stage with a long name and a chip of a measure that belongs to it
(`stageChip`, `stageChipOverlays`).

`text-measures.ts` — a text measure other than the core's estimate (0.7 em
per character), which the parity stories give to the map and the browser
lane to the exports by name.
