# Tests

The executable CI contract and release procedure are in [docs/CI.md](../docs/CI.md).

| Directory | Purpose | Command |
| --- | --- | --- |
| `core/` | Node algorithms, seeded graph invariants, deterministic layout, filters, overlays, Canvas geometry, SVG/BPMN | `npm run test:core` |
| `support/` | Seeded generators for searching tests: random stream, graph families, positions and viewports, event schedules, shrinking, event logs and their directly-follows graphs, BPMN-lite models, mutated BPMN files, malformed input for every public entry point; fake layout workers and engines for lifecycle tests; a recording 2D context that says which element inked which canvas pixels; the ladder of abstraction settings with scenes of four magnitudes, readings of what a map drew with the properties they must hold, and the readings of an SVG export several tests share | imported by `core/` and `react/` tests and the story "Thresholds and sizes" |
| `fixtures/` | A directly-follows graph of an observed order-to-cash process (`o2c-observed.json`), read by the repositioning tests | imported by `core/` tests |
| `react/` | jsdom callbacks, keyboard interaction, state replacement and renderer lifecycles | `npm run test:components` |
| `tooling/` | Negative checks for architecture boundaries, the source lint, workflow policies, artifact budgets and the benchmark's report; the core entry point's built declarations against `scripts/core-exports.json`, deprecations and every exported name of the four entry points against `docs/API.md`, `tokens.css` against the token table; the table of invalid input against the entry points | `npm run test:tooling` |
| `package/` | Separate consumer of the actual npm tarball; NodeNext types and real browser assets/lifecycle | `npm run test:package` |
| `browser/` | Production Storybook accessibility and keyboard tests, and the map's paint order in a real browser | `npm run storybook:build` then `npm run test:browser` |
| `visual/` | Ten behavior checks including six screenshots and the large Canvas scene | `npm run test:visual` |
| `bench/` | The benchmark: times on large and dense inputs in Node and in Chromium, beside the numbers measured before the repairs and the targets; not a gate | `npm run bench` |

`npm run check` runs lint, typecheck, architecture/workflow guards, tooling tests
and unit/component coverage. Vitest counts all implementation files and enforces
reviewed floors (the measured values rounded down). It refuses focused `.only`
tests in CI. Reported coverage is not a claim of semantic completeness; graph
routes still differ from observed variants and grouped metric approximations
still require host evidence.

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
test adds no dependency.

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
  A deep run of a large search outlives Vitest's test timeout of 30 seconds;
  pass `--testTimeout=1800000 --hookTimeout=1800000` to let it finish.
- `seeds(count)` are the seeds, `1 … count` by default and `count` seeds from
  `WISE_SEED` on when it is set. Every assertion names its seed through
  `caseLabel(seed, detail)`, so the failure prints
  `seed 17 (step 3); replay with WISE_SEED=17`. To reproduce it, run the test
  with `WISE_SEED=17`: the failing case is the first one drawn, and the test
  stops at its assertion:

  ```sh
  WISE_SEED=17 npx vitest run tests/core/<file>.test.ts -t "<test name>"
  ```

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
entry points once per case, `caseCount(300)` cases; what each does with
invalid input, documented and observed, is the table in
[invalid-input.md](invalid-input.md), which a tooling test keeps complete.
`react/MarkupSafety.test.tsx` checks that markup in the data stays text in
every output.

How a map reads across its controls is measured, not looked at.
`ladder.ts` holds the 24 rungs of the controls (activities and paths at 0 %,
the default 1 % and 3 %, 5 %, 10 %, 25 % and 50 %; keep connected on and
off; stages shown and collapsed), the map's pipeline (`shownGraph`: collapse,
then thresholds), the committed scenes with their constraint overlays, and
`generatedScene(seed, magnitude)`: a seeded log near 100 events whose counts
are multiplied by a whole factor to 10², 10⁴, 10⁶ or 10⁷ events, so that the
map's shape is the same at every magnitude and only the numbers change.
`reading.ts` turns what a renderer drew into a `Reading` (cards, texts with
their boxes and sizes, badges, path lines with width and colour, self-loops,
the note on withheld paths, the legend's printed ends): `readCanvas` records
a Canvas draw, `react/map-reading.ts` reads the React map's DOM.
`checkReading` holds a reading at the fitted view and one with everything
any zoom draws against the scene: the map is not empty, with keep connected
every activity lies between the start and the end, the cards and paths are
the abstraction's, no card covers another, no arc label, path count or badge
covers a card or another of them, texts drawn at the fitted view are at least
9 px on screen and are shed in the documented order, path widths and colours
follow the legend, whose ends are the scene's, printed counts read back within
their precision (`parsePrinted`), and the note says how many paths it shows of
how many. `findingOf` names the failures that are open decisions; every other
failure fails the search. `pictureOf` draws a rung with its failures marked;
`savePicture` (`pictures.ts`) writes it under `reports/thresholds/`, and the
tests attach it to their report (`annotate`, copied to `.vitest-attachments/`).
`core/thresholds.test.ts` reads the Canvas drawing of every rung of the
committed scenes (laid out by ELK, by Dagre above 500 nodes and paths) and
of 20 seeds at the four magnitudes,
and checks 200 random pairs of settings for elements that come back higher
up; `react/Thresholds.test.tsx` reads the React map and the Canvas map
(Dagre layouts) at every committed rung and one rung of each generated scene,
and changes the controls while layouts run. The story "Thresholds and sizes"
shows a scene's ladder with what the test measures under each map.

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
fail without recording. CI pins Playwright 1.61.1 and runs Ubuntu 24.04 Chromium.
The hosted OS image can change independently and must still pass. For an intended
visual change, outside CI on the corresponding OS:

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
image the Linux images were captured in, and the SHA-256 of all twelve files.
The Linux images were captured in that container, not on the hosted runner; a
strict run on the hosted runner is what qualifies them there.
