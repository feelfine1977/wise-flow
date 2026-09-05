# Checkpoint CP-E1 — Flow library, milestone 0.1

How to try the milestone by hand. Requires Node 18.18 or later and npm 10.
Commands run from this directory.

## 1. Install and verify

```sh
npm install
npm test                # Vitest: 8 files, 51 tests
npm run build           # tsc → dist/ (ESM + types) and the stylesheets
```

Expected: every test passes; `dist/index.js`, `dist/react/index.js`,
`dist/tokens.css`, `dist/style.css` exist.

## 2. Storybook

```sh
npm run storybook       # opens http://localhost:6006
```

### 2.1 Process map › P2P map

What appears: the BPI Challenge 2019 purchase-to-pay log (251,734 purchase
order items) as a directly-follows map laid out by ELK, with the stage
groups Requisition → Purchase order → Goods receipt → Invoice → Payment
from left to right, start and end events, path width by transition count
and colour by expectation-shortfall share, a legend at the bottom right and
the abstraction panel at the top left.

Constraint overlays from the fixture statistics:

- badges on `Clear Invoice` (≥1, 23 % missing), `Record Invoice Receipt`
  (≤1, 4 % repeated) and `Cancel Invoice Receipt` (∅, 3 % occur);
- arcs above the map from Record Goods Receipt / Record Service Entry Sheet
  to Record Invoice Receipt / Vendor creates invoice (lag, 19 % late;
  precedence, 52 % reverse) and dashed reverse arcs below the map;
- self-loops with the repeat share at the top-right corner of activities;
- hatched activities outside the consignment scope; a chip with the manual
  touches gauge on the Purchase order group and three map-level chips under
  the legend.

What to do:

- Move the *Activities* and *Paths* sliders: the map thins out and stays
  connected (re-added paths are dashed); surviving activities do not move
  while sliding because positions are cached per abstraction level.
- Press *Show stages*: five stage nodes replace the activities; *Show
  activities* returns.
- Zoom out with the mouse wheel or the − button: labels, badges, arcs and
  chips disappear in steps as the zoom drops below the level-of-detail
  thresholds; zoom in and they return.
- Click an activity: it is selected, unrelated elements dim; Shift-click
  adds to the selection; click the background to clear.
- Press Tab to focus the map, then the arrow keys: focus moves between
  activities (ring outline), Enter selects, Escape clears, Home/End jump.
- Press *Table view*: the same activities, paths and overlays as three
  tables with the same numbers; *Map view* returns.
- Hover a badge, an arc or a chip for the reading (label, share, threshold).

Pass when: the map renders with badges, arcs and hatching; the abstraction
sliders change the map without breaking it into pieces; overlays follow the
zoom level; the table view lists the same numbers.

### 2.2 Stable layout › Global vs vendor (union layout)

What appears: the whole log on the left and vendor 0128 (327 items) on the
right, both on one union layout; the header reads
"12 shared activities, 12 at identical positions, 0 moved."

What to do: compare the position of `Create Purchase Order Item`,
`Record Goods Receipt` or `Clear Invoice` on both sides; select an activity
on one side (the selection is shared). Open the sibling story
*Independent layouts (for comparison)*: the header now reports moved
activities.

Pass when: shared activities sit at identical coordinates on both sides
(0 moved) while the independent layouts move them.

### 2.3 Overlays › All constraint presets

What appears: a small synthetic purchase-to-pay graph on Dagre with one
example per preset: presence badge (≥1 22 %), singularity badge and
self-loop (≤1 17 %), exclusion badge (∅ 4 %), lag arc (⏱ 35 %), precedence
arc (⇒ 14 %) with a dashed reverse arc (⇐ 14 %), balance chip with a gauge
and a tint on the Purchase order group, hatched Record Service Entry Sheet
with the scope chip. The remaining stories show one preset each and the
raw overlay kinds.

Pass when: all six overlay kinds are visible and the legend explains them.

### 2.4 Table alternative and trace timeline

*Table alternative › Vendor scene as tables*: three tables with captions,
column headers and numbers; clicking a row selects it. *Trace timeline ›
Aligned at goods receipt*: three cases aligned at time zero, violated
events ringed and marked "!", annotation brackets; the *Table alternative*
story lists the same events.

## 3. Screenshot test

```sh
npx playwright install chromium
npm run test:visual
```

Playwright starts Storybook on port 6007 and compares the P2P map and the
stable-layout story with the baselines in `tests/visual/__screenshots__/`
(recorded on macOS). On a platform without a baseline the first run records
one and reports it as a failure; the second run passes. Refresh baselines
after an intended change with `npm run test:visual -- --update-snapshots`.

## 4. Fixture

```sh
npm run fixture     # python3 fixtures/build_bpic2019_fixture.py [path/to/BPI_Challenge_2019.csv]
```

Rebuilds `fixtures/bpic2019_p2p.json` from the CSV (about a minute with
pandas). The output is deterministic for the same input.

## 5. Results at hand-over

- `npm test`: 8 files, 51 tests passed (core invariants, layout stability,
  overlay geometry, deterministic scales and SVG, component behaviour).
- `npm run lint`, `npm run typecheck`, `npm run build`: clean.
- `npm run storybook`: 21 stories render; the P2P map runs on ELK in a
  Web Worker (`data-engine="elk"` on the map element), 23 activities and 35
  paths at the default abstraction, 17 arcs, 4 self-loops, 3 badges, 10
  hatched activities, 4 chips.
- `npm run test:visual`: 2 tests passed against the recorded baselines.

## Not done

- `<BpmnView/>`, `importBpmn`, BPMN-lite, the Canvas renderer, `toPNG`,
  `<VariantStrip/>`, `<PerformanceSpectrum/>`, `<DottedChart/>`: later
  milestones (see `docs/ROADMAP.md`); `renderer: "canvas"` falls back to
  the React Flow renderer.
- Edge routing: ELK routes edges as polylines around the stage groups;
  orthogonal routing and edge bundling on dense maps are left for 0.2.
- The keep-connected reconnection is bounded but not a global optimum:
  between neighbouring thresholds the number of re-added paths may differ
  by one (documented in `docs/API.md`, tested on the fixture and 40 random
  graphs).
- German strings exist for the core and the map, not yet for every story
  text; the workbench's design-tokens package does not exist yet, so
  `src/tokens.css` carries the variables under the intended names.
- Playwright baselines exist for macOS only; Linux baselines have to be
  recorded once in CI.
- Licence file: to be chosen by the owner (`docs/LICENSING.md`).
