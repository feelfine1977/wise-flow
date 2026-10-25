# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `support/` | Seeded generators for searching tests: random stream, graph families, positions and viewports, event schedules, shrinking, event logs and their directly-follows graphs, BPMN-lite models, mutated BPMN files, malformed input for every public entry point; fake layout workers and engines for lifecycle tests; a recording 2D context that says which element inked which canvas pixels; the ladder of abstraction settings with scenes of four magnitudes, readings of what a map drew with the properties they must hold, and the readings of an SVG export several tests share | imported by `core/` and `react/` tests and the story "Thresholds and sizes" |
| `fixtures/` | A directly-follows graph of an observed order-to-cash process (`o2c-observed.json`), read by the repositioning tests | imported by `core/` tests |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, the source lint, workflow policies, artifact budgets and the benchmark's report; the core entry point's built declarations against `scripts/core-exports.json`, deprecations and every exported name of the four entry points against `docs/API.md`; the token table and its generated `tokens.css`; the styling contract against the rendered fixtures and the API document; the emitted JavaScript without comments, the declarations with their documentation comments, and their maps; the table of invalid input against the entry points; the package's name `wise-flow` in the manifest, the lockfile and every changeset, Changesets' public access, and the former name only in the changeset and the migration note that give it; the processors a run at the hosted runners' size is pinned to and the tests it reports as tight | `npm run test:tooling` |
| `package/` | Separate consumer of the actual npm tarball; NodeNext types and real browser assets/lifecycle | `npm run test:package` |
| `browser/` | Production Storybook accessibility and keyboard tests, the map's paint order, host stylesheets against the styling contract and the cascade layer, the computed styles of the map and its panels against their record (only the elements inside the library's roots), the outline and fill of an activity's card when hovered, selected, focused and out of scope, the detail panel (fewer activities and paths drawn at each step of "Activities" to the left, "Paths" in place), the texts of the DOM map at least 9 px on the screen at every zoom its zoom control steps through, the controls (no panel over an activity at the fitted zoom, the dark scheme's panels, controls and table cells and its pattern ink, the controls' accessibility and names in English and German, and every form control's text, border and outline colour a token in every state and both schemes), and the parity of the four renderers, in a real browser | `npm run storybook:build` then `npm run test:browser` |
| `visual/` | Fourteen behavior checks including nine screenshots (three of the instrument look), the large Canvas scene and the fonts the map is drawn in | `npm run test:visual` |
| `bench/` | The benchmark: times on large and dense inputs in Node and in Chromium, beside the numbers measured before the repairs and the targets; not a gate | `npm run bench` |

`npm run check` runs lint, typecheck, architecture/workflow guards, tooling tests
and unit/component coverage. `npm run test:hosted` runs unit/component coverage on
two cores, as the hosted runners have, and reports the tests that passed in more
than half their time limit ([CI](../docs/CI.md#local-commands-and-diagnostics)).
Vitest counts all implementation files and enforces
reviewed floors (the measured values rounded down). It refuses focused `.only`
tests in CI. Reported coverage is not a claim of semantic completeness; graph
routes still differ from observed variants and grouped metric approximations
still require host evidence.

## Readable at every zoom

`core/readable.test.ts` holds what `readableAt` decides from the zoom (levels,
boosts, the labels and pills shed, the ladder, the hysteresis) against rules
written by hand, a card's lines at each level and where they lie, the pills'
growth, and the Canvas drawing of the BPIC maps at every zoom from 0.1 to 2 in
steps of 0.05, out and back in, each frame from the one before: no text under
9 px on the screen, the shedding order, every card's box where the layout put
it. It also holds the exports: `print` without a theme, never the page's dark
scheme, and at 85 mm no text under 7 pt, with the cards' numbers and a key of
every activity, in the SVG and the PNG. `react/Readable.test.tsx` holds the
same sweep on the DOM map (read with `map-reading.ts`, whose root classes it
checks against the core's decision), counts what a zoom change writes (the
root's classes, once, and nothing of a card), finds a card without text named
by its title and its accessible name and, on the Canvas map, by its tooltip,
and has the DOM map and the Canvas map choose the same level at three zooms.
`core/readable.test.ts` also holds `readableZoom` (the smallest zoom of each
level against the ladder, drawn at it and not a hair below, 0 without a
floor or a card, Infinity for a level that fits no rung) and names
shortened alike (`distinctLines`: told apart by their start, an ellipsis and
the part from the first character that differs, again among those that
still coincide, the lines before the last kept, the cards' own lines and
every level's in a built scene, the whole name as the title).
`browser/readable.spec.ts` measures every text the DOM map of the P2P story
draws in Chromium, at its fitted zoom and six steps out with its zoom
control: its computed size times the scale of what is around it.

`react/ScreenNumbers.test.tsx` checks the numbered fallback below the ladder,
full-name keys in English and German (including host reference labels), and
the whole-log cards at all 24 control settings over nine fixed zoom steps on
both drawing adapters. The readings distinguish reference numbers from case
counts. `core/shown-numbers.test.ts` compares live numbers with SVG/PNG numbers,
keys and notes at fixed zooms, with explicit text-state replay and the default
decision at a supplied screen zoom. `browser/screen-numbers.spec.ts` measures
the whole-log markers at fixed zoom 0.05 on both maps and compares their
positions, sizes, weights and paints with SVG and PNG; it checks key scrolling,
keyboard focus and Axe. `core/flow-loops.test.ts` checks ordinary model-loop
ink, protection, bounds, hit targets and culling; the browser parity lane adds
the model-loop fixture at zoom 1 and the small-zoom story checks its live ink.
`core/number-clearance.test.ts` checks two cards only 4.2 screen pixels apart,
links to their unchanged centres, displaced references visible outside node
culling, figure bounds and all 24 settled ELK control settings at fixed zooms.
Screen readings check marker clearance; Chromium checks actual glyph rectangles
on whole-log and 50% scenes on both maps, alongside SVG/PNG replay.
No strict image baseline is changed.

## Opening the map

`core/opening-view.test.ts` checks the fitted/readable boundary, reading
edges and centring, panel clearance and overview corners with hand-derived
boxes. `react/Opening.test.tsx` checks both maps at 1,400 × 900 with panels
placed by `react/panels.ts`: the whole log at the default thresholds opens
at 0.75 on the start with an overview; the vendor and the whole log at
50 % fit without one. No panel covers an activity. It checks the viewport
mark, click, drag and arrow keys, plain-fit opt-out, preserving a move on
control changes, reopening a graph and fit-then-control changes. A small
synthetic standalone Canvas map checks opening without keys and replacing
its graph or `openKey`. `browser/opening.spec.ts` runs the same scenes in
Chromium at 1,400 × 900, measures actual panel rectangles, reads each Canvas
frame's viewport independently of its overview, tests pointer and keyboard
navigation and accessibility, pans and zooms before control changes, and
replaces the graph. Stories in `stories/Opening.stories.tsx` fix their
settings and path rule; the small-zoom story fixes its zoom too.
`react/ReadableFloor.test.tsx` holds both maps to a smallest zoom asked for
as a readable level: the floor derived from the cards (`readableZoom`) and
held by React Flow, the zoom-out button stopping at it, the fit button
showing the whole map where it fits above the floor and otherwise the map
from its start at the floor with the overview, an element brought into
view at a host's request (a node, an edge by the middle of its route, with
the keyboard position following, the same object asking once and a token
asking again), the part in view told to the host when the view rests on
another part and said by the panel and the overview, and `openKey` (a
replaced graph under the same key keeps the view, a new key opens again).
`core/viewport.test.ts` holds `partInView` against hand-placed cards and
paths (events and constraints not counted, a line that only touches the
view's edge out, insets, a view without a zoom) and `elementPoint`;
`core/map-controller.test.ts` the `reveal` event.

## Paths at a small zoom

`core/paths-at-zoom.test.ts` holds `pathsAtZoom` against a small graph with
hand-derived widths (a line of 1.79 drawn from 0.28, protected by a mark, a
selection, the keyboard and a highlighted route) and against the whole BPIC
log with every activity and path selected, laid out by ELK: at the zoom
fitted into 1,400 × 900 it lets through exactly what the rule written out in
`core/zoom-cases.ts` gives (a line at least half a pixel wide, or each
activity's strongest path from and to a more frequent one, counted there
without the library: 84 of 656 lines), everything at zoom 1, more as the
zoom grows, and every activity between the start and the end at each step.
It drives a culled `CanvasRenderer` on that scene through zoom steps in and
out, a pan and a gesture, with both an unlimited and a finite budget: the lines it inks are exactly those let through
whose extent the hit index finds in view, the note's numbers count over the
whole map, never fall going in nor rise going out, stay with a pan and
change only once the gesture ends. `react/PathsAtZoom.test.tsx` holds the
React map to the same rule over the whole map at the fitted zoom and in
steps (changing only at rest, not with a pan), its note and the detail
panel's line, a selected path and one on a highlighted route, the table
view and the export of what the map shows against what it draws.
`react/Thresholds.test.tsx` reads the ladder with the rule on at the fitted
view: the Canvas reading draws with the frame's own `pathRule`, so the note
and the paths drawn are checked together.

## Parity of the four renderers

`browser/parity.spec.ts` opens each parity story (`stories/Parity.stories.tsx`),
reads what the interactive DOM map drew from computed styles and geometry, and
draws the scene the story wrote beside the map with the SVG export (parsed),
the Canvas map (recorded calls, one element at a time) and the PNG export
(recorded calls of the whole figure, each given to the element that draws the
same operation), in the theme the story wrote with its scene. Three stories
are drawn a second time in the dark scheme: the map in a page that prefers it,
the scene resolved in it; one story draws in a second theme (cards outlined 3
wide with corners of 10, names at 15, cases at 13, the frequency cue only as
its foot); and one gives the map no theme but sets
`--wf-paper`, `--wf-ink`, `--wf-focus` and `--wf-font` on its container (a hex
colour and two colour names), and writes the theme `useFlowTheme` resolves there,
which the other three renderers draw. The test checks that the scheme and
the theme reached what it compares, and for the host's variables that the theme
holds them as literals, that the SVG export writes them (and no `var(`, `oklch(`
or `color-mix(`) and that the DOM map paints its focus and writes its labels in
them. One story draws the element kinds in a theme with rules (a gateway's fill
and outline by kind, an activity tagged `manual` outlined 2 wide with corners of
8, its name at 600 in the rule's colour and its cue only as the foot by tag, a
re-added path's colour at half its opacity and a re-added activity's fill at
0.6 by state), and the test checks that all four renderers drew them. Each
reader draws an element at its opacity (its group's in the SVG export, the
computed opacity of it and its ancestors in the DOM map, the global alpha on
the Canvas) into every paint of it. For every node, edge, group and mark it compares the box,
outline paint and width, dash, fill, radius, shadow, colour band, a card's
frequency cue (the paint and the length, to the pixel, of its stripe and its
foot), band rule and each text's string, size, weight and paint with the SVG
export's, and for paths
their line join and arrowhead with its width (the head grows with the line), for arcs and self-loops their arrowhead and for
a mark with a label pill the pill's box, fill, outline and radius. Every
difference is listed in `browser/parity/expected.json` by renderer, element
kind, property and the two values, with its fixtures and number of elements; a
difference the list lacks fails, and so does an entry that is no longer found or
found on other elements. A change that removes a difference removes its entry;
a change that adds one fixes the drawing instead. Set `FLOW_PARITY_FOUND` to a
file name to write what was found. The readers and the check are tested in Node
by `core/renderer-parity.test.ts`.

Every renderer writes the texts the scene's text measure fitted, so the
Canvas recordings and a live Canvas map shorten labels as the SVG export
does. Two stories write BPIC global with activity names, in English with the
estimate and in German with another measure (`../fixtures/text-measures.ts`,
at the repository root), which the test gives the exports too; it checks
that the measure reached what it compares (more name lines than the
estimate).

A second test opens the interactive map and the live Canvas map side by side in
a theme with rules of the interactive states and one activity selected, records
the Canvas context's calls in the page, and checks that both draw the selected
activity's outline, fill and name in the rules' colours and every dimmed path at
the rule's opacity.

A third test opens the interactive map and the live Canvas map side by side
under the same four variables, with no theme and one activity selected, records
the Canvas context's calls in the page, and checks that the Canvas map fills the
activity, outlines it in the focus colour and writes its name in the ink and
the font the DOM map paints them in.

## Searching tests: seeds, deep mode and reproduction

A searching test draws its input from the generators in `support/` instead of
writing it by hand: `createRandom(seed)` is the random stream (`int`, `pick`,
`shuffle`, `weighted`, `sample`, `fork`); `families` in `graphs.ts` are graph
shapes by size and seed (chain, layered, tree, cyclic, hub, components, stages,
lanes, nested, overlaid, and long, German, right-to-left and markup-like
labels), `invalidFamilies` plant defects and say which; `positionsOf` and
`viewportOf` in `scenes.ts` arrange a graph (grid, layered, overlapping,
extreme; routes straight or bent) and look at it (ordinary, tiny, huge, far away, extreme zoom);
`schedule` and `interleave` in `schedules.ts` give event sequences on a fake
clock; `oddPositionsOf` places a point-sized, a huge and a twin node, and
`viewportAtSide` puts a view's edge across an element. `inkContext` and
`watch` in `ink.ts` record a Canvas draw: every call with its arguments, and
the box of canvas pixels each fill, stroke or text covers, attributed to the
element whose list entry was read last, so that a test can compare what was
drawn with a reference computed from the scene's data alone. `eventLog` in
`logs.ts` plays a random process tree (sequence, choice, parallel block, loop)
into traces and returns their directly-follows graph with the counts a host
sends; `generatedModel` in `models.ts` builds a BPMN-lite model from such a
log, a graph family or a random stage model, optionally with ids and labels
that XML must escape and with default flows; `mutate` in `bpmn-files.ts`
breaks the text of a BPMN file in one of `MUTATION_KINDS` (removed
attributes, duplicate ids, dangling references, unknown elements and
namespaces, missing diagram information, huge and non-numeric coordinates,
an empty process, nested sub-processes, a large file, truncation, garbage,
wrong element types, moved elements, the `wise` extension, entities).
`core/token-game.ts` plays a model's tokens by the BPMN rules (at most one
token per flow is explored) and reports stuck, unsafe and trapped states and
nodes that never take a token; `isWrong` judges a game that stopped at its
limit only by what it saw. Generators are hand-written and seeded; a
test adds no dependency. `core/bpmn-xml-text.test.ts` runs in jsdom
(`@vitest-environment jsdom`) to read a BPMN export with a second parser,
jsdom's `DOMParser`, which checks XML 1.0 well-formedness as the library's
own parser does not.

The shape of a searching test:

```ts
for (const seed of seeds(caseCount(20))) {
  const graph = families.layered(30, seed);
  expect(property(graph), caseLabel(seed, "layered 30")).toBe(true);
}
```

- `caseCount(base)` is how many cases run: `base` by default, so the ordinary
  gate stays within its time, and fifty times as many with `WISE_DEEP=1`
  (`WISE_DEEP=3` runs a hundred and fifty times as many). Each searching test
  is run in deep mode at least once before it is merged, and its deep run is
  recorded with the seed range, the number of cases, the duration and the result.
  A search that takes more than half of Vitest's 30 seconds on two cores names
  its own time limit, scaled with `caseCount(1)` (`SEARCH_TIMEOUT` for the
  searches over malformed input). A deep run of a large search outlives other
  limits; pass `--testTimeout=1800000 --hookTimeout=1800000` to let it finish.
- `seeds(count)` are the seeds, `1 … count` by default and `count` seeds from
  `WISE_SEED` on when it is set. Every assertion names its seed through
  `caseLabel(seed, detail)`, so the failure prints
  `seed 17 (step 3); replay with WISE_SEED=17`. To reproduce it, run the test
  with `WISE_SEED=17`: the failing case is the first one drawn, and the test
  stops at its assertion:

  ```sh
  WISE_SEED=17 npx vitest run tests/core/<file>.test.ts -t "<test name>"
  ```

  `-t` matches the test's full name, in which Vitest joins the enclosing
  `describe` names and the test's own with ` > `; a pattern that names a
  suite and a test writes that separator between them.

- A fault that a search finds is first shrunk and then pinned: `shrinkCase`
  in `shrink.ts` tries smaller sizes of the generated case and then
  `shrinkGraph` removes nodes, edges, groups and overlays while the predicate
  still fails (a predicate that throws counts as failing). The smallest case
  becomes a small, named, deterministic regression test that does not use the
  generators, and the fix follows it.
- A naive reference implementation in a searching test is obviously correct
  however slow, and shares no code with what it checks.
- A search that finds nothing is a result too: say what was searched, how many
  cases ran, and what kinds of input the generators cannot produce.

Malformed input at every public entry point: `malformedCase(seed)` in
`malformed.ts` draws one case per seed, its kind in turn: an invalid family
of `graphs.ts`, a cycle of group parents, an empty or one-activity graph,
zero cases, very long or markup labels, junk overlays, unknown group kinds or
junk `meta`, with positions missing, not finite, extreme or none, and a stream
of junk numbers (`junkNumber` for a host's numbers, `junkValue` for a
backend's, with strings; `junkCoordinate` for coordinates) and strings.
`Calls` runs a public function on it: an untyped error (`TypeError`,
`RangeError`, …) or a call beyond the time bound fails at once with the seed;
plain errors are counted, and a search fails on one its list of documented or
known errors does not name. `core/malformed-*.test.ts` and
`react/Malformed*.test.tsx` call every function and component of the four
entry points once per case, `caseCount(300)` cases; the React searches run
their cases through `eachCase`, which stops at the next case once the test
timed out, and await `caseSettled()` after each test, so that a test that
timed out does not go on rendering into the next one; what each does with
invalid input, documented and observed, is the table in
[invalid-input.md](invalid-input.md), which a tooling test keeps complete.
`react/MarkupSafety.test.tsx` checks that markup in the data stays text in
every output.

How a map reads across its abstraction settings is measured, not looked at.
`ladder.ts` holds the 24 rungs of the `abstraction` thresholds (activities
and paths at 0 %, the ladder's default 1 % and 3 %, 5 %, 10 %, 25 % and 50
%; keep connected on and off; stages shown and collapsed), the map's
pipeline (`shownGraph`: collapse, then thresholds; the React map joins the
given marks to the graph's first, so that a collapse moves them to their
stage), the committed scenes with their constraint overlays, and
`generatedScene(seed, magnitude)`: a seeded log near 100 events whose counts
are multiplied by a whole factor to 10², 10⁴, 10⁶ or 10⁷ events, so that the
map's shape is the same at every magnitude and only the numbers change.
`reading.ts` turns what a renderer drew into a `Reading` (cards, texts with
their boxes and sizes, badges, path lines with width and colour, self-loops,
the note on withheld paths, the legend's printed ends): `readCanvas` records
a Canvas draw (with the readable state it drew in), `react/map-reading.ts`
reads the React map's DOM, doing what the stylesheet does with the classes the
map writes on its root for its readable state (jsdom applies no stylesheet):
the card block of the root's level, scaled with the group titles and the
pills by the root's floor, and the labels the root sheds left out.
`checkReading` holds a reading at the fitted view and one with everything
any zoom draws against the scene: the map is not empty, with keep connected
every activity lies between the start and the end, the cards and paths are
the abstraction's, no card covers another, no arc label, path count or badge
covers a card or another of them, texts drawn at the fitted view are at
least 9 px on screen and are shed in the documented order (paths' labels,
self-loop labels, the cards' texts, the deviation pills last), path widths and
colours follow the legend, whose ends are the scene's, printed counts read
back within their precision (`parsePrinted`), and the note says how many
paths it shows of how many. `findingOf` names the failures that are open
decisions; every other failure fails the search (a text under 9 px was one
until the map kept its texts readable at every zoom; now it fails). `pictureOf` draws a rung
with its failures marked; `savePicture` (`pictures.ts`) writes it under
`reports/thresholds/`, and the tests attach it to their report (`annotate`,
copied to `.vitest/attachments/`). `core/thresholds.test.ts` reads the
Canvas drawing of every rung of the committed scenes (laid out by ELK, by
Dagre above 500 nodes and paths) and of 20 seeds at the four magnitudes, and
checks 200 random pairs of settings for elements that come back higher up;
`react/Thresholds.test.tsx` reads the React map and the Canvas map (Dagre
layouts) at every committed rung and one rung of each generated scene, and
changes the `abstraction` prop while layouts run. The story "Thresholds and
sizes" shows a scene's ladder with what the test measures under each map.

A model-based test drives a lifecycle with random schedules instead of random
input: `react/LayoutLifecycle.test.tsx` (the hook and the layout module) and
`react/MapLifecycle.test.tsx` (the map) draw operations on a fake clock from
`schedule`, apply them to the real code with the fake workers of
`support/workers.ts`, and after every step compare the state with a small
model of what must be true. `FakeLayoutWorker` stands in for `Worker` at an
ELK and a Dagre URL and answers a layout only when the schedule says so, also
after it was terminated; `HeldEngine` is an ELK instance a caller supplies,
answered the same way, which the layout module cannot interrupt. Every answer
carries its serial number in its coordinates (`replyOf`), and
`layoutSignature` names the inputs an answer was computed for, so a test can
tell whether what a map shows is the answer for its current request. The
failure message names the invariant, the seed and the step, and prints the
schedule so far; shrink such a schedule by hand or with `shrinkList` over its
operations.

The soak tests (`react/LayoutSoak.test.tsx`, `core/layout-soak.test.ts`) run
thousands of mount, change and unmount cycles and compare the collected heap
before and after. They need a garbage collection they can call and are
skipped, with that reason, unless it is exposed:

```sh
NODE_OPTIONS=--expose-gc npx vitest run tests/react/LayoutSoak.test.tsx tests/core/layout-soak.test.ts
```

## Benchmark

`npm run bench` builds the library and times it on large and dense inputs:
scene preparation of 100,000 to 1,000,000 flows with and without self-loops,
simplification of the cyclic family at 50,000 and 100,000 activities (default
options, `keepConnected: false`, and thresholds 0.3/0.2), the Canvas draw per
frame of a moving view (a sparse 100,000-activity scene, a hub with 50,000 flows
in view with the default budget, with `"all"` and with every flow highlighted,
the same hub with 5,000 flows with the default budget and with every flow
highlighted, a fit-all view of 50,000 activities), the React map's readiness with supplied positions for 1,000 to
20,000 activities, the first scene and the refined layout of a map without
positions (sparse and dense, 100 and 500 activities), the time from aborting a
layout to its terminated worker, and the scene memory retained per activity
and per flow. It is not part of the gate: the counted-work tests of `core/`
and `react/` are, and they stay so. The benchmark reports time and fails only
when a case cannot run.

```sh
npm run bench                        # full mode: 5 trials after 1 warm-up, about 15–20 minutes
npm run bench -- --quick             # 2 trials after 1 warm-up, memory at 50,000 and 100,000
npm run bench -- --only draw. --only map-ready   # cases whose id contains one of the texts
npm run bench -- --trials 9 --out artifacts/bench-before   # more trials, another directory
npm run bench -- --loaded "other jobs on the host"         # label the run as measured on a loaded machine
```

It needs only what the repository installs: Node cases run in a process of
their own with `--expose-gc` (`bench/node.ts`, bundled by Vite against
`dist/`), browser cases on a fresh page in the Chromium that Playwright
installed for the browser tests (`bench/page/`, served from a Vite build), and
the memory cases through `scripts/scene-memory.mjs`. Nothing of it is in the
published package.

It writes `artifacts/bench/bench.json` (every sample, the inputs' sizes and
counts, commit, machine, load average before and after, Node, V8, Chromium and
Playwright versions, the library's gzipped JavaScript) and
`artifacts/bench/bench.md`, a table per group. How to read the table:

- **Median, Min, Max** over the trials, after the warm-up. A Canvas trial is a
  gesture of six frames panned by a pixel each, and every frame is a sample;
  its time is the renderer's own draw time (`lastDraw.ms`, what the adaptive
  budget times), without rasterisation, in headless Chromium without a GPU.
  The adaptive budget moves a step after each gesture, so its warm-up goes on
  until a gesture draws as many flows as the one before (at most eight more
  gestures) and the trials time the budget it settles on.
- **Measured on** says what was measured: sizes, how much was in view and how
  many flows the budget drew, which renderer the map chose, how a layout ended.
- **Before** is the number measured before the repairs of this line,
  **During the repairs** one recorded while they were made, both from
  `bench/reference.json` with their sources and conditions listed below the
  tables. Most were taken by a harness outside the repository or by single
  runs, and none on a host known to be idle; compare in kind, not to the
  millisecond.
- **Target** is the latency target set for the repairs, with `met` or `not met`
  for the median where the target is a bound (16.7 ms per frame in motion, the
  first scene of a dense 500-activity map under 1 s, a 20,000-activity map with
  positions ready under 500 ms) or asks that preparation completes.
- A run is labelled **measured on a loaded machine** when `--loaded` says so
  or the load average reached half the cores. Numbers from a loaded machine
  show the shape of the costs, not the latency a user sees; rerun on an idle
  host for that, and compare two runs on the same host by their JSON files.

To compare a change, run the benchmark before and after it with `--out` into
two directories on the same idle host and the same mode.

## Strict visual CI and deliberate approval

Strict visual tests use `updateSnapshots: "none"`; missing or changed baselines
fail without recording. CI pins Playwright 1.64.1 and runs the lane in the
Playwright image the provenance record names by digest, the image the Linux
images are captured in. For an intended visual change, outside CI on the
corresponding OS (for Linux, in that image):

```sh
npm run test:visual:approve
npm run test:visual -- --update-snapshots=none
```

Approval refuses to run in CI. Review every proposed image and its behavior.
Never rename a `darwin` baseline to `linux`. Linux approval requires the matching
Linux environment. Failure artifacts contain actual/diff images and traces,
not automatically approved snapshots.

The origin of the current reference images is recorded in
[visual/baseline-provenance.json](visual/baseline-provenance.json): the source
commit, the date of the owner's approval, the macOS version and the container
image the Linux images were captured in, and the SHA-256 of all eighteen files.
The Linux images are captured in that container, and GitHub's strict job runs
in the same container (`check:workflows` compares the two digests), so an image
approved locally is checked on GitHub where it was made.

On Linux the browser takes its fonts from [visual/fonts.conf](visual/fonts.conf),
which the visual configuration passes as `FONTCONFIG_FILE` to both the strict
run and the approval: `system-ui`, `sans-serif` and `sans` become Liberation
Sans, so the Linux images show the map in a font with a bold face and do not
depend on the machine's default font. `visual/fonts.spec.ts` reads from Chromium
the faces the panel's heading, a card's name and its counts are drawn in and
fails if they are not Liberation Sans; it is skipped on macOS, whose images
depend on the system font of the macOS version in the record (Chromium on
macOS ignores fontconfig). The library's own font list is unchanged: on an
analyst's Linux machine `system-ui` stays the right first choice.
A tooling test imports the visual configuration to check that it hands the
file to the browser; Node strips its TypeScript types from 22.18 on, so
`npm run test:tooling` needs Node 22.18 or later, or 24.

To check or capture the Linux images, run the record's `command` in its image,
in a clone used only for this (its `npm ci` installs Linux packages into the
clone's `node_modules`):

```sh
image=$(node -p "require('./tests/visual/baseline-provenance.json').linux.image")
docker run --rm --platform linux/amd64 --ipc=host -v "$PWD":/work -w /work "$image" \
  bash -c 'npm ci && npm run test:visual -- --update-snapshots=none'
# To capture the images for approval instead: npm ci && npm run test:visual:approve
```

Use `fc-match 'system\-ui'` to ask fontconfig about `system-ui`, with
`FONTCONFIG_FILE=tests/visual/fonts.conf` for the lane's view: unescaped, the
hyphen starts a size and the name asked about is `system`. Chromium itself
resolves `system-ui` by asking fontconfig for `sans`, so `fc-match sans` and
`fc-match sans:bold` give the faces the map's text is drawn in.
