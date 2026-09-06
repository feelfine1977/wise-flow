# Checkpoints

How to try the milestones by hand. Requires Node 18.18 or later and npm 10.
Commands run from this directory. CP-E1 covers milestone 0.1, CP-E2
milestone 0.2 (section 6), CP-E3 milestone 0.3 (section 7).

## 1. Install and verify

```sh
npm install
npm test                # Vitest: 23 files, 126 tests
npm run build           # tsc → dist/ (ESM + types) and the stylesheets
```

Expected: every test passes; `dist/index.js`, `dist/react/index.js`,
`dist/bpmn/index.js`, `dist/canvas/index.js`, `dist/tokens.css`,
`dist/style.css` exist.

## 2. Storybook (CP-E1)

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

Playwright starts Storybook on port 6007 and compares the P2P map, the
stable-layout story, the BPMN stage-model diagram, the view grid, the
paths of a focused activity and the stage lanes with the baselines in
`tests/visual/__screenshots__/` (recorded on macOS; Linux baselines exist
for the 0.1 and 0.2 stories), checks that the viewport of the BPMN model
does not move while overlay datasets switch, operates the actions menu by
keyboard, adds and removes filter chips and hovers and right-clicks on the
Canvas renderer. On a platform without a baseline the first run records
one and reports it as a failure; the second run passes. Refresh baselines
after an intended change with `npm run test:visual -- --update-snapshots`.

## 4. Fixture

```sh
npm run fixture     # python3 fixtures/build_bpic2019_fixture.py [path/to/BPI_Challenge_2019.csv]
```

Rebuilds `fixtures/bpic2019_p2p.json` from the CSV (about a minute with
pandas). The output is deterministic for the same input.

## 5. Results at hand-over of 0.1 (CP-E1)

- `npm test`: 8 files, 51 tests passed (core invariants, layout stability,
  overlay geometry, deterministic scales and SVG, component behaviour).
- `npm run lint`, `npm run typecheck`, `npm run build`: clean.
- `npm run storybook`: 21 stories render; the P2P map runs on ELK in a
  Web Worker (`data-engine="elk"` on the map element), 23 activities and 35
  paths at the default abstraction, 17 arcs, 4 self-loops, 3 badges, 10
  hatched activities, 4 chips.
- `npm run test:visual`: 2 tests passed against the recorded baselines.

## 6. CP-E2 — milestone 0.2: BPMN and views

Open Storybook (`npm run storybook`) and walk through the *BPMN* and
*Views* groups. The bpmn.io watermark at the bottom right of every BPMN
diagram is part of the licence and stays.

### 6.1 BPMN › from stage model (P2P)

What appears: the purchase-to-pay stage model of `fixtures/p2p_stages.ts`
(five stages, eleven known activities, no log) as a BPMN 2.0 diagram on
bpmn-js: a pool "Purchase-to-pay" with the lanes Requisition, Purchase
order, Goods receipt, Invoice and Payment stacked top to bottom, one start
event, tasks in process order, XOR gateways around the optional
requisition stage, the optional order changes and the optional payment
block, an XOR split and merge around the goods-or-service choice, a loop
marker on Record Goods Receipt, one end event. The header reads
"11 tasks · 12 gateways · 2 events · 30 flows · 5 lanes".

What to do:

- Switch *Lanes* to *roles*: the same process with the lanes Requester,
  Purchasing, Warehouse, Accounts payable; *none* drops the pool.
- Tick *modeler*: the bpmn-js modeler with palette and context pad replaces
  the viewer; click a task, a flow or a lane and read the selection in the
  header ("selected tasks [clear_invoice] …"), which is what the constraint
  authoring forms receive.
- Tick *fixture overlays*: the constraint overlays of the BPIC 2019
  fixture land on the tasks by activity id (badges on Clear Invoice and
  Record Invoice Receipt, hatched tasks outside the consignment scope, lag
  and precedence arcs between Record Goods Receipt and Record Invoice
  Receipt, a chip with the manual-touches gauge on the Purchase order
  lane, three map-level chips under the legend).
- Tick *native process map*: the same BPMN-lite graph on `<ProcessMap/>`
  (gateways as diamonds, lanes as groups).
- Press *Table view*: tasks, flows and overlays as tables.

Pass when: the diagram shows five stacked lanes with all eleven tasks and
twelve gateways, no two shapes overlap, every flow is drawn orthogonally,
the modeler reports selections, and the overlays appear on the right
tasks.

### 6.2 BPMN › from log (BPIC 2019, abstraction slider)

What appears: the directly-follows graph of the whole log above the
thresholds of the two sliders (defaults: activities ≥ 5 %, paths ≥ 12 %)
turned into a BPMN-lite model: every node with several successors got a
split gateway, every node with several predecessors a join gateway, the
stage groups became lanes, self-loops became loop markers, and the fixture
overlays sit on the tasks. With the defaults the header reads
"9 tasks · 10 gateways · 2 events · 27 flows · 5 lanes".

What to do: move the *Paths* slider down to 5 %: more paths survive, more
gateways appear, the diagram is laid out again (this is a new model, not a
new dataset). Untick *AND gateways where concurrent*: the parallel gateways
(+) become exclusive ones (×). Move *Activities* up to 20 %: only the
strongest tasks remain and the model stays a connected chain from start to
end.

Pass when: the counts in the header change with the sliders, the model
always has exactly one start and one end event, and no task has more than
one incoming or outgoing flow without a gateway in between.

### 6.3 BPMN › overlays on a model

What appears: the hand-written model `fixtures/p2p_small.bpmn` (pool with
the lanes Purchasing, Warehouse, Accounts payable; seven tasks; two
gateways; a rejection loop) with the fixture's constraint overlays for the
dataset *All items*: 17 overlays, badges on Record Invoice Receipt (≤1 4 %)
and Clear Invoice (≥1 23 %), lag and precedence arcs between Record Goods
Receipt / Record Service Entry Sheet and Record Invoice Receipt with dashed
reverse arcs, hatched tasks outside the 3-way-match scope, map-level chips
under the legend. Below the diagram the mapping table lists every task
with the activity it was matched to: `record_goods_receipt` by id, five
tasks by label, and *Approve Invoice* unmapped.

What to do:

- Press *Vendor 0128*, then *All items*, then *None*: the overlays change
  (the vendor has fewer evaluated constraints, so some readings say "not
  applicable in this scene"), while the diagram does not move; the
  *viewport* readout in the header (x, y, zoom) stays the same.
- Pan and zoom the diagram, then switch datasets again: the viewport you
  chose is kept.
- Zoom out: badges, chips and arcs disappear below their level-of-detail
  thresholds.
- Tick *modeler*, select tasks, flows and lanes: the header lists them by
  FlowGraph id (activity ids where the mapping applies).
- Press *Table view*: the tasks appear under their activity ids where
  mapped.

Pass when: switching datasets changes the overlays and leaves the viewport
readout unchanged; the mapping table shows the three cases (id, label,
unmapped); arcs connect the mapped tasks.

### 6.4 BPMN › export → import round trip

What appears: the stage model exported to BPMN 2.0 XML with DI, parsed
back, re-exported, and eight checks in the header: parser warnings, DI for
every element, tasks, gateways and events, flows, lanes, positions,
re-export identical — all green. The left half is bpmn-js reading the
exported XML, the right half the re-imported graph on the native renderer.
*show XML* prints the file (about 36 kB); it opens in Camunda Modeler.

Pass when: all eight checks are green (`data-pass="true"` on the header
element).

### 6.5 Views › four views of one map

What appears: the abstracted P2P map (activities ≥ 1 %, paths ≥ 3 %) under
four tabs — Finance (expectation shortfall, presence and balance
constraints), Logistics (median lag in blue, lag arcs), Compliance
(shortfall with precedence, exclusion and applicability), Automation
(events per case in orange, singularity constraints). The note in the bar
says that colour and width scales are shared.

What to do: switch tabs — every activity keeps its position and every
path its width (the width legend reads 40 … 195k in every view); press
*All views*: the four maps as a 2 × 2 grid of small multiples with one
legend per distinct style; select an activity in one map and it is
selected in all four. The sibling story *small multiples* opens in the
grid.

Pass when: positions and path widths are identical across the four views
and the grid shows all four maps with their legends.

### 6.6 Results at hand-over of 0.2

- `npm test`: 13 files, 71 tests passed (the 51 of 0.1 plus BPMN-lite from
  the stage model and the log, export → import round trip with positions
  and an idempotent re-export, import of the hand-written file with the
  mapping, views with shared domains, `<BpmnView/>` and `<ViewSwitcher/>`
  in jsdom).
- `npm run lint`, `npm run typecheck`, `npm run build`: clean; `dist/bpmn/`
  is emitted for the `./bpmn` entry.
- `npm run storybook`: 27 stories render without console errors; the BPMN
  stories report `data-bpmn-status="ready"` and the counts named above.
- `npm run test:visual`: 5 tests passed against the recorded baselines
  (the first run on a fresh platform records the two new baselines and
  reports them, the second run passes).

## 7. CP-E3 — milestone 0.3: interaction, paths, filters, lanes, canvas

Open Storybook (`npm run storybook`) and walk through the *Interaction*,
*Layout* and *Canvas* groups. All three use the BPI Challenge 2019 map at
activities ≥ 1 %, paths ≥ 3 %, except the synthetic large map.

### 7.1 Interaction › select and context menu

What appears: the P2P map with the header "Selection: nothing · Last
action: –".

What to do:

- Click *Clear Invoice*: the header reads "activities Clear Invoice",
  unrelated elements dim. Shift-click *Record Goods Receipt*: both are
  listed, and the path between them appears at the side (two selected
  activities show their path).
- Right-click *Clear Invoice*: the actions menu opens under the pointer
  with the identity line (label, kind, stage, the worst expectation
  touching it) and the groups *Filter* (filter to, exclude), *Explore*
  (paths in and out, distribution lens, worst cases, and the host's own
  entry "Open the activity profile" added through `onContextMenu`),
  *Compare* (pin), *Author* (add expectation); every entry shows its
  accelerator letter. Press `o`: the menu closes and the header reads
  "profile on Clear Invoice". Press `w` after opening it again: "worst-cases
  on Clear Invoice".
- With two activities selected, right-click one of them: the menu is
  titled for the pair and offers the pair actions (filter to cases where
  one is followed by the other, the path between them, the lag lens, a
  lag or precedence expectation).
- Keyboard only: press Tab until the map has focus, an arrow key to move
  the focus ring, Enter to open the menu for the focused activity, the
  arrow keys, Home and End inside the menu, Enter or a letter to choose,
  Escape to close (focus returns to the map). Alt with an arrow key moves
  the focus along the paths (the focused path is highlighted; Enter opens
  its menu). Shift with an arrow key extends the selection.
- A screen reader (or the hidden live region, `data-testid="wf-live"`)
  announces "Selected: …", "Actions menu for … opened; 8 actions.",
  "Actions menu closed." and the result of every action.

Pass when: the menu opens on a right click and on Enter, every entry is
reachable by keyboard, the host's entry appears, the header shows the
chosen action, and two selected activities open the pair menu.

### 7.2 Interaction › paths for an activity

What appears: *Record Invoice Receipt* is focused: it, its predecessors and
successors and the paths between them stay bright while the rest of the
map is dimmed; the map is fitted beside a side list "Paths of Record
Invoice Receipt" with *Incoming paths (26 paths)* and *Outgoing paths* —
transitions, cases (share of the activity's cases), median and 90th
percentile lag, expectation shortfall — and a total row equal to the
activity's in- and out-counts. The note under the title says where the
numbers come from: with *paths from the analysis (full graph)* ticked, the
list reads the `paths` block of a focused flow response (here computed
from the full directly-follows graph, so it also lists paths the
abstraction hides); unticked, the numbers come from the map.

What to do:

- Click a column header to sort (▲ / ▼ and `aria-sort`); click a row: its
  path is selected on the map (or, for a path the abstraction hides, its
  two endpoints). Hover a row: the path is highlighted.
- Change the focus in the header select; press × on the list or Escape on
  the map to clear it (the map fits again).
- Select two activities (click, Shift-click): the list shows the path from
  the first to the second and the reverse path when one exists.

Pass when: dimming, the side list and the totals agree with the map, rows
select paths, and the source note changes with the checkbox.

### 7.3 Interaction › filters

What appears: two chips above the map ("case start 2018-01-01 –
2018-06-30", "cases with Record Goods Receipt"), "N_in of 251,734 cases ·
N_out removed" and per chip "−n by this filter alone" (the preview here is
a fixed share per clause; the workbench's numbers come from
`GET …/filters/preview`); the header prints the canonical filter JSON.

What to do: right-click an activity and choose *Filter to cases with this
activity* (`f`) or *Exclude* (`x`): a chip is added and the live region
says "Filter added: …"; press × on a chip (or Delete on a focused chip):
the chip is removed; *Clear filters* empties the bar. A time window with
`events_inside` would carry the "changes cases" mark. The map itself never
changes: it only calls `onFilterChange`.

Pass when: chips follow the actions, the canonical JSON in the header is
the same for any order of the same clauses, and the map does not filter.

### 7.4 Layout › stage lanes and role lanes

What appears: the P2P map with the stage groups Requisition → Purchase
order → Goods receipt → Invoice → Payment as five consecutive bands along
the flow, cut half-way between neighbouring stages and spanning the map;
no activity moved compared with *none*, which draws the groups as boxes
as before. *Role lanes*: the BPMN-lite model of the stage model with the
lanes Requester, Purchasing, Warehouse, Accounts payable stacked across
the flow; every task sits inside its lane, the flow order along the map
stays.

Pass when: the bands are in stage order and contiguous, switching the mode
does not move activities in the stage mode, and every task lies inside its
role lane.

### 7.5 Canvas › large map, P2P map on canvas, PNG export

What appears: a synthetic process with 5,000 activities and 19,800 paths
in ten stages (sizes selectable in the controls), drawn on a canvas
(`data-renderer="canvas"` on the map element, "renderer: canvas" in the
header) with stage bands, badges on every 97th activity, the abstraction
controls hidden and the legend at the bottom right.

What to do:

- Drag to pan, Ctrl or Cmd with the wheel (or the + / − buttons) to zoom:
  labels and badges appear as the zoom passes the level-of-detail
  thresholds; only the elements inside the viewport are drawn (the
  renderer's `lastDraw` counts them).
- Hover an activity: a tooltip with its description; click to select
  (Shift-click extends); right-click: the same actions menu as on the SVG
  renderer.
- Press Tab to focus the map, Home: the first activity is focused and
  centred; the arrow keys move the focus; Enter opens the menu.
- *P2P map on canvas*: the fixture map forced onto the canvas: the same
  overlays (badges, arcs, self-loops, hatching, chips), selection and
  menu.
- *PNG export*: press *Render PNG*: the abstracted P2P map with stage
  bands, title, context line and legend as a single-column figure at 2×
  density; the link downloads it.

Pass when: the large map pans and zooms smoothly, hover and the menu work
on canvas hits, the keyboard routes work, and the PNG shows the map with
its legend.

### 7.6 Results at hand-over of 0.3

- `npm test`: 23 files, 126 tests passed (the 71 of 0.2 plus the
  selection model, the default actions, the paths from the map and from
  the response, canonical filters and chip texts, stage and role lanes,
  `prepareScene` / `drawScene` / `toPNG` / `CanvasRenderer` on a recording
  context, `<ContextMenu/>`, `<FilterChips/>`, `<PathList/>` and the map's
  interaction in jsdom).
- `npm run lint`, `npm run typecheck`, `npm run build`: clean; `dist/canvas/`
  is emitted for the `./canvas` entry.
- `npm run storybook`: 35 stories render without console errors.
- `npm run test:visual`: 10 tests passed against the recorded baselines
  (six screenshots; the paths and stage-lanes baselines are recorded for
  macOS, the 0.1 and 0.2 stories also for Linux).

## Not done

- Orthogonal edge routing and bundling on the abstracted map and the
  position cache keyed by norm fingerprint and mapping version: moved to
  0.4 (see `docs/ROADMAP.md`).
- The Canvas renderer draws the whole scene in one pass per frame (with
  viewport culling above 1,500 elements); there is no dirty-rectangle
  redraw yet. Edge labels on the canvas are drawn at the polyline midpoint
  without collision avoidance.
- The default actions name what the host has to do (`lens`,
  `worst-cases`, `pin`, `add-constraint`); the map performs the filter,
  paths, collapse and expand actions itself. The distribution lens, worst
  cases, pinning and the norm editor belong to the workbench.
- Role lanes drop the routes of paths that cross lanes (they are drawn as
  straight connections); a swimlane routing lives in `layoutBpmn`.
- BPMN authoring forms: `<BpmnView/>` reports selected tasks, flows and
  lanes; the forms that turn a selection into a constraint belong to the
  workbench (0.4 in the roadmap).
- `liteFromGraph` decides AND gateways with the directly-follows heuristic
  (successors that follow each other in both orders); it does not mine
  concurrency from the log, and a model above a low threshold can carry
  many gateways. BPMN-lite does not produce sub-processes, message flows
  or boundary events; the importer reads them.
- `layoutBpmn` places every lane as one band and routes flows with a
  three-segment Manhattan rule; back edges run below the shapes and may
  cross tasks in a dense lane. The ELK compound layout is available with
  `lanes: "compound"` when a swimlane picture is not wanted.
- `<BpmnView/>` in modeler mode offers bpmn-js's own editing; overlays are
  re-projected after every change, but arcs are recomputed from the
  element boxes, not from the modeller's connection routes.
- bpmn-js needs SVG geometry that jsdom does not provide, so the component
  tests cover the headless import, the table alternative and the controls;
  rendering is checked in Storybook and Playwright.
- The keep-connected reconnection is bounded but not a global optimum:
  between neighbouring thresholds the number of re-added paths may differ
  by one (documented in `docs/API.md`, tested on the fixture and 40 random
  graphs).
- German strings exist for the core, the map and the BPMN view, not yet
  for every story text; the workbench's design-tokens package does not
  exist yet, so `src/tokens.css` carries the variables under the intended
  names.
- Playwright baselines exist for macOS only; Linux baselines have to be
  recorded once in CI.
